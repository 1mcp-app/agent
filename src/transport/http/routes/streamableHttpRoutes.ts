import { MCP_SERVER_NAME, MCP_SERVER_VERSION, STREAMABLE_HTTP_ENDPOINT } from '@src/constants.js';
import { AsyncLoadingOrchestrator } from '@src/core/capabilities/asyncLoadingOrchestrator.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { SessionAdmissionCapacityError } from '@src/core/server/sessionAdmission.js';
import { withProjectBinding } from '@src/domains/project-selection/projectBindingScope.js';
import logger from '@src/logger/logger.js';
import { withHttpProjectAdmission } from '@src/transport/http/middlewares/projectAdmission.js';
import {
  getPresetName,
  getTagExpression,
  getTagFilterMode,
  getTagQuery,
  getValidatedTags,
} from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import tagsExtractor from '@src/transport/http/middlewares/tagsExtractor.js';
import { StreamableSessionRepository } from '@src/transport/http/storage/streamableSessionRepository.js';
import { getRequestSessionBinding } from '@src/transport/http/streamableSessionAuthorization.js';
import { StreamableSessionLifecycle, StreamableSessionStatus } from '@src/transport/http/streamableSessionLifecycle.js';
import {
  extractTemplateContextRequest,
  hasExplicitTemplateContextProof,
} from '@src/transport/http/utils/contextExtractor.js';
import { sendBadRequest, sendInternalError, sendNotFound } from '@src/transport/http/utils/httpErrorHandler.js';
import { authorizeRequestTemplateContext } from '@src/transport/http/utils/templateContextAuthority.js';
import { logError, logWarn } from '@src/transport/http/utils/unifiedLogger.js';

import { Request, RequestHandler, Response, Router } from 'express';

import { prepareHttpRequestContext } from './inspectRequestContext.js';

/**
 * Type guard to check if a request body is an initialize request.
 */
function isInitializeRequest(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'method' in body &&
    body.method === 'initialize' &&
    'jsonrpc' in body &&
    body.jsonrpc === '2.0'
  );
}

/**
 * Extract protocol version from initialize request body.
 * Similar to contextExtractor pattern - extract directly from req.body.params
 */
function extractProtocolVersion(body: unknown): string | null {
  try {
    const reqBody = body as {
      params?: {
        protocolVersion?: unknown;
      };
    };

    if (reqBody?.params?.protocolVersion && typeof reqBody.params.protocolVersion === 'string') {
      return reqBody.params.protocolVersion;
    }
    return null;
  } catch (_error) {
    logWarn('streamableHttpRoutes.failed.to.extract.protocol.version.from.request.body.3edac56e');
    return null;
  }
}

/**
 * Wraps an Express response to log when status >= 400 is set.
 * This catches SDK responses that don't throw errors.
 */
function wrapResponseForLogging(req: Request, res: Response, sessionId: string | undefined): Response {
  const originalStatus = res.status.bind(res);
  const originalJson = res.json.bind(res);
  let logged = false;

  const logIfNeeded = (_responseBody?: unknown) => {
    if (logged || res.statusCode < 400) return;
    logged = true;

    const level = res.statusCode >= 500 ? 'error' : 'warn';
    const logFn = level === 'error' ? logError : logWarn;
    logFn('http.response-error', {
      method: req.method,
      sessionId,
      statusCode: res.statusCode,
    });
    // Log request/response details at debug level for troubleshooting
    logger.debug('streamableHttpRoutes.sdk.error.details.0633179d', { sessionId: sessionId });
  };

  // Intercept res.status() to detect when error codes are set
  res.status = function (code: number): Response {
    const result = originalStatus(code);
    if (code >= 400) {
      logIfNeeded();
    }
    return result;
  };

  // Intercept res.json() to capture response body for error logging
  res.json = function (body: unknown): Response {
    if (res.statusCode >= 400) {
      logIfNeeded(body);
    }
    return originalJson(body);
  };

  // Intercept res.writeHead() - SDK uses this via Hono adapter
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
  const origWriteHead = res.writeHead.bind(res) as (...args: any[]) => Response;
  res.writeHead = function (statusCode: number, ...rest: any[]): Response {
    if (statusCode >= 400) {
      res.statusCode = statusCode;
      logIfNeeded();
    }
    return origWriteHead(statusCode, ...rest);
  };
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */

  return res;
}

/**
 * Builds the inbound connection config from request data.
 *
 * @param res - Express response object containing validated middleware data
 * @param req - Express request object
 * @param customTemplate - Optional custom template to include
 * @returns The inbound connection configuration
 */
function buildConfigFromRequest(res: Response, req: Request, customTemplate?: string) {
  return {
    tags: getValidatedTags(res),
    tagExpression: getTagExpression(res),
    tagFilterMode: getTagFilterMode(res),
    tagQuery: getTagQuery(res),
    presetName: getPresetName(res),
    enablePagination: req.query.pagination === 'true',
    customTemplate,
  };
}

/** Keep in-flight SDK work and open responses alive independently of ordinary socket closure. */
async function withSessionActivity(
  lifecycle: StreamableSessionLifecycle,
  sessionId: string,
  res: Response,
  handle: () => Promise<void>,
): Promise<void> {
  const release = lifecycle.protectSession(sessionId);
  let workFinished = false;
  let responseFinished = res.writableEnded;
  const releaseWhenFinished = () => {
    if (workFinished && responseFinished) release(res.statusCode < 400);
  };
  const finishResponse = () => {
    responseFinished = true;
    releaseWhenFinished();
  };
  res.on('finish', finishResponse);
  res.on('close', finishResponse);
  try {
    await handle();
  } finally {
    workFinished = true;
    responseFinished ||= res.writableEnded;
    releaseWhenFinished();
  }
}

function sendSessionError(req: Request, res: Response, error: unknown): void {
  if (error instanceof SessionAdmissionCapacityError) {
    res.status(503).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Session capacity exhausted. Retry after a session is released.' },
      id: null,
    });
    return;
  }
  sendInternalError(res, error, {
    method: req.method,
    path: req.path,
    sessionId: req.headers['mcp-session-id'] as string | undefined,
    phase: 'handleRequest',
  });
}

export function setupStreamableHttpRoutes(
  router: Router,
  serverManager: ServerManager,
  sessionRepository: StreamableSessionRepository,
  authMiddleware: RequestHandler,
  availabilityMiddleware?: RequestHandler,
  asyncOrchestrator?: AsyncLoadingOrchestrator,
  customTemplate?: string,
  injectedLifecycle?: StreamableSessionLifecycle,
): void {
  const middlewares = [tagsExtractor, authMiddleware];

  // Add availability middleware if provided
  if (availabilityMiddleware) {
    middlewares.push(availabilityMiddleware);
  }

  const lifecycle =
    injectedLifecycle || new StreamableSessionLifecycle(serverManager, sessionRepository, asyncOrchestrator);

  const handleAdmittedProjectPost = withHttpProjectAdmission(serverManager, async (req: Request, res: Response) => {
    try {
      const headerSessionId = req.headers['mcp-session-id'] as string | undefined;
      const isInitialize = isInitializeRequest(req.body);
      const extractedContext = extractTemplateContextRequest(req);
      const sessionId = headerSessionId ?? (isInitialize ? extractedContext?.proof?.sessionId : undefined);
      const authorization = extractedContext
        ? authorizeRequestTemplateContext({ ...extractedContext, transportSessionId: sessionId })
        : undefined;
      if (hasExplicitTemplateContextProof(req) && authorization?.status !== 'trusted') {
        sendBadRequest(res, 'Request context proof rejected');
        return;
      }
      const result = await lifecycle.resolvePostSession({
        sessionId,
        deferActivity: true,
        authorizationBinding: getRequestSessionBinding(req),
        isInitializeRequest: isInitialize,
        createSessionData: () => ({
          config: buildConfigFromRequest(res, req, customTemplate),
          context: authorization?.status === 'trusted' ? authorization.context : undefined,
          contextProof:
            authorization?.status === 'trusted' && authorization.provenance === 'verified-local'
              ? extractedContext?.proof
              : undefined,
        }),
      });

      if (result.status === StreamableSessionStatus.Missing) {
        // The MCP spec reserves 404 for a session ID the server no longer knows;
        // a non-initialize request without the header is a 400.
        if (!headerSessionId && !isInitialize) {
          sendBadRequest(res, 'Bad Request: Mcp-Session-Id header is required');
          return;
        }
        sendNotFound(res, 'Session not found. Send an initialize request first to create a new session.', {
          sessionId: result.sessionId,
        });
        return;
      }

      if ('persisted' in result && !result.persisted) {
        logger.warn('streamableHttpRoutes.new.session.was.created.but.not.persisted.c1345354');
      }

      const actualSessionId = result.sessionId;
      const transport = result.transport;
      const wrappedRes = wrapResponseForLogging(req, res, actualSessionId);
      const protocolVersion = isInitialize ? extractProtocolVersion(req.body) : null;

      if ('isRestored' in transport && typeof transport.isRestored === 'function' && transport.isRestored()) {
        logger.debug('streamableHttpRoutes.handling.request.for.restored.session.3031f880', {
          sessionId: actualSessionId,
          method: (req.body as { method?: string })?.method,
        });
      }

      await withSessionActivity(lifecycle, actualSessionId, res, async () => {
        if (!isInitialize && authorization?.status === 'trusted') {
          const preparedContext = await prepareHttpRequestContext(
            serverManager,
            req,
            res,
            buildConfigFromRequest(res, req, customTemplate),
          );
          if (!('bindingId' in preparedContext)) {
            throw new Error('Project binding is no longer available');
          }
          const bindingId = preparedContext.bindingId;
          const bindingContext = serverManager.getTemplateServerManager().getBindingContext(bindingId);
          if (!bindingContext) throw new Error('Project binding is no longer available');
          await withProjectBinding(bindingId, bindingContext, () => transport.handleRequest(req, wrappedRes, req.body));
        } else {
          await transport.handleRequest(req, wrappedRes, req.body);
        }
      });

      if (isInitialize && protocolVersion) {
        try {
          lifecycle.storeInitializeResponse(actualSessionId, {
            protocolVersion,
            capabilities: {},
            serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
          });
          logger.debug('streamableHttpRoutes.stored.initialize.response.for.session.9fcc1c4d');
        } catch (err) {
          logger.warn('streamableHttpRoutes.failed.to.store.initialize.response.for.92e5cefc', { error: err });
        }
      }
    } catch (error) {
      sendSessionError(req, res, error);
    }
  });
  const handleProjectPost: RequestHandler = async (req, res, next) => {
    try {
      const binding = getRequestSessionBinding(req);
      if (binding !== undefined) {
        const extracted = extractTemplateContextRequest(req);
        const sessionId =
          (req.headers['mcp-session-id'] as string | undefined) ??
          (isInitializeRequest(req.body) ? extracted?.proof?.sessionId : undefined);
        if (sessionId && !lifecycle.isSessionAuthorized(sessionId, binding)) {
          let canInitialize = false;
          if (isInitializeRequest(req.body)) {
            canInitialize = lifecycle.canInitializeSignedSession(
              sessionId,
              binding,
              extracted?.context,
              extracted?.proof,
            );
          }
          if (!canInitialize) {
            sendNotFound(res, 'Session not found. Send an initialize request first to create a new session.');
            return;
          }
        }
      }
      await handleAdmittedProjectPost(req, res, next);
    } catch (error) {
      sendInternalError(res, error, { method: req.method, path: req.path, phase: 'sessionAuthorization' });
    }
  };
  router.post(STREAMABLE_HTTP_ENDPOINT, ...middlewares, handleProjectPost);

  router.get(STREAMABLE_HTTP_ENDPOINT, ...middlewares, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId) {
        sendBadRequest(res, 'Invalid params: sessionId is required');
        return;
      }

      const result = await lifecycle.resolveExistingSession(sessionId, getRequestSessionBinding(req), false);

      if (result.status === StreamableSessionStatus.Missing) {
        sendNotFound(res, 'No active streamable HTTP session found for the provided sessionId', { sessionId });
        return;
      }

      const wrappedRes = wrapResponseForLogging(req, res, sessionId);
      await withSessionActivity(lifecycle, sessionId, res, () =>
        result.transport.handleRequest(req, wrappedRes, req.body),
      );
    } catch (error) {
      sendSessionError(req, res, error);
    }
  });

  router.delete(STREAMABLE_HTTP_ENDPOINT, ...middlewares, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId) {
        sendBadRequest(res, 'Invalid params: sessionId is required');
        return;
      }

      const result = await lifecycle.resolveExistingSession(sessionId, getRequestSessionBinding(req), false);

      if (result.status === StreamableSessionStatus.Missing) {
        sendNotFound(res, 'No active streamable HTTP session found for the provided sessionId', { sessionId });
        return;
      }

      const wrappedRes = wrapResponseForLogging(req, res, sessionId);
      await withSessionActivity(lifecycle, sessionId, res, () => result.transport.handleRequest(req, wrappedRes));
      await lifecycle.completeExplicitDelete(sessionId);
    } catch (error) {
      sendSessionError(req, res, error);
    }
  });
}

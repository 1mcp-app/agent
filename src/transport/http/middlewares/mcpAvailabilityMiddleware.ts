import { ConfigManager } from '@src/config/configManager.js';
import { LoadingState } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { secureLogger } from '@src/logger/secureLogger.js';
import { sanitizeOAuthServerList } from '@src/logger/secureLogger.js';

import { NextFunction, Request, Response } from 'express';

import { getValidatedTags } from './scopeAuthMiddleware.js';

/**
 * Extended request interface to include MCP loading information
 */
export interface McpRequest extends Request {
  mcpAvailability?: {
    availableServers: string[];
    unavailableServers: string[];
    loadingServers: string[];
    oauthRequiredServers: string[];
    hasPartialAvailability: boolean;
    allServersReady: boolean;
    requestedTags?: string[];
    totalServersBeforeFiltering?: number;
  };
}

/**
 * Middleware options for MCP availability checking
 */
export interface McpAvailabilityOptions {
  /** Whether to allow requests when some servers are still loading */
  allowPartialAvailability?: boolean;
  /** Whether to include OAuth-required servers as available */
  includeOAuthServers?: boolean;
  /** Custom error message for unavailable servers */
  unavailableMessage?: string;
  /** Custom error message for loading servers */
  loadingMessage?: string;
}

/**
 * Default options for MCP availability middleware
 */
const DEFAULT_OPTIONS: Required<McpAvailabilityOptions> = {
  allowPartialAvailability: true,
  includeOAuthServers: false,
  unavailableMessage: 'Some requested MCP servers are not available',
  loadingMessage: 'Some requested MCP servers are still loading',
};

/**
 * Creates middleware that checks MCP server availability before processing requests
 *
 * This middleware examines the loading state of MCP servers and provides different
 * behaviors based on server availability and configuration options.
 *
 * @param loadingManager - The MCP loading manager instance
 * @param options - Configuration options for availability checking
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * const availabilityMiddleware = createMcpAvailabilityMiddleware(loadingManager, {
 *   allowPartialAvailability: true,
 *   includeOAuthServers: false,
 * });
 *
 * router.post('/mcp', availabilityMiddleware, (req, res) => {
 *   // Handle MCP request with availability info in req.mcpAvailability
 * });
 * ```
 */
export function createMcpAvailabilityMiddleware(
  loadingManager?: McpLoadingManager,
  options: McpAvailabilityOptions = {},
) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return (req: McpRequest, res: Response, next: NextFunction) => {
    try {
      // If no loading manager, assume all servers are available (legacy mode)
      if (!loadingManager) {
        debugIf('No loading manager - assuming all servers available');
        next();
        return;
      }

      // Get requested tags from scope auth middleware
      const requestedTags = getValidatedTags(res);

      // If no specific tags requested, get all servers
      const stateTracker = loadingManager.getStateTracker();
      const allStates = stateTracker.getAllServerStates();

      // Filter servers based on requested tags
      // Tags are used to control which MCP servers are available for requests.
      // When tags are specified, only servers that have ALL the requested tags will be included.
      const allServers = Array.from(allStates.keys());
      let relevantServers: string[];

      if (requestedTags && requestedTags.length > 0) {
        // Get server configurations to access tags
        const configManager = ConfigManager.getInstance();
        const transportConfig = configManager.getTransportConfig();

        // Filter servers that have ALL requested tags
        // This implements the "AND" logic: servers must have every requested tag
        relevantServers = allServers.filter((serverName) => {
          const serverConfig = transportConfig[serverName];
          if (!serverConfig || !serverConfig.tags) {
            // Server has no tags, so it doesn't match any tag request
            return false;
          }

          // Check if server has ALL requested tags (case-insensitive matching)
          const serverTags = serverConfig.tags.map((tag) => tag.toLowerCase());
          const requestedTagsLower = requestedTags.map((tag) => tag.toLowerCase());

          return requestedTagsLower.every((requestedTag) => serverTags.includes(requestedTag));
        });

        debugIf(() => ({
          message: `Filtered ${relevantServers.length}/${allServers.length} servers with tags: ${requestedTags.join(', ')}`,
          meta: { relevantServers: relevantServers.length, allServers: allServers.length, requestedTags },
        }));
      } else {
        relevantServers = allServers;
        debugIf(() => ({
          message: `Checking availability for all ${relevantServers.length} servers`,
          meta: { relevantServers: relevantServers.length },
        }));
      }

      // Categorize servers by state with detailed error information
      const availableServers: string[] = [];
      const unavailableServers: string[] = [];
      const loadingServers: string[] = [];
      const oauthRequiredServers: string[] = [];

      // Collect detailed server information for error responses
      const serverDetails: Record<
        string,
        {
          state: string;
          error?: string;
          duration?: number;
          retryCount?: number;
          authUrl?: string;
        }
      > = {};

      for (const serverName of relevantServers) {
        const serverInfo = stateTracker.getServerState(serverName);
        if (!serverInfo) {
          unavailableServers.push(serverName);
          serverDetails[serverName] = {
            state: 'unknown',
            error: 'Server not found in loading state tracker',
          };
          continue;
        }

        // Store detailed information for this server
        serverDetails[serverName] = {
          state: serverInfo.state,
          error: serverInfo.error?.message,
          duration: serverInfo.duration,
          retryCount: serverInfo.retryCount,
          authUrl: serverInfo.authorizationUrl,
        };

        switch (serverInfo.state) {
          case LoadingState.Ready:
            availableServers.push(serverName);
            break;
          case LoadingState.Loading:
          case LoadingState.Pending:
            loadingServers.push(serverName);
            break;
          case LoadingState.AwaitingOAuth:
            if (opts.includeOAuthServers) {
              availableServers.push(serverName);
            } else {
              oauthRequiredServers.push(serverName);
            }
            break;
          case LoadingState.Failed:
          case LoadingState.Cancelled:
          default:
            unavailableServers.push(serverName);
            break;
        }
      }

      // Calculate availability metrics
      const hasPartialAvailability = availableServers.length > 0;
      const allServersReady = relevantServers.length > 0 && availableServers.length === relevantServers.length;

      // Add availability info to request
      req.mcpAvailability = {
        availableServers,
        unavailableServers,
        loadingServers,
        oauthRequiredServers,
        hasPartialAvailability,
        allServersReady,
        requestedTags: requestedTags && requestedTags.length > 0 ? requestedTags : undefined,
        totalServersBeforeFiltering: requestedTags && requestedTags.length > 0 ? allServers.length : undefined,
      };

      // Log availability status
      const tagInfo =
        requestedTags && requestedTags.length > 0
          ? ` (filtered by tags: ${requestedTags.join(', ')}, ${allServers.length} total)`
          : '';
      const oauthCount = oauthRequiredServers.length;
      secureLogger.debug(
        `MCP Availability: ${availableServers.length}/${relevantServers.length} ready, ` +
          `${loadingServers.length} loading, ${unavailableServers.length} failed, ` +
          `${oauthCount} OAuth required${tagInfo}`,
      );

      // Decide whether to proceed based on availability
      if (relevantServers.length === 0) {
        // No servers configured - proceed normally
        next();
        return;
      }

      if (allServersReady) {
        // All servers ready - proceed normally
        next();
        return;
      }

      if (!hasPartialAvailability) {
        // No servers available - return error with detailed information
        logger.warn('No MCP servers available for request');

        // Create detailed error message including specific server failures
        const failureDetails = unavailableServers
          .map((name) => {
            const detail = serverDetails[name];
            if (detail.error) {
              return `${name}: ${detail.error} (retries: ${detail.retryCount || 0})`;
            }
            return `${name}: ${detail.state}`;
          })
          .join(', ');

        const detailedMessage =
          unavailableServers.length > 0
            ? `No MCP servers are currently available. Failed servers: ${failureDetails}`
            : 'No MCP servers are currently available';

        res.status(503).json({
          error: 'service_unavailable',
          message: detailedMessage,
          details: {
            total: relevantServers.length,
            available: availableServers.length,
            loading: loadingServers.length,
            failed: unavailableServers.length,
            oauthRequired: oauthRequiredServers.length,
            availableList: availableServers,
            loadingList: loadingServers,
            failedList: unavailableServers,
            oauthRequiredList: sanitizeOAuthServerList(oauthRequiredServers),
          },
          serverDetails,
          loading: {
            isComplete: stateTracker.isLoadingComplete(),
            summary: loadingManager.getSummary(),
          },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (opts.allowPartialAvailability) {
        // Some servers available - proceed with warning
        logger.info(
          `Proceeding with partial MCP availability: ${availableServers.length}/${relevantServers.length} servers ready`,
        );

        // Add warning headers
        res.setHeader('X-MCP-Partial-Availability', 'true');
        res.setHeader('X-MCP-Available-Count', availableServers.length.toString());
        res.setHeader('X-MCP-Total-Count', relevantServers.length.toString());

        if (loadingServers.length > 0) {
          res.setHeader('X-MCP-Loading-Count', loadingServers.length.toString());
        }

        next();
        return;
      } else {
        // Partial availability not allowed - return error with detailed information
        logger.warn('Partial MCP availability not allowed - blocking request');

        const primaryReason = loadingServers.length > 0 ? 'loading' : 'unavailable';
        let detailedMessage = primaryReason === 'loading' ? opts.loadingMessage : opts.unavailableMessage;

        // Add specific error details for unavailable servers
        if (unavailableServers.length > 0) {
          const failureDetails = unavailableServers
            .map((name) => {
              const detail = serverDetails[name];
              if (detail.error) {
                return `${name}: ${detail.error} (retries: ${detail.retryCount || 0})`;
              }
              return `${name}: ${detail.state}`;
            })
            .join(', ');
          detailedMessage += `. Failed servers: ${failureDetails}`;
        }

        // Add loading server details
        if (loadingServers.length > 0) {
          const loadingDetails = loadingServers
            .map((name) => {
              const detail = serverDetails[name];
              const retryInfo = detail.retryCount && detail.retryCount > 0 ? ` (retry ${detail.retryCount})` : '';
              return `${name}: ${detail.state}${retryInfo}`;
            })
            .join(', ');
          detailedMessage +=
            primaryReason === 'loading'
              ? `. Loading servers: ${loadingDetails}`
              : ` Currently loading: ${loadingDetails}`;
        }

        res.status(primaryReason === 'loading' ? 202 : 503).json({
          error: primaryReason === 'loading' ? 'servers_loading' : 'servers_unavailable',
          message: detailedMessage,
          details: {
            total: relevantServers.length,
            available: availableServers.length,
            loading: loadingServers.length,
            failed: unavailableServers.length,
            oauthRequired: oauthRequiredServers.length,
            availableList: availableServers,
            loadingList: loadingServers,
            failedList: unavailableServers,
            oauthRequiredList: sanitizeOAuthServerList(oauthRequiredServers),
          },
          serverDetails,
          loading: {
            isComplete: stateTracker.isLoadingComplete(),
            summary: loadingManager.getSummary(),
          },
          retryAfter: primaryReason === 'loading' ? 30 : undefined, // Suggest retry in 30 seconds for loading
          timestamp: new Date().toISOString(),
        });
        return;
      }
    } catch (error) {
      logger.error('MCP availability check failed:', error);

      // On error, proceed normally to avoid blocking requests
      // This ensures the system remains functional even if availability checking fails
      next();
    }
  };
}

/**
 * Utility function to get MCP availability info from request
 */
export function getMcpAvailability(req: Request) {
  return (req as McpRequest).mcpAvailability;
}

/**
 * Utility function to check if all MCP servers are ready
 */
export function areAllMcpServersReady(req: Request): boolean {
  const availability = getMcpAvailability(req);
  return availability?.allServersReady ?? true; // Assume ready if no availability info
}

/**
 * Utility function to get list of available MCP servers
 */
export function getAvailableMcpServers(req: Request): string[] {
  const availability = getMcpAvailability(req);
  return availability?.availableServers ?? [];
}

/**
 * Utility function to get list of loading MCP servers
 */
export function getLoadingMcpServers(req: Request): string[] {
  const availability = getMcpAvailability(req);
  return availability?.loadingServers ?? [];
}

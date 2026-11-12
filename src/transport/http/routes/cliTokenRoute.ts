import { randomUUID } from 'node:crypto';

import { getOAuthAuthorizationFlow, OAuthAuthorizationFlowProvider } from '@src/auth/oauthAuthorizationFlow.js';
import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { verifyCliTokenAuthorization } from '@src/core/context/cliTokenProof.js';
import { TemplateContextCapabilityStore } from '@src/core/context/templateContextTrust.js';
import { RuntimeIdentityService } from '@src/core/runtime/runtimeIdentityService.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import logger from '@src/logger/logger.js';

import { Request, RequestHandler, Response } from 'express';

export function createCliTokenRoute(oauthProvider: SDKOAuthServerProvider): RequestHandler {
  const oauthFlowProvider = oauthProvider as SDKOAuthServerProvider & OAuthAuthorizationFlowProvider;
  const oauthFlow =
    oauthFlowProvider.oauthFlow ??
    getOAuthAuthorizationFlow(oauthFlowProvider, {
      createTokenId: randomUUID,
      getAuthConfig: () => {
        const agentConfig = AgentConfigManager.getInstance();
        return {
          enabled: agentConfig.get('features').auth,
          oauthTokenTtlMs: agentConfig.get('auth').oauthTokenTtlMs,
        };
      },
      getAvailableTags: () => McpConfigManager.getInstance().getAvailableTags(),
      getResourceUrl: () => AgentConfigManager.getInstance().getUrl(),
    });

  return async (req: Request, res: Response): Promise<void> => {
    // Must use socket address (not req.ip) to prevent X-Forwarded-For spoofing
    const remoteAddr = req.socket.remoteAddress;
    const isLocalhost = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';

    if (!isLocalhost) {
      res.status(403).json({ error: 'This endpoint is only available from localhost' });
      return;
    }

    const config = AgentConfigManager.getInstance();
    if (!config.get('features').auth) {
      res.json({ authRequired: false, message: 'Auth is disabled on this server' });
      return;
    }

    // Socket location is not authority: a local reverse proxy also connects over loopback.
    const storageDir = config.get('runtimeScopeStoragePath');
    let authorized = false;
    try {
      if (storageDir) {
        const capability = new TemplateContextCapabilityStore({
          storageDir,
          runtimeScopeId: new RuntimeIdentityService({ storageDir }).getRuntimeScopeId(),
        }).read();
        authorized = capability !== null && verifyCliTokenAuthorization(req.headers.authorization, capability);
      }
    } catch {
      // Unavailable or insecure local credentials deny issuance.
    }
    if (!authorized) {
      res.status(403).json({ error: 'Local runtime credentials are required to issue a CLI token' });
      return;
    }

    const result = oauthFlow.createLocalhostCliToken();
    if (!result.authRequired) {
      res.json(result);
      return;
    }

    logger.info('cliTokenRoute.cli.token.generated.for.localhost.71ee18e2');

    res.json({
      authRequired: true,
      token: result.token,
      expiresIn: result.expiresIn,
    });
  };
}

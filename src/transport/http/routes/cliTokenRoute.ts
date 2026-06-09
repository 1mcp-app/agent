import { randomUUID } from 'node:crypto';

import { getOAuthAuthorizationFlow, OAuthAuthorizationFlowProvider } from '@src/auth/oauthAuthorizationFlow.js';
import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
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
    });

  return async (req: Request, res: Response): Promise<void> => {
    // Must use socket address (not req.ip) to prevent X-Forwarded-For spoofing
    const remoteAddr = req.socket.remoteAddress;
    const isLocalhost = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';

    if (!isLocalhost) {
      res.status(403).json({ error: 'This endpoint is only available from localhost' });
      return;
    }

    const result = oauthFlow.createLocalhostCliToken();
    if (!result.authRequired) {
      res.json(result);
      return;
    }

    logger.info('CLI token generated for localhost', { tokenId: result.tokenId.substring(0, 8) + '...' });

    res.json({
      authRequired: true,
      token: result.token,
      expiresIn: result.expiresIn,
    });
  };
}

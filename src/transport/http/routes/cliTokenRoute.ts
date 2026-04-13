import { randomUUID } from 'node:crypto';

import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import logger from '@src/logger/logger.js';
import { tagsToScopes } from '@src/utils/validation/scopeValidation.js';

import { Request, RequestHandler, Response } from 'express';

export function createCliTokenRoute(oauthProvider: SDKOAuthServerProvider): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    // Must use socket address (not req.ip) to prevent X-Forwarded-For spoofing
    const remoteAddr = req.socket.remoteAddress;
    const isLocalhost = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';

    if (!isLocalhost) {
      res.status(403).json({ error: 'This endpoint is only available from localhost' });
      return;
    }

    const agentConfig = AgentConfigManager.getInstance();

    if (!agentConfig.get('features').auth) {
      res.json({ authRequired: false, message: 'Auth is disabled on this server' });
      return;
    }

    const tokenId = randomUUID();
    const accessToken = AUTH_CONFIG.SERVER.TOKEN.ID_PREFIX + tokenId;
    const ttlMs = agentConfig.get('auth').oauthTokenTtlMs;

    const mcpConfig = McpConfigManager.getInstance();
    const allScopes = tagsToScopes(mcpConfig.getAvailableTags());

    oauthProvider.oauthStorage.sessionRepository.createWithId(tokenId, 'cli', '', allScopes, ttlMs);

    logger.info('CLI token generated for localhost', { tokenId: tokenId.substring(0, 8) + '...' });

    res.json({
      authRequired: true,
      token: accessToken,
      expiresIn: Math.floor(ttlMs / 1000),
    });
  };
}

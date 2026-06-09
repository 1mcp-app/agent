import { attachFreshClientSurface } from '@src/commands/shared/clientSurfaceAttachment.js';
import logger from '@src/logger/logger.js';
import { StdioProxyTransport } from '@src/transport/stdioProxyTransport.js';

import { ProxyOptions } from './index.js';

/**
 * Proxy command - Start STDIO proxy to running 1MCP HTTP server
 */
export async function proxyCommand(options: ProxyOptions): Promise<void> {
  try {
    const attachment = await attachFreshClientSurface({
      clientSurface: 'stdio-proxy',
      version: 'proxy',
      options,
    });
    const { target, options: mergedOptions } = attachment;
    const discoveredUrl = attachment.serverUrl.toString();

    // Auto-discover server URL
    logger.info('🔍 Discovering running 1MCP server...');

    // Log discovery source
    switch (target.source) {
      case 'user':
        logger.info(`📍 Using user-provided URL: ${discoveredUrl}`);
        break;
      case 'pidfile':
        logger.info(`✅ Found server via PID file: ${discoveredUrl}`);
        break;
      case 'portscan':
        logger.info(`✅ Found server via port scan: ${discoveredUrl}`);
        break;
    }

    // Apply priority logic: preset > filter > tags (only one will be used)
    if (mergedOptions.preset) {
      logger.info(`📦 Using preset: ${mergedOptions.preset}`);
    } else if (mergedOptions.filter) {
      logger.info(`🔍 Using filter: ${mergedOptions.filter}`);
    } else if (mergedOptions.tags && mergedOptions.tags.length > 0) {
      logger.info(`🏷️  Using tags: ${mergedOptions.tags.join(', ')}`);
    }

    // Create and start proxy transport
    logger.info('📡 Starting STDIO proxy...');

    const proxyTransport = new StdioProxyTransport({
      serverUrl: discoveredUrl,
      bearerToken: attachment.bearerToken,
      context: attachment.context,
    });

    await proxyTransport.start();

    logger.info(`📡 STDIO proxy running, forwarding to ${discoveredUrl}`);

    // Set up graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down STDIO proxy...');
      await proxyTransport.close();
      logger.info('STDIO proxy shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGHUP', shutdown);
  } catch (error) {
    if (error instanceof Error) {
      logger.error(error.message);
    } else {
      logger.error('Failed to start STDIO proxy:', error);
    }
    process.exit(1);
  }
}

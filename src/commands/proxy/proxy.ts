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
    logger.info('proxy.discovering.running.1mcp.server.9ae9a998');

    // Log discovery source
    switch (target.source) {
      case 'user':
        logger.info('proxy.using.user.provided.url.5d95dba1');
        break;
      case 'pidfile':
        logger.info('proxy.found.server.via.pid.file.acea205d');
        break;
      case 'portscan':
        logger.info('proxy.found.server.via.port.scan.4262265e');
        break;
    }

    // Apply priority logic: preset > filter > tags (only one will be used)
    if (mergedOptions.preset) {
      logger.info('proxy.using.preset.c16bbd2d');
    } else if (mergedOptions.filter) {
      logger.info('proxy.using.filter.85e1ffb4');
    } else if (mergedOptions.tags && mergedOptions.tags.length > 0) {
      logger.info('proxy.using.tags.20586b71');
    }

    // Create and start proxy transport
    logger.info('proxy.starting.stdio.proxy.d415368c');

    const proxyTransport = new StdioProxyTransport({
      serverUrl: discoveredUrl,
      bearerToken: attachment.bearerToken,
      context: attachment.context,
      contextProof: attachment.contextProof,
      createContextProof: attachment.createContextProof,
    });

    await proxyTransport.start();

    logger.info('proxy.stdio.proxy.running.forwarding.to.b084a797');

    // Set up graceful shutdown
    const shutdown = async () => {
      logger.info('proxy.shutting.down.stdio.proxy.0fa99376');
      await proxyTransport.close();
      logger.info('proxy.stdio.proxy.shutdown.complete.eb154c73');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGHUP', shutdown);
  } catch (error) {
    if (error instanceof Error) {
      logger.error('proxy.proxycommand.diagnostic.de43c663', { error: error });
    } else {
      logger.error('proxy.failed.to.start.stdio.proxy.2ee21544', { error: error });
    }
    process.exit(1);
  }
}

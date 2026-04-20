import { buildCliContext, generateStreamableSessionId } from '@src/commands/shared/cliContext.js';
import { resolveServeTarget } from '@src/commands/shared/serveTargetResolver.js';
import { MCP_SERVER_VERSION } from '@src/constants/mcp.js';
import logger from '@src/logger/logger.js';
import { StdioProxyTransport } from '@src/transport/stdioProxyTransport.js';

import { ProxyOptions } from './index.js';

/**
 * Proxy command - Start STDIO proxy to running 1MCP HTTP server
 */
export async function proxyCommand(options: ProxyOptions): Promise<void> {
  try {
    const { cwd, projectConfig, projectRoot, mergedOptions, discoveredUrl, source } = await resolveServeTarget(options);

    // Auto-discover server URL
    logger.info('🔍 Discovering running 1MCP server...');

    // Log discovery source
    switch (source) {
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
    let finalPreset: string | undefined;
    let finalFilter: string | undefined;
    let finalTags: string[] | undefined;

    if (mergedOptions.preset) {
      finalPreset = mergedOptions.preset;
      logger.info(`📦 Using preset: ${mergedOptions.preset}`);
    } else if (mergedOptions.filter) {
      finalFilter = mergedOptions.filter;
      logger.info(`🔍 Using filter: ${mergedOptions.filter}`);
    } else if (mergedOptions.tags && mergedOptions.tags.length > 0) {
      finalTags = mergedOptions.tags;
      logger.info(`🏷️  Using tags: ${mergedOptions.tags.join(', ')}`);
    }

    // Create and start proxy transport
    logger.info('📡 Starting STDIO proxy...');

    const proxyTransport = new StdioProxyTransport({
      serverUrl: discoveredUrl,
      preset: finalPreset,
      filter: finalFilter,
      tags: finalTags,
      context: buildCliContext({
        cwd,
        projectConfig,
        projectRoot,
        transportType: 'stdio-proxy',
        version: MCP_SERVER_VERSION,
        sessionId: generateStreamableSessionId(),
      }),
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

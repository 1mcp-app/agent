import logger from '@src/logger/logger.js';
import { StdioProxyTransport } from '@src/transport/stdioProxyTransport.js';
import { loadProjectConfig, normalizeTags } from '@src/utils/config/projectConfigLoader.js';
import { discoverServerWithPidFile, validateServer1mcpUrl } from '@src/utils/parsing/urlDetection.js';

import { ProxyOptions } from './index.js';

/**
 * Proxy command - Start STDIO proxy to running 1MCP HTTP server
 */
export async function proxyCommand(options: ProxyOptions): Promise<void> {
  try {
    // Load project configuration from .1mcprc (if exists)
    const projectConfig = await loadProjectConfig();

    // Merge configuration with priority: CLI options > .1mcprc > defaults
    const preset = options.preset || projectConfig?.preset;
    const filter = options.filter || projectConfig?.filter;
    const tags = options.tags || normalizeTags(projectConfig?.tags);

    // Auto-discover server URL
    logger.info('🔍 Discovering running 1MCP server...');

    const { url: serverUrl, source } = await discoverServerWithPidFile(options['config-dir'], options.url);

    // Log discovery source
    switch (source) {
      case 'user':
        logger.info(`📍 Using user-provided URL: ${serverUrl}`);
        break;
      case 'pidfile':
        logger.info(`✅ Found server via PID file: ${serverUrl}`);
        break;
      case 'portscan':
        logger.info(`✅ Found server via port scan: ${serverUrl}`);
        break;
    }

    // Validate server connectivity
    const validation = await validateServer1mcpUrl(serverUrl);
    if (!validation.valid) {
      logger.error(`❌ Cannot connect to 1MCP server: ${validation.error}`);
      process.exit(1);
    }

    // Apply priority logic: preset > filter > tags (only one will be used)
    let finalPreset: string | undefined;
    let finalFilter: string | undefined;
    let finalTags: string[] | undefined;

    if (preset) {
      finalPreset = preset;
      logger.info(`📦 Using preset: ${preset}`);
    } else if (filter) {
      finalFilter = filter;
      logger.info(`🔍 Using filter: ${filter}`);
    } else if (tags && tags.length > 0) {
      finalTags = tags;
      logger.info(`🏷️  Using tags: ${tags.join(', ')}`);
    }

    // Create and start proxy transport
    logger.info('📡 Starting STDIO proxy...');

    const proxyTransport = new StdioProxyTransport({
      serverUrl,
      preset: finalPreset,
      filter: finalFilter,
      tags: finalTags,
    });

    await proxyTransport.start();

    logger.info(`📡 STDIO proxy running, forwarding to ${serverUrl}`);

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

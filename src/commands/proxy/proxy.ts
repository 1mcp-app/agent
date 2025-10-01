import logger from '../../logger/logger.js';
import { ProxyOptions } from './index.js';
import { discoverServerWithPidFile, validateServer1mcpUrl } from '../../utils/urlDetection.js';
import { StdioProxyTransport } from '../../transport/stdioProxyTransport.js';
import { TagQueryParser } from '../../utils/tagQueryParser.js';
import { PresetManager } from '../../utils/presetManager.js';

/**
 * Proxy command - Start STDIO proxy to running 1MCP HTTP server
 */
export async function proxyCommand(options: ProxyOptions): Promise<void> {
  try {
    // Load preset if specified
    let presetFilter: string | undefined;

    if (options.preset) {
      const presetManager = PresetManager.getInstance(options['config-dir']);
      const preset = await presetManager.getPreset(options.preset);

      if (preset) {
        // Convert preset tag query to filter expression
        presetFilter = preset.tagQuery.expression;
        logger.info(`📦 Loaded filter from preset "${options.preset}": ${presetFilter}`);
      }
    }

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

    // Parse tag filter (CLI option > preset)
    const filterExpression = options.filter || presetFilter;
    let tags: string[] | undefined;

    if (filterExpression) {
      try {
        // Try advanced parsing first
        try {
          const tagExpression = TagQueryParser.parseAdvanced(filterExpression);
          // For proxy, we only support simple tag lists (no complex expressions)
          // Extract simple tags if possible
          if (tagExpression.type === 'tag') {
            tags = [tagExpression.value!];
          } else {
            logger.warn('Complex filter expressions are not supported in proxy mode');
            logger.warn('Falling back to simple comma-separated parsing');
            throw new Error('Complex expression not supported');
          }
        } catch {
          // Fall back to simple parsing
          tags = TagQueryParser.parseSimple(filterExpression);
        }

        if (tags && tags.length > 0) {
          logger.info(`🏷️  Tag filter: ${tags.join(', ')}`);
        }
      } catch (error) {
        logger.error(`Invalid filter expression: ${error instanceof Error ? error.message : 'Unknown error'}`);
        logger.error('Examples:');
        logger.error('  --filter "web,api,database"  # OR logic (comma-separated)');
        process.exit(1);
      }
    }

    // Create and start proxy transport
    logger.info('📡 Starting STDIO proxy...');

    const proxyTransport = new StdioProxyTransport({
      serverUrl,
      tags,
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

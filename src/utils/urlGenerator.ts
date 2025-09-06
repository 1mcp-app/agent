import { AgentConfigManager } from '../core/server/agentConfig.js';
import { PresetManager } from './presetManager.js';
import logger from '../logger/logger.js';

/**
 * URL generation options
 */
export interface UrlGenerationOptions {
  preset?: string;
  tagFilter?: string;
  tags?: string[];
  includeAuth?: boolean;
  customParams?: Record<string, string>;
}

/**
 * URL generator utility for MCP access URLs with preset support
 */
export class UrlGenerator {
  private agentConfig: AgentConfigManager;
  private presetManager: PresetManager;

  constructor() {
    this.agentConfig = AgentConfigManager.getInstance();
    this.presetManager = PresetManager.getInstance();
  }

  /**
   * Generate MCP access URL with preset parameter
   */
  public generatePresetUrl(presetName: string): string {
    const baseUrl = this.agentConfig.getUrl();
    const url = new URL(baseUrl);

    // Add preset parameter
    url.searchParams.set('preset', presetName);

    logger.debug('Generated preset URL', { presetName, url: url.toString() });
    return url.toString();
  }

  /**
   * Generate MCP access URL with tag filter
   */
  public generateTagFilterUrl(tagFilter: string): string {
    const baseUrl = this.agentConfig.getUrl();
    const url = new URL(baseUrl);

    // Add tag-filter parameter
    url.searchParams.set('tag-filter', tagFilter);

    logger.debug('Generated tag filter URL', { tagFilter, url: url.toString() });
    return url.toString();
  }

  /**
   * Generate MCP access URL with legacy tags parameter (deprecated)
   */
  public generateTagsUrl(tags: string[]): string {
    const baseUrl = this.agentConfig.getUrl();
    const url = new URL(baseUrl);

    // Add tags parameter
    url.searchParams.set('tags', tags.join(','));

    logger.debug('Generated tags URL (deprecated)', { tags, url: url.toString() });
    return url.toString();
  }

  /**
   * Generate MCP access URL based on options
   */
  public generateUrl(options: UrlGenerationOptions = {}): string {
    const baseUrl = this.agentConfig.getUrl();
    const url = new URL(baseUrl);

    // Priority: preset > tag-filter > tags (deprecated)
    if (options.preset) {
      // Validate preset exists
      if (!this.presetManager.hasPreset(options.preset)) {
        throw new Error(`Preset '${options.preset}' not found`);
      }
      url.searchParams.set('preset', options.preset);
    } else if (options.tagFilter) {
      url.searchParams.set('tag-filter', options.tagFilter);
    } else if (options.tags && options.tags.length > 0) {
      url.searchParams.set('tags', options.tags.join(','));
    }

    // Add custom parameters
    if (options.customParams) {
      for (const [key, value] of Object.entries(options.customParams)) {
        url.searchParams.set(key, value);
      }
    }

    // Add authentication parameters if needed
    if (options.includeAuth && this.agentConfig.isAuthEnabled()) {
      // Note: Auth parameters would be added here if needed
      // This is a placeholder for future auth URL parameters
    }

    logger.debug('Generated URL', {
      options,
      url: url.toString(),
      baseUrl,
    });

    return url.toString();
  }

  /**
   * Get base server URL without parameters
   */
  public getBaseUrl(): string {
    return this.agentConfig.getUrl();
  }

  /**
   * Validate and generate URL for preset
   */
  public async validateAndGeneratePresetUrl(
    presetName: string,
  ): Promise<{ url: string; valid: boolean; error?: string }> {
    try {
      // Check if preset exists
      if (!this.presetManager.hasPreset(presetName)) {
        return {
          url: '',
          valid: false,
          error: `Preset '${presetName}' not found`,
        };
      }

      // Test preset to ensure it has valid configuration
      const preset = this.presetManager.getPreset(presetName);
      if (!preset) {
        return {
          url: '',
          valid: false,
          error: `Preset '${presetName}' configuration is invalid`,
        };
      }

      // Validate preset configuration
      const validation = await this.presetManager.validatePreset(presetName, preset);
      if (!validation.isValid) {
        return {
          url: '',
          valid: false,
          error: `Preset validation failed: ${validation.errors.join('; ')}`,
        };
      }

      // Generate URL
      const url = this.generatePresetUrl(presetName);

      return {
        url,
        valid: true,
      };
    } catch (error) {
      logger.error('URL validation and generation failed', { presetName, error });
      return {
        url: '',
        valid: false,
        error: `Failed to generate URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Parse MCP URL to extract filtering parameters
   */
  public parseUrl(url: string): {
    preset?: string;
    tagFilter?: string;
    tags?: string[];
    otherParams: Record<string, string>;
  } {
    try {
      const urlObj = new URL(url);
      const params = urlObj.searchParams;

      const result: any = {
        otherParams: {},
      };

      // Extract filtering parameters
      if (params.has('preset')) {
        result.preset = params.get('preset');
      } else if (params.has('tag-filter')) {
        result.tagFilter = params.get('tag-filter');
      } else if (params.has('tags')) {
        const tagsStr = params.get('tags');
        if (tagsStr) {
          result.tags = tagsStr
            .split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
        }
      }

      // Extract other parameters
      for (const [key, value] of params.entries()) {
        if (!['preset', 'tag-filter', 'tags'].includes(key)) {
          result.otherParams[key] = value;
        }
      }

      return result;
    } catch (error) {
      logger.error('Failed to parse URL', { url, error });
      return { otherParams: {} };
    }
  }

  /**
   * Check if URL uses preset-based filtering
   */
  public isPresetUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.searchParams.has('preset');
    } catch {
      return false;
    }
  }

  /**
   * Extract preset name from URL
   */
  public extractPresetName(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.searchParams.get('preset');
    } catch {
      return null;
    }
  }

  /**
   * Generate connection string for MCP clients (includes protocol and formatting)
   */
  public generateConnectionString(options: UrlGenerationOptions = {}): string {
    const url = this.generateUrl(options);

    // For MCP clients, we might want to format the URL differently
    // This is where we could add MCP-specific formatting if needed
    return url;
  }
}

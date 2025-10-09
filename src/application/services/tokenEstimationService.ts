import type { Prompt, PromptArgument, Resource, Tool } from '@modelcontextprotocol/sdk/types.js';

import logger from '@src/logger/logger.js';

import { encoding_for_model, type TiktokenModel } from 'tiktoken';

/**
 * Token breakdown by capability type
 */
export interface TokenBreakdown {
  tools: ToolTokenInfo[];
  resources: ResourceTokenInfo[];
  prompts: PromptTokenInfo[];
  serverOverhead: number;
  totalTokens: number;
}

/**
 * Token information for a specific tool
 */
export interface ToolTokenInfo {
  name: string;
  tokens: number;
  description?: string;
}

/**
 * Token information for a specific resource
 */
export interface ResourceTokenInfo {
  uri: string;
  name?: string;
  tokens: number;
  mimeType?: string;
}

/**
 * Token information for a specific prompt
 */
export interface PromptTokenInfo {
  name: string;
  tokens: number;
  description?: string;
  argumentsTokens: number;
}

/**
 * Server token estimation summary
 */
export interface ServerTokenEstimate {
  serverName: string;
  connected: boolean;
  breakdown: TokenBreakdown;
  error?: string;
}

/**
 * Service for estimating MCP token usage using tiktoken
 */
export class TokenEstimationService {
  private encoder: any;
  private model: TiktokenModel;
  private static readonly BASE_SERVER_OVERHEAD = 75; // Base overhead for server connection
  private static readonly FALLBACK_CHARS_PER_TOKEN = 3.5; // Character-based fallback estimation

  constructor(model: string = 'gpt-4o') {
    try {
      // Validate and cast the model to TiktokenModel
      this.model = model as TiktokenModel;

      // Initialize encoder for the specified model
      this.encoder = encoding_for_model(this.model);
      logger.debug(`TokenEstimationService initialized with tiktoken ${this.model} encoding`);
    } catch (error) {
      logger.error(`Failed to initialize tiktoken encoder for model ${model}:`, error);
      logger.warn(`Falling back to gpt-4o encoding`);

      // Fallback to gpt-4o if the provided model fails
      try {
        this.model = 'gpt-4o';
        this.encoder = encoding_for_model(this.model);
      } catch (fallbackError) {
        logger.error('Failed to initialize fallback encoder:', fallbackError);
        this.encoder = null;
        this.model = 'gpt-4o'; // Keep default for logging purposes
      }
    }
  }

  /**
   * Estimate tokens for a single tool definition
   */
  private estimateToolTokens(tool: Tool): number {
    try {
      // Create a representative JSON structure for the tool
      const toolDefinition = {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      };

      const toolJson = JSON.stringify(toolDefinition);

      if (this.encoder) {
        const tokens = this.encoder.encode(toolJson);
        return tokens.length;
      } else {
        // Fallback to character-based estimation
        return Math.ceil(toolJson.length / TokenEstimationService.FALLBACK_CHARS_PER_TOKEN);
      }
    } catch (error) {
      logger.warn(`Error estimating tokens for tool ${tool.name}:`, error);
      // Fallback estimation based on typical tool size
      return 150;
    }
  }

  /**
   * Estimate tokens for a single resource
   */
  private estimateResourceTokens(resource: Resource): number {
    try {
      // Create a representative structure for the resource metadata
      const resourceMeta = {
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      };

      const resourceJson = JSON.stringify(resourceMeta);

      if (this.encoder) {
        const tokens = this.encoder.encode(resourceJson);
        return tokens.length;
      } else {
        // Fallback to character-based estimation
        return Math.ceil(resourceJson.length / TokenEstimationService.FALLBACK_CHARS_PER_TOKEN);
      }
    } catch (error) {
      logger.warn(`Error estimating tokens for resource ${resource.uri}:`, error);
      // Fallback estimation based on typical resource size
      return 50;
    }
  }

  /**
   * Estimate tokens for a single prompt template
   */
  private estimatePromptTokens(prompt: Prompt): number {
    try {
      // Estimate tokens for the prompt template and arguments
      let totalTokens = 0;

      // Count tokens for prompt name and description
      const promptMeta = {
        name: prompt.name,
        description: prompt.description,
      };
      const promptMetaJson = JSON.stringify(promptMeta);

      if (this.encoder) {
        totalTokens += this.encoder.encode(promptMetaJson).length;
      } else {
        totalTokens += Math.ceil(promptMetaJson.length / TokenEstimationService.FALLBACK_CHARS_PER_TOKEN);
      }

      // Count tokens for arguments
      if (prompt.arguments) {
        const argumentsJson = JSON.stringify(prompt.arguments);
        if (this.encoder) {
          totalTokens += this.encoder.encode(argumentsJson).length;
        } else {
          totalTokens += Math.ceil(argumentsJson.length / TokenEstimationService.FALLBACK_CHARS_PER_TOKEN);
        }
      }

      return totalTokens;
    } catch (error) {
      logger.warn(`Error estimating tokens for prompt ${prompt.name}:`, error);
      // Fallback estimation based on typical prompt size
      return 100;
    }
  }

  /**
   * Estimate tokens for all capabilities of a server
   */
  public estimateServerTokens(
    serverName: string,
    tools: Tool[] = [],
    resources: Resource[] = [],
    prompts: Prompt[] = [],
    connected: boolean = true,
  ): ServerTokenEstimate {
    try {
      logger.debug(`Estimating tokens for server: ${serverName}`);

      // Calculate token breakdown by capability type
      const toolTokens: ToolTokenInfo[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        tokens: this.estimateToolTokens(tool),
      }));

      const resourceTokens: ResourceTokenInfo[] = resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        mimeType: resource.mimeType,
        tokens: this.estimateResourceTokens(resource),
      }));

      const promptTokens: PromptTokenInfo[] = prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        tokens: this.estimatePromptTokens(prompt),
        argumentsTokens: prompt.arguments ? this.estimateArgumentsTokens(prompt.arguments) : 0,
      }));

      // Calculate totals
      const totalToolTokens = toolTokens.reduce((sum, tool) => sum + tool.tokens, 0);
      const totalResourceTokens = resourceTokens.reduce((sum, resource) => sum + resource.tokens, 0);
      const totalPromptTokens = promptTokens.reduce((sum, prompt) => sum + prompt.tokens, 0);
      const serverOverhead = TokenEstimationService.BASE_SERVER_OVERHEAD;

      const breakdown: TokenBreakdown = {
        tools: toolTokens,
        resources: resourceTokens,
        prompts: promptTokens,
        serverOverhead,
        totalTokens: totalToolTokens + totalResourceTokens + totalPromptTokens + serverOverhead,
      };

      return {
        serverName,
        connected,
        breakdown,
      };
    } catch (error) {
      logger.error(`Error estimating tokens for server ${serverName}:`, error);
      return {
        serverName,
        connected,
        breakdown: {
          tools: [],
          resources: [],
          prompts: [],
          serverOverhead: TokenEstimationService.BASE_SERVER_OVERHEAD,
          totalTokens: TokenEstimationService.BASE_SERVER_OVERHEAD,
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Estimate tokens for prompt arguments
   */
  private estimateArgumentsTokens(arguments_: PromptArgument[]): number {
    try {
      const argumentsJson = JSON.stringify(arguments_);

      if (this.encoder) {
        const tokens = this.encoder.encode(argumentsJson);
        return tokens.length;
      } else {
        return Math.ceil(argumentsJson.length / TokenEstimationService.FALLBACK_CHARS_PER_TOKEN);
      }
    } catch (error) {
      logger.warn('Error estimating tokens for prompt arguments:', error);
      return 25; // Conservative fallback
    }
  }

  /**
   * Calculate aggregate statistics across multiple servers
   */
  public calculateAggregateStats(estimates: ServerTokenEstimate[]): {
    totalServers: number;
    connectedServers: number;
    totalTools: number;
    totalResources: number;
    totalPrompts: number;
    overallTokens: number;
    serverBreakdown: { [serverName: string]: number };
  } {
    const connectedEstimates = estimates.filter((est) => est.connected && !est.error);

    return {
      totalServers: estimates.length,
      connectedServers: connectedEstimates.length,
      totalTools: connectedEstimates.reduce((sum, est) => sum + est.breakdown.tools.length, 0),
      totalResources: connectedEstimates.reduce((sum, est) => sum + est.breakdown.resources.length, 0),
      totalPrompts: connectedEstimates.reduce((sum, est) => sum + est.breakdown.prompts.length, 0),
      overallTokens: connectedEstimates.reduce((sum, est) => sum + est.breakdown.totalTokens, 0),
      serverBreakdown: Object.fromEntries(connectedEstimates.map((est) => [est.serverName, est.breakdown.totalTokens])),
    };
  }

  /**
   * Clean up resources when done
   */
  public dispose(): void {
    if (this.encoder && typeof this.encoder.free === 'function') {
      try {
        this.encoder.free();
        logger.debug('TokenEstimationService encoder disposed');
      } catch (error) {
        logger.warn('Error disposing tiktoken encoder:', error);
      }
    }
  }
}

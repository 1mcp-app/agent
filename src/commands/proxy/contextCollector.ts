import { execFile } from 'child_process';
import { basename } from 'path';
import { promisify } from 'util';

import logger, { debugIf } from '@src/logger/logger.js';
import {
  type ContextCollectionOptions,
  type ContextData,
  type ContextNamespace,
  createSessionId,
  type EnvironmentContext,
  formatTimestamp,
  type UserContext,
} from '@src/types/context.js';

import { z } from 'zod';

const execFileAsync = promisify(execFile);

/**
 * Context Collector Implementation
 *
 * Gathers environment and project-specific context for the context-aware proxy.
 * This includes project information, user details, and environment variables.
 */
const ContextCollectionOptionsSchema = z.object({
  includeGit: z.boolean().default(true),
  includeEnv: z.boolean().default(true),
  envPrefixes: z.array(z.string()).default([]),
  sanitizePaths: z.boolean().default(true),
  maxDepth: z.number().default(3),
});

export class ContextCollector {
  private options: Required<ContextCollectionOptions>;

  constructor(options: Partial<ContextCollectionOptions> = {}) {
    this.options = ContextCollectionOptionsSchema.parse(options);
  }

  /**
   * Collect all context data
   */
  async collect(): Promise<ContextData> {
    try {
      debugIf(() => ({
        message: 'Collecting context data',
        meta: {
          includeGit: this.options.includeGit,
          includeEnv: this.options.includeEnv,
          envPrefixes: this.options.envPrefixes,
        },
      }));

      const project = await this.collectProjectContext();
      const user = this.collectUserContext();
      const environment = this.collectEnvironmentContext();

      const contextData: ContextData = {
        project,
        user,
        environment,
        timestamp: formatTimestamp(),
        sessionId: createSessionId(),
        version: 'v1',
      };

      debugIf(() => ({
        message: 'Context collection complete',
        meta: {
          hasProject: !!project.path,
          hasGit: !!project.git,
          hasUser: !!user.username,
          hasEnvironment: !!environment.variables,
          sessionId: contextData.sessionId,
        },
      }));

      return contextData;
    } catch (error) {
      logger.error(`Failed to collect context: ${error}`);
      throw error;
    }
  }

  /**
   * Collect project-specific context
   */
  private async collectProjectContext(): Promise<ContextNamespace> {
    const projectPath = process.cwd();
    const projectName = basename(projectPath);

    const context: ContextNamespace = {
      path: this.options.sanitizePaths ? this.sanitizePath(projectPath) : projectPath,
      name: projectName,
    };

    // Collect git information if enabled
    if (this.options.includeGit) {
      context.git = await this.collectGitContext();
    }

    return context;
  }

  /**
   * Collect git repository information
   */
  private async collectGitContext(): Promise<ContextNamespace['git']> {
    const cwd = process.cwd();

    try {
      // First check if we're in a git repository
      await this.executeCommand('git', ['rev-parse', '--git-dir'], cwd);

      // Run all git commands in parallel for better performance
      const [branch, commit, remoteUrl] = await Promise.allSettled([
        this.executeCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
        this.executeCommand('git', ['rev-parse', 'HEAD'], cwd),
        this.executeCommand('git', ['config', '--get', 'remote.origin.url'], cwd),
      ]);

      return {
        isRepo: true,
        branch: branch.status === 'fulfilled' ? branch.value.trim() : undefined,
        commit: commit.status === 'fulfilled' ? commit.value.trim().substring(0, 8) : undefined,
        repository: remoteUrl.status === 'fulfilled' ? this.extractRepoName(remoteUrl.value.trim()) : undefined,
      };
    } catch {
      debugIf(() => ({
        message: 'Not a git repository or git commands failed',
      }));
      return { isRepo: false };
    }
  }

  /**
   * Collect user information from OS
   */
  private collectUserContext(): UserContext {
    try {
      const os = require('os') as typeof import('os');
      const userInfo = os.userInfo();

      const context: UserContext = {
        username: userInfo.username,
        uid: String(userInfo.uid),
        gid: String(userInfo.gid),
        home: this.options.sanitizePaths ? this.sanitizePath(userInfo.homedir) : userInfo.homedir,
        shell: userInfo.shell || undefined,
        name: process.env.USER || process.env.LOGNAME || userInfo.username,
      };

      return context;
    } catch (error) {
      logger.error(`Failed to collect user context: ${error}`);
      return {
        username: 'unknown',
        uid: 'unknown',
        gid: 'unknown',
      };
    }
  }

  /**
   * Collect environment variables and system environment
   */
  private collectEnvironmentContext(): EnvironmentContext {
    const context: EnvironmentContext = {};

    if (this.options.includeEnv) {
      const variables: Record<string, string> = {};

      // Filter out sensitive environment variables
      const sensitiveKeys = ['PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'AUTH', 'CREDENTIAL', 'PRIVATE'];

      // Determine which keys to collect
      const keysToCollect = this.options.envPrefixes?.length
        ? Object.keys(process.env).filter(
            (key) =>
              this.options.envPrefixes!.some((prefix) => key.startsWith(prefix)) &&
              process.env[key] &&
              !sensitiveKeys.some((sensitive) => key.toUpperCase().includes(sensitive)),
          )
        : Object.keys(process.env).filter(
            (key) => process.env[key] && !sensitiveKeys.some((sensitive) => key.toUpperCase().includes(sensitive)),
          );

      // Collect the filtered keys
      keysToCollect.forEach((key) => {
        const value = process.env[key];
        if (value) {
          variables[key] = value;
        }
      });

      context.variables = {
        ...variables,
        NODE_ENV: process.env.NODE_ENV || 'development',
        TERM: process.env.TERM || 'unknown',
        SHELL: process.env.SHELL || 'unknown',
      };
      context.prefixes = this.options.envPrefixes;
    }

    return context;
  }

  /**
   * Allowed commands for security - prevent command injection
   */
  private static readonly ALLOWED_COMMANDS = new Set([
    'git',
    'node',
    'npm',
    'pnpm',
    'yarn',
    'python',
    'python3',
    'pip',
    'pip3',
    'curl',
    'wget',
  ]);

  /**
   * Validate command arguments to prevent injection
   */
  private validateCommandArgs(command: string, args: string[]): void {
    // Check if command is allowed
    if (!ContextCollector.ALLOWED_COMMANDS.has(command)) {
      throw new Error(`Command '${command}' is not allowed`);
    }

    // Validate arguments for dangerous patterns
    const dangerousPatterns = [
      /[;&|`$(){}[\]]/, // Shell metacharacters
      /\.\./, // Path traversal
      /^\s*rm/i, // Dangerous file operations
      /^\s*sudo/i, // Privilege escalation
    ];

    for (const arg of args) {
      for (const pattern of dangerousPatterns) {
        if (pattern.test(arg)) {
          throw new Error(`Dangerous argument detected: ${arg}`);
        }
      }
    }
  }

  /**
   * Execute command using promisified execFile for cleaner async/await
   */
  private async executeCommand(command: string, args: string[], cwd: string = process.cwd()): Promise<string> {
    // Validate for security
    this.validateCommandArgs(command, args);

    try {
      const { stdout } = await execFileAsync(command, args, {
        cwd,
        timeout: 5000,
        maxBuffer: 1024 * 1024, // 1MB buffer
      });
      return stdout;
    } catch (error) {
      debugIf(() => ({
        message: 'Command execution failed',
        meta: { command, args, error: error instanceof Error ? error.message : String(error) },
      }));
      throw error;
    }
  }

  /**
   * Extract repository name from git remote URL
   */
  private extractRepoName(remoteUrl?: string): string | undefined {
    if (!remoteUrl) return undefined;

    // Handle HTTPS URLs: https://github.com/user/repo.git
    const httpsMatch = remoteUrl.match(/https:\/\/[^/]+\/([^/]+\/[^/]+?)(\.git)?$/);
    if (httpsMatch) return httpsMatch[1];

    // Handle SSH URLs: git@github.com:user/repo.git
    const sshMatch = remoteUrl.match(/git@[^:]+:([^/]+\/[^/]+?)(\.git)?$/);
    if (sshMatch) return sshMatch[1];

    // Handle relative paths
    if (!remoteUrl.includes('://') && !remoteUrl.includes('@')) {
      return basename(remoteUrl.replace(/\.git$/, ''));
    }

    return remoteUrl;
  }

  /**
   * Sanitize file paths for security
   */
  private sanitizePath(path: string): string {
    const pathModule = require('path') as typeof import('path');
    const os = require('os') as typeof import('os');

    // Resolve path to canonical form to prevent traversal
    const resolvedPath = pathModule.resolve(path);
    const homeDir = os.homedir();

    // Check for path traversal attempts
    if (resolvedPath.includes('..')) {
      throw new Error(`Path traversal detected: ${path}`);
    }

    // Validate path is within allowed directories
    const allowedPrefixes = [process.cwd(), homeDir, '/tmp', '/var/tmp'];

    const isAllowed = allowedPrefixes.some((prefix) => resolvedPath.startsWith(prefix));
    if (!isAllowed) {
      throw new Error(`Access to path not allowed: ${resolvedPath}`);
    }

    // Remove sensitive paths like user home directory specifics
    if (resolvedPath.startsWith(homeDir)) {
      return resolvedPath.replace(homeDir, '~');
    }

    // Normalize path separators
    return resolvedPath.replace(/\\/g, '/');
  }
}

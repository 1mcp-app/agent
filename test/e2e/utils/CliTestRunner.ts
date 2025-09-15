import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { CommandTestEnvironment } from './CommandTestEnvironment.js';

export interface CommandExecutionOptions {
  timeout?: number;
  expectError?: boolean;
  input?: string;
  args?: string[];
  cwd?: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: Error;
  duration: number;
}

/**
 * Utility for executing CLI commands in isolated test environments.
 * Ensures commands run safely without affecting the real application.
 */
export class CliTestRunner {
  private readonly cliPath: string;

  constructor(private environment: CommandTestEnvironment) {
    // Path to the built CLI executable
    this.cliPath = join(process.cwd(), 'build', 'index.js');
  }

  /**
   * Execute a CLI command with the given arguments
   */
  async runCommand(command: string, subcommand: string, options: CommandExecutionOptions = {}): Promise<CommandResult> {
    const args = [command, subcommand];

    // Add user-specified args first
    if (options.args) {
      args.push(...options.args);
    }

    // For preset commands, inject config-dir at the end if not already specified
    if (command === 'preset') {
      if (!args.includes('--config-dir') && !args.includes('-d')) {
        // For preset commands, we need the directory containing the config file, not the file itself
        const configDir = dirname(this.environment.getConfigPath());
        args.push('--config-dir', configDir);
      }
    }

    return this.executeCommand(args, options);
  }

  /**
   * Execute MCP management commands (mcp subcommand)
   */
  async runMcpCommand(
    action: 'add' | 'remove' | 'enable' | 'disable' | 'list' | 'status' | 'update',
    options: CommandExecutionOptions = {},
  ): Promise<CommandResult> {
    const args = ['mcp', action];

    // Add config path if not already specified in args
    // Also check for --config without value to prevent corrupting default config
    if (!options.args?.includes('--config') && !options.args?.includes('-c')) {
      args.push('--config', this.environment.getConfigPath());
    } else if (options.args?.includes('--config')) {
      // If --config is present, ensure it has a value to prevent default config corruption
      const configIndex = options.args.indexOf('--config');
      if (configIndex === options.args.length - 1 || options.args[configIndex + 1]?.startsWith('--')) {
        // --config is the last argument or followed by another flag, so it has no value
        // Insert our test config path after --config
        options.args.splice(configIndex + 1, 0, this.environment.getConfigPath());
      }
    }

    if (options.args) {
      args.push(...options.args);
    }

    return this.executeCommand(args, options);
  }

  /**
   * Execute App management commands (app subcommand)
   */
  async runAppCommand(
    action: 'discover' | 'list' | 'status' | 'backups' | 'restore' | 'consolidate',
    options: CommandExecutionOptions = {},
  ): Promise<CommandResult> {
    const args = ['app', action];

    if (options.args) {
      args.push(...options.args);
    }

    return this.executeCommand(args, options);
  }

  /**
   * Execute the serve command for testing server startup
   */
  async runServeCommand(options: CommandExecutionOptions = {}): Promise<CommandResult> {
    const args = ['serve'];

    // Add config path
    args.push('--config', this.environment.getConfigPath());

    // Add test-friendly defaults
    args.push('--transport', 'stdio'); // Use stdio for testing
    args.push('--port', '0'); // Use random port

    if (options.args) {
      args.push(...options.args);
    }

    return this.executeCommand(args, { ...options, timeout: options.timeout || 5000 });
  }

  /**
   * Check if the CLI is available and working
   */
  async checkCliAvailable(): Promise<boolean> {
    try {
      const result = await this.executeCommand(['--help'], { timeout: 5000 });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Execute command with full argument list
   */
  private async executeCommand(args: string[], options: CommandExecutionOptions = {}): Promise<CommandResult> {
    const startTime = Date.now();
    const timeout = options.timeout || 10000; // 10 second default timeout

    return new Promise((resolve) => {
      const env = {
        ...process.env,
        ...this.environment.getEnvironmentVariables(),
      };

      const child = spawn('node', [this.cliPath, ...args], {
        env,
        cwd: options.cwd || this.environment.getTempDir(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      // Set up timeout
      if (timeout > 0) {
        timeoutHandle = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            child.kill('SIGTERM');
            resolve({
              exitCode: -1,
              stdout,
              stderr,
              error: new Error(`Command timed out after ${timeout}ms`),
              duration: Date.now() - startTime,
            });
          }
        }, timeout);
      }

      // Capture output
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Send input if provided
      if (options.input) {
        child.stdin?.write(options.input);
        child.stdin?.end();
      } else {
        child.stdin?.end();
      }

      // Handle process exit
      child.on('exit', (code, signal) => {
        if (!resolved) {
          resolved = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          const exitCode = code !== null ? code : signal === 'SIGTERM' ? -1 : -2;

          resolve({
            exitCode,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            duration: Date.now() - startTime,
          });
        }
      });

      // Handle process errors
      child.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          resolve({
            exitCode: -1,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            error,
            duration: Date.now() - startTime,
          });
        }
      });
    });
  }

  /**
   * Helper to parse JSON output from commands
   */
  parseJsonOutput<T = any>(result: CommandResult): T {
    if (result.exitCode !== 0) {
      throw new Error(`Command failed with exit code ${result.exitCode}: ${result.stderr}`);
    }

    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(`Failed to parse JSON output: ${error}. Output was: ${result.stdout}`);
    }
  }

  /**
   * Helper to check if command succeeded
   */
  assertSuccess(result: CommandResult, message?: string): void {
    if (result.exitCode !== 0) {
      const errorMsg = message || `Command failed with exit code ${result.exitCode}`;
      throw new Error(`${errorMsg}\nSTDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`);
    }
  }

  /**
   * Helper to check if command failed as expected
   */
  assertFailure(result: CommandResult, expectedExitCode?: number, message?: string): void {
    if (result.exitCode === 0) {
      const errorMsg = message || 'Expected command to fail but it succeeded';
      throw new Error(`${errorMsg}\nSTDOUT: ${result.stdout}`);
    }

    if (expectedExitCode !== undefined && result.exitCode !== expectedExitCode) {
      const errorMsg = message || `Expected exit code ${expectedExitCode} but got ${result.exitCode}`;
      throw new Error(`${errorMsg}\nSTDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`);
    }
  }

  /**
   * Helper to check if output contains expected text
   */
  assertOutputContains(result: CommandResult, expectedText: string, checkStderr = false): void {
    const output = checkStderr ? result.stderr : result.stdout;
    if (!output.includes(expectedText)) {
      throw new Error(`Output does not contain expected text: "${expectedText}"\n` + `Actual output: ${output}`);
    }
  }

  /**
   * Helper to check if output matches a regex pattern
   */
  assertOutputMatches(result: CommandResult, pattern: RegExp, checkStderr = false): void {
    const output = checkStderr ? result.stderr : result.stdout;
    if (!pattern.test(output)) {
      throw new Error(`Output does not match pattern: ${pattern}\n` + `Actual output: ${output}`);
    }
  }

  /**
   * Helper to check if output does NOT contain expected text
   */
  assertOutputDoesNotContain(result: CommandResult, expectedText: string, checkStderr = false): void {
    const output = checkStderr ? result.stderr : result.stdout;
    if (output.includes(expectedText)) {
      throw new Error(`Output unexpectedly contains text: "${expectedText}"\n` + `Actual output: ${output}`);
    }
  }

  /**
   * Execute command with custom environment variables
   * Creates a temporary environment with overrides
   */
  async runCommandWithCustomEnv(
    command: string,
    subcommand: string,
    envOverrides: Record<string, string>,
    options: CommandExecutionOptions = {},
  ): Promise<CommandResult> {
    const args = [command, subcommand];

    // Add user-specified args
    if (options.args) {
      args.push(...options.args);
    }

    return new Promise((resolve) => {
      const env = {
        ...process.env,
        ...this.environment.getEnvironmentVariables(),
        ...envOverrides, // Override with custom env vars
      };

      const child = spawn('node', [this.cliPath, ...args], {
        env,
        cwd: options.cwd || this.environment.getTempDir(),
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';
      const startTime = Date.now();
      const timeout = options.timeout || 10000;

      const timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeout);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      if (options.input) {
        child.stdin?.write(options.input);
        child.stdin?.end();
      }

      child.on('close', (code) => {
        clearTimeout(timeoutHandle);
        resolve({
          exitCode: code || 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          duration: Date.now() - startTime,
        });
      });

      child.on('error', (error) => {
        clearTimeout(timeoutHandle);
        resolve({
          exitCode: -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error,
          duration: Date.now() - startTime,
        });
      });
    });
  }
}

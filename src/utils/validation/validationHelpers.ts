import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Validation utilities for app configuration consolidation.
 *
 * Provides comprehensive validation for configuration files,
 * server connectivity, and permission handling.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  fixable: boolean;
}

export interface OperationPreview {
  app: string;
  configPath: string;
  serversToImport: string[];
  replacementUrl: string;
  backupPath: string;
  risks: string[];
}

/**
 * Validate application configuration file
 */
export function validateAppConfig(configPath: string, content: unknown): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    fixable: false,
  };

  // JSON structure validation
  if (!content || typeof content !== 'object') {
    result.valid = false;
    result.errors.push('Invalid JSON structure');
    return result;
  }

  const contentObj = content as Record<string, unknown>;

  // Check for MCP servers section
  if (!contentObj.mcpServers && !contentObj.servers) {
    result.warnings.push('No MCP servers section found');
  }

  // Server configuration validation
  const servers = (contentObj.mcpServers || contentObj.servers || {}) as Record<string, unknown>;
  Object.entries(servers).forEach(([name, config]: [string, unknown]) => {
    if (!config || typeof config !== 'object') {
      result.errors.push(`Server "${name}" has invalid configuration`);
      return;
    }

    const configObj = config as Record<string, unknown>;

    if (!configObj.command && !configObj.url) {
      result.errors.push(`Server "${name}" missing command or url`);
    }

    if (name === '1mcp') {
      result.warnings.push('Existing 1mcp server will be replaced');
    }

    // Validate URL format if present
    if (configObj.url) {
      try {
        new URL(configObj.url as string);
      } catch {
        result.errors.push(`Server "${name}" has invalid URL format`);
      }
    }

    // Validate command format if present
    if (configObj.command && typeof configObj.command !== 'string') {
      result.errors.push(`Server "${name}" command must be a string`);
    }
  });

  result.valid = result.errors.length === 0;
  result.fixable = result.errors.every(
    (error) => error.includes('missing command') || error.includes('invalid format') || error.includes('invalid URL'),
  );

  return result;
}

/**
 * Validate 1mcp server connectivity
 */
export async function validateServer1mcpConnection(url: string): Promise<ValidationResult> {
  try {
    // Test basic connectivity using OAuth endpoint (which always exists)
    const baseUrl = url.replace('/mcp', '');
    const oauthResponse = await fetch(`${baseUrl}/oauth/`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!oauthResponse.ok) {
      return {
        valid: false,
        errors: [`1mcp server not responding (HTTP ${oauthResponse.status})`],
        warnings: [],
        fixable: true,
      };
    }

    // For MCP endpoint, we just verify OAuth is working since MCP requires POST with specific payload
    // The OAuth endpoint responding successfully indicates the server is properly running

    return {
      valid: true,
      errors: [],
      warnings: [],
      fixable: false,
    };
  } catch (error) {
    return {
      valid: false,
      errors: [`Cannot connect to 1mcp server: ${error instanceof Error ? error.message : String(error)}`],
      warnings: ['Make sure 1mcp server is running'],
      fixable: true,
    };
  }
}

/**
 * Handle file permission errors with specific diagnostics
 */
export function handlePermissionError(filePath: string, error: unknown): string {
  const dirPath = path.dirname(filePath);

  try {
    const stats = fs.statSync(dirPath);
    const currentUser = os.userInfo();

    // Specific permission diagnostics
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
      const errorCode = error.code;
      if (errorCode === 'EACCES') {
        if (stats.uid !== currentUser.uid) {
          return `Configuration directory owned by different user.
Fix: chown -R ${currentUser.username} "${dirPath}"
Alternative: Copy config to your user directory`;
        }

        if (!(stats.mode & 0o200)) {
          return `Configuration directory is read-only.
Fix: chmod u+w "${dirPath}"`;
        }

        return `Permission denied. Check directory permissions:
Current: ${stats.mode.toString(8)}
Required: Read/write access
Fix: chmod u+rw "${dirPath}"`;
      }

      if (errorCode === 'ENOENT') {
        return `Configuration directory does not exist.
The application may not be installed or configured yet.
Fix: Create directory "mkdir -p ${dirPath}" and run application first`;
      }

      if (errorCode === 'EBUSY' || errorCode === 'ETXTBSY') {
        return `Configuration file is currently in use.
Fix: Close the application and try again`;
      }
    }
  } catch (_statError) {
    const errorMessage =
      error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Unknown error';
    return `Cannot access configuration directory: ${errorMessage}
Try: Check if the path exists and you have proper permissions`;
  }

  const errorMessage =
    error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Unknown error';
  return `Unexpected permission error: ${errorMessage}
Last resort: Run with elevated permissions (not recommended)`;
}

/**
 * Validate file system permissions for configuration operations
 */
export function validateFilePermissions(configPath: string): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    fixable: true,
  };

  const dirPath = path.dirname(configPath);

  try {
    // Check if directory exists
    if (!fs.existsSync(dirPath)) {
      result.valid = false;
      result.errors.push(`Configuration directory does not exist: ${dirPath}`);
      return result;
    }

    // Check directory permissions
    try {
      fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      result.valid = false;
      result.errors.push(handlePermissionError(configPath, error));
      return result;
    }

    // Check file permissions if file exists
    if (fs.existsSync(configPath)) {
      try {
        fs.accessSync(configPath, fs.constants.R_OK | fs.constants.W_OK);
      } catch (error) {
        result.valid = false;
        result.errors.push(handlePermissionError(configPath, error));
        return result;
      }
    }
  } catch (error) {
    const errorObj = error as Error;
    result.valid = false;
    result.errors.push(`File system error: ${errorObj.message}`);
  }

  return result;
}

/**
 * Generate operation preview for user confirmation
 */
export function generateOperationPreview(
  app: string,
  configPath: string,
  serversToImport: string[],
  replacementUrl: string,
  backupPath: string,
): OperationPreview {
  const risks: string[] = [];

  // Check for potential issues
  if (serversToImport.length === 0) {
    risks.push('No MCP servers found to import');
  }

  if (serversToImport.length > 10) {
    risks.push(`Large number of servers (${serversToImport.length}) - consolidation may take time`);
  }

  if (!fs.existsSync(configPath)) {
    risks.push('Configuration file does not exist - will be created');
  }

  return {
    app,
    configPath,
    serversToImport,
    replacementUrl,
    backupPath,
    risks,
  };
}

/**
 * Validate operation before execution
 */
export async function validateOperation(
  configPath: string,
  content: unknown,
  serverUrl: string,
): Promise<{
  configValidation: ValidationResult;
  permissionValidation: ValidationResult;
  connectivityValidation: ValidationResult;
  canProceed: boolean;
}> {
  const configValidation = validateAppConfig(configPath, content);
  const permissionValidation = validateFilePermissions(configPath);
  const connectivityValidation = await validateServer1mcpConnection(serverUrl);

  const canProceed = configValidation.valid && permissionValidation.valid && connectivityValidation.valid;

  return {
    configValidation,
    permissionValidation,
    connectivityValidation,
    canProceed,
  };
}

/**
 * Validate that a path is safe (prevent path traversal attacks)
 */
export function validateSafePath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const normalized = path.normalize(filePath);

  // Check for path traversal attempts
  if (normalized.includes('..')) {
    return false;
  }

  // Check for dangerous paths (adjust based on your security requirements)
  const dangerousPaths = ['/etc/', '/usr/', '/bin/', '/sbin/', '/var/'];
  if (process.platform !== 'win32') {
    for (const dangerous of dangerousPaths) {
      if (resolved.startsWith(dangerous)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Result of JSON validation with parsed content or error message
 */
export interface JsonValidationResult {
  valid: boolean;
  parsed?: unknown;
  error?: string;
}

/**
 * Validate JSON content safely
 */
export function validateJsonContent(content: string): JsonValidationResult {
  try {
    const parsed: unknown = JSON.parse(content);
    return { valid: true, parsed };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      valid: false,
      error: `Invalid JSON: ${errorMessage}`,
    };
  }
}

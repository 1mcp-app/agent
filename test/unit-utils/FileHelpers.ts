import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

/**
 * File and directory testing utilities
 * Handles temporary file/directory management for tests
 */
export class FileHelpers {
  /**
   * Create a temporary directory for testing
   */
  static createTempDir(prefix: string = 'mcp-test'): string {
    const tempDir = path.join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    return tempDir;
  }

  /**
   * Clean up a temporary directory
   */
  static cleanupTempDir(tempDir: string): void {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Create a temporary file with content
   */
  static createTempFile(content: string, extension: string = '.json'): string {
    const tempDir = FileHelpers.createTempDir();
    const filePath = path.join(tempDir, `test-file${extension}`);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }
}

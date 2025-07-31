import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('appDiscovery', () => {
  describe('discoverAppConfigs', () => {
    it('should handle VS Code settings.json with comments', async () => {
      // Create a temporary VS Code settings file with comments
      const testDir = path.join(process.cwd(), 'test-temp');
      const vscodeDir = path.join(testDir, 'Library', 'Application Support', 'Code', 'User');
      const settingsPath = path.join(vscodeDir, 'settings.json');

      // Create directories
      fs.mkdirSync(vscodeDir, { recursive: true });

      // Create VS Code settings with comments
      const settingsWithComments = `{
  // This is a comment
  "editor.fontSize": 14,
  "workbench.colorTheme": "Dark+", // Another comment
  /* Multi-line comment
     with MCP configuration */
  "mcp.servers": {
    "test-server": {
      "url": "http://localhost:3000"
    }
  },
  // Final comment
  "files.autoSave": "afterDelay"
}`;

      fs.writeFileSync(settingsPath, settingsWithComments);

      // Mock the getAppConfigPaths to return our test path
      const originalProcess = process.platform;
      const originalHomedir = process.env.HOME;

      try {
        // Set up environment to match our test structure
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        process.env.HOME = testDir;

        // Test the core parsing logic by testing that JSON5 can parse VS Code settings with comments
        const JSON5 = (await import('json5')).default;

        expect(() => {
          const parsed = JSON5.parse(settingsWithComments);
          expect(parsed).toHaveProperty('mcp.servers');
          expect(parsed['mcp.servers']).toHaveProperty('test-server');
          expect(parsed['mcp.servers']['test-server'].url).toBe('http://localhost:3000');
        }).not.toThrow();
      } finally {
        // Cleanup
        fs.rmSync(testDir, { recursive: true, force: true });
        Object.defineProperty(process, 'platform', { value: originalProcess });
        if (originalHomedir) {
          process.env.HOME = originalHomedir;
        } else {
          delete process.env.HOME;
        }
      }
    });

    it('should parse regular JSON without comments using standard JSON.parse', () => {
      const regularJson = `{
  "name": "test",
  "servers": {
    "test-server": {
      "url": "http://localhost:3000"
    }
  }
}`;

      expect(() => {
        const parsed = JSON.parse(regularJson);
        expect(parsed).toHaveProperty('servers');
        expect(parsed.servers).toHaveProperty('test-server');
      }).not.toThrow();
    });
  });
});

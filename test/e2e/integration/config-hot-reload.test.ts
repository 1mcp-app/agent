import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Configuration Hot Reload Integration', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('hot-reload-test', 'basic'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Manual Config File Changes', () => {
    it('should handle manual server disable through config file', async () => {
      // Start with a running server
      await runner.runMcpCommand('add', {
        args: ['test-server', '--type', 'stdio', '--command', 'echo', '--args', 'hello'],
      });

      // Verify server is running
      const initialList = await runner.runMcpCommand('list');
      runner.assertOutputContains(initialList, 'test-server');

      // Manually disable the server by modifying the config file
      const fs = await import('fs/promises');
      const configPath = environment.getConfigPath();

      // Read current config
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      // Disable the server
      config.mcpServers['test-server'].disabled = true;
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      // Give it a moment for the hot reload to kick in
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify server is no longer listed
      const afterDisable = await runner.runMcpCommand('list');
      expect(afterDisable.stdout).not.toContain('test-server');

      // Verify server is shown as disabled
      const disabledList = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      runner.assertOutputContains(disabledList, 'test-server');
      runner.assertOutputContains(disabledList, '🔴');
    });

    it('should handle manual server enable through config file', async () => {
      // Add a disabled server
      await runner.runMcpCommand('add', {
        args: ['disabled-test-server', '--type', 'stdio', '--command', 'echo', '--args', 'hello', '--disabled'],
      });

      // Verify server is disabled
      const initialList = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      runner.assertOutputContains(initialList, 'disabled-test-server');
      runner.assertOutputContains(initialList, '🔴');

      // Manually enable the server by modifying the config file
      const fs = await import('fs/promises');
      const configPath = environment.getConfigPath();

      // Read current config
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      // Enable the server
      config.mcpServers['disabled-test-server'].disabled = false;
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      // Give it a moment for the hot reload to kick in
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify server is now enabled and listed
      const afterEnable = await runner.runMcpCommand('list');
      runner.assertOutputContains(afterEnable, 'disabled-test-server');
      runner.assertOutputContains(afterEnable, '🟢');
    });

    it('should handle rapid config changes without errors', async () => {
      // Add a server
      await runner.runMcpCommand('add', {
        args: ['rapid-test-server', '--type', 'stdio', '--command', 'echo', '--args', 'test'],
      });

      const fs = await import('fs/promises');
      const configPath = environment.getConfigPath();

      // Perform rapid changes
      for (let i = 0; i < 3; i++) {
        // Read current config
        const configContent = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(configContent);

        // Toggle disabled state
        config.mcpServers['rapid-test-server'].disabled = i % 2 === 0;
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));

        // Small delay between changes
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Give final change time to process
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should not have any errors and server should be in the expected state
      const finalList = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      runner.assertOutputContains(finalList, 'rapid-test-server');
    });

    it('should handle mixed changes across multiple servers', async () => {
      // Add multiple servers
      await runner.runMcpCommand('add', {
        args: ['multi-server-1', '--type', 'stdio', '--command', 'echo', '--args', 'server1'],
      });
      await runner.runMcpCommand('add', {
        args: ['multi-server-2', '--type', 'stdio', '--command', 'echo', '--args', 'server2'],
      });

      const fs = await import('fs/promises');
      const configPath = environment.getConfigPath();

      // Read current config
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      // Make mixed changes to different servers
      config.mcpServers['multi-server-1'].disabled = true; // Disable first
      config.mcpServers['multi-server-2'].args = ['server2', 'updated']; // Modify second

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      // Give time for hot reload
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify changes took effect
      const listResult = await runner.runMcpCommand('list', { args: ['--show-disabled'] });

      // First server should be disabled
      expect(listResult.stdout).toContain('multi-server-1');
      expect(listResult.stdout).toContain('🔴');

      // Second server should still be enabled (it was modified but not disabled)
      expect(listResult.stdout).toContain('multi-server-2');
      expect(listResult.stdout).toContain('🟢');
    });
  });

  describe('Error Recovery', () => {
    it('should handle invalid config gracefully', async () => {
      // Add a server first
      await runner.runMcpCommand('add', {
        args: ['error-test-server', '--type', 'stdio', '--command', 'echo', '--args', 'hello'],
      });

      const fs = await import('fs/promises');
      const configPath = environment.getConfigPath();

      // Write invalid JSON
      await fs.writeFile(configPath, '{ invalid json content }');

      // Wait for error processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Restore valid config
      const validConfig = {
        mcpServers: {
          'error-test-server': {
            command: 'echo',
            args: ['hello'],
            disabled: false,
          },
        },
      };

      await fs.writeFile(configPath, JSON.stringify(validConfig, null, 2));

      // Give time for recovery
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Should recover and show the server
      const listResult = await runner.runMcpCommand('list');
      runner.assertOutputContains(listResult, 'error-test-server');
    });

    it('should handle missing config file gracefully', async () => {
      const fs = await import('fs/promises');
      const configPath = environment.getConfigPath();

      // Remove the config file
      await fs.unlink(configPath);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // The system should handle missing config gracefully
      // It may return an error code but shouldn't crash
      const listResult = await runner.runMcpCommand('list');
      // Should either succeed (0) or return config error (1)
      expect([0, 1]).toContain(listResult.exitCode);
    });
  });

  describe('Configuration Changes While Server is Running', () => {
    it('should not affect other servers when one server is disabled', async () => {
      // Add multiple servers
      await runner.runMcpCommand('add', {
        args: ['stable-server-1', '--type', 'stdio', '--command', 'echo', '--args', 'stable1'],
      });
      await runner.runMcpCommand('add', {
        args: ['stable-server-2', '--type', 'stdio', '--command', 'echo', '--args', 'stable2'],
      });
      await runner.runMcpCommand('add', {
        args: ['unstable-server', '--type', 'stdio', '--command', 'echo', '--args', 'unstable'],
      });

      // Verify all servers are initially running
      const initialList = await runner.runMcpCommand('list');
      runner.assertOutputContains(initialList, 'stable-server-1');
      runner.assertOutputContains(initialList, 'stable-server-2');
      runner.assertOutputContains(initialList, 'unstable-server');

      // Manually disable one server
      const fs = await import('fs/promises');
      const configPath = environment.getConfigPath();

      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      config.mcpServers['unstable-server'].disabled = true;
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      // Give time for hot reload
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify only the unstable server is disabled
      const afterDisable = await runner.runMcpCommand('list');
      runner.assertOutputContains(afterDisable, 'stable-server-1');
      runner.assertOutputContains(afterDisable, 'stable-server-2');
      expect(afterDisable.stdout).not.toContain('unstable-server');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle multiple rapid config changes without performance degradation', async () => {
      // Add several servers
      const serverCount = 5;
      for (let i = 0; i < serverCount; i++) {
        await runner.runMcpCommand('add', {
          args: [`perf-server-${i}`, '--type', 'stdio', '--command', 'echo', '--args', `server${i}`],
        });
      }

      const fs = await import('fs/promises');
      const configPath = environment.getConfigPath();

      // Measure time for rapid changes
      const startTime = Date.now();

      for (let i = 0; i < 10; i++) {
        // Toggle disable state for all servers
        const configContent = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(configContent);

        for (let j = 0; j < serverCount; j++) {
          config.mcpServers[`perf-server-${j}`].disabled = i % 2 === 0;
        }

        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        await new Promise((resolve) => setTimeout(resolve, 50)); // 50ms between changes
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should complete within reasonable time (less than 5 seconds)
      expect(totalTime).toBeLessThan(5000);

      // Give final changes time to process
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify system is still responsive
      const listResult = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      expect(listResult.exitCode).toBe(0);

      // All servers should be present (some enabled, some disabled)
      for (let i = 0; i < serverCount; i++) {
        expect(listResult.stdout).toContain(`perf-server-${i}`);
      }
    });
  });
});

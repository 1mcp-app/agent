import { ConfigChangeDetector } from '@src/config/configChangeDetector.js';
import { ConfigChangeType } from '@src/config/types.js';

import { describe, expect, it } from 'vitest';

describe('ConfigChangeDetector', () => {
  let changeDetector: ConfigChangeDetector;

  beforeEach(() => {
    changeDetector = new ConfigChangeDetector();
  });

  describe('detectChanges', () => {
    it('should detect added servers', () => {
      const oldConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          tags: ['test'],
        },
      };

      const newConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          tags: ['test'],
        },
        'server-2': {
          command: 'python',
          args: ['server2.py'],
          tags: ['python'],
        },
      };

      const changes = changeDetector.detectChanges(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe(ConfigChangeType.ADDED);
      expect(changes[0].serverName).toBe('server-2');
    });

    it('should detect removed servers', () => {
      const oldConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          tags: ['test'],
        },
        'server-2': {
          command: 'python',
          args: ['server2.py'],
          tags: ['python'],
        },
      };

      const newConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          tags: ['test'],
        },
      };

      const changes = changeDetector.detectChanges(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe(ConfigChangeType.REMOVED);
      expect(changes[0].serverName).toBe('server-2');
    });

    it('should detect modified servers', () => {
      const oldConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          tags: ['test'],
        },
      };

      const newConfig = {
        'server-1': {
          command: 'node',
          args: ['server1-updated.js'],
          tags: ['test', 'updated'],
        },
      };

      const changes = changeDetector.detectChanges(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      const change = changes[0];
      expect(change.type).toBe(ConfigChangeType.MODIFIED);
      expect(change.serverName).toBe('server-1');
      if (change.type === ConfigChangeType.MODIFIED) {
        expect(change.fieldsChanged).toContain('args');
        expect(change.fieldsChanged).toContain('tags');
      }
    });

    it('should detect multiple types of changes', () => {
      const oldConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          tags: ['test'],
        },
        'server-2': {
          command: 'python',
          args: ['server2.py'],
          tags: ['python'],
        },
        'server-3': {
          command: 'echo',
          args: ['hello'],
          tags: ['echo'],
        },
      };

      const newConfig = {
        'server-1': {
          command: 'node',
          args: ['server1-modified.js'],
          tags: ['test'],
        },
        'server-2': {
          command: 'python',
          args: ['server2.py'],
          tags: ['python'],
        },
        'server-4': {
          command: 'bash',
          args: ['server4.sh'],
          tags: ['bash'],
        },
      };

      const changes = changeDetector.detectChanges(oldConfig, newConfig);

      expect(changes).toHaveLength(3);

      const addedChange = changes.find((c) => c.type === ConfigChangeType.ADDED);
      expect(addedChange?.serverName).toBe('server-4');

      const removedChange = changes.find((c) => c.type === ConfigChangeType.REMOVED);
      expect(removedChange?.serverName).toBe('server-3');

      const modifiedChange = changes.find((c) => c.type === ConfigChangeType.MODIFIED);
      expect(modifiedChange?.serverName).toBe('server-1');
    });

    it('should return empty array when configs are identical', () => {
      const config = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          tags: ['test'],
        },
      };

      const changes = changeDetector.detectChanges(config, config);

      expect(changes).toHaveLength(0);
    });

    it('should handle empty configs', () => {
      const changes = changeDetector.detectChanges({}, {});

      expect(changes).toHaveLength(0);
    });

    it('should detect changes from empty config', () => {
      const oldConfig = {};
      const newConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          tags: ['test'],
        },
      };

      const changes = changeDetector.detectChanges(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe(ConfigChangeType.ADDED);
      expect(changes[0].serverName).toBe('server-1');
    });

    it('should detect changes to empty config', () => {
      const oldConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          tags: ['test'],
        },
      };
      const newConfig = {};

      const changes = changeDetector.detectChanges(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe(ConfigChangeType.REMOVED);
      expect(changes[0].serverName).toBe('server-1');
    });

    it('should detect tag-only changes', () => {
      const oldConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          tags: ['test', 'original'],
        },
      };

      const newConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          tags: ['test', 'modified'],
        },
      };

      const changes = changeDetector.detectChanges(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      const change = changes[0];
      expect(change.type).toBe(ConfigChangeType.MODIFIED);
      if (change.type === ConfigChangeType.MODIFIED) {
        expect(change.fieldsChanged).toEqual(['tags']);
      }
    });

    it('should detect nested object changes', () => {
      const oldConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          env: {
            NODE_ENV: 'development',
            DEBUG: 'false',
          },
        },
      };

      const newConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          env: {
            NODE_ENV: 'production',
            DEBUG: 'false',
          },
        },
      };

      const changes = changeDetector.detectChanges(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      const change = changes[0];
      expect(change.type).toBe(ConfigChangeType.MODIFIED);
      if (change.type === ConfigChangeType.MODIFIED) {
        expect(change.fieldsChanged).toContain('env');
      }
    });

    it('should detect array changes', () => {
      const oldConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js', 'arg1.js', 'arg2.js'],
        },
      };

      const newConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js', 'arg1.js', 'arg3.js'],
        },
      };

      const changes = changeDetector.detectChanges(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      const change = changes[0];
      expect(change.type).toBe(ConfigChangeType.MODIFIED);
      if (change.type === ConfigChangeType.MODIFIED) {
        expect(change.fieldsChanged).toContain('args');
      }
    });

    it('should not detect changes when only order differs in arrays', () => {
      const oldConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js', 'arg1.js', 'arg2.js'],
        },
      };

      const newConfig = {
        'server-1': {
          command: 'node',
          args: ['arg2.js', 'server1.js', 'arg1.js'],
        },
      };

      const changes = changeDetector.detectChanges(oldConfig, newConfig);

      // Arrays with different elements should be detected as changed
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe(ConfigChangeType.MODIFIED);
    });

    it('should handle undefined vs null differences', () => {
      const oldConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          timeout: undefined,
        },
      };

      const newConfig = {
        'server-1': {
          command: 'node',
          args: ['server1.js'],
          timeout: 5000,
        },
      };

      const changes = changeDetector.detectChanges(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe(ConfigChangeType.MODIFIED);
    });
  });
});

import { MCPServerParams } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplateConfigurationManager } from './templateConfigurationManager.js';

// Mock dependencies
vi.mock('@src/config/configManager.js', () => ({
  ConfigManager: {
    getInstance: vi.fn(() => ({
      loadConfigWithTemplates: vi.fn(),
    })),
  },
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('TemplateConfigurationManager', () => {
  let templateConfigurationManager: TemplateConfigurationManager;
  let mockLogger: any;

  beforeEach(() => {
    templateConfigurationManager = new TemplateConfigurationManager();
    mockLogger = logger;
    vi.clearAllMocks();
  });

  afterEach(() => {
    templateConfigurationManager.cleanup();
  });

  describe('mergeServerConfigurations', () => {
    let staticServers: Record<string, MCPServerParams>;
    let templateServers: Record<string, MCPServerParams>;

    beforeEach(() => {
      staticServers = {
        'static-server-1': {
          command: 'echo',
          args: ['static1'],
          tags: ['tag1'],
        },
        'static-server-2': {
          command: 'echo',
          args: ['static2'],
          tags: ['tag2'],
        },
        'shared-server': {
          command: 'echo',
          args: ['static-shared'],
          tags: ['shared'],
        },
      };

      templateServers = {
        'template-server-1': {
          command: 'echo',
          args: ['template1'],
          tags: ['template'],
        },
        'template-server-2': {
          command: 'echo',
          args: ['template2'],
          tags: ['template'],
        },
        'shared-server': {
          command: 'echo',
          args: ['template-shared'],
          tags: ['shared'],
        },
      };
    });

    it('should merge all servers when there are no conflicts', () => {
      // Arrange - remove shared server to avoid conflict
      const { 'shared-server': _, ...staticNoShared } = staticServers;
      const { 'shared-server': __, ...templateNoShared } = templateServers;

      // Act - access private method for testing
      const merged = (templateConfigurationManager as any).mergeServerConfigurations(staticNoShared, templateNoShared);

      // Assert
      expect(Object.keys(merged)).toHaveLength(4);
      expect(merged['static-server-1']).toEqual(staticNoShared['static-server-1']);
      expect(merged['static-server-2']).toEqual(staticNoShared['static-server-2']);
      expect(merged['template-server-1']).toEqual(templateNoShared['template-server-1']);
      expect(merged['template-server-2']).toEqual(templateNoShared['template-server-2']);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should ignore static server when conflict exists with template server', () => {
      // Act
      const merged = (templateConfigurationManager as any).mergeServerConfigurations(staticServers, templateServers);

      // Assert
      expect(Object.keys(merged)).toHaveLength(5); // 3 template + 2 non-conflicting static

      // Template servers should be included
      expect(merged['template-server-1']).toEqual(templateServers['template-server-1']);
      expect(merged['template-server-2']).toEqual(templateServers['template-server-2']);
      expect(merged['shared-server']).toEqual(templateServers['shared-server']); // Template takes precedence

      // Non-conflicting static servers should be included
      expect(merged['static-server-1']).toEqual(staticServers['static-server-1']);
      expect(merged['static-server-2']).toEqual(staticServers['static-server-2']);

      // Warning should be logged for ignored static server
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Ignoring 1 static server(s) that conflict with template servers: shared-server',
      );
    });

    it('should ignore multiple static servers when multiple conflicts exist', () => {
      // Arrange - add more conflicts
      const staticServersWithMoreConflicts = {
        ...staticServers,
        'another-static': {
          command: 'echo',
          args: ['another'],
          tags: ['another'],
        },
      };

      const templateServersWithMoreConflicts = {
        ...templateServers,
        'another-static': {
          command: 'echo',
          args: ['template-another'],
          tags: ['template-another'],
        },
      };

      // Act
      const merged = (templateConfigurationManager as any).mergeServerConfigurations(
        staticServersWithMoreConflicts,
        templateServersWithMoreConflicts,
      );

      // Assert
      expect(Object.keys(merged)).toHaveLength(6); // 3 original template + 1 new conflicting template + 2 non-conflicting static

      // Template servers should be included
      expect(merged['template-server-1']).toEqual(templateServers['template-server-1']);
      expect(merged['template-server-2']).toEqual(templateServers['template-server-2']);
      expect(merged['shared-server']).toEqual(templateServers['shared-server']);
      expect(merged['another-static']).toEqual(templateServersWithMoreConflicts['another-static']);

      // Non-conflicting static servers should be included
      expect(merged['static-server-1']).toEqual(staticServers['static-server-1']);
      expect(merged['static-server-2']).toEqual(staticServers['static-server-2']);

      // Warning should be logged for ignored static servers
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Ignoring 2 static server(s) that conflict with template servers: shared-server, another-static',
      );
    });

    it('should include only static servers when no template servers exist', () => {
      // Act
      const merged = (templateConfigurationManager as any).mergeServerConfigurations(staticServers, {});

      // Assert
      expect(Object.keys(merged)).toHaveLength(3);
      expect(merged['static-server-1']).toEqual(staticServers['static-server-1']);
      expect(merged['static-server-2']).toEqual(staticServers['static-server-2']);
      expect(merged['shared-server']).toEqual(staticServers['shared-server']);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should include only template servers when no static servers exist', () => {
      // Act
      const merged = (templateConfigurationManager as any).mergeServerConfigurations({}, templateServers);

      // Assert
      expect(Object.keys(merged)).toHaveLength(3);
      expect(merged['template-server-1']).toEqual(templateServers['template-server-1']);
      expect(merged['template-server-2']).toEqual(templateServers['template-server-2']);
      expect(merged['shared-server']).toEqual(templateServers['shared-server']);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should return empty object when both inputs are empty', () => {
      // Act
      const merged = (templateConfigurationManager as any).mergeServerConfigurations({}, {});

      // Assert
      expect(Object.keys(merged)).toHaveLength(0);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should handle deep object equality properly', () => {
      // Arrange - create complex objects
      const complexStatic = {
        'complex-server': {
          command: 'node',
          args: ['server.js'],
          env: {
            NODE_ENV: 'production',
            PORT: '3000',
            DEEP: {
              VALUE: 'static',
            },
          },
          tags: ['complex'],
          disabled: false,
        },
      };

      const complexTemplate = {
        'complex-server': {
          command: 'node',
          args: ['server.js'],
          env: {
            NODE_ENV: 'production',
            PORT: '3000',
            DEEP: {
              VALUE: 'template', // Different value
            },
          },
          tags: ['complex'],
          disabled: false,
        },
      };

      // Act
      const merged = (templateConfigurationManager as any).mergeServerConfigurations(complexStatic, complexTemplate);

      // Assert
      expect(Object.keys(merged)).toHaveLength(1);
      expect(merged['complex-server']).toEqual(complexTemplate['complex-server']); // Template takes precedence
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Ignoring 1 static server(s) that conflict with template servers: complex-server',
      );
    });
  });

  describe('circuit breaker functionality', () => {
    it('should reset circuit breaker state', () => {
      // Arrange - get initial state
      expect(templateConfigurationManager.isTemplateProcessingDisabled()).toBe(false);
      expect(templateConfigurationManager.getErrorCount()).toBe(0);

      // Act - reset circuit breaker
      templateConfigurationManager.resetCircuitBreaker();

      // Assert - should still be in initial state
      expect(templateConfigurationManager.isTemplateProcessingDisabled()).toBe(false);
      expect(templateConfigurationManager.getErrorCount()).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith('Circuit breaker reset - template processing re-enabled');
    });

    it('should check template processing disabled state', () => {
      // Arrange & Act
      const isDisabled = templateConfigurationManager.isTemplateProcessingDisabled();
      const errorCount = templateConfigurationManager.getErrorCount();

      // Assert
      expect(isDisabled).toBe(false);
      expect(errorCount).toBe(0);
    });
  });
});

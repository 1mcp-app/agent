import { AgentConfigManager } from '../server/agentConfig.js';
import { FlagManager } from './flagManager.js';

describe('FlagManager', () => {
  let flagManager: FlagManager;
  let configManager: AgentConfigManager;

  beforeEach(() => {
    flagManager = FlagManager.getInstance();
    configManager = AgentConfigManager.getInstance();
  });

  afterEach(() => {
    // Reset configuration to defaults after each test
    configManager.updateConfig({
      features: {
        auth: false,
        scopeValidation: false,
        enhancedSecurity: false,
        configReload: true,
        envSubstitution: true,
        sessionPersistence: true,
        clientNotifications: true,
        internalTools: false,
        internalToolsList: [],
      },
    });
  });

  describe('isToolEnabled', () => {
    it('should return false for disabled internal tools by default', () => {
      expect(flagManager.isToolEnabled('internalTools')).toBe(false);
      expect(flagManager.isToolEnabled('internalTools', 'discovery', 'search')).toBe(false);
    });

    it('should return true when internal tools are enabled', () => {
      configManager.updateConfig({
        features: {
          auth: false,
          scopeValidation: false,
          enhancedSecurity: false,
          configReload: true,
          envSubstitution: true,
          sessionPersistence: true,
          clientNotifications: true,
          internalTools: true,
          internalToolsList: [],
        },
      });

      expect(flagManager.isToolEnabled('internalTools')).toBe(true);
      // With simplified structure, any subcategory/tool should return true if master is enabled
      expect(flagManager.isToolEnabled('internalTools', 'discovery', 'search')).toBe(true);
      expect(flagManager.isToolEnabled('internalTools', 'installation', 'install')).toBe(true);
    });

    it('should return false for unknown categories', () => {
      expect(flagManager.isToolEnabled('unknownCategory')).toBe(false);
      expect(flagManager.isToolEnabled('unknownCategory', 'subcategory')).toBe(false);
    });
  });

  describe('isCategoryEnabled', () => {
    it('should return category enable status correctly', () => {
      expect(flagManager.isCategoryEnabled('internalTools')).toBe(false); // Default disabled for security

      // Enable internal tools
      configManager.updateConfig({
        features: {
          auth: false,
          scopeValidation: false,
          enhancedSecurity: false,
          configReload: true,
          envSubstitution: true,
          sessionPersistence: true,
          clientNotifications: true,
          internalTools: true,
          internalToolsList: [],
        },
      });

      expect(flagManager.isCategoryEnabled('internalTools')).toBe(true);
      expect(flagManager.isCategoryEnabled('unknownCategory')).toBe(false);
    });
  });

  describe('validateFlags', () => {
    it('should return valid result for default configuration', () => {
      const validation = flagManager.validateFlags();
      // Simplified validation should always be valid
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.warnings).toHaveLength(0);
    });

    it('should return valid result when internal tools are enabled', () => {
      configManager.updateConfig({
        features: {
          auth: false,
          scopeValidation: false,
          enhancedSecurity: false,
          configReload: true,
          envSubstitution: true,
          sessionPersistence: true,
          clientNotifications: true,
          internalTools: true,
          internalToolsList: [],
        },
      });

      const validation = flagManager.validateFlags();
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.warnings).toHaveLength(0);
    });
  });

  describe('getFlagSummary', () => {
    it('should return simplified flag summary', () => {
      const summary = flagManager.getFlagSummary();

      expect(summary).toHaveProperty('internalTools');
      expect(summary.internalTools).toBe(false); // Default disabled for security
    });

    it('should reflect enabled internal tools in summary', () => {
      configManager.updateConfig({
        features: {
          auth: false,
          scopeValidation: false,
          enhancedSecurity: false,
          configReload: true,
          envSubstitution: true,
          sessionPersistence: true,
          clientNotifications: true,
          internalTools: true,
          internalToolsList: [],
        },
      });

      const summary = flagManager.getFlagSummary();
      expect(summary.internalTools).toBe(true);
    });
  });

  describe('getEnabledTools', () => {
    it('should return no tools when internal tools are disabled', () => {
      const tools = flagManager.getEnabledTools('internalTools');
      expect(tools).toHaveLength(0);
    });

    it('should return all tools when internal tools are enabled', () => {
      configManager.updateConfig({
        features: {
          auth: false,
          scopeValidation: false,
          enhancedSecurity: false,
          configReload: true,
          envSubstitution: true,
          sessionPersistence: true,
          clientNotifications: true,
          internalTools: true,
          internalToolsList: [],
        },
      });

      const tools = flagManager.getEnabledTools('internalTools');
      expect(tools.length).toBeGreaterThan(0);
      expect(tools).toContain('search');
      expect(tools).toContain('install');
      expect(tools).toContain('enable');
    });

    it('should return empty array for unknown categories', () => {
      const tools = flagManager.getEnabledTools('unknownCategory');
      expect(tools).toHaveLength(0);
    });
  });

  describe('areToolsSafeForContext', () => {
    it('should return true for development context with any tools', () => {
      configManager.updateConfig({
        features: {
          auth: false,
          scopeValidation: false,
          enhancedSecurity: false,
          configReload: true,
          envSubstitution: true,
          sessionPersistence: true,
          clientNotifications: true,
          internalTools: true,
          internalToolsList: [],
        },
      });

      expect(flagManager.areToolsSafeForContext('development')).toBe(true);
      expect(flagManager.areToolsSafeForContext('testing')).toBe(true);
    });

    it('should return false for production context with internal tools enabled', () => {
      configManager.updateConfig({
        features: {
          auth: false,
          scopeValidation: false,
          enhancedSecurity: false,
          configReload: true,
          envSubstitution: true,
          sessionPersistence: true,
          clientNotifications: true,
          internalTools: true,
          internalToolsList: [],
        },
      });

      expect(flagManager.areToolsSafeForContext('production')).toBe(false);
    });

    it('should return true for production context with internal tools disabled', () => {
      expect(flagManager.areToolsSafeForContext('production')).toBe(true);
    });
  });

  describe('parseToolsList', () => {
    it('should return empty array for empty input', () => {
      const result = flagManager.parseToolsList('');
      expect(result).toEqual([]);
    });

    it('should return empty array for null/undefined input', () => {
      const result1 = flagManager.parseToolsList(null as any);
      const result2 = flagManager.parseToolsList(undefined as any);
      expect(result1).toEqual([]);
      expect(result2).toEqual([]);
    });

    it('should parse individual tool names', () => {
      const result = flagManager.parseToolsList('search,list,status');
      expect(result).toEqual(['search', 'list', 'status']);
    });

    it('should parse category shortcuts', () => {
      const result = flagManager.parseToolsList('safe');
      expect(result).toEqual(['search', 'registry_info', 'registry_list', 'info', 'list', 'status']);
    });

    it('should parse mixed tools and categories', () => {
      const result = flagManager.parseToolsList('search,management,info');
      expect(result).toContain('search');
      expect(result).toContain('info');
      expect(result).toContain('list');
      expect(result).toContain('status');
      expect(result).toContain('enable');
      expect(result).toContain('disable');
    });

    it('should handle whitespace and case insensitivity', () => {
      const result = flagManager.parseToolsList('  Search , LIST , status  ');
      expect(result).toEqual(['search', 'list', 'status']);
    });

    it('should remove duplicates', () => {
      const result = flagManager.parseToolsList('search,search,list,search');
      expect(result).toEqual(['search', 'list']);
    });

    it('should throw error for invalid tool names', () => {
      expect(() => {
        flagManager.parseToolsList('invalid_tool');
      }).toThrow('Invalid tools list: Unknown tool or category: "invalid_tool"');
    });

    it('should throw error for invalid category names', () => {
      expect(() => {
        flagManager.parseToolsList('invalid_category');
      }).toThrow('Invalid tools list: Unknown tool or category: "invalid_category"');
    });

    it('should show available options in error message', () => {
      try {
        flagManager.parseToolsList('invalid');
      } catch (error) {
        const errorMessage = (error as Error).message;
        expect(errorMessage).toContain('Available tools:');
        expect(errorMessage).toContain('Available categories:');
        expect(errorMessage).toContain('search');
        expect(errorMessage).toContain('discovery');
      }
    });
  });

  describe('getEnabledToolsFromList', () => {
    it('should return empty list for non-internal tools category', () => {
      const result = flagManager.getEnabledToolsFromList('otherCategory', ['search', 'list']);
      expect(result).toEqual([]);
    });

    it('should return empty list for empty tools list', () => {
      const result = flagManager.getEnabledToolsFromList('internalTools', []);
      expect(result).toEqual([]);
    });

    it('should filter valid tools from list', () => {
      const result = flagManager.getEnabledToolsFromList('internalTools', ['search', 'list', 'invalid_tool']);
      expect(result).toEqual(['search', 'list']);
    });

    it('should handle all valid tools', () => {
      const allTools = [
        'search',
        'registry_status',
        'registry_info',
        'registry_list',
        'list',
        'status',
        'install',
        'enable',
      ];
      const result = flagManager.getEnabledToolsFromList('internalTools', allTools);
      expect(result).toEqual(allTools);
    });
  });

  describe('getAvailableToolsAndCategories', () => {
    it('should return available tools and categories', () => {
      const result = flagManager.getAvailableToolsAndCategories();

      expect(result.tools).toContain('search');
      expect(result.tools).toContain('list');
      expect(result.tools).toContain('install');
      expect(result.tools).toContain('enable');

      expect(result.categories).toContain('discovery');
      expect(result.categories).toContain('management');
      expect(result.categories).toContain('installation');
      expect(result.categories).toContain('safe');
    });

    it('should return arrays that can be modified without affecting original', () => {
      const result1 = flagManager.getAvailableToolsAndCategories();
      const result2 = flagManager.getAvailableToolsAndCategories();

      result1.tools.push('new_tool');
      result1.categories.push('new_category');

      expect(result2.tools).not.toContain('new_tool');
      expect(result2.categories).not.toContain('new_category');
    });
  });
});

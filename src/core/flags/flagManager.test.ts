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
        },
      });

      expect(flagManager.areToolsSafeForContext('production')).toBe(false);
    });

    it('should return true for production context with internal tools disabled', () => {
      expect(flagManager.areToolsSafeForContext('production')).toBe(true);
    });
  });
});

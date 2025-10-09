import { beforeEach, describe, expect, it } from 'vitest';

import { PresetServerChangeDetector } from './presetServerChangeDetector.js';

describe('PresetServerChangeDetector', () => {
  let detector: PresetServerChangeDetector;

  beforeEach(() => {
    detector = new PresetServerChangeDetector();
  });

  describe('detectChanges', () => {
    it('should detect no changes when no previous data exists', () => {
      const result = detector.detectChanges('test', ['server1', 'server2']);

      expect(result.hasChanged).toBe(false);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.unchanged).toEqual(['server1', 'server2']);
    });

    it('should detect added servers', () => {
      detector.updateServerList('test', ['server1', 'server2']);
      const result = detector.detectChanges('test', ['server1', 'server2', 'server3']);

      expect(result.hasChanged).toBe(true);
      expect(result.added).toEqual(['server3']);
      expect(result.removed).toEqual([]);
      expect(result.unchanged).toEqual(['server1', 'server2']);
    });

    it('should detect removed servers', () => {
      detector.updateServerList('test', ['server1', 'server2', 'server3']);
      const result = detector.detectChanges('test', ['server1', 'server2']);

      expect(result.hasChanged).toBe(true);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual(['server3']);
      expect(result.unchanged).toEqual(['server1', 'server2']);
    });

    it('should detect both added and removed servers', () => {
      detector.updateServerList('test', ['server1', 'server2', 'server3']);
      const result = detector.detectChanges('test', ['server2', 'server4', 'server5']);

      expect(result.hasChanged).toBe(true);
      expect(result.added).toEqual(['server4', 'server5']);
      expect(result.removed).toEqual(['server1', 'server3']);
      expect(result.unchanged).toEqual(['server2']);
    });

    it('should detect no changes when server lists are identical', () => {
      detector.updateServerList('test', ['server1', 'server2', 'server3']);
      const result = detector.detectChanges('test', ['server3', 'server1', 'server2']); // Different order

      expect(result.hasChanged).toBe(false);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.unchanged).toEqual(['server1', 'server2', 'server3']);
    });

    it('should handle empty server lists', () => {
      detector.updateServerList('test', []);
      const result = detector.detectChanges('test', []);

      expect(result.hasChanged).toBe(false);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.unchanged).toEqual([]);
    });

    it('should detect changes from empty to non-empty', () => {
      detector.updateServerList('test', []);
      const result = detector.detectChanges('test', ['server1', 'server2']);

      expect(result.hasChanged).toBe(true);
      expect(result.added).toEqual(['server1', 'server2']);
      expect(result.removed).toEqual([]);
      expect(result.unchanged).toEqual([]);
    });

    it('should detect changes from non-empty to empty', () => {
      detector.updateServerList('test', ['server1', 'server2']);
      const result = detector.detectChanges('test', []);

      expect(result.hasChanged).toBe(true);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual(['server1', 'server2']);
      expect(result.unchanged).toEqual([]);
    });
  });

  describe('updateServerList', () => {
    it('should store server list for a preset', () => {
      detector.updateServerList('test', ['server1', 'server2']);

      expect(detector.hasPreset('test')).toBe(true);
      expect(detector.getPreviousServerList('test')).toEqual(['server1', 'server2']);
    });

    it('should sort and store server list', () => {
      detector.updateServerList('test', ['server3', 'server1', 'server2']);

      expect(detector.getPreviousServerList('test')).toEqual(['server1', 'server2', 'server3']);
    });

    it('should update existing preset', () => {
      detector.updateServerList('test', ['server1', 'server2']);
      detector.updateServerList('test', ['server3', 'server4']);

      expect(detector.getPreviousServerList('test')).toEqual(['server3', 'server4']);
    });
  });

  describe('getPreviousServerList', () => {
    it('should return empty array for non-existent preset', () => {
      expect(detector.getPreviousServerList('nonexistent')).toEqual([]);
    });

    it('should return copy of stored list', () => {
      detector.updateServerList('test', ['server1', 'server2']);
      const list1 = detector.getPreviousServerList('test');
      const list2 = detector.getPreviousServerList('test');

      expect(list1).toEqual(['server1', 'server2']);
      expect(list2).toEqual(['server1', 'server2']);
      expect(list1).not.toBe(list2); // Should be different array instances
    });
  });

  describe('hasPreset', () => {
    it('should return false for non-existent preset', () => {
      expect(detector.hasPreset('nonexistent')).toBe(false);
    });

    it('should return true for existing preset', () => {
      detector.updateServerList('test', ['server1']);
      expect(detector.hasPreset('test')).toBe(true);
    });
  });

  describe('removePreset', () => {
    it('should remove tracking for a preset', () => {
      detector.updateServerList('test', ['server1']);
      expect(detector.hasPreset('test')).toBe(true);

      detector.removePreset('test');
      expect(detector.hasPreset('test')).toBe(false);
      expect(detector.getPreviousServerList('test')).toEqual([]);
    });

    it('should handle removing non-existent preset', () => {
      detector.removePreset('nonexistent'); // Should not throw
      expect(detector.hasPreset('nonexistent')).toBe(false);
    });
  });

  describe('getTrackedPresets', () => {
    it('should return empty array when no presets tracked', () => {
      expect(detector.getTrackedPresets()).toEqual([]);
    });

    it('should return sorted list of tracked presets', () => {
      detector.updateServerList('preset3', ['server1']);
      detector.updateServerList('preset1', ['server2']);
      detector.updateServerList('preset2', ['server3']);

      expect(detector.getTrackedPresets()).toEqual(['preset1', 'preset2', 'preset3']);
    });
  });

  describe('clear', () => {
    it('should remove all tracked presets', () => {
      detector.updateServerList('test1', ['server1']);
      detector.updateServerList('test2', ['server2']);

      expect(detector.getTrackedPresets()).toHaveLength(2);

      detector.clear();

      expect(detector.getTrackedPresets()).toEqual([]);
      expect(detector.hasPreset('test1')).toBe(false);
      expect(detector.hasPreset('test2')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return zero stats for empty detector', () => {
      const stats = detector.getStats();

      expect(stats.totalPresets).toBe(0);
      expect(stats.totalUniqueServers).toBe(0);
      expect(stats.serverCounts).toEqual({});
    });

    it('should calculate stats correctly', () => {
      detector.updateServerList('preset1', ['server1', 'server2']);
      detector.updateServerList('preset2', ['server2', 'server3']);
      detector.updateServerList('preset3', ['server1']);

      const stats = detector.getStats();

      expect(stats.totalPresets).toBe(3);
      expect(stats.totalUniqueServers).toBe(3); // server1, server2, server3
      expect(stats.serverCounts).toEqual({
        preset1: 2,
        preset2: 2,
        preset3: 1,
      });
    });
  });

  describe('multiple presets', () => {
    it('should handle multiple presets independently', () => {
      detector.updateServerList('preset1', ['server1', 'server2']);
      detector.updateServerList('preset2', ['server3', 'server4']);

      const result1 = detector.detectChanges('preset1', ['server1', 'server3']);
      const result2 = detector.detectChanges('preset2', ['server3', 'server4']);

      expect(result1.hasChanged).toBe(true);
      expect(result1.added).toEqual(['server3']);
      expect(result1.removed).toEqual(['server2']);

      expect(result2.hasChanged).toBe(false);
      expect(result2.added).toEqual([]);
      expect(result2.removed).toEqual([]);
    });
  });
});

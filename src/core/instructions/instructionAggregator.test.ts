import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstructionAggregator } from './instructionAggregator.js';

describe('InstructionAggregator', () => {
  let aggregator: InstructionAggregator;

  beforeEach(() => {
    aggregator = new InstructionAggregator();
  });

  describe('setInstructions', () => {
    it('should store instructions for a server', () => {
      const instructions = 'Test server instructions';

      aggregator.setInstructions('server1', instructions);

      expect(aggregator.hasInstructions('server1')).toBe(true);
      expect(aggregator.getServerInstructions('server1')).toBe(instructions);
      expect(aggregator.getServerCount()).toBe(1);
    });

    it('should update existing instructions for a server', () => {
      const oldInstructions = 'Old instructions';
      const newInstructions = 'New instructions';

      aggregator.setInstructions('server1', oldInstructions);
      aggregator.setInstructions('server1', newInstructions);

      expect(aggregator.getServerInstructions('server1')).toBe(newInstructions);
      expect(aggregator.getServerCount()).toBe(1);
    });

    it('should remove server when instructions are undefined', () => {
      aggregator.setInstructions('server1', 'Test instructions');
      aggregator.setInstructions('server1', undefined);

      expect(aggregator.hasInstructions('server1')).toBe(false);
      expect(aggregator.getServerCount()).toBe(0);
    });

    it('should remove server when instructions are empty string', () => {
      aggregator.setInstructions('server1', 'Test instructions');
      aggregator.setInstructions('server1', '');

      expect(aggregator.hasInstructions('server1')).toBe(false);
      expect(aggregator.getServerCount()).toBe(0);
    });

    it('should trim whitespace from instructions', () => {
      const instructions = '  Test instructions with whitespace  ';
      const expectedTrimmed = 'Test instructions with whitespace';

      aggregator.setInstructions('server1', instructions);

      expect(aggregator.getServerInstructions('server1')).toBe(expectedTrimmed);
    });

    it('should emit instructions-changed event when instructions change', () => {
      const mockListener = vi.fn();
      aggregator.on('instructions-changed', mockListener);

      aggregator.setInstructions('server1', 'Test instructions');

      expect(mockListener).toHaveBeenCalledWith();
      expect(mockListener).toHaveBeenCalledTimes(1);
    });

    it('should not emit event when instructions do not change', () => {
      const instructions = 'Test instructions';
      const mockListener = vi.fn();

      aggregator.setInstructions('server1', instructions);
      aggregator.on('instructions-changed', mockListener);
      aggregator.setInstructions('server1', instructions);

      expect(mockListener).not.toHaveBeenCalled();
    });
  });

  describe('removeServer', () => {
    it('should remove server and emit event if server had instructions', () => {
      const mockListener = vi.fn();

      aggregator.setInstructions('server1', 'Test instructions');
      aggregator.on('instructions-changed', mockListener);
      mockListener.mockClear(); // Clear the setup call

      aggregator.removeServer('server1');

      expect(aggregator.hasInstructions('server1')).toBe(false);
      expect(aggregator.getServerCount()).toBe(0);
      expect(mockListener).toHaveBeenCalledWith();
    });

    it('should not emit event if server had no instructions', () => {
      const mockListener = vi.fn();
      aggregator.on('instructions-changed', mockListener);

      aggregator.removeServer('nonexistent');

      expect(mockListener).not.toHaveBeenCalled();
    });
  });

  describe('getServerNames', () => {
    it('should return empty array when no servers', () => {
      expect(aggregator.getServerNames()).toEqual([]);
    });

    it('should return sorted list of server names', () => {
      aggregator.setInstructions('zebra', 'Z');
      aggregator.setInstructions('alpha', 'A');
      aggregator.setInstructions('bravo', 'B');

      expect(aggregator.getServerNames()).toEqual(['alpha', 'bravo', 'zebra']);
    });
  });

  describe('clear', () => {
    it('should clear all instructions and emit event', () => {
      const mockListener = vi.fn();

      aggregator.setInstructions('server1', 'Instructions 1');
      aggregator.setInstructions('server2', 'Instructions 2');
      aggregator.on('instructions-changed', mockListener);
      mockListener.mockClear(); // Clear setup calls

      aggregator.clear();

      expect(aggregator.getServerCount()).toBe(0);
      expect(mockListener).toHaveBeenCalledWith();
    });

    it('should not emit event when clearing empty aggregator', () => {
      const mockListener = vi.fn();
      aggregator.on('instructions-changed', mockListener);

      aggregator.clear();

      expect(mockListener).not.toHaveBeenCalled();
    });
  });

  describe('getSummary', () => {
    it('should return summary with no servers', () => {
      expect(aggregator.getSummary()).toBe('0 servers with instructions: ');
    });

    it('should return summary with server names', () => {
      aggregator.setInstructions('server2', 'Instructions 2');
      aggregator.setInstructions('server1', 'Instructions 1');

      expect(aggregator.getSummary()).toBe('2 servers with instructions: server1, server2');
    });
  });
});

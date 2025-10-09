import { describe, expect, it } from 'vitest';

import {
  type DoubleHyphenParseResult,
  hasDoubleHyphen,
  mergeDoubleHyphenArgs,
  parseDoubleHyphenArgs,
} from './doubleHyphenParser.js';

describe('doubleHyphenParser', () => {
  describe('hasDoubleHyphen', () => {
    it('should return true when " -- " is present', () => {
      const args = ['add', 'server-name', '--env', 'KEY=value', '--', 'npx', '-y', 'package'];
      expect(hasDoubleHyphen(args)).toBe(true);
    });

    it('should return false when " -- " is not present', () => {
      const args = ['add', 'server-name', '--type', 'stdio', '--command', 'node'];
      expect(hasDoubleHyphen(args)).toBe(false);
    });

    it('should return true when " -- " is at the end with no following args', () => {
      const args = ['add', 'server-name', '--'];
      expect(hasDoubleHyphen(args)).toBe(true);
    });
  });

  describe('parseDoubleHyphenArgs', () => {
    it('should parse simple command with no arguments', () => {
      const args = ['add', 'server-name', '--', 'node'];
      const result = parseDoubleHyphenArgs(args);

      expect(result).toEqual({
        command: 'node',
        type: 'stdio',
      });
    });

    it('should parse command with multiple arguments', () => {
      const args = ['add', 'server-name', '--', 'npx', '-y', 'airtable-mcp-server'];
      const result = parseDoubleHyphenArgs(args);

      expect(result).toEqual({
        command: 'npx',
        args: ['-y', 'airtable-mcp-server'],
        type: 'stdio',
      });
    });

    it('should parse complex command with flags and arguments', () => {
      const args = ['add', 'server', '--env', 'KEY=value', '--', 'cmd', '/c', 'npx', '-y', '@some/package'];
      const result = parseDoubleHyphenArgs(args);

      expect(result).toEqual({
        command: 'cmd',
        args: ['/c', 'npx', '-y', '@some/package'],
        type: 'stdio',
      });
    });

    it('should return empty result when no " -- " is present', () => {
      const args = ['add', 'server-name', '--type', 'stdio'];
      const result = parseDoubleHyphenArgs(args);

      expect(result).toEqual({});
    });

    it('should throw error when " -- " is present but no command follows', () => {
      const args = ['add', 'server-name', '--'];

      expect(() => parseDoubleHyphenArgs(args)).toThrow('No command specified after " -- "');
    });

    it('should handle " -- " with single argument', () => {
      const args = ['add', 'server-name', '--', 'echo'];
      const result = parseDoubleHyphenArgs(args);

      expect(result).toEqual({
        command: 'echo',
        type: 'stdio',
      });
    });
  });

  describe('mergeDoubleHyphenArgs', () => {
    it('should merge double hyphen args when yargs args are empty', () => {
      const yargsArgs = { name: 'server-name' };
      const doubleHyphenResult: DoubleHyphenParseResult = {
        command: 'node',
        args: ['server.js'],
        type: 'stdio',
      };

      const result = mergeDoubleHyphenArgs(yargsArgs, doubleHyphenResult);

      expect(result).toEqual({
        name: 'server-name',
        command: 'node',
        args: ['server.js'],
        type: 'stdio',
      });
    });

    it('should prioritize explicit yargs flags over double hyphen args', () => {
      const yargsArgs = {
        name: 'server-name',
        type: 'http',
        command: 'explicit-command',
      };
      const doubleHyphenResult: DoubleHyphenParseResult = {
        command: 'double-hyphen-command',
        args: ['arg1'],
        type: 'stdio',
      };

      const result = mergeDoubleHyphenArgs(yargsArgs, doubleHyphenResult);

      expect(result).toEqual({
        name: 'server-name',
        type: 'http', // yargs wins
        command: 'explicit-command', // yargs wins
        args: ['arg1'], // double hyphen adds since not in yargs
      });
    });

    it('should only add missing values from double hyphen args', () => {
      const yargsArgs = {
        name: 'server-name',
        env: ['NODE_ENV=production'],
      };
      const doubleHyphenResult: DoubleHyphenParseResult = {
        command: 'npx',
        args: ['-y', 'package'],
        type: 'stdio',
      };

      const result = mergeDoubleHyphenArgs(yargsArgs, doubleHyphenResult);

      expect(result).toEqual({
        name: 'server-name',
        env: ['NODE_ENV=production'],
        command: 'npx',
        args: ['-y', 'package'],
        type: 'stdio',
      });
    });

    it('should handle empty double hyphen result', () => {
      const yargsArgs = {
        name: 'server-name',
        type: 'http',
        url: 'http://localhost:3000',
      };
      const doubleHyphenResult: DoubleHyphenParseResult = {};

      const result = mergeDoubleHyphenArgs(yargsArgs, doubleHyphenResult);

      expect(result).toEqual(yargsArgs);
    });
  });
});

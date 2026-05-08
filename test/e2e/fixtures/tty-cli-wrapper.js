#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

Object.defineProperty(process.stdin, 'isTTY', {
  value: true,
  configurable: true,
});
Object.defineProperty(process.stdout, 'isTTY', {
  value: true,
  configurable: true,
});

process.stdin.setRawMode = () => {};

const [, , targetScript, ...args] = process.argv;

if (!targetScript) {
  throw new Error('Missing target script for TTY CLI wrapper');
}

process.argv = [process.execPath, targetScript, ...args];

await import(pathToFileURL(resolve(targetScript)).href);

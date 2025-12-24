/**
 * Spinner utility for loading indicators
 * Wraps ora for TypeScript-friendly interface
 */
import type { Ora } from 'ora';
import ora from 'ora';

export interface Spinner {
  start(): Spinner;
  stop(): Spinner;
  succeed(message?: string): Spinner;
  fail(message?: string): Spinner;
  warn(message?: string): Spinner;
  info(message?: string): Spinner;
  update(text: string): Spinner;
  isSpinning: boolean;
}

/**
 * Create a new spinner instance
 */
export function createSpinner(text: string): Spinner {
  const instance: Ora = ora({
    text,
    spinner: 'dots',
    color: 'cyan',
  });

  return {
    start() {
      instance.start();
      return this;
    },
    stop() {
      instance.stop();
      return this;
    },
    succeed(message) {
      instance.succeed(message);
      return this;
    },
    fail(message) {
      instance.fail(message);
      return this;
    },
    warn(message) {
      instance.warn(message);
      return this;
    },
    info(message) {
      instance.info(message);
      return this;
    },
    update(text) {
      instance.text = text;
      return this;
    },
    get isSpinning() {
      return instance.isSpinning;
    },
  };
}

/**
 * Create and start a spinner immediately
 */
export function spinner(text: string): Spinner {
  return createSpinner(text).start();
}

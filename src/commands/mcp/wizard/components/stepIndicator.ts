import printer from '@src/utils/ui/printer.js';

import boxen from 'boxen';
import chalk from 'chalk';

const WIZARD_STEPS = ['Search', 'Select', 'Configure', 'Confirm', 'Install'] as const;

/**
 * Show wizard step progress indicator
 * @param currentStep Current step number (1-5)
 * @param skipClear Whether to skip clearing console (useful when preserving logs)
 */
export function showStepIndicator(currentStep: number, skipClear = false): void {
  if (!skipClear) {
    console.clear();
  }

  const stepBar = WIZARD_STEPS.map((step, index) => {
    const num = index + 1;
    if (num < currentStep) {
      return chalk.green(`✓ ${step}`);
    } else if (num === currentStep) {
      return chalk.cyan.bold(`► ${step}`);
    } else {
      return chalk.gray(`○ ${step}`);
    }
  }).join(chalk.gray(' → '));

  printer.raw(
    boxen(stepBar, {
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      borderStyle: 'single',
      borderColor: 'gray',
    }),
  );
  printer.blank();
}

/**
 * Get total number of wizard steps
 */
export function getTotalSteps(): number {
  return WIZARD_STEPS.length;
}

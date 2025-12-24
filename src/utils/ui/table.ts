/**
 * Table formatting utility for CLI output
 */
import chalk from 'chalk';

export interface TableColumn {
  name: string;
  alignment?: 'left' | 'center' | 'right';
  width?: number;
}

export interface TableOptions {
  columns: TableColumn[];
  rows: Array<Record<string, string | number>>;
  title?: string;
  headers?: boolean;
}

/**
 * Calculate column widths based on content
 */
function calculateColumnWidths(columns: TableColumn[], rows: Array<Record<string, string | number>>): number[] {
  const widths: number[] = columns.map((col) => col.width || col.name.length);

  // Find maximum width for each column based on row content
  for (const row of rows) {
    for (let i = 0; i < columns.length; i++) {
      const colName = columns[i].name;
      const value = String(row[colName] ?? '');
      widths[i] = Math.max(widths[i], value.length);
    }
  }

  // Add padding
  return widths.map((w) => w + 2);
}

/**
 * Align text within a column
 */
function alignText(text: string, width: number, alignment: 'left' | 'center' | 'right' = 'left'): string {
  const padded = text.padEnd(width - 1);
  if (alignment === 'center') {
    const totalPadding = width - text.length - 1;
    const leftPadding = Math.floor(totalPadding / 2);
    const rightPadding = totalPadding - leftPadding;
    return ' '.repeat(leftPadding) + text + ' '.repeat(rightPadding);
  } else if (alignment === 'right') {
    return ' '.repeat(width - text.length - 1) + text + ' ';
  }
  return padded;
}

/**
 * Format and print a table
 */
export function printTable(options: TableOptions): void {
  const { columns, rows, title, headers = true } = options;

  if (rows.length === 0) {
    console.log(chalk.gray('No data to display'));
    return;
  }

  const widths = calculateColumnWidths(columns, rows);

  // Print title if provided
  if (title) {
    console.log();
    console.log(chalk.bold.cyan(title));
  }

  // Print header row
  if (headers) {
    const headerRow = columns.map((col, i) => alignText(col.name, widths[i], col.alignment)).join(chalk.gray('│'));
    console.log(chalk.bold(headerRow));

    // Print separator
    const separator = columns.map((w, i) => chalk.gray('─'.repeat(widths[i]))).join(chalk.gray('┼'));
    console.log(separator);
  }

  // Print data rows
  for (const row of rows) {
    const cells = columns.map((col, i) => {
      const value = String(row[col.name] ?? '');
      const aligned = alignText(value, widths[i], col.alignment);
      return aligned;
    });
    console.log(cells.join(chalk.gray('│')));
  }
}

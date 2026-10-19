import chalk, { Chalk } from 'chalk';
import yargs from 'yargs';

export function helpWidth(stream: { isTTY?: boolean; columns?: number }): number {
  if (!stream.isTTY) return 80;
  return Math.min(stream.columns || 80, 100);
}

function wrapWords(text: string, width: number, indent: string): string {
  const lines: string[] = [];
  let line = indent;
  for (const word of text.split(/\s+/)) {
    if (line.length > indent.length && line.length + word.length + 1 > width) {
      lines.push(line);
      line = indent;
    }
    line += line.length === indent.length ? word : ` ${word}`;
  }
  return [...lines, line].join('\n');
}

/** Yargs' two-column layout splits long switches on narrow terminals. */
function stackNarrowHelp(text: string, width: number): string {
  return text
    .split('\n')
    .map((line) => {
      if (!line.trim()) return '';
      const columns = line.trim().split(/ {2,}/);
      if (line.startsWith('  ') && columns.length > 1) {
        return `${wrapWords(columns[0], width, '  ')}\n${wrapWords(columns.slice(1).join(' '), width, '    ')}`;
      }
      return wrapWords(line.trim(), width, line.startsWith('  ') ? '  ' : '');
    })
    .join('\n');
}

/** Style after wrapping so ANSI escapes never affect column alignment. */
export function styleHelp(
  text: string,
  isTTY = Boolean(process.stdout.isTTY),
  width = helpWidth(process.stdout),
): string {
  // Chalk's bundled color detector does not honor NO_COLOR.
  const { color: noColor } = yargs([]).env('NO').option('color', { type: 'string' }).parseSync();
  const color = new Chalk({ level: isTTY && !noColor ? chalk.level : 0 });
  // Keep compact root help a presentation choice; Yargs hide() leaks across parses.
  const overview = text
    .split('\n\n')
    .filter((section) => !section.startsWith('Server options:\n'))
    .join('\n\n');
  const formatted = width < 80 ? stackNarrowHelp(overview, width) : overview;
  return formatted
    .split('\n')
    .map((line) => {
      if (/^[A-Za-z][A-Za-z /-]*:$/.test(line)) return color.bold.cyan(line);
      return line.replace(
        /^(\s*(?:Usage: )?)(1mcp\b[^\n]*?)(?=\s{2,}|$)/,
        (_, indent, command) => `${indent}${color.bold(command)}`,
      );
    })
    .join('\n');
}

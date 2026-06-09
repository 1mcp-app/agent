import { MCPServerParams } from '@src/core/types/transport.js';
import { TagQueryEvaluator, TagSelection, TagState } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { PresetStrategy } from '@src/domains/preset/types/presetTypes.js';

import boxen from 'boxen';
import chalk from 'chalk';

export function showTagSelection(
  tagSelections: TagSelection[],
  currentIndex: number,
  servers: Record<string, MCPServerParams>,
  strategy: PresetStrategy,
): void {
  console.log(createTagSelectionHeader(strategy));
  console.log(createTagList(tagSelections, currentIndex, servers));
  console.log(createLivePreview(tagSelections, servers, strategy));
  console.log(createStateLegend());
}

export function getTagStateColor(state: TagState): (text: string) => string {
  switch (state) {
    case 'empty':
      return chalk.gray;
    case 'selected':
      return chalk.green;
    case 'not-selected':
      return chalk.red;
    default:
      return chalk.reset;
  }
}

export function showTagServerDetails(tagSelection: TagSelection, servers: Record<string, MCPServerParams>): void {
  const enabledServers = tagSelection.servers.filter((serverName) => servers[serverName]?.disabled !== true);
  const disabledServers = tagSelection.servers.filter((serverName) => servers[serverName]?.disabled === true);

  let content = chalk.blue.bold(`📋 Tag: ${tagSelection.tag}\n\n`);

  if (enabledServers.length > 0) {
    content += chalk.green.bold(`✅ Enabled Servers (${enabledServers.length}):\n`);
    for (const serverName of enabledServers) {
      content += formatServerDetailsLine(serverName, servers, chalk.green);
    }
    content += '\n';
  }

  if (disabledServers.length > 0) {
    content += chalk.red.bold(`❌ Disabled Servers (${disabledServers.length}):\n`);
    for (const serverName of disabledServers) {
      content += formatServerDetailsLine(serverName, servers, chalk.red);
    }
    content += '\n';
  }

  if (tagSelection.servers.length === 0) {
    content += chalk.yellow('No servers have this tag.\n\n');
  }

  content += chalk.gray('Press any key to return to tag selection...');

  console.log(
    boxen(content, {
      padding: 1,
      borderStyle: 'round',
      borderColor: 'blue',
      title: `🔍 Server Details`,
      titleAlignment: 'center',
    }),
  );
}

function createTagSelectionHeader(strategy: PresetStrategy): string {
  return boxen(
    chalk.cyan.bold('🎯 Three-State Tag Selection\n\n') +
      chalk.yellow(`Strategy: ${strategy === 'and' ? 'ALL' : 'ANY'} selected tags must match\n`) +
      chalk.gray('Controls: ↑↓ Navigate  Space Cycle states  → Server details  Enter Confirm  ← Back  Esc Cancel'),
    {
      padding: 1,
      borderStyle: 'double',
      borderColor: 'cyan',
      title: 'Tag Selection',
      titleAlignment: 'center',
    },
  );
}

function createTagList(
  tagSelections: TagSelection[],
  currentIndex: number,
  servers: Record<string, MCPServerParams>,
): string {
  const tagListContent = tagSelections
    .map((selection, index) => {
      const symbol = TagQueryEvaluator.getTagStateSymbol(selection.state);
      const stateColor = getTagStateColor(selection.state);
      const isCurrentIndex = index === currentIndex;
      const cursor = isCurrentIndex ? chalk.yellow.bold('►') : ' ';
      const tagHighlight = isCurrentIndex ? chalk.bgGray.white.bold : chalk.white;
      const enabledServers = selection.servers.filter((serverName) => servers[serverName]?.disabled !== true);
      const disabledServers = selection.servers.filter((serverName) => servers[serverName]?.disabled === true);
      const disabledText =
        disabledServers.length > 0 ? chalk.gray(`, ${chalk.red(disabledServers.length)} disabled`) : '';
      const serverInfo = chalk.gray(`(${chalk.blue(enabledServers.length)} enabled`) + disabledText + chalk.gray(')');

      return `${cursor} ${stateColor(symbol)} ${tagHighlight(selection.tag)} ${serverInfo}`;
    })
    .join('\n');

  return boxen(tagListContent, {
    padding: 1,
    borderStyle: 'round',
    borderColor: 'blue',
  });
}

function createLivePreview(
  tagSelections: TagSelection[],
  servers: Record<string, MCPServerParams>,
  strategy: PresetStrategy,
): string {
  const matchingServers = TagQueryEvaluator.getMatchingServers(tagSelections, servers, strategy);
  const disabledServers = matchingServers.filter((serverName) => servers[serverName]?.disabled === true);
  const enabledServers = matchingServers.filter((serverName) => servers[serverName]?.disabled !== true);
  const matchColor = enabledServers.length === 0 ? chalk.red : enabledServers.length < 3 ? chalk.yellow : chalk.green;
  const matchIcon = enabledServers.length === 0 ? '❌' : enabledServers.length < 3 ? '⚠️' : '✅';

  let previewContent =
    chalk.blue.bold('Live Preview:\n') +
    `${matchIcon} ${matchColor.bold(`${enabledServers.length} enabled servers`)} match your selection\n` +
    (enabledServers.length > 0
      ? chalk.green(`Servers: ${TagQueryEvaluator.formatServerList(enabledServers, 3)}`)
      : chalk.gray('No enabled servers match'));

  if (disabledServers.length > 0) {
    previewContent +=
      '\n' +
      chalk.red.bold(`⚠️  ${disabledServers.length} disabled servers also match: `) +
      chalk.red(TagQueryEvaluator.formatServerList(disabledServers, 3));
  }

  return boxen(previewContent, {
    padding: 1,
    borderStyle: 'round',
    borderColor: disabledServers.length > 0 ? 'yellow' : 'green',
    title: '⚡ Live Preview',
    titleAlignment: 'center',
  });
}

function createStateLegend(): string {
  const legend =
    chalk.gray('○ ') +
    chalk.dim('Empty (ignored)') +
    '   ' +
    chalk.green('✓ ') +
    chalk.green('Selected (include)') +
    '   ' +
    chalk.red('✗ ') +
    chalk.red('Not selected (exclude)');

  return boxen(legend, {
    padding: 1,
    borderStyle: 'single',
    borderColor: 'gray',
  });
}

function formatServerDetailsLine(
  serverName: string,
  servers: Record<string, MCPServerParams>,
  color: (text: string) => string,
): string {
  const serverConfig = servers[serverName];
  const allTags = (serverConfig.tags || []).join(', ');
  return color(`  • ${serverName}`) + chalk.gray(` - tags: ${allTags || 'none'}\n`);
}

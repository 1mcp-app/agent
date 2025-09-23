import chalk from 'chalk';
import boxen from 'boxen';
import { ServerVersionsResponse, OutputFormat } from '../../core/registry/types.js';

/**
 * Format server versions for display
 */
export function formatServerVersions(versionsResponse: ServerVersionsResponse, format: OutputFormat = 'table'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(versionsResponse, null, 2);
    case 'detailed':
      return formatDetailedVersions(versionsResponse);
    case 'table':
    default:
      return formatTableVersions(versionsResponse);
  }
}

/**
 * Format versions as table
 */
function formatTableVersions(versionsResponse: ServerVersionsResponse): string {
  const { versions, name } = versionsResponse;

  if (versions.length === 0) {
    return `\nNo versions found for server: ${name}\n`;
  }

  // Sort versions by publishedAt descending (newest first)
  const sortedVersions = [...versions].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  const tableData = sortedVersions.map((version, index) => ({
    '#': index + 1,
    Version: version.version,
    Status: version.status,
    Latest: version.isLatest ? 'Yes' : 'No',
    Published: formatDate(version.publishedAt),
    Updated: formatDate(version.updatedAt),
  }));

  let result = `\nVersions for ${name} (${versions.length} total):\n`;
  console.table(tableData);

  return result;
}

/**
 * Format versions with enhanced detailed display
 */
function formatDetailedVersions(versionsResponse: ServerVersionsResponse): string {
  const { versions, name, serverId } = versionsResponse;

  if (versions.length === 0) {
    return chalk.yellow(`No versions found for server: ${name}`);
  }

  // Sort versions by publishedAt descending (newest first)
  const sortedVersions = [...versions].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  // Header
  const header = chalk.cyan.bold(name) + chalk.gray(` (${versions.length} versions)`);

  // Version list
  const versionsList = sortedVersions
    .map((version, index) => {
      const statusColor = version.status === 'active' ? 'green' : version.status === 'deprecated' ? 'yellow' : 'red';
      const statusBadge = chalk[statusColor](`● ${version.status}`);

      const latestBadge = version.isLatest ? chalk.yellow.bold(' [LATEST]') : '';
      const versionNumber = chalk.white.bold(version.version);

      const publishedDate = chalk.gray(`Published: ${formatRelativeDate(version.publishedAt)}`);
      const updatedDate =
        version.updatedAt !== version.publishedAt
          ? chalk.gray(`Updated: ${formatRelativeDate(version.updatedAt)}`)
          : '';

      return `  ${chalk.gray(`${index + 1}.`)} ${versionNumber}${latestBadge} ${statusBadge}
     ${publishedDate}
     ${updatedDate}`
        .split('\n')
        .filter((line) => line.trim())
        .join('\n');
    })
    .join('\n\n');

  const content = `${header}\n\n${versionsList}`;

  // Add server info at bottom
  const serverInfo = `\n${chalk.cyan.bold('Server Information:')}
  ${chalk.cyan('Server ID:')} ${serverId}
  ${chalk.cyan('Active Versions:')} ${sortedVersions.filter((v) => v.status === 'active').length}
  ${chalk.cyan('Deprecated Versions:')} ${sortedVersions.filter((v) => v.status === 'deprecated').length}`;

  return boxen(content + serverInfo, {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    borderColor: 'cyan',
  });
}

/**
 * Format date to readable string
 */
function formatDate(isoString: string): string {
  if (!isoString) return 'Unknown';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Invalid Date';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Invalid Date';
  }
}

/**
 * Format date as relative time (e.g., "2 days ago")
 */
function formatRelativeDate(isoString: string): string {
  if (!isoString) return 'Unknown';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Invalid Date';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffDays > 30) {
      return formatDate(isoString);
    } else if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffMinutes > 0) {
      return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
    } else {
      return 'Just now';
    }
  } catch {
    return 'Invalid Date';
  }
}

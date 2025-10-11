import { ServerPackage, Transport } from '@src/domains/registry/types.js';

import chalk from 'chalk';

/**
 * Truncate string to specified length with ellipsis
 */
export function truncateString(str: string | null | undefined, maxLength: number): string {
  if (!str || typeof str !== 'string') return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Format transport value to handle objects and undefined values
 */
export function formatTransport(transport?: Transport | string): string {
  if (!transport) return '';
  if (typeof transport === 'string') return transport;
  if (typeof transport === 'object') {
    // Handle case where transport is an object
    return transport.type || String(transport);
  }
  return String(transport);
}

/**
 * Format status with colors
 */
export function formatStatus(status: string | null | undefined): string {
  if (status === '') return chalk.gray('● ');
  if (!status) return chalk.gray('● UNKNOWN');

  switch (status) {
    case 'active':
      return chalk.green('● ACTIVE');
    case 'deprecated':
      return chalk.yellow('● DEPRECATED');
    case 'archived':
      return chalk.red('● ARCHIVED');
    default:
      return chalk.gray(`● ${status.toUpperCase()}`);
  }
}

/**
 * Format registry types without colors (for table display)
 */
export function formatRegistryTypesPlain(packages: ServerPackage[] | null | undefined = []): string {
  if (!packages) return 'unknown';

  const types = packages
    .map((p) => p.registryType)
    .filter((type) => type && type !== 'unknown')
    .filter(Boolean);
  const uniqueTypes = [...new Set(types)];

  if (uniqueTypes.length === 0) return 'unknown';

  return uniqueTypes.join(', ');
}

/**
 * Format transport types without colors (for table display)
 */
export function formatTransportTypesPlain(packages: ServerPackage[] | null | undefined = []): string {
  if (!packages) return 'stdio';

  const transports = packages.map((p) => formatTransport(p.transport)).filter(Boolean);
  const uniqueTransports = [...new Set(transports)];

  if (uniqueTransports.length === 0) return 'stdio';

  return uniqueTransports.join(', ');
}

/**
 * Format ISO date string to readable format
 */
export function formatDate(isoString: string): string {
  if (!isoString || typeof isoString !== 'string') {
    return 'Unknown';
  }
  try {
    const date = new Date(isoString);
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'Invalid Date';
    }
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
export function formatRelativeDate(isoString: string): string {
  if (!isoString) return 'Unknown';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Invalid Date';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffDays > 7) {
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

/**
 * Format ISO timestamp to readable format with time
 */
export function formatTimestamp(isoString: string): string {
  if (!isoString) return '';

  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return isoString;
    }
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

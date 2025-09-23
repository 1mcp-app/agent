import chalk from 'chalk';
import boxen from 'boxen';
import {
  RegistryServer,
  OutputFormat,
  OFFICIAL_REGISTRY_KEY,
  ServerPackage,
  Transport,
} from '../../core/registry/types.js';

/**
 * Format a server's details for display
 */
export function formatServerDetails(server: RegistryServer, format: OutputFormat = 'table'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(server, null, 2);
    case 'detailed':
      return formatDetailedServer(server);
    case 'table':
    default:
      return formatTableServer(server);
  }
}

/**
 * Format server as table
 */
function formatTableServer(server: RegistryServer): string {
  const meta = server._meta[OFFICIAL_REGISTRY_KEY];

  const basicInfo: Record<string, string> = {
    Name: server.name,
    Description: server.description,
    Status: server.status,
    Version: server.version,
    'Repository URL': server.repository.url,
    'Repository Source': server.repository.source,
  };

  if (server.repository.subfolder) {
    basicInfo['Repository Subfolder'] = server.repository.subfolder;
  }

  const packages = server.packages || [];
  if (packages.length > 0) {
    basicInfo['Package Count'] = packages.length.toString();
    basicInfo['Registry Types'] =
      packages
        .map((p) => p.registryType)
        .filter(Boolean)
        .join(', ') || 'unknown';
    basicInfo['Transport Types'] =
      packages
        .map((p) => formatDetailTransport(p.transport))
        .filter(Boolean)
        .join(', ') || 'stdio';
  }

  const remotes = server.remotes || [];
  if (remotes.length > 0) {
    basicInfo['Remote Endpoints'] = remotes.length.toString();
    basicInfo['Remote Types'] = remotes.map((r) => r.type).join(', ');
  }

  basicInfo['Published At'] = formatDate(meta.publishedAt);
  basicInfo['Updated At'] = formatDate(meta.updatedAt);
  basicInfo['Is Latest'] = meta.isLatest ? 'Yes' : 'No';
  basicInfo['Registry ID'] = meta.serverId;

  let result = '\nServer Details:\n';
  console.table([basicInfo]);

  // Add packages table if available
  if (packages.length > 0) {
    result += '\nPackages:\n';
    const packageData = packages.map((pkg, index) => ({
      Index: index + 1,
      'Registry Type': pkg.registryType || 'unknown',
      Identifier: pkg.identifier,
      Version: pkg.version || server.version,
      Transport: formatDetailTransport(pkg.transport) || 'stdio',
    }));
    console.table(packageData);
  }

  // Add remotes table if available
  if (remotes.length > 0) {
    result += '\nRemote Endpoints:\n';
    const remoteData = remotes.map((remote, index) => ({
      Index: index + 1,
      Type: remote.type,
      URL: remote.url,
    }));
    console.table(remoteData);
  }

  return result;
}

/**
 * Format server with enhanced detailed display
 */
function formatDetailedServer(server: RegistryServer): string {
  const meta = server._meta[OFFICIAL_REGISTRY_KEY];

  // Status badge with color
  const statusColor = server.status === 'active' ? 'green' : server.status === 'deprecated' ? 'yellow' : 'red';
  const statusBadge = chalk[statusColor].bold(`● ${server.status.toUpperCase()}`);

  // Header with enhanced information
  const header = chalk.cyan.bold(server.name) + ' ' + chalk.gray(`(${server.version})`) + ' ' + statusBadge;

  // Description with enhanced formatting
  const description = chalk.white(server.description);

  // Enhanced basic info section
  const basicInfo = [
    `${chalk.cyan('Repository:')} ${server.repository.url}`,
    `${chalk.cyan('Source:')} ${server.repository.source}`,
    server.repository.subfolder ? `${chalk.cyan('Subfolder:')} ${server.repository.subfolder}` : '',
    server.websiteUrl ? `${chalk.cyan('Website:')} ${server.websiteUrl}` : '',
    `${chalk.cyan('Published:')} ${formatRelativeDate(meta.publishedAt)}`,
    `${chalk.cyan('Updated:')} ${formatRelativeDate(meta.updatedAt)}`,
    `${chalk.cyan('Latest Version:')} ${meta.isLatest ? chalk.green('Yes') : chalk.yellow('No')}`,
  ]
    .filter(Boolean)
    .join('\n');

  let content = `${header}\n\n${description}\n\n${basicInfo}`;

  // Enhanced packages section with installation instructions
  const packages = server.packages || [];
  if (packages.length > 0) {
    const packagesList = packages
      .map((pkg, index) => {
        const registryType = pkg.registryType || 'unknown';
        const transport = formatDetailTransport(pkg.transport) || 'stdio';
        const installCmd = generateInstallCommand(pkg, server.version);
        return `  ${index + 1}. ${chalk.yellow(registryType)} - ${pkg.identifier} ${chalk.gray(`(${transport})`)}
     ${chalk.gray(`Install: ${installCmd}`)}`;
      })
      .join('\n');

    content += `\n\n${chalk.cyan.bold('Packages:')} ${chalk.gray(`(${packages.length})`)}
${packagesList}`;
  }

  // Enhanced remotes section
  const remotes = server.remotes || [];
  if (remotes.length > 0) {
    const remotesList = remotes
      .map((remote, index) => {
        return `  ${index + 1}. ${chalk.yellow(remote.type)} - ${remote.url}`;
      })
      .join('\n');

    content += `\n\n${chalk.cyan.bold('Remote Endpoints:')} ${chalk.gray(`(${remotes.length})`)}
${remotesList}`;
  }

  // Enhanced registry and metadata info
  const metaInfo = [
    `${chalk.cyan('Registry ID:')} ${meta.serverId}`,
    `${chalk.cyan('Version ID:')} ${meta.versionId}`,
    server.$schema ? `${chalk.cyan('Schema Version:')} ${server.$schema}` : '',
  ].filter(Boolean);

  content += `\n\n${chalk.cyan.bold('Registry Information:')}
  ${metaInfo.join('\n  ')}`;

  // MCP Usage Instructions section
  content += `\n\n${chalk.cyan.bold('MCP Usage Instructions:')}
  ${chalk.gray('• Add to your MCP client configuration')}
  ${chalk.gray('• Use with 1MCP proxy for multiple server management')}
  ${chalk.gray('• Check transport compatibility with your client')}`;

  // Additional package information if available
  const packageInfo = [];
  if (packages.length > 0) {
    const registryTypes = [...new Set(packages.map((p) => p.registryType).filter(Boolean))];
    const transports = [...new Set(packages.map((p) => formatDetailTransport(p.transport)).filter(Boolean))];

    if (registryTypes.length > 0) {
      packageInfo.push(`${chalk.cyan('Registry Types:')} ${registryTypes.join(', ')}`);
    }
    if (transports.length > 0) {
      packageInfo.push(`${chalk.cyan('Transport Types:')} ${transports.join(', ')}`);
    }
  }

  if (packageInfo.length > 0) {
    content += `\n\n${chalk.cyan.bold('Package Information:')}
  ${packageInfo.join('\n  ')}`;
  }

  return boxen(content, {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    borderColor: 'cyan',
  });
}

/**
 * Generate installation command based on package type
 */
function generateInstallCommand(pkg: ServerPackage, version: string): string {
  const registryType = pkg.registryType;
  const identifier = pkg.identifier;
  const pkgVersion = pkg.version || version;

  switch (registryType) {
    case 'npm':
      return `npm install ${identifier}@${pkgVersion}`;
    case 'pypi':
      return `pip install ${identifier}==${pkgVersion}`;
    case 'docker':
      return `docker pull ${identifier}:${pkgVersion}`;
    default:
      return `${registryType}: ${identifier}@${pkgVersion}`;
  }
}

/**
 * Format transport value to handle objects and undefined values for detailed display
 */
function formatDetailTransport(transport?: Transport): string {
  if (!transport) return '';
  if (typeof transport === 'string') return transport;
  if (typeof transport === 'object') {
    // Handle case where transport is an object
    return transport.type || String(transport);
  }
  return String(transport);
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
      hour: '2-digit',
      minute: '2-digit',
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

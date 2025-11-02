import {
  OFFICIAL_REGISTRY_KEY,
  OutputFormat,
  RegistryServer,
  ServerPackage,
  Transport,
} from '@src/domains/registry/types.js';

import boxen from 'boxen';
import chalk from 'chalk';

import { formatDate, formatRelativeDate } from './commonFormatters.js';

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
  basicInfo['Registry ID'] = server.name || 'N/A';

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
      Runtime: pkg.runtimeHint || 'N/A',
      'Env Vars': (pkg.environmentVariables?.length || 0) > 0 ? pkg.environmentVariables?.length : 'None',
      Args: (pkg.packageArguments?.length || 0) + (pkg.runtimeArguments?.length || 0) || 'None',
    }));
    console.table(packageData);
  }

  // Add environment variables table if available
  const allEnvVars = packages.flatMap((pkg) => pkg.environmentVariables || []);
  if (allEnvVars.length > 0) {
    result += '\nEnvironment Variables:\n';
    const envVarData = allEnvVars.map((envVar, index) => ({
      Index: index + 1,
      Name: envVar.value || 'ENV_VAR',
      Required: envVar.isRequired ? 'Yes' : 'No',
      Secret: envVar.isSecret ? 'Yes' : 'No',
      Default: envVar.default || 'N/A',
      Description: envVar.description || 'N/A',
    }));
    console.table(envVarData);
  }

  // Add arguments table if available
  const allArgs = packages.flatMap((pkg) => [
    ...(pkg.packageArguments || []).map((arg) => ({ ...arg, type: 'Package' })),
    ...(pkg.runtimeArguments || []).map((arg) => ({ ...arg, type: 'Runtime' })),
  ]);
  if (allArgs.length > 0) {
    result += '\nArguments:\n';
    const argData = allArgs.map((arg, index) => ({
      Index: index + 1,
      Name: arg.name || 'arg',
      Type: arg.type || 'N/A',
      Required: arg.isRequired ? 'Yes' : 'No',
      Secret: arg.isSecret ? 'Yes' : 'No',
      Repeated: arg.isRepeated ? 'Yes' : 'No',
      Default: arg.default || 'N/A',
      Description: arg.description || 'N/A',
    }));
    console.table(argData);
  }

  // Add remotes table if available
  if (remotes.length > 0) {
    result += '\nRemote Endpoints:\n';
    const remoteData = remotes.map((remote, index) => ({
      Index: index + 1,
      Type: remote.type,
      URL: remote.url,
      Headers: (remote.headers?.length || 0) > 0 ? remote.headers?.length : 'None',
    }));
    console.table(remoteData);
  }

  return result;
}

/**
 * Format server with enhanced detailed display
 */
function formatDetailedServer(server: RegistryServer): string {
  if (!server._meta) {
    return 'Error: server._meta is undefined';
  }

  const meta = server._meta[OFFICIAL_REGISTRY_KEY];
  if (!meta) {
    return `Error: meta not found for key ${OFFICIAL_REGISTRY_KEY}`;
  }

  // Status badge with color - use status from meta if server status is not available
  const serverStatus = server.status || meta.status || 'unknown';
  const statusColor =
    serverStatus === 'active'
      ? 'green'
      : serverStatus === 'deprecated'
        ? 'yellow'
        : serverStatus === 'archived'
          ? 'red'
          : 'gray';
  const statusBadge = chalk[statusColor].bold(`● ${serverStatus.toUpperCase()}`);

  // Header with enhanced information
  const header = chalk.cyan.bold(server.name) + ' ' + chalk.gray(`(${server.version})`) + ' ' + statusBadge;

  // Description with enhanced formatting
  const description = chalk.white(server.description);

  // Enhanced basic info section
  const basicInfo = [
    `${chalk.cyan('Repository:')} ${server.repository?.url || 'N/A'}`,
    `${chalk.cyan('Source:')} ${server.repository?.source || 'N/A'}`,
    server.repository?.subfolder ? `${chalk.cyan('Subfolder:')} ${server.repository.subfolder}` : '',
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
        let packageDetails = `  ${index + 1}. ${chalk.yellow(registryType)} - ${pkg.identifier} ${chalk.gray(`(${transport})`)}
     ${chalk.gray(`Install: ${installCmd}`)}`;

        // Add runtime hint if available
        if (pkg.runtimeHint) {
          packageDetails += `\n     ${chalk.blue('Runtime:')} ${pkg.runtimeHint}`;
        }

        // Add file hash if available
        if (pkg.fileSha256) {
          packageDetails += `\n     ${chalk.magenta('SHA256:')} ${pkg.fileSha256.substring(0, 16)}...`;
        }

        return packageDetails;
      })
      .join('\n');

    content += `\n\n${chalk.cyan.bold('Packages:')} ${chalk.gray(`(${packages.length})`)}
${packagesList}`;

    // Add environment variables if any packages have them
    const allEnvVars = packages.flatMap((pkg) => pkg.environmentVariables || []);
    if (allEnvVars.length > 0) {
      const envVarsList = allEnvVars
        .map((envVar, index) => {
          const required = envVar.isRequired ? chalk.red('*') : '';
          const secret = envVar.isSecret ? chalk.yellow('🔒') : '';
          const defaultVal = envVar.default ? chalk.gray(` (default: ${envVar.default})`) : '';
          const description = envVar.description ? ` - ${envVar.description}` : '';
          return `  ${index + 1}. ${envVar.value || 'ENV_VAR'}${required}${secret}${defaultVal}${description}`;
        })
        .join('\n');

      content += `\n\n${chalk.cyan.bold('Environment Variables:')} ${chalk.gray(`(${allEnvVars.length})`)}
${envVarsList}`;
    }

    // Add package arguments if any packages have them
    const allPackageArgs = packages.flatMap((pkg) => pkg.packageArguments || []);
    const allRuntimeArgs = packages.flatMap((pkg) => pkg.runtimeArguments || []);

    if (allPackageArgs.length > 0) {
      const packageArgsList = allPackageArgs
        .map((arg, index) => {
          const required = arg.isRequired ? chalk.red('*') : '';
          const secret = arg.isSecret ? chalk.yellow('🔒') : '';
          const repeated = arg.isRepeated ? chalk.blue('[]') : '';
          const defaultVal = arg.default ? chalk.gray(` (default: ${arg.default})`) : '';
          const type = arg.type ? chalk.magenta(`<${arg.type}>`) : '';
          const description = arg.description ? ` - ${arg.description}` : '';
          return `  ${index + 1}. ${arg.name || 'arg'}${required}${secret}${repeated} ${type}${defaultVal}${description}`;
        })
        .join('\n');

      content += `\n\n${chalk.cyan.bold('Package Arguments:')} ${chalk.gray(`(${allPackageArgs.length})`)}
${packageArgsList}`;
    }

    if (allRuntimeArgs.length > 0) {
      const runtimeArgsList = allRuntimeArgs
        .map((arg, index) => {
          const required = arg.isRequired ? chalk.red('*') : '';
          const secret = arg.isSecret ? chalk.yellow('🔒') : '';
          const repeated = arg.isRepeated ? chalk.blue('[]') : '';
          const defaultVal = arg.default ? chalk.gray(` (default: ${arg.default})`) : '';
          const type = arg.type ? chalk.magenta(`<${arg.type}>`) : '';
          const hint = arg.valueHint ? chalk.cyan(` (hint: ${arg.valueHint})`) : '';
          const description = arg.description ? ` - ${arg.description}` : '';
          return `  ${index + 1}. ${arg.name || 'arg'}${required}${secret}${repeated} ${type}${defaultVal}${hint}${description}`;
        })
        .join('\n');

      content += `\n\n${chalk.cyan.bold('Runtime Arguments:')} ${chalk.gray(`(${allRuntimeArgs.length})`)}
${runtimeArgsList}`;
    }
  }

  // Enhanced remotes section
  const remotes = server.remotes || [];
  if (remotes.length > 0) {
    const remotesList = remotes
      .map((remote, index) => {
        let remoteDetails = `  ${index + 1}. ${chalk.yellow(remote.type)} - ${remote.url}`;

        // Add headers if available
        if (remote.headers && remote.headers.length > 0) {
          const headersList = remote.headers
            .map((header) => {
              const description = header.description ? ` (${header.description})` : '';
              const required = header.isRequired ? chalk.red('*') : '';
              const secret = header.isSecret ? chalk.yellow('🔒') : '';
              return `       ${header.value || 'header'}${required}${secret}${description}`;
            })
            .join('\n');
          remoteDetails += `\n     ${chalk.cyan('Headers:')}\n${headersList}`;
        }

        return remoteDetails;
      })
      .join('\n');

    content += `\n\n${chalk.cyan.bold('Remote Endpoints:')} ${chalk.gray(`(${remotes.length})`)}
${remotesList}`;
  }

  // Enhanced registry and metadata info
  const metaInfo = [
    `${chalk.cyan('Registry ID:')} ${server.name || 'N/A'}`,
    `${chalk.cyan('Version ID:')} ${server.version || 'N/A'}`,
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

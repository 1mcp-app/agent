import { createRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import { debugIf } from '@src/logger/logger.js';

import { InstallAdapterOptions } from './types.js';

export class PackageResolver {
  private registryClient;

  constructor() {
    this.registryClient = createRegistryClient();
  }

  async resolvePackageToServerName(serverName: string, options: InstallAdapterOptions): Promise<string> {
    if (!options.package) {
      return serverName;
    }

    try {
      let searchResults;
      let matchedServer = null;

      // Strategy 1: Try exact package identifier match (might work for some packages)
      searchResults = await this.registryClient.searchServers({
        query: options.package,
        limit: 20,
      });
      matchedServer = searchResults.find(
        (server) =>
          server.packages &&
          server.packages.some(
            (pkg) =>
              pkg.identifier === options.package ||
              pkg.identifier === `@${options.package}` ||
              pkg.identifier.endsWith(`/${options.package}`),
          ),
      );

      // Strategy 2: Extract organization/author from package and search for that
      if (!matchedServer && options.package.includes('/')) {
        const orgName = options.package.split('/')[0].replace('@', '');
        debugIf(() => ({
          message: 'Adapter: Trying organization search',
          meta: { packageName: options.package, orgName },
        }));

        searchResults = await this.registryClient.searchServers({
          query: orgName,
          limit: 50,
        });

        matchedServer = searchResults.find(
          (server) =>
            server.packages &&
            server.packages.some(
              (pkg) =>
                pkg.identifier === options.package ||
                pkg.identifier === `@${options.package}` ||
                pkg.identifier.endsWith(`/${options.package}`),
            ),
        );
      }

      // Strategy 3: Try searching for the server name component
      if (!matchedServer) {
        const serverComponent = options.package.split('/').pop();
        if (serverComponent) {
          debugIf(() => ({
            message: 'Adapter: Trying server component search',
            meta: { packageName: options.package, serverComponent },
          }));

          searchResults = await this.registryClient.searchServers({
            query: serverComponent,
            limit: 50,
          });

          matchedServer = searchResults.find(
            (server) =>
              server.packages &&
              server.packages.some(
                (pkg) =>
                  pkg.identifier === options.package ||
                  pkg.identifier === `@${options.package}` ||
                  pkg.identifier.endsWith(`/${options.package}`),
              ),
          );
        }
      }

      if (matchedServer) {
        const actualServerName = matchedServer.name;
        debugIf(() => ({
          message: 'Adapter: Resolved package to registry server',
          meta: { packageName: options.package, serverName: actualServerName },
        }));
        return actualServerName;
      } else {
        // If no server found for the package, try using the package name as server ID
        const actualServerName = options.package;
        debugIf(() => ({
          message: 'Adapter: Using package name as server ID',
          meta: { packageName: options.package, serverName: actualServerName },
        }));
        return actualServerName;
      }
    } catch (searchError) {
      // If search fails, fall back to using the original server name
      debugIf(() => ({
        message: 'Adapter: Package search failed, using original server name',
        meta: { packageName: options.package, serverName, error: searchError },
      }));
      return serverName;
    }
  }
}

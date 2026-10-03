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
        debugIf(() => ({ message: 'packageResolver.adapter.trying.organization.search.67ea0532' }));

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
          debugIf(() => ({ message: 'packageResolver.adapter.trying.server.component.search.09ff5656' }));

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
          message: 'packageResolver.adapter.resolved.package.to.registry.server.40d09eb5',
          meta: { serverName: actualServerName },
        }));
        return actualServerName;
      } else {
        // If no server found for the package, try using the package name as server ID
        const actualServerName = options.package;
        debugIf(() => ({
          message: 'packageResolver.adapter.using.package.name.as.server.id.881107c3',
          meta: { serverName: actualServerName },
        }));
        return actualServerName;
      }
    } catch (searchError) {
      // If search fails, fall back to using the original server name
      debugIf(() => ({
        message: 'packageResolver.adapter.package.search.failed.using.original.server.name.997cc88b',
        meta: { serverName: serverName, error: searchError },
      }));
      return serverName;
    }
  }
}

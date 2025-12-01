/**
 * Domain service adapters for internal tools
 *
 * This module exports thin adapters that bridge internal tools with existing domain services.
 * Each adapter wraps domain service calls and transforms data between internal tool format
 * and domain service format.
 */
import {
  RegistryDiscoveryAdapter as _RegistryDiscoveryAdapter,
  createDiscoveryAdapter,
  type DiscoveryAdapter,
} from './discoveryAdapter.js';
import { createInstallationAdapter, type InstallationAdapter } from './installationAdapter.js';
import { createManagementAdapter, type ManagementAdapter } from './managementAdapter.js';

// Re-export adapters for external use
export { type DiscoveryAdapter, RegistryDiscoveryAdapter, createDiscoveryAdapter } from './discoveryAdapter.js';

export {
  type InstallationAdapter,
  type InstallAdapterOptions,
  type UninstallAdapterOptions,
  type UpdateAdapterOptions,
  type ListAdapterOptions,
  ServerInstallationAdapter,
  createInstallationAdapter,
} from './installationAdapter.js';

export {
  type ManagementAdapter,
  type ServerInfo,
  type ServerStatusInfo,
  type ManagementListOptions,
  type EnableServerOptions,
  type EnableServerResult,
  type DisableServerOptions,
  type DisableServerResult,
  type ReloadOptions,
  type ReloadResult,
  type UpdateConfigResult,
  type ValidationResult,
  ConfigManagementAdapter,
  createManagementAdapter,
} from './managementAdapter.js';

/**
 * Adapter factory for creating all adapters with consistent configuration
 */
export class AdapterFactory {
  private static discoveryAdapter?: DiscoveryAdapter;
  private static installationAdapter?: InstallationAdapter;
  private static managementAdapter?: ManagementAdapter;

  /**
   * Get or create discovery adapter
   */
  static getDiscoveryAdapter(): DiscoveryAdapter {
    if (!this.discoveryAdapter) {
      this.discoveryAdapter = createDiscoveryAdapter();
    }
    return this.discoveryAdapter;
  }

  /**
   * Get or create installation adapter
   */
  static getInstallationAdapter(): InstallationAdapter {
    if (!this.installationAdapter) {
      this.installationAdapter = createInstallationAdapter();
    }
    return this.installationAdapter;
  }

  /**
   * Get or create management adapter
   */
  static getManagementAdapter(): ManagementAdapter {
    if (!this.managementAdapter) {
      this.managementAdapter = createManagementAdapter();
    }
    return this.managementAdapter;
  }

  /**
   * Get all adapters
   */
  static getAllAdapters(): {
    discovery: DiscoveryAdapter;
    installation: InstallationAdapter;
    management: ManagementAdapter;
  } {
    return {
      discovery: this.getDiscoveryAdapter(),
      installation: this.getInstallationAdapter(),
      management: this.getManagementAdapter(),
    };
  }

  /**
   * Clean up all adapters
   */
  static cleanup(): void {
    if (this.discoveryAdapter && 'destroy' in this.discoveryAdapter) {
      // Type assertion for cleanup - the discovery adapter may have a destroy method
      (this.discoveryAdapter as { destroy?: () => void }).destroy?.();
    }

    // Reset adapters
    this.discoveryAdapter = undefined;
    this.installationAdapter = undefined;
    this.managementAdapter = undefined;
  }

  /**
   * Reset adapters (useful for testing or configuration changes)
   */
  static reset(): void {
    this.cleanup();
  }
}

/**
 * Convenience function to get all adapters at once
 */
export function getAdapters(): {
  discovery: DiscoveryAdapter;
  installation: InstallationAdapter;
  management: ManagementAdapter;
} {
  return AdapterFactory.getAllAdapters();
}

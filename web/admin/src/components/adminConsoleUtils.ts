import type {
  ConfiguredServerPreviewResponse,
  ConfiguredServerReadModel,
  OAuthServiceStatus,
  RuntimeIdentity,
} from '../api/adminApi';
import type { AdminConsoleState } from '../state/adminConsoleState';

export function filterServers(servers: ConfiguredServerReadModel[], query: string, filter: ServerFilter) {
  const normalizedQuery = query.trim().toLowerCase();
  return servers.filter((server) => {
    const matchesQuery =
      !normalizedQuery ||
      server.id.toLowerCase().includes(normalizedQuery) ||
      serverTags(server).some((tag) => tag.toLowerCase().includes(normalizedQuery)) ||
      transportSummaryLabel(server).toLowerCase().includes(normalizedQuery) ||
      describeTransport(server.transport).toLowerCase().includes(normalizedQuery);
    const matchesFilter =
      filter === 'all' || (filter === 'enabled' && server.enabled) || (filter === 'disabled' && !server.enabled);
    return matchesQuery && matchesFilter;
  });
}

export function enabledServers(servers: ConfiguredServerReadModel[]): number {
  return servers.filter((server) => server.enabled).length;
}

export function disabledServers(servers: ConfiguredServerReadModel[]): number {
  return servers.filter((server) => !server.enabled).length;
}

export function isOAuthAttention(service: OAuthServiceStatus): boolean {
  return Boolean(service.requiresOAuth) || service.status !== 'ready' || Boolean(service.lastError);
}

export function describeTransport(transport: Record<string, unknown>): string {
  if (typeof transport.command === 'string') {
    return transport.command;
  }
  if (typeof transport.url === 'string') {
    return transport.url;
  }
  if (typeof transport.type === 'string') {
    return transport.type;
  }
  return 'configured';
}

export function transportSummaryLabel(server: ConfiguredServerReadModel): string {
  return server.transportSummary?.label ?? describeTransport(server.transport);
}

export function serverTags(server: ConfiguredServerReadModel): string[] {
  return Array.isArray(server.tags) ? server.tags : [];
}

export function serverMutationsAvailable(server: ConfiguredServerReadModel): boolean {
  return server.mutationAvailability?.available ?? true;
}

export function serverActionState(server: ConfiguredServerReadModel, action: 'enable' | 'disable') {
  return (
    server.actionState?.[action] ?? {
      available: true,
      label: action === 'enable' ? `Enable ${server.id}` : `Disable ${server.id}`,
    }
  );
}

export function connectivityMeta(preview: ConfiguredServerPreviewResponse['preview']): string | undefined {
  const check = preview.connectivityCheck;
  if (check.status === 'skipped') {
    return connectivitySkipReason(check.reason);
  }
  if (check.status === 'failed') {
    return check.message;
  }
  return check.checkedAt ? `Checked at ${check.checkedAt}` : undefined;
}

export function connectivitySummary(check: ConfiguredServerPreviewResponse['preview']['connectivityCheck']): string {
  if (check.status === 'passed') {
    return 'Bounded dry-run connectivity check passed.';
  }
  if (check.status === 'failed') {
    return 'Connectivity check failed. Apply remains blocked until the check passes or a later override path is available.';
  }
  return 'Connectivity check was skipped for this preview.';
}

export function connectivitySkipReason(reason: string): string {
  switch (reason) {
    case 'connection_critical_fields_unchanged':
      return 'Connection-critical fields are unchanged. Rerun connectivity if you want an explicit check.';
    case 'target_disabled':
      return 'Target is disabled, so automatic connectivity was skipped.';
    case 'validation_failed':
      return 'Validation failed before a connectivity check could run.';
    case 'local_stdio_transport':
      return 'Local stdio transport does not use remote connectivity checks.';
    case 'checker_unavailable':
      return 'Connectivity checker is unavailable on this runtime.';
    case 'endpoint_changed_with_preserved_secrets':
      return 'Endpoint changed while secrets stayed preserved. Supply replacements or rerun after updating secrets.';
    default:
      return reason;
  }
}

export function riskFlagColor(flag: string): string {
  switch (flag) {
    case 'rename':
      return 'violet';
    case 'connection_critical':
      return 'red';
    case 'secret':
      return 'grape';
    case 'template_risk':
      return 'orange';
    default:
      return 'gray';
  }
}

export function riskFlagLabel(flag: string): string {
  switch (flag) {
    case 'rename':
      return 'rename';
    case 'connection_critical':
      return 'connection critical';
    case 'secret':
      return 'secret';
    case 'template_risk':
      return 'template risk';
    default:
      return flag;
  }
}

export function secretSummary(server: ConfiguredServerReadModel): string {
  if (server.secretInputs.length === 0) {
    return 'No secret inputs';
  }
  return `${server.secretInputs.length} redacted`;
}

export function runtimeSummary(runtime?: RuntimeIdentity): string {
  return runtime?.runtimeVersion ?? 'unknown';
}

export function runtimeEndpointSummary(runtime?: RuntimeIdentity): string {
  return runtime?.externalUrl ?? 'not reported';
}

export function viewLabel(state: AdminConsoleState): string {
  return state.view === 'setupRequired' ? 'Setup required' : state.view;
}

export function viewBadgeColor(state: AdminConsoleState): string {
  if (state.view === 'setupRequired') {
    return 'yellow';
  }
  return state.view === 'console' ? 'teal' : 'gray';
}

export function humanize(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').toLowerCase();
}

export type ServerFilter = 'all' | 'enabled' | 'disabled';

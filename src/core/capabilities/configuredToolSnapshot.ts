import type { ListToolsResult, Tool } from '@src/sdk/legacy/types.js';

import { ClientStatus, type OutboundConnection, type OutboundConnections } from '@src/core/types/index.js';

const snapshots = new WeakMap<OutboundConnection, Tool[]>();
const pendingPages = new WeakMap<
  OutboundConnection,
  { nextCursor: string; tools: Tool[]; seenCursors: Set<string>; pageCount: number }
>();
const lastCompleteTargetSnapshots = new Map<string, Tool[]>();
const completeTargetSnapshots = new Map<string, ConfiguredToolTargetSnapshot>();
const MAX_TOOL_PAGES = 1_000;

export type ConfiguredToolSnapshotSource = 'mcpServers' | 'mcpTemplates';

export interface ConfiguredToolTargetSnapshot {
  source: ConfiguredToolSnapshotSource;
  targetName: string;
  instances: Array<{ instanceId: string; tools: Tool[] }>;
}

export interface ConfiguredToolInspectionPublication {
  source: ConfiguredToolSnapshotSource;
  targetName: string;
  instances: Array<{
    instanceId: string;
    connections: readonly OutboundConnection[];
    tools: readonly Tool[];
  }>;
}

export function publishConfiguredToolSnapshot(
  connection: OutboundConnection,
  tools: readonly Tool[],
  complete = true,
): void {
  if (!complete) {
    snapshots.delete(connection);
    return;
  }
  const snapshot = tools.map((tool) => ({ ...tool }));
  snapshots.set(connection, snapshot);
}

export function publishConfiguredToolPage(
  connection: OutboundConnection,
  tools: readonly Tool[],
  cursor: string | undefined,
  nextCursor: string | undefined,
): void {
  const previous = cursor === undefined ? undefined : pendingPages.get(connection);
  if (
    cursor !== undefined &&
    (previous?.nextCursor !== cursor ||
      previous.seenCursors.has(nextCursor ?? '') ||
      previous.pageCount >= MAX_TOOL_PAGES)
  ) {
    pendingPages.delete(connection);
    snapshots.delete(connection);
    return;
  }

  const accumulated = [...(previous?.tools ?? []), ...tools];
  if (nextCursor === undefined) {
    pendingPages.delete(connection);
    publishConfiguredToolSnapshot(connection, accumulated);
  } else {
    pendingPages.set(connection, {
      nextCursor,
      tools: accumulated,
      seenCursors: new Set([...(previous?.seenCursors ?? []), nextCursor]),
      pageCount: (previous?.pageCount ?? 0) + 1,
    });
    snapshots.delete(connection);
  }
}

export async function collectConfiguredToolPages(
  listPage: (cursor: string | undefined) => Promise<ListToolsResult>,
): Promise<ListToolsResult> {
  const tools: Tool[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
    const result = await listPage(cursor);
    tools.push(...(result.tools ?? []));
    if (result.nextCursor === undefined) return { ...result, tools };
    if (seenCursors.has(result.nextCursor)) throw new Error('Tool pagination returned a repeated cursor');
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }

  throw new Error(`Tool pagination exceeded ${MAX_TOOL_PAGES} pages`);
}

export function readConfiguredToolSnapshot(connection: OutboundConnection): readonly Tool[] | undefined {
  return snapshots.get(connection);
}

export function clearConfiguredToolSnapshot(connection: OutboundConnection): void {
  snapshots.delete(connection);
  pendingPages.delete(connection);
}

export function readLastConfiguredToolSnapshot(targetName: string): readonly Tool[] {
  return lastCompleteTargetSnapshots.get(targetName) ?? [];
}

export function clearLastConfiguredToolSnapshot(targetName: string): void {
  lastCompleteTargetSnapshots.delete(targetName);
}

export function clearCompleteConfiguredToolTargetSnapshot(
  source: ConfiguredToolSnapshotSource,
  targetName: string,
): void {
  completeTargetSnapshots.delete(targetSnapshotKey(source, targetName));
}

export function publishLastConfiguredToolSnapshot(targetName: string, tools: readonly Tool[]): void {
  lastCompleteTargetSnapshots.set(
    targetName,
    tools.map((tool) => ({ ...tool })),
  );
}

export function readCompleteConfiguredToolTargetSnapshot(
  source: ConfiguredToolSnapshotSource,
  targetName: string,
): ConfiguredToolTargetSnapshot | undefined {
  const snapshot = completeTargetSnapshots.get(targetSnapshotKey(source, targetName));
  return snapshot ? cloneTargetSnapshot(snapshot) : undefined;
}

/** Publish a fully collected target observation without yielding between writes. */
export function publishCompleteConfiguredToolInspection(publication: ConfiguredToolInspectionPublication): void {
  const snapshot: ConfiguredToolTargetSnapshot = {
    source: publication.source,
    targetName: publication.targetName,
    instances: publication.instances.map(({ instanceId, tools }) => ({
      instanceId,
      tools: tools.map((tool) => ({ ...tool })),
    })),
  };

  for (const instance of publication.instances) {
    for (const connection of new Set(instance.connections)) {
      publishConfiguredToolSnapshot(connection, instance.tools);
    }
  }
  completeTargetSnapshots.set(targetSnapshotKey(publication.source, publication.targetName), snapshot);
  publishLastConfiguredToolSnapshot(
    publication.targetName,
    Array.from(new Map(snapshot.instances.flatMap(({ tools }) => tools.map((tool) => [tool.name, tool]))).values()),
  );
}

function targetSnapshotKey(source: ConfiguredToolSnapshotSource, targetName: string): string {
  return `${source}\0${targetName}`;
}

function cloneTargetSnapshot(snapshot: ConfiguredToolTargetSnapshot): ConfiguredToolTargetSnapshot {
  return {
    source: snapshot.source,
    targetName: snapshot.targetName,
    instances: snapshot.instances.map(({ instanceId, tools }) => ({
      instanceId,
      tools: tools.map((tool) => ({ ...tool })),
    })),
  };
}

export function publishCompleteConfiguredToolTargetSnapshots(connections: OutboundConnections): void {
  const connectionsByTarget = new Map<string, OutboundConnection[]>();

  for (const connection of connections.values()) {
    if (connection.status !== ClientStatus.Connected) continue;
    const existing = connectionsByTarget.get(connection.name);
    if (existing) existing.push(connection);
    else connectionsByTarget.set(connection.name, [connection]);
  }

  for (const [targetName, targetConnections] of connectionsByTarget) {
    const targetTools = new Map<string, Tool>();
    let complete = true;
    for (const connection of targetConnections) {
      const connectionTools = snapshots.get(connection);
      if (!connectionTools) {
        complete = false;
        break;
      }
      for (const tool of connectionTools) targetTools.set(tool.name, tool);
    }
    if (complete) publishLastConfiguredToolSnapshot(targetName, Array.from(targetTools.values()));
  }
}

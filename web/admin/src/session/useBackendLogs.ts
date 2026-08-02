import { useCallback, useEffect, useRef, useState } from 'react';

import { AdminApiError } from '../api/adminApi';
import type {
  AdminApiClient,
  BackendLogEntry,
  BackendLogSnapshot,
  BackendLogSource,
} from '../api/adminApi';

const MAX_SELECTED_ENTRIES = 5_000;
const MAX_SELECTED_CONTENT_UNITS = 512 * 1024;

export interface BackendLogsModel {
  connection: 'idle' | 'loading' | 'active' | 'reconnecting';
  sources: BackendLogSource[];
  selectedSourceId: string | null;
  entries: BackendLogEntry[];
  unread: Readonly<Record<string, number>>;
  cursors: Readonly<Record<string, number>>;
  selectionLoading: boolean;
  selectionError: string | null;
  select(sourceId: string): void | Promise<void>;
}

type BackendLogsState = Omit<BackendLogsModel, 'select'>;

const INITIAL_STATE: BackendLogsState = {
  connection: 'idle',
  sources: [],
  selectedSourceId: null,
  entries: [],
  unread: {},
  cursors: {},
  selectionLoading: false,
  selectionError: null,
};

export function useBackendLogs(input: {
  api: AdminApiClient;
  active: boolean;
  authenticated: boolean;
  onUnauthenticated(): void;
}): BackendLogsModel {
  const [state, setState] = useState<BackendLogsState>(INITIAL_STATE);
  const stateRef = useRef(state);
  const sourcesRef = useRef<BackendLogSource[]>([]);
  const onUnauthenticatedRef = useRef(input.onUnauthenticated);
  const selectionRequest = useRef(0);
  stateRef.current = state;
  onUnauthenticatedRef.current = input.onUnauthenticated;

  const applySnapshot = useCallback((snapshot: BackendLogSnapshot) => {
    sourcesRef.current = snapshot.sources;
    setState((current) => {
      const selectedSourceId = snapshot.sources.some((source) => source.id === current.selectedSourceId)
        ? current.selectedSourceId
        : (snapshot.sources[0]?.id ?? null);
      return {
        connection: 'active',
        sources: snapshot.sources,
        selectedSourceId,
        entries: selectedSourceId
          ? boundSelectedEntries(snapshot.entries.filter((entry) => entry.sourceId === selectedSourceId))
          : [],
        unread: unreadFromSnapshot(snapshot, selectedSourceId),
        cursors: cursorsFromEntries(snapshot.entries),
        selectionLoading: false,
        selectionError: null,
      };
    });
  }, []);

  const loadSource = useCallback(
    async (sourceId: string) => {
      const requestId = ++selectionRequest.current;
      setState((current) => ({
        ...current,
        selectedSourceId: sourceId,
        entries: [],
        unread: { ...current.unread, [sourceId]: 0 },
        selectionLoading: true,
        selectionError: null,
      }));
      try {
        const snapshot = await input.api.getBackendLogSnapshot();
        if (selectionRequest.current !== requestId) return;
        setState((current) => {
          if (current.selectedSourceId !== sourceId) return current;
          const retained = snapshot.entries.filter((entry) => entry.sourceId === sourceId);
          const live = current.entries.filter((entry) => entry.sequence > snapshot.sequence);
          return {
            ...current,
            entries: boundSelectedEntries([...retained, ...live]),
            selectionLoading: false,
            selectionError: null,
          };
        });
      } catch (error) {
        if (selectionRequest.current !== requestId) return;
        if (error instanceof AdminApiError && error.failure.kind === 'unauthenticated') {
          onUnauthenticatedRef.current();
          return;
        }
        setState((current) =>
          current.selectedSourceId === sourceId
            ? {
                ...current,
                selectionLoading: false,
                selectionError: 'Failed to load retained backend logs. Live entries will continue to appear.',
              }
            : current,
        );
      }
    },
    [input.api],
  );

  useEffect(() => {
    if (!input.active || !input.authenticated) {
      selectionRequest.current += 1;
      sourcesRef.current = [];
      setState(INITIAL_STATE);
      return;
    }
    setState((current) => ({ ...current, connection: 'loading' }));
    const close = input.api.openBackendLogStream({
      onSnapshot: applySnapshot,
      onGap: applySnapshot,
      onEntry: (entry) => {
        if (!sourcesRef.current.some((source) => source.id === entry.sourceId)) {
          sourcesRef.current = [...sourcesRef.current, sourceFromEntry(entry)];
        }
        setState((current) => receiveEntry(current, entry));
      },
      onSources: (sources) => {
        sourcesRef.current = sources;
        const current = stateRef.current;
        const nextSelectedSourceId = sources.some((source) => source.id === current.selectedSourceId)
          ? current.selectedSourceId
          : (sources[0]?.id ?? null);
        setState((next) => reconcileSources(next, sources, nextSelectedSourceId));
        if (nextSelectedSourceId && nextSelectedSourceId !== current.selectedSourceId) {
          void loadSource(nextSelectedSourceId);
        }
      },
      onSourceUpdate: (update) => {
        const current = stateRef.current;
        const sources = update.removed
          ? sourcesRef.current.filter((source) => source.id !== update.sourceId)
          : [...sourcesRef.current.filter((source) => source.id !== update.sourceId), update.source!].sort((left, right) =>
              left.id.localeCompare(right.id),
            );
        sourcesRef.current = sources;
        const nextSelectedSourceId = sources.some((source) => source.id === current.selectedSourceId)
          ? current.selectedSourceId
          : (sources[0]?.id ?? null);
        setState((next) => reconcileSources(next, sources, nextSelectedSourceId));
        if (nextSelectedSourceId && nextSelectedSourceId !== current.selectedSourceId) {
          void loadSource(nextSelectedSourceId);
        }
      },
      onOpen: () => setState((current) => ({ ...current, connection: current.sources.length ? 'active' : 'loading' })),
      onError: () => setState((current) => ({ ...current, connection: 'reconnecting' })),
    });
    return close;
  }, [applySnapshot, input.active, input.api, input.authenticated, loadSource]);

  const select = useCallback(
    (sourceId: string) => loadSource(sourceId),
    [loadSource],
  );

  return { ...state, select };
}

function receiveEntry(state: BackendLogsState, entry: BackendLogEntry): BackendLogsState {
  const sources = state.sources.some((source) => source.id === entry.sourceId)
    ? state.sources
    : [...state.sources, sourceFromEntry(entry)];
  if (state.selectedSourceId === null) {
    return {
      ...state,
      connection: 'active',
      sources,
      selectedSourceId: entry.sourceId,
      entries: [entry],
      unread: { ...state.unread, [entry.sourceId]: 0 },
      cursors: { ...state.cursors, [entry.sourceId]: entry.sequence },
      selectionLoading: false,
      selectionError: null,
    };
  }
  if (entry.sourceId === state.selectedSourceId) {
    return {
      ...state,
      connection: 'active',
      sources,
      entries: boundSelectedEntries([...state.entries, entry]),
      cursors: { ...state.cursors, [entry.sourceId]: entry.sequence },
    };
  }
  return {
    ...state,
    connection: 'active',
    sources,
    unread: { ...state.unread, [entry.sourceId]: (state.unread[entry.sourceId] ?? 0) + 1 },
    cursors: { ...state.cursors, [entry.sourceId]: entry.sequence },
  };
}

function sourceFromEntry(entry: BackendLogEntry): BackendLogSource {
  return {
    id: entry.sourceId,
    canonicalName: entry.canonicalName,
    displayName: entry.displayName,
    kind: entry.sourceKind,
    capture: 'managed',
    lifecycle: 'active',
  };
}

function cursorsFromEntries(entries: BackendLogEntry[]): Record<string, number> {
  const cursors: Record<string, number> = {};
  for (const entry of entries) cursors[entry.sourceId] = entry.sequence;
  return cursors;
}

function reconcileSources(
  state: BackendLogsState,
  sources: BackendLogSource[],
  selectedSourceId: string | null,
): BackendLogsState {
  const retainedIds = new Set(sources.map((source) => source.id));
  const selectionChanged = selectedSourceId !== state.selectedSourceId;
  return {
    ...state,
    sources,
    selectedSourceId,
    entries: selectionChanged ? [] : state.entries,
    unread: retainSourceState(state.unread, retainedIds),
    cursors: retainSourceState(state.cursors, retainedIds),
    selectionLoading: selectionChanged && selectedSourceId !== null,
    selectionError: selectionChanged ? null : state.selectionError,
  };
}

function retainSourceState<T>(values: Readonly<Record<string, T>>, retainedIds: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(values).filter(([sourceId]) => retainedIds.has(sourceId))) as Record<string, T>;
}

function unreadFromSnapshot(snapshot: BackendLogSnapshot, selectedSourceId: string | null): Record<string, number> {
  const unread: Record<string, number> = {};
  for (const entry of snapshot.entries) {
    if (entry.sourceId !== selectedSourceId) unread[entry.sourceId] = (unread[entry.sourceId] ?? 0) + 1;
  }
  return unread;
}

function boundSelectedEntries(entries: BackendLogEntry[]): BackendLogEntry[] {
  let contentUnits = 0;
  const retained: BackendLogEntry[] = [];
  for (let index = entries.length - 1; index >= 0 && retained.length < MAX_SELECTED_ENTRIES; index--) {
    const entry = entries[index];
    contentUnits += entry.content.length;
    if (contentUnits > MAX_SELECTED_CONTENT_UNITS && retained.length > 0) break;
    retained.push(entry);
  }
  return retained.reverse();
}

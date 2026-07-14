import type {
  ConfiguredServerDetailResponse,
  ConfiguredServerEditDraft,
  ConfiguredServerEditField,
} from '../api/adminApi';

export type SecretDraftState = Record<
  string,
  {
    fieldPath: string[];
    action: 'preserve' | 'replace' | 'clear';
    replacementKind: 'environmentReference' | 'inlineSecret';
    replacementValue: string;
  }
>;

export type FieldDraftState = Record<string, unknown>;

export function buildPreviewEdit(
  fieldGroups: ConfiguredServerDetailResponse['editContract']['fieldGroups'],
  fieldDraft: FieldDraftState,
  initialFieldDraft: FieldDraftState,
  secretDraft: SecretDraftState,
): ConfiguredServerEditDraft {
  const edit: Record<string, unknown> = {};
  const transport: Record<string, unknown> = {};

  for (const group of fieldGroups) {
    for (const field of group.fields) {
      if (field.control === 'secret' || !field.editable || field.control === 'readonly') continue;

      const key = fieldKey(field.fieldPath);
      const value = draftValueForField(field, fieldDraft[key]);
      if (stableDisplayValue(value) === stableDisplayValue(draftValueForField(field, initialFieldDraft[key]))) continue;

      const root = field.fieldPath[0];
      if (root === 'id') edit.id = String(value ?? '');
      else if (root === 'enabled') edit.enabled = Boolean(value);
      else if (root === 'tags') edit.tags = stringArray(value);
      else if (root === 'transport' && field.fieldPath.length > 1) {
        setNestedDraftValue(transport, field.fieldPath.slice(1), value);
      } else if (root) setNestedDraftValue(edit, field.fieldPath, value);
    }
  }

  const secrets = Object.values(secretDraft)
    .filter((draft) => draft.action !== 'preserve')
    .map((draft) => ({
      fieldPath: draft.fieldPath,
      action: draft.action,
      ...(draft.action === 'replace'
        ? { replacement: { kind: draft.replacementKind, value: draft.replacementValue } }
        : {}),
    }));

  return {
    ...edit,
    ...(Object.keys(transport).length > 0 ? { transport } : {}),
    ...(secrets.length > 0 ? { secrets } : {}),
  } as ConfiguredServerEditDraft;
}

export function fieldKey(fieldPath: string[]): string {
  return fieldPath.join('\0');
}

export function initialDraftValue(field: ConfiguredServerEditField): unknown {
  return draftValueForField(field, field.value);
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function splitStringList(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

export function displayFieldValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return Object.keys(value).length > 0 ? Object.keys(value).join(', ') : '-';
  return String(value ?? '-');
}

export function formatPreviewValue(value: unknown): string {
  if (value === undefined || value === null) return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatPreviewValue).join(', ');
  if (typeof value !== 'object') return '-';

  const record = value as Record<string, unknown>;
  if (record.secret === true || record.value === '[REDACTED]') return '[REDACTED]';
  if (record.kind === 'inlineSecret') return 'inline secret: [REDACTED]';
  if (typeof record.kind === 'string' && typeof record.value === 'string') {
    return `${humanize(record.kind)}: ${record.value}`;
  }

  return Object.entries(record)
    .map(([key, nestedValue]) => `${key}: ${secretLikeKey(key) ? '[REDACTED]' : formatPreviewValue(nestedValue)}`)
    .join('; ');
}

function draftValueForField(field: ConfiguredServerEditField, value: unknown): unknown {
  if (field.control === 'switch') return Boolean(value);
  if (field.control === 'tag-list' || field.control === 'string-list') return stringArray(value);
  if (field.control === 'record') return objectRecord(value);
  if (field.control === 'text' || field.control === 'select') return String(value ?? '');
  return value;
}

function setNestedDraftValue(target: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  const leaf = path.at(-1);
  if (leaf) cursor[leaf] = value;
}

function stableDisplayValue(value: unknown): string {
  return JSON.stringify(value);
}

function secretLikeKey(key: string): boolean {
  return /authorization|password|secret|token/iu.test(key);
}

function humanize(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').toLowerCase();
}

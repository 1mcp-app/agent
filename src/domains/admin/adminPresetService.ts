import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';

import type { MCPServerParams } from '@src/core/types/index.js';
import type { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import { TagQueryEvaluator } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import type { PresetStrategy, TagQuery } from '@src/domains/preset/types/presetTypes.js';

import type { AdminOperationContext, AdminOperationResult, AdminOperationService } from './adminOperationService.js';

export interface AdminPresetDraft {
  name: string;
  description?: string;
  strategy: PresetStrategy;
  tagQuery: TagQuery;
}

export interface AdminPresetMatch {
  name: string;
  tags: string[];
  enabled: boolean;
  matched: boolean;
  reason: string;
}

export interface AdminPresetPreview {
  draft: AdminPresetDraft;
  revision: string;
  previewFingerprint: string;
  validation: {
    status: 'valid' | 'invalid';
    fieldErrors: Array<{ field: string; message: string }>;
    globalErrors: string[];
    warnings: string[];
  };
  matches: AdminPresetMatch[];
  matchCount: number;
  structuredConversion: { lossless: boolean; strategy?: 'or' | 'and'; tags?: string[]; reason?: string };
}

export interface AdminPresetOperations {
  listPresets(input: { context: AdminOperationContext }): Promise<AdminOperationResult<unknown>>;
  getPreset(input: { context: AdminOperationContext; name: string }): Promise<AdminOperationResult<unknown>>;
  previewPreset(input: {
    context: AdminOperationContext;
    draft: AdminPresetDraft;
    sourceName?: string;
  }): Promise<AdminOperationResult<AdminPresetPreview>>;
  createPreset(input: MutationInput): Promise<AdminOperationResult<unknown>>;
  updatePreset(input: MutationInput & { sourceName: string }): Promise<AdminOperationResult<unknown>>;
  duplicatePreset(input: MutationInput & { sourceName: string }): Promise<AdminOperationResult<unknown>>;
  deletePreset(input: DeleteInput): Promise<AdminOperationResult<unknown>>;
  previewDeletePreset(input: {
    context: AdminOperationContext;
    name: string;
    revision: string;
  }): Promise<AdminOperationResult<unknown>>;
  getRecentAuditFacts(options?: { limit?: number }): ReturnType<AdminOperationService['getRecentAuditFacts']>;
}

interface MutationInput {
  context: AdminOperationContext;
  draft: AdminPresetDraft;
  revision: string;
  previewFingerprint: string;
}

interface DeleteInput {
  context: AdminOperationContext;
  name: string;
  revision: string;
  previewFingerprint: string;
}

interface AdminPresetServiceOptions {
  operationService: AdminOperationService;
  presetManager: PresetManager;
  readServerTargets: () => Record<string, MCPServerParams>;
  createBackupId?: () => string;
}

export class AdminPresetConflictError extends Error {
  readonly code = 'preset_revision_conflict';

  constructor() {
    super('preset_revision_conflict');
  }
}

export class AdminPresetNotFoundError extends Error {
  readonly code = 'preset_not_found';

  constructor() {
    super('preset_not_found');
  }
}

export class AdminPresetService implements AdminPresetOperations {
  private readonly operationService: AdminOperationService;
  private readonly presetManager: PresetManager;
  private readonly readServerTargets: () => Record<string, MCPServerParams>;
  private readonly createBackupId: () => string;

  constructor(options: AdminPresetServiceOptions) {
    this.operationService = options.operationService;
    this.presetManager = options.presetManager;
    this.readServerTargets = options.readServerTargets;
    this.createBackupId = options.createBackupId ?? randomUUID;
  }

  async listPresets(input: { context: AdminOperationContext }): Promise<AdminOperationResult<unknown>> {
    return this.operationService.executeReadOnly({
      context: input.context,
      operationName: 'listPresets',
      run: async () => {
        await this.presetManager.reloadFromStorage();
        const revision = this.revision();
        const targets = this.readServerTargets();
        return {
          revision,
          targets: Object.entries(targets).map(([name, target]) => ({
            name,
            tags: target.tags ?? [],
            enabled: target.disabled !== true && target.disabled !== 'true',
          })),
          presets: this.presetManager.getPresetList().map((preset) => ({
            ...preset,
            querySummary: TagQueryEvaluator.queryToString(preset.tagQuery),
            matchCount: this.matches(preset, targets).filter((match) => match.matched).length,
          })),
        };
      },
    });
  }

  async getPreset(input: { context: AdminOperationContext; name: string }): Promise<AdminOperationResult<unknown>> {
    return this.operationService.executeReadOnly({
      context: input.context,
      operationName: 'getPreset',
      run: async () => {
        await this.presetManager.reloadFromStorage();
        const preset = this.presetManager.getPreset(input.name);
        if (!preset) throw new AdminPresetNotFoundError();
        return { revision: this.revision(), preset, structuredConversion: structuredConversion(preset) };
      },
    });
  }

  async previewPreset(input: {
    context: AdminOperationContext;
    draft: AdminPresetDraft;
    sourceName?: string;
  }): Promise<AdminOperationResult<AdminPresetPreview>> {
    return this.operationService.executeDryRun({
      context: input.context,
      operationName: input.sourceName ? 'previewPresetUpdate' : 'previewPresetCreate',
      run: async () => {
        await this.presetManager.reloadFromStorage();
        if (input.sourceName && !this.presetManager.hasPreset(input.sourceName)) throw new AdminPresetNotFoundError();
        return this.buildPreview(input.draft);
      },
    });
  }

  createPreset(input: MutationInput): Promise<AdminOperationResult<unknown>> {
    return this.mutate('createPreset', input, undefined);
  }

  updatePreset(input: MutationInput & { sourceName: string }): Promise<AdminOperationResult<unknown>> {
    return this.mutate('updatePreset', input, input.sourceName);
  }

  duplicatePreset(input: MutationInput & { sourceName: string }): Promise<AdminOperationResult<unknown>> {
    return this.mutate('duplicatePreset', input, input.sourceName, true);
  }

  deletePreset(input: DeleteInput): Promise<AdminOperationResult<unknown>> {
    return this.operationService.executeMutation({
      context: input.context,
      operationName: 'deletePreset',
      confirmationRequirements: [
        { code: 'previewConfirmed', expected: input.previewFingerprint },
        { code: 'presetNameConfirmed', expected: input.name },
      ],
      run: async () => {
        await this.presetManager.reloadFromStorage();
        this.assertRevision(input.revision);
        const preset = this.presetManager.getPreset(input.name);
        if (!preset) throw new AdminPresetNotFoundError();
        const expected = this.deleteFingerprint(input.name, input.revision);
        if (expected !== input.previewFingerprint) throw new AdminPresetConflictError();
        const backupPath = this.backup();
        await this.presetManager.deletePreset(input.name);
        return { deleted: input.name, backupPath, revision: this.revision() };
      },
    });
  }

  previewDeletePreset(input: {
    context: AdminOperationContext;
    name: string;
    revision: string;
  }): Promise<AdminOperationResult<unknown>> {
    return this.operationService.executeDryRun({
      context: input.context,
      operationName: 'previewPresetDelete',
      run: async () => {
        await this.presetManager.reloadFromStorage();
        this.assertRevision(input.revision);
        const preset = this.presetManager.getPreset(input.name);
        if (!preset) throw new AdminPresetNotFoundError();
        const matches = this.matches(preset, this.readServerTargets());
        return {
          name: input.name,
          revision: input.revision,
          previewFingerprint: this.deleteFingerprint(input.name, input.revision),
          matches,
          matchCount: matches.filter((match) => match.matched).length,
          consequence: `New requests using preset '${input.name}' will fail with the existing preset-not-found behavior.`,
        };
      },
    });
  }

  getRecentAuditFacts(options?: { limit?: number }) {
    return this.operationService.getRecentAuditFacts(options);
  }

  private mutate(
    operationName: string,
    input: MutationInput,
    sourceName?: string,
    duplicate = false,
  ): Promise<AdminOperationResult<unknown>> {
    return this.operationService.executeMutation({
      context: input.context,
      operationName,
      confirmationRequirements: [
        { code: 'previewConfirmed', expected: input.previewFingerprint },
        ...(this.matchCount(input.draft) === 0 ? [{ code: 'zeroMatchConfirmed', expected: true }] : []),
      ],
      run: async () => {
        await this.presetManager.reloadFromStorage();
        this.assertRevision(input.revision);
        if (sourceName && !this.presetManager.hasPreset(sourceName)) throw new AdminPresetNotFoundError();
        if (sourceName && !duplicate && input.draft.name !== sourceName) throw new Error('Preset names are immutable');
        if ((duplicate || !sourceName) && this.presetManager.hasPreset(input.draft.name))
          throw new Error('Preset already exists');
        const preview = await this.buildPreview(input.draft);
        if (preview.validation.status === 'invalid' || preview.previewFingerprint !== input.previewFingerprint) {
          throw new AdminPresetConflictError();
        }
        const backupPath = this.backup();
        await this.presetManager.savePreset(input.draft.name, {
          description: input.draft.description,
          strategy: input.draft.strategy,
          tagQuery: input.draft.tagQuery,
        });
        return { preset: this.presetManager.getPreset(input.draft.name), backupPath, revision: this.revision() };
      },
    });
  }

  private async buildPreview(draft: AdminPresetDraft): Promise<AdminPresetPreview> {
    const validation = await this.presetManager.validatePreset(draft.name, {
      description: draft.description,
      strategy: draft.strategy,
      tagQuery: draft.tagQuery,
    });
    const revision = this.revision();
    const matches = this.matches(draft, this.readServerTargets());
    return {
      draft,
      revision,
      previewFingerprint: fingerprint({ draft, revision, matches }),
      validation: {
        status: validation.isValid ? 'valid' : 'invalid',
        fieldErrors: validation.errors
          .filter((error) => /name/i.test(error))
          .map((message) => ({ field: 'name', message })),
        globalErrors: validation.errors.filter((error) => !/name/i.test(error)),
        warnings: validation.warnings,
      },
      matches,
      matchCount: matches.filter((match) => match.matched).length,
      structuredConversion: structuredConversion(draft),
    };
  }

  private matches(
    draft: Pick<AdminPresetDraft, 'strategy' | 'tagQuery'>,
    targets: Record<string, MCPServerParams>,
  ): AdminPresetMatch[] {
    return Object.entries(targets).map(([name, target]) => {
      const tags = target.tags ?? [];
      const query =
        draft.strategy === 'advanced' && draft.tagQuery.$advanced
          ? TagQueryParser.advancedQueryToJSON(String(draft.tagQuery.$advanced))
          : draft.tagQuery;
      const matched = TagQueryEvaluator.evaluate(query, tags);
      return {
        name,
        tags,
        enabled: target.disabled !== true && target.disabled !== 'true',
        matched,
        reason: matched ? `Matched ${TagQueryEvaluator.queryToString(draft.tagQuery)}` : 'Tag query did not match',
      };
    });
  }

  private matchCount(draft: AdminPresetDraft): number {
    return this.matches(draft, this.readServerTargets()).filter((match) => match.matched).length;
  }

  private revision(): string {
    const filePath = this.presetManager.getConfigPath();
    return fingerprint(fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.from(''));
  }

  private assertRevision(revision: string): void {
    if (revision !== this.revision()) throw new AdminPresetConflictError();
  }

  private deleteFingerprint(name: string, revision: string): string {
    return fingerprint({ delete: name, revision });
  }

  private backup(): string | null {
    const filePath = this.presetManager.getConfigPath();
    if (!fs.existsSync(filePath)) return null;
    const backupPath = `${filePath}.admin-backup-${this.createBackupId()}`;
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  }
}

function structuredConversion(preset: Pick<AdminPresetDraft, 'strategy' | 'tagQuery'>) {
  if (preset.strategy !== 'or' && preset.strategy !== 'and') {
    return {
      lossless: false,
      reason: 'Advanced queries can switch to structured mode only when they are a flat tag OR/AND query.',
    };
  }
  const operator = preset.strategy === 'or' ? '$or' : '$and';
  const clauses = preset.tagQuery[operator];
  if (
    !Array.isArray(clauses) ||
    !clauses.every((clause) => typeof clause.tag === 'string' && Object.keys(clause).length === 1)
  ) {
    return { lossless: false, reason: 'This query contains operators that structured mode cannot preserve.' };
  }
  return { lossless: true, strategy: preset.strategy, tags: clauses.map((clause) => clause.tag as string) };
}

function fingerprint(value: unknown): string {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  return createHash('sha256').update(input).digest('hex');
}

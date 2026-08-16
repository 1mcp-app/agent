import { createHash } from 'node:crypto';

import type { InstructionSurface } from '@src/core/instructions/instructionAggregator.js';
import type { InstructionTemplateConfig } from '@src/core/types/transport.js';
import type { ConfiguredServerTargetSource } from '@src/domains/config-change/configChange.js';
import type {
  InstructionTemplateCollectionReadModel,
  InstructionTemplateManager,
  InstructionTemplateMutationResult,
  InstructionTemplateReadModel,
  InstructionTemplateValidation,
} from '@src/domains/instruction-template/instructionTemplateManager.js';
import type { ContextData } from '@src/types/context.js';

import type { AdminOperationContext, AdminOperationResult, AdminOperationService } from './adminOperationService.js';

export type InstructionPreviewSelection =
  | { mode: 'all' }
  | { mode: 'preset'; preset: string }
  | { mode: 'tags'; tags: string[] }
  | { mode: 'tag-filter'; expression: string };
export type InstructionPreviewSurface = 'initialize' | 'cli';

export interface AdminInstructionPreviewInput {
  identity: string;
  surface: InstructionSurface;
  template: string;
  selection: InstructionPreviewSelection;
  requestContext?: ContextData;
}

export interface AdminInstructionPreviewServerFact {
  target: { source: ConfiguredServerTargetSource; name: string };
  hasInstructions: boolean;
}

export interface AdminInstructionPreviewResult {
  surface: InstructionPreviewSurface;
  rendered?: string;
  validation?: { valid: false; code: string; message: string };
  effectiveServers: AdminInstructionPreviewServerFact[];
  unresolvedTemplates: string[];
}

export interface SanitizedInstructionRenderFailure {
  code: 'managed_template_render_failed';
  surface: InstructionPreviewSurface;
  templateIdentity: string;
  occurredAt: string;
}

export interface RuntimeInstructionRenderFailure {
  surface: InstructionSurface;
  templateIdentity: string;
  error: string;
  occurredAt: Date;
}

export interface AdminInstructionTemplateOperations {
  listTemplates(input: {
    context: AdminOperationContext;
  }): Promise<AdminOperationResult<InstructionTemplateAdminState>>;
  getTemplate(input: {
    context: AdminOperationContext;
    identity: string;
  }): Promise<AdminOperationResult<InstructionTemplateDetail>>;
  createTemplate(input: TemplateSaveOperationInput): Promise<AdminOperationResult<InstructionTemplateMutationResult>>;
  updateTemplate(input: TemplateSaveOperationInput): Promise<AdminOperationResult<InstructionTemplateMutationResult>>;
  cloneTemplate(input: TemplateCloneOperationInput): Promise<AdminOperationResult<InstructionTemplateMutationResult>>;
  validateTemplate(input: TemplateIdentityOperationInput): Promise<AdminOperationResult<TemplateValidationPreview>>;
  previewTemplate(input: TemplatePreviewOperationInput): Promise<AdminOperationResult<AdminInstructionPreviewResult>>;
  activateTemplate(
    input: TemplateIdentityOperationInput,
  ): Promise<AdminOperationResult<InstructionTemplateMutationResult>>;
  importLegacyTemplate(
    input: TemplateIdentityOperationInput,
  ): Promise<AdminOperationResult<InstructionTemplateMutationResult | { status: 'legacy_unavailable' }>>;
  previewDeleteTemplate(input: TemplateIdentityOperationInput): Promise<AdminOperationResult<TemplateDeletePreview>>;
  deleteTemplate(
    input: TemplateIdentityOperationInput,
  ): Promise<AdminOperationResult<InstructionTemplateMutationResult>>;
}

export interface InstructionTemplateAdminState extends InstructionTemplateCollectionReadModel {
  renderFailures: Partial<Record<InstructionPreviewSurface, SanitizedInstructionRenderFailure>>;
  legacyImportAvailable: boolean;
}

export interface InstructionTemplateDetail {
  template: InstructionTemplateReadModel;
  configFingerprint: string;
  renderFailures: Partial<Record<InstructionPreviewSurface, SanitizedInstructionRenderFailure>>;
}

export interface TemplateDeletePreview {
  identity: string;
  allowed: boolean;
  reason?: 'protected' | 'active_conflict' | 'not_found';
  expectedConfigFingerprint: string;
  previewFingerprint: string;
}

export interface TemplateValidationPreview {
  identity: string;
  validation?: InstructionTemplateValidation;
  expectedConfigFingerprint: string;
  previewFingerprint: string;
}

interface TemplateIdentityOperationInput {
  context: AdminOperationContext;
  identity: string;
  expectedConfigFingerprint: string;
  previewFingerprint?: string;
}

interface TemplateSaveOperationInput extends TemplateIdentityOperationInput {
  variants: InstructionTemplateConfig;
}

interface TemplateCloneOperationInput extends TemplateIdentityOperationInput {
  sourceIdentity: string;
}

interface TemplatePreviewOperationInput {
  context: AdminOperationContext;
  identity: string;
  surface: InstructionPreviewSurface;
  selection: InstructionPreviewSelection;
  requestContext?: ContextData;
}

interface AdminInstructionTemplateServiceOptions {
  operationService: AdminOperationService;
  manager: InstructionTemplateManager;
  preview: (input: AdminInstructionPreviewInput) => Promise<AdminInstructionPreviewResult>;
  getLegacyInitialization: () => string | undefined;
  getRenderFailures: () => Partial<Record<InstructionSurface, RuntimeInstructionRenderFailure>>;
}

export class AdminInstructionTemplateNotFoundError extends Error {
  readonly code = 'instruction_template_not_found';

  constructor(readonly identity: string) {
    super(`Instruction template '${identity}' was not found`);
    this.name = 'AdminInstructionTemplateNotFoundError';
  }
}

export class AdminInstructionTemplateService implements AdminInstructionTemplateOperations {
  constructor(private readonly options: AdminInstructionTemplateServiceOptions) {}

  listTemplates(input: { context: AdminOperationContext }) {
    return this.options.operationService.executeReadOnly({
      context: input.context,
      operationName: 'listInstructionTemplates',
      run: async () => this.readAdminState(),
    });
  }

  getTemplate(input: { context: AdminOperationContext; identity: string }) {
    return this.options.operationService.executeReadOnly({
      context: withTemplateTarget(input.context, input.identity),
      operationName: 'getInstructionTemplate',
      run: async () => {
        const state = await this.readAdminState();
        const template = state.templates.find((candidate) => candidate.identity === input.identity);
        if (!template) throw new AdminInstructionTemplateNotFoundError(input.identity);
        return { template, configFingerprint: state.configFingerprint, renderFailures: state.renderFailures };
      },
    });
  }

  createTemplate(input: TemplateSaveOperationInput) {
    return this.mutate('createInstructionTemplate', input, () =>
      this.options.manager.create({
        identity: input.identity,
        template: input.variants,
        expectedConfigFingerprint: input.expectedConfigFingerprint,
      }),
    );
  }

  updateTemplate(input: TemplateSaveOperationInput) {
    return this.mutate('updateInstructionTemplate', input, () =>
      this.options.manager.update({
        identity: input.identity,
        template: input.variants,
        expectedConfigFingerprint: input.expectedConfigFingerprint,
      }),
    );
  }

  cloneTemplate(input: TemplateCloneOperationInput) {
    return this.mutate('cloneInstructionTemplate', input, () =>
      this.options.manager.clone({
        sourceIdentity: input.sourceIdentity,
        identity: input.identity,
        expectedConfigFingerprint: input.expectedConfigFingerprint,
      }),
    );
  }

  validateTemplate(input: TemplateIdentityOperationInput) {
    return this.options.operationService.executeReadOnly({
      context: withTemplateTarget(input.context, input.identity),
      operationName: 'validateInstructionTemplate',
      run: async () => {
        const state = await this.options.manager.list();
        return {
          identity: input.identity,
          validation: await this.options.manager.validate(input.identity),
          expectedConfigFingerprint: state.configFingerprint,
          previewFingerprint: previewFingerprint('activate', input.identity, state.configFingerprint),
        };
      },
    });
  }

  previewTemplate(input: TemplatePreviewOperationInput) {
    return this.options.operationService.executeDryRun({
      context: withTemplateTarget(input.context, input.identity),
      operationName: 'previewInstructionTemplate',
      run: async () => {
        const state = await this.options.manager.list();
        const template = state.templates.find((candidate) => candidate.identity === input.identity);
        if (!template) throw new AdminInstructionTemplateNotFoundError(input.identity);
        return this.options.preview({
          identity: input.identity,
          surface: input.surface === 'initialize' ? 'initialization' : 'cli',
          template: template.variants[input.surface === 'initialize' ? 'initialization' : 'cli'],
          selection: input.selection,
          requestContext: input.requestContext,
        });
      },
    });
  }

  activateTemplate(input: TemplateIdentityOperationInput) {
    return this.mutate('activateInstructionTemplate', input, () =>
      input.previewFingerprint !== previewFingerprint('activate', input.identity, input.expectedConfigFingerprint)
        ? Promise.resolve({ status: 'conflict' as const })
        : this.options.manager.activate({
            identity: input.identity,
            expectedConfigFingerprint: input.expectedConfigFingerprint,
          }),
    );
  }

  importLegacyTemplate(input: TemplateIdentityOperationInput) {
    return this.mutate('importLegacyInstructionTemplate', input, async () => {
      const initialization = this.options.getLegacyInitialization();
      return initialization === undefined
        ? { status: 'legacy_unavailable' as const }
        : this.options.manager.importLegacy({
            identity: input.identity,
            initialization,
            expectedConfigFingerprint: input.expectedConfigFingerprint,
          });
    });
  }

  previewDeleteTemplate(input: TemplateIdentityOperationInput) {
    return this.options.operationService.executeDryRun({
      context: withTemplateTarget(input.context, input.identity),
      operationName: 'previewDeleteInstructionTemplate',
      run: async (): Promise<TemplateDeletePreview> => {
        const state = await this.options.manager.list();
        const template = state.templates.find((candidate) => candidate.identity === input.identity);
        return {
          identity: input.identity,
          allowed: Boolean(template && !template.protected && !template.active),
          reason: !template
            ? 'not_found'
            : template.protected
              ? 'protected'
              : template.active
                ? 'active_conflict'
                : undefined,
          expectedConfigFingerprint: state.configFingerprint,
          previewFingerprint: previewFingerprint('delete', input.identity, state.configFingerprint),
        };
      },
    });
  }

  deleteTemplate(input: TemplateIdentityOperationInput) {
    return this.mutate('deleteInstructionTemplate', input, () =>
      input.previewFingerprint !== previewFingerprint('delete', input.identity, input.expectedConfigFingerprint)
        ? Promise.resolve({ status: 'conflict' as const })
        : this.options.manager.delete({
            identity: input.identity,
            expectedConfigFingerprint: input.expectedConfigFingerprint,
          }),
    );
  }

  private mutate<T>(operationName: string, input: TemplateIdentityOperationInput, run: () => Promise<T>) {
    return this.options.operationService.executeMutation({
      context: withTemplateTarget(input.context, input.identity),
      operationName,
      run,
    });
  }

  private async readAdminState(): Promise<InstructionTemplateAdminState> {
    const state = await this.options.manager.list();
    return {
      ...state,
      legacyImportAvailable: this.options.getLegacyInitialization() !== undefined,
      renderFailures: sanitizeRenderFailures(this.options.getRenderFailures()),
    };
  }
}

function previewFingerprint(action: 'activate' | 'delete', identity: string, configFingerprint: string): string {
  return `instruction_template_preview_${createHash('sha256')
    .update(action)
    .update('\0')
    .update(identity)
    .update('\0')
    .update(configFingerprint)
    .digest('hex')}`;
}

function withTemplateTarget(context: AdminOperationContext, identity: string): AdminOperationContext {
  return { ...context, target: { type: 'instruction_template', id: identity } };
}

function sanitizeRenderFailures(
  failures: Partial<Record<InstructionSurface, RuntimeInstructionRenderFailure>>,
): Partial<Record<InstructionPreviewSurface, SanitizedInstructionRenderFailure>> {
  return Object.fromEntries(
    Object.entries(failures).map(([surface, failure]) => [
      surface === 'initialization' ? 'initialize' : 'cli',
      {
        code: 'managed_template_render_failed',
        surface: failure.surface === 'initialization' ? 'initialize' : 'cli',
        templateIdentity: failure.templateIdentity,
        occurredAt: failure.occurredAt.toISOString(),
      },
    ]),
  );
}

import { promises as fs } from 'node:fs';

import {
  DEFAULT_CLI_INSTRUCTION_TEMPLATE,
  DEFAULT_INSTRUCTION_TEMPLATE,
} from '@src/core/instructions/templateTypes.js';
import { type TemplateValidationResult, validateTemplateContent } from '@src/core/instructions/templateValidator.js';
import type { InstructionTemplateConfig } from '@src/core/types/transport.js';
import {
  type ConfigChangeResult,
  type ConfigChangeService,
  fingerprintConfiguredServerConfigDocument,
} from '@src/domains/config-change/configChange.js';

export { DEFAULT_CLI_INSTRUCTION_TEMPLATE } from '@src/core/instructions/templateTypes.js';

const DEFAULT_IDENTITY = 'default';
const DEFAULT_VARIANTS: InstructionTemplateConfig = {
  initialization: DEFAULT_INSTRUCTION_TEMPLATE,
  cli: DEFAULT_CLI_INSTRUCTION_TEMPLATE,
};

export interface InstructionTemplateValidation {
  valid: boolean;
  initialization: TemplateValidationResult;
  cli: TemplateValidationResult;
}

export interface InstructionTemplateReadModel {
  identity: string;
  variants: InstructionTemplateConfig;
  protected: boolean;
  active: boolean;
  draft: boolean;
  validation: InstructionTemplateValidation;
}

export interface InstructionTemplateCollectionReadModel {
  activeIdentity: string;
  selectionExplicit: boolean;
  configFingerprint: string;
  templates: InstructionTemplateReadModel[];
}

export type InstructionTemplateMutationResult =
  | ConfigChangeResult
  | { status: 'protected' | 'active_conflict' | 'identity_conflict' | 'not_found' | 'conflict' }
  | { status: 'invalid'; validation: InstructionTemplateValidation };

interface InstructionTemplateManagerPorts {
  getConfigPath: () => string;
  configChangeService: ConfigChangeService;
}

interface ConfigDocument extends Record<string, unknown> {
  instructionTemplates?: Record<string, InstructionTemplateConfig>;
  publishedInstructionTemplates?: Record<string, InstructionTemplateConfig>;
  activeInstructionTemplate?: string;
}

export interface InstructionTemplateIdentityMutationInput {
  identity: string;
  expectedConfigFingerprint: string;
}

export interface SaveInstructionTemplateInput extends InstructionTemplateIdentityMutationInput {
  template: InstructionTemplateConfig;
}

export interface CloneInstructionTemplateInput extends InstructionTemplateIdentityMutationInput {
  sourceIdentity: string;
}

export interface ImportLegacyInstructionTemplateInput extends InstructionTemplateIdentityMutationInput {
  initialization: string;
}

export interface InstructionTemplateManager {
  list(): Promise<InstructionTemplateCollectionReadModel>;
  create(input: SaveInstructionTemplateInput): Promise<InstructionTemplateMutationResult>;
  update(input: SaveInstructionTemplateInput): Promise<InstructionTemplateMutationResult>;
  clone(input: CloneInstructionTemplateInput): Promise<InstructionTemplateMutationResult>;
  delete(input: InstructionTemplateIdentityMutationInput): Promise<InstructionTemplateMutationResult>;
  activate(input: InstructionTemplateIdentityMutationInput): Promise<InstructionTemplateMutationResult>;
  importLegacy(input: ImportLegacyInstructionTemplateInput): Promise<InstructionTemplateMutationResult>;
  validate(identity: string): Promise<InstructionTemplateValidation | undefined>;
}

export function createInstructionTemplateManager(ports: InstructionTemplateManagerPorts): InstructionTemplateManager {
  async function readConfig(): Promise<ConfigDocument> {
    return JSON.parse(await fs.readFile(ports.getConfigPath(), 'utf8')) as ConfigDocument;
  }

  function variantsFor(config: ConfigDocument, identity: string): InstructionTemplateConfig | undefined {
    return identity === DEFAULT_IDENTITY ? DEFAULT_VARIANTS : config.instructionTemplates?.[identity];
  }

  function hasStaleFingerprint(config: ConfigDocument, expectedConfigFingerprint: string): boolean {
    return fingerprintConfiguredServerConfigDocument(config) !== expectedConfigFingerprint;
  }

  async function writeCollection(
    operation: Parameters<ConfigChangeService['setInstructionTemplateConfiguration']>[0]['operation'],
    identity: string,
    instructionTemplates: Record<string, InstructionTemplateConfig> | undefined,
    publishedInstructionTemplates: Record<string, InstructionTemplateConfig> | undefined,
    activeInstructionTemplate: string | undefined,
    expectedConfigFingerprint: string,
  ): Promise<InstructionTemplateMutationResult> {
    const result = await ports.configChangeService.setInstructionTemplateConfiguration({
      operation,
      identity,
      instructionTemplates:
        instructionTemplates && Object.keys(instructionTemplates).length > 0 ? instructionTemplates : undefined,
      publishedInstructionTemplates:
        publishedInstructionTemplates && Object.keys(publishedInstructionTemplates).length > 0
          ? publishedInstructionTemplates
          : undefined,
      activeInstructionTemplate,
      expectedConfigFingerprint,
    });
    return result.status === 'source_conflict' ? { status: 'conflict' } : result;
  }

  return {
    async list() {
      const config = await readConfig();
      const selectionExplicit = Object.hasOwn(config, 'activeInstructionTemplate');
      const configuredActive = config.activeInstructionTemplate;
      const activeIdentity =
        configuredActive === DEFAULT_IDENTITY || (configuredActive && config.instructionTemplates?.[configuredActive])
          ? configuredActive
          : DEFAULT_IDENTITY;
      const managed = Object.entries(config.instructionTemplates ?? {})
        .filter(([identity]) => identity !== DEFAULT_IDENTITY)
        .map(([identity, variants]) => ({
          identity,
          variants,
          protected: false,
          active: identity === activeIdentity,
          draft: isDirtyDraft(config, identity, variants, activeIdentity),
          validation: validateVariants(variants),
        }));

      return {
        activeIdentity,
        selectionExplicit,
        configFingerprint: fingerprintConfiguredServerConfigDocument(config),
        templates: [
          {
            identity: DEFAULT_IDENTITY,
            variants: DEFAULT_VARIANTS,
            protected: true,
            active: activeIdentity === DEFAULT_IDENTITY,
            draft: false,
            validation: validateVariants(DEFAULT_VARIANTS),
          },
          ...managed,
        ],
      };
    },

    async create(input) {
      const config = await readConfig();
      if (hasStaleFingerprint(config, input.expectedConfigFingerprint)) return { status: 'conflict' };
      if (input.identity === DEFAULT_IDENTITY || config.instructionTemplates?.[input.identity]) {
        return { status: 'identity_conflict' };
      }
      return writeCollection(
        'template_create',
        input.identity,
        { ...config.instructionTemplates, [input.identity]: input.template },
        config.publishedInstructionTemplates,
        config.activeInstructionTemplate,
        input.expectedConfigFingerprint,
      );
    },

    async update(input) {
      const config = await readConfig();
      if (hasStaleFingerprint(config, input.expectedConfigFingerprint)) return { status: 'conflict' };
      if (input.identity === DEFAULT_IDENTITY) return { status: 'protected' };
      if (!config.instructionTemplates?.[input.identity]) return { status: 'not_found' };
      const publishedInstructionTemplates = { ...config.publishedInstructionTemplates };
      if (
        config.activeInstructionTemplate === input.identity &&
        !Object.hasOwn(publishedInstructionTemplates, input.identity)
      ) {
        publishedInstructionTemplates[input.identity] = config.instructionTemplates[input.identity];
      }
      return writeCollection(
        'template_update',
        input.identity,
        { ...config.instructionTemplates, [input.identity]: input.template },
        publishedInstructionTemplates,
        config.activeInstructionTemplate,
        input.expectedConfigFingerprint,
      );
    },

    async clone(input) {
      const config = await readConfig();
      if (hasStaleFingerprint(config, input.expectedConfigFingerprint)) return { status: 'conflict' };
      if (input.identity === DEFAULT_IDENTITY || config.instructionTemplates?.[input.identity]) {
        return { status: 'identity_conflict' };
      }
      const source = variantsFor(config, input.sourceIdentity);
      if (!source) return { status: 'not_found' };
      return writeCollection(
        'template_clone',
        input.identity,
        { ...config.instructionTemplates, [input.identity]: { ...source } },
        config.publishedInstructionTemplates,
        config.activeInstructionTemplate,
        input.expectedConfigFingerprint,
      );
    },

    async delete(input) {
      const config = await readConfig();
      if (hasStaleFingerprint(config, input.expectedConfigFingerprint)) return { status: 'conflict' };
      if (input.identity === DEFAULT_IDENTITY) return { status: 'protected' };
      if (!config.instructionTemplates?.[input.identity]) return { status: 'not_found' };
      if (config.activeInstructionTemplate === input.identity) return { status: 'active_conflict' };
      const instructionTemplates = { ...config.instructionTemplates };
      delete instructionTemplates[input.identity];
      const publishedInstructionTemplates = { ...config.publishedInstructionTemplates };
      delete publishedInstructionTemplates[input.identity];
      return writeCollection(
        'template_delete',
        input.identity,
        instructionTemplates,
        publishedInstructionTemplates,
        config.activeInstructionTemplate,
        input.expectedConfigFingerprint,
      );
    },

    async activate(input) {
      const config = await readConfig();
      if (hasStaleFingerprint(config, input.expectedConfigFingerprint)) return { status: 'conflict' };
      const variants = variantsFor(config, input.identity);
      if (!variants) return { status: 'not_found' };
      const validation = validateVariants(variants);
      if (!validation.valid) return { status: 'invalid', validation };
      return writeCollection(
        'template_activate',
        input.identity,
        config.instructionTemplates,
        input.identity === DEFAULT_IDENTITY
          ? config.publishedInstructionTemplates
          : { ...config.publishedInstructionTemplates, [input.identity]: variants },
        input.identity,
        input.expectedConfigFingerprint,
      );
    },

    async importLegacy(input) {
      const config = await readConfig();
      if (hasStaleFingerprint(config, input.expectedConfigFingerprint)) return { status: 'conflict' };
      if (input.identity === DEFAULT_IDENTITY || config.instructionTemplates?.[input.identity]) {
        return { status: 'identity_conflict' };
      }
      return writeCollection(
        'template_import',
        input.identity,
        {
          ...config.instructionTemplates,
          [input.identity]: { initialization: input.initialization, cli: DEFAULT_CLI_INSTRUCTION_TEMPLATE },
        },
        config.publishedInstructionTemplates,
        config.activeInstructionTemplate,
        input.expectedConfigFingerprint,
      );
    },

    async validate(identity) {
      const config = await readConfig();
      const variants = variantsFor(config, identity);
      return variants ? validateVariants(variants) : undefined;
    },
  };
}

function isDirtyDraft(
  config: ConfigDocument,
  identity: string,
  variants: InstructionTemplateConfig,
  activeIdentity: string,
): boolean {
  const published = config.publishedInstructionTemplates?.[identity];
  if (!published) return identity !== activeIdentity;
  return published.initialization !== variants.initialization || published.cli !== variants.cli;
}

function validateVariants(variants: InstructionTemplateConfig): InstructionTemplateValidation {
  const initialization = validateTemplateContent(variants.initialization, 'initialization', {
    allowUnsafeContent: true,
  });
  const cli = validateTemplateContent(variants.cli, 'cli', { allowUnsafeContent: true });
  return { valid: initialization.valid && cli.valid, initialization, cli };
}

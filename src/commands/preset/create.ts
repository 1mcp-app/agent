import type { Argv } from 'yargs';
import { PresetManager } from '@src/utils/config/presetManager.js';
import { UrlGenerator } from '@src/utils/ui/urlGenerator.js';
import { TagQueryParser } from '@src/utils/parsing/tagQueryParser.js';
import { PresetErrorHandler } from '@src/utils/config/presetErrorHandler.js';
import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';

/**
 * Command arguments for preset create command
 */
export interface CreateArguments extends GlobalOptions {
  _: string[];
  name: string;
  filter: string;
  description?: string;
}

/**
 * Build the create command configuration
 */
export function buildCreateCommand(yargs: Argv) {
  return yargs
    .positional('name', {
      describe: 'Name for the new preset',
      type: 'string',
      demandOption: true,
    })
    .option('filter', {
      describe: 'Filter expression for server selection',
      type: 'string',
      alias: 'f',
      demandOption: true,
    })
    .option('description', {
      describe: 'Description for the preset',
      type: 'string',
    });
}

/**
 * Preset create command (command-line)
 */
export async function createCommand(argv: CreateArguments): Promise<void> {
  try {
    if (!argv.name) {
      PresetErrorHandler.validationError('Preset name is required', 'name');
    }

    if (!argv.filter) {
      PresetErrorHandler.validationError(
        'Filter expression is required. Use --filter "web,api" or --filter "web AND api"',
        'filter',
      );
    }

    // Initialize preset manager
    const presetManager = PresetManager.getInstance(argv['config-dir']);
    await presetManager.initialize();

    // Parse filter expression
    let tagQuery;
    let strategy: 'or' | 'and' | 'advanced' = 'or';

    // Determine if this is a complex expression or simple tags
    const filterUpper = argv.filter.toUpperCase();
    const hasAdvancedSyntax =
      argv.filter.includes('(') ||
      argv.filter.includes(')') ||
      filterUpper.includes(' AND ') ||
      filterUpper.includes(' OR ') ||
      filterUpper.includes(' NOT ') ||
      argv.filter.includes('&&') ||
      argv.filter.includes('||') ||
      argv.filter.includes('!');

    if (hasAdvancedSyntax) {
      // Use advanced parsing for complex expressions
      try {
        // Use unified conversion to JSON format
        tagQuery = TagQueryParser.advancedQueryToJSON(argv.filter);
        strategy = 'advanced';
      } catch (_error) {
        PresetErrorHandler.createFilterError(argv.filter);
      }
    } else {
      // Use simple parsing for basic comma-separated or single tags
      try {
        const tags = TagQueryParser.parseSimple(argv.filter);
        if (tags.length === 0) {
          throw new Error('No valid tags found in filter expression');
        }

        // Validate that tags don't contain suspicious patterns
        for (const tag of tags) {
          // Check for spaces in tag names (likely indicates missing quotes or improper syntax)
          if (tag.includes(' ')) {
            throw new Error(
              `Invalid tag "${tag}": tag names cannot contain spaces. Use quotes for multi-word tags or AND/OR operators for logic.`,
            );
          }
          // Check for invalid characters
          if (!/^[a-zA-Z0-9_.-]+$/.test(tag)) {
            throw new Error(
              `Invalid tag "${tag}": tags can only contain letters, numbers, hyphens, underscores, and dots.`,
            );
          }
        }

        if (tags.length === 1) {
          strategy = 'or';
          tagQuery = { tag: tags[0] };
        } else {
          strategy = 'or';
          tagQuery = { $or: tags.map((tag) => ({ tag })) };
        }
      } catch (_error) {
        PresetErrorHandler.createFilterError(argv.filter);
      }
    }

    // Save preset
    await presetManager.savePreset(argv.name, {
      description: argv.description,
      strategy,
      tagQuery,
    });

    // Generate URL
    const urlGenerator = new UrlGenerator();
    const url = urlGenerator.generatePresetUrl(argv.name);

    console.log(`✅ Preset '${argv.name}' created successfully!`);
    console.log(`📋 Strategy: ${strategy}`);
    console.log(`🔗 URL: ${url}`);

    if (argv.description) {
      console.log(`📝 Description: ${argv.description}`);
    }
  } catch (error) {
    logger.error('Preset create command failed', { error });
    PresetErrorHandler.handleCliError(error, 'preset create');
  }
}

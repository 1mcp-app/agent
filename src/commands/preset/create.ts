import { PresetManager } from '../../utils/presetManager.js';
import { UrlGenerator } from '../../utils/urlGenerator.js';
import { TagQueryParser } from '../../utils/tagQueryParser.js';
import logger from '../../logger/logger.js';

/**
 * Command arguments for preset create command
 */
interface CreateArguments {
  _: string[];
  name: string;
  filter: string;
  description?: string;
}

/**
 * Preset create command (command-line)
 */
export async function createCommand(argv: CreateArguments): Promise<void> {
  try {
    if (!argv.name) {
      console.error('❌ Preset name is required');
      process.exit(1);
    }

    if (!argv.filter) {
      console.error('❌ Filter expression is required. Use --filter "web,api" or --filter "web AND api"');
      process.exit(1);
    }

    // Initialize preset manager
    const presetManager = PresetManager.getInstance();
    await presetManager.initialize();

    // Parse filter expression
    let tagQuery;
    let strategy: 'or' | 'and' | 'advanced' = 'or';

    try {
      // First try to parse as advanced expression
      const expression = TagQueryParser.parseAdvanced(argv.filter);
      // For advanced expressions, we need to convert to our TagQuery format
      // This is a simplified conversion - in production you might want more sophisticated logic
      if (expression.type === 'tag') {
        tagQuery = { tag: expression.value };
      } else if (expression.type === 'or') {
        tagQuery = { $or: expression.children?.map((child) => ({ tag: child.value })) || [] };
      } else if (expression.type === 'and') {
        tagQuery = { $and: expression.children?.map((child) => ({ tag: child.value })) || [] };
      } else {
        // For complex expressions, store the original filter string in a special field
        tagQuery = { $advanced: argv.filter };
      }
      strategy = 'advanced';
    } catch (_advancedError) {
      // Fall back to simple parsing
      try {
        const tags = TagQueryParser.parseSimple(argv.filter);
        if (tags.length === 0) {
          throw new Error('No valid tags found in filter expression');
        }

        // Determine strategy based on presence of AND/OR keywords
        const filterUpper = argv.filter.toUpperCase();
        if (filterUpper.includes(' AND ')) {
          strategy = 'and';
          tagQuery = { $and: tags.map((tag) => ({ tag })) };
        } else {
          strategy = 'or';
          tagQuery = tags.length === 1 ? { tag: tags[0] } : { $or: tags.map((tag) => ({ tag })) };
        }
      } catch (_simpleError) {
        console.error(`❌ Invalid filter expression: ${argv.filter}`);
        console.error('Examples:');
        console.error('  --filter "web,api,database"           # OR logic (comma-separated)');
        console.error('  --filter "web AND database"           # AND logic');
        console.error('  --filter "(web OR api) AND database"  # Complex expressions');
        process.exit(1);
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
    console.error(`❌ Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

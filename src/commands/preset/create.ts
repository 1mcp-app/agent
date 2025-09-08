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
  'config-dir'?: string;
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
        const expression = TagQueryParser.parseAdvanced(argv.filter);
        strategy = 'advanced';

        // Convert expression to TagQuery format
        if (expression.type === 'tag') {
          tagQuery = { tag: expression.value };
        } else if (expression.type === 'or') {
          tagQuery = { $or: expression.children?.map((child) => ({ tag: child.value })) || [] };
        } else if (expression.type === 'and') {
          tagQuery = { $and: expression.children?.map((child) => ({ tag: child.value })) || [] };
        } else {
          // For complex expressions, store as advanced query
          tagQuery = { $advanced: argv.filter };
        }
      } catch (_error) {
        console.error(`❌ Invalid filter expression: ${argv.filter}`);
        console.error('Examples:');
        console.error('  --filter "web,api,database"           # OR logic (comma-separated)');
        console.error('  --filter "web AND database"           # AND logic');
        console.error('  --filter "(web OR api) AND database"  # Complex expressions');
        process.exit(1);
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

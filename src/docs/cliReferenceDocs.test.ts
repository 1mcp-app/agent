import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

const root = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function readMarkdownFiles(path: string): string[] {
  return readdirSync(join(root, path), { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    return entry.isDirectory()
      ? readMarkdownFiles(entryPath)
      : entry.name.endsWith('.md')
        ? [readRepoFile(entryPath)]
        : [];
  });
}

describe('CLI reference documentation', () => {
  it('documents only the registry subcommands and options implemented by yargs', () => {
    const registryBuilder = readRepoFile('src/commands/registry/index.ts');
    const searchBuilder = readRepoFile('src/commands/registry/search.ts');
    const statusBuilder = readRepoFile('src/commands/registry/status.ts');
    const showBuilder = readRepoFile('src/commands/registry/show.ts');
    const versionsBuilder = readRepoFile('src/commands/registry/versions.ts');
    const pages = ['en', 'zh'].map((locale) => readRepoFile(`docs/${locale}/commands/registry/index.md`));

    for (const command of ['search', 'status', 'show', 'versions']) {
      expect(registryBuilder).toContain(`'${command}`);
      expect(pages.join('\n')).toContain(command);
    }

    for (const option of ['--status', '--type', '--transport', '--limit', '--cursor', '--format']) {
      expect(readRepoFile('docs/en/commands/registry/search.md')).toContain(option);
      expect(readRepoFile('docs/zh/commands/registry/search.md')).toContain(option);
    }

    expect(searchBuilder).toContain("choices: ['active', 'archived', 'deprecated', 'all']");
    expect(statusBuilder).toContain('stats: {');
    expect(showBuilder).toContain("option('ver'");
    expect(versionsBuilder).toContain("option('format'");
    expect(pages.join('\n')).not.toMatch(/registry (updates|cache|config|login)/);
  });

  it('keeps target, admin, proxy, and CLI workflow context selectors discoverable', () => {
    const targetBuilder = readRepoFile('src/commands/target/index.ts');
    const adminBuilder = readRepoFile('src/commands/admin/index.ts');
    const adminCommands = readRepoFile('src/commands/admin/admin.ts');
    const config = [readRepoFile('docs/.vitepress/config/en.ts'), readRepoFile('docs/.vitepress/config/zh.ts')].join(
      '\n',
    );

    for (const command of [
      'add',
      'use',
      'export',
      'import',
      'doctor',
      'current',
      'list',
      'inspect',
      'delete',
      'rename',
      'verify',
    ]) {
      expect(targetBuilder).toContain(`'${command}`);
    }
    for (const command of ['bootstrap', 'login', 'status', 'logout']) {
      expect(adminBuilder).toContain(`'${command}`);
    }
    expect(adminCommands).toContain("requireOption(options.username, 'admin username')");
    expect(adminCommands).toContain("requireOption(options.password, 'admin password')");
    expect(adminCommands).toContain('options.json || (!dependencies.promptForCredentials && !process.stdin.isTTY)');

    for (const locale of ['en', 'zh']) {
      const target = readRepoFile(`docs/${locale}/commands/target.md`);
      const admin = readRepoFile(`docs/${locale}/commands/admin.md`);
      for (const command of [
        'add',
        'use',
        'export',
        'import',
        'doctor',
        'current',
        'list',
        'inspect',
        'delete',
        'rename',
        'verify',
      ]) {
        expect(target).toContain(`target ${command}`);
      }
      for (const command of ['bootstrap', 'login', 'status', 'logout']) {
        expect(admin).toContain(`admin ${command}`);
      }
      expect(admin).toContain('admin logout --context local --all-local');
      expect(admin).toContain('admin bootstrap --username <name> --password <password>');
      expect(admin).toContain(
        locale === 'en'
          ? 'Both `--username` and `--password` are required.'
          : '`--username` 和 `--password` 均为必填项。',
      );
      expect(admin).toContain(
        locale === 'en' ? 'With `--json` or a non-interactive stdin' : '使用 `--json` 或 stdin 为非交互式时',
      );
      for (const command of ['instructions', 'inspect', 'run', 'proxy']) {
        expect(readRepoFile(`docs/${locale}/commands/${command}.md`)).toContain('--context <name>');
      }
    }

    expect(config).toContain("'/commands/target'");
    expect(config).toContain("'/zh/commands/target'");
    expect(config).toContain("'/commands/admin'");
    expect(config).toContain("'/zh/commands/admin'");
  });

  it('keeps preset URLs, mcp add arrays, and internal-tool examples aligned with the current contracts', () => {
    const docs = readMarkdownFiles('docs/en').concat(readMarkdownFiles('docs/zh')).join('\n');

    expect(docs).not.toContain('/?preset=');
    expect(docs).toContain('/mcp?preset=');
    for (const locale of ['en', 'zh']) {
      const presetIndex = readRepoFile(`docs/${locale}/commands/preset/index.md`);
      expect(presetIndex).toContain('`http://localhost:3050/mcp`');
      expect(presetIndex).not.toContain('`http://localhost:3050/`');
    }
    expect(readRepoFile('docs/en/commands/preset/url.md')).toContain('HTTP `400`');
    expect(readRepoFile('docs/zh/commands/preset/url.md')).toContain('HTTP `400`');

    for (const locale of ['en', 'zh']) {
      const add = readRepoFile(`docs/${locale}/commands/mcp/add.md`);
      const list = readRepoFile(`docs/${locale}/commands/mcp/list.md`);
      expect(add).toContain('--args=--root --args=./');
      expect(add).toContain('[options] -- <command> [args...]');
      expect(add).toContain(locale === 'en' ? '`http` or `sse`' : '`http` 或 `sse`');
      expect(add).toContain('--headers <key=value>');
      expect(list).toContain('--outdated');
    }

    const supervisor = readRepoFile('src/core/server/backendStdioSupervisor.ts');
    expect(supervisor).toContain('const DEFAULT_MAX_RESTARTS = 5');
    expect(supervisor).toContain('options.policy.maxRestarts === 0 ? null');
    expect(supervisor).toContain('2 ** Math.min(nextAttempt - 1, 4)');
    expect(readRepoFile('docs/en/commands/mcp/add.md')).toContain(
      'The default is `5`; only `0` enables unlimited attempts.',
    );
    expect(readRepoFile('docs/zh/commands/mcp/add.md')).toContain('默认值为 `5`；只有设置为 `0` 才会无限次重试。');
    expect(readRepoFile('docs/en/commands/mcp/add.md')).toContain(
      'Each later delay doubles, capped at 16 times this value.',
    );
    expect(readRepoFile('docs/zh/commands/mcp/add.md')).toContain('后续延迟每次翻倍，最大为该值的 16 倍。');

    for (const locale of ['en', 'zh']) {
      const overview = `docs/${locale}/reference/internal-tools/index.md`;
      expect(existsSync(join(root, overview))).toBe(true);
      expect(readRepoFile(`docs/${locale}/reference/internal-tools.md`)).toContain(
        locale === 'en' ? '/reference/internal-tools/' : '/zh/reference/internal-tools/',
      );
      expect(readRepoFile(overview)).toContain('notifications/initialized');
      expect(readRepoFile(overview)).toContain('"name":"project-dependencies"');
      expect(readRepoFile(overview)).toContain(`"protocolVersion":"${LATEST_PROTOCOL_VERSION}"`);
      expect(readRepoFile(overview)).toContain('"name":"1mcp_1mcp_mcp_install"');
      const example = readRepoFile(overview).match(/```json\n([\s\S]*?)\n```/)?.[1];
      expect(example).toBeDefined();
      const [initialize, initialized, call] = example!.split('\n').map((message) => JSON.parse(message));
      expect(initialize).toMatchObject({ method: 'initialize', params: { protocolVersion: LATEST_PROTOCOL_VERSION } });
      expect(initialized).toMatchObject({ method: 'notifications/initialized' });
      expect(call).toMatchObject({
        method: 'tools/call',
        params: { name: '1mcp_1mcp_mcp_install', arguments: { name: 'project-dependencies' } },
      });
      expect(readRepoFile(`docs/${locale}/reference/internal-tools/installation.md`)).toContain('`name`');
    }
  });
});

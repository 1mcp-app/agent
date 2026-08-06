import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const llmArtifacts = ['llms.txt', 'llms-en.txt', 'llms-zh.txt', 'llms-full.txt'] as const;

const artifactRoutePolicies = {
  'llms.txt': { allowRoot: false, allowZh: false, allowStatic: true },
  'llms-en.txt': { allowRoot: true, allowZh: false, allowStatic: false },
  'llms-zh.txt': { allowRoot: false, allowZh: true, allowStatic: false },
  'llms-full.txt': { allowRoot: true, allowZh: true, allowStatic: false },
} as const;

const llmCommandContracts = [
  {
    form: '1mcp cli-setup --codex',
    builder: 'src/commands/cliSetup/index.ts',
    fragments: ["'cli-setup'", "option('codex'"],
  },
  {
    form: '1mcp cli-setup --claude',
    builder: 'src/commands/cliSetup/index.ts',
    fragments: ["'cli-setup'", "option('claude'"],
  },
  {
    form: '1mcp instructions',
    builder: 'src/commands/instructions/index.ts',
    fragments: ["'instructions'"],
  },
  {
    form: '1mcp inspect <server>',
    builder: 'src/commands/inspect/index.ts',
    fragments: ["'inspect [target]'", 'Inspect target: <server>, <server>/<tool>'],
  },
  {
    form: '1mcp inspect <server>/<tool>',
    builder: 'src/commands/inspect/index.ts',
    fragments: ["'inspect [target]'", 'Inspect target: <server>, <server>/<tool>'],
  },
  {
    form: "1mcp run <server>/<tool> --args '<json>'",
    builder: 'src/commands/run/index.ts',
    fragments: ["'run <tool>'", 'Tool reference in the format <server>/<tool>', "option('args'"],
  },
  {
    form: '1mcp app backups [app-name]',
    builder: 'src/commands/app/index.ts',
    fragments: ["command: 'backups [app-name]'"],
  },
  {
    form: '1mcp preset url <name>',
    builder: 'src/commands/preset/index.ts',
    fragments: ["command: 'url <name>'"],
  },
  {
    form: '1mcp registry search [query]',
    builder: 'src/commands/registry/index.ts',
    fragments: ["'search [query]'"],
  },
  {
    form: '1mcp registry status',
    builder: 'src/commands/registry/index.ts',
    fragments: ["'status'", 'Show registry availability status'],
  },
  {
    form: '1mcp registry show <server-id>',
    builder: 'src/commands/registry/index.ts',
    fragments: ["command: 'show <server-id>'"],
  },
  {
    form: '1mcp registry versions <server-id>',
    builder: 'src/commands/registry/index.ts',
    fragments: ["command: 'versions <server-id>'"],
  },
] as const;

function readRepoFile(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function markdownFiles(path: string): string[] {
  return readdirSync(join(root, path), { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    return entry.isDirectory() ? markdownFiles(entryPath) : entry.name.endsWith('.md') ? [entryPath] : [];
  });
}

function routeExists(route: string): boolean {
  const pathname = new URL(route, 'https://docs.1mcp.app').pathname;
  if (pathname === '/en' || pathname.startsWith('/en/')) {
    return false;
  }

  if (pathname.endsWith('.txt')) {
    return (
      llmArtifacts.includes(pathname.slice(1) as (typeof llmArtifacts)[number]) &&
      existsSync(join(root, 'docs/public', pathname.slice(1)))
    );
  }

  const segments = pathname.split('/').filter(Boolean);
  const isChinese = segments[0] === 'zh';
  const page = join('docs', isChinese ? 'zh' : 'en', ...(isChinese ? segments.slice(1) : segments));

  return [join(root, `${page}.md`), join(root, page, 'index.md')].some(existsSync);
}

function internalRoutes(artifact: string): string[] {
  return [...artifact.matchAll(/\[[^\]]+\]\((\/[^)\s#?]+)(?:[?#][^)]*)?\)/g)].map((match) => match[1]);
}

function validateArtifactRoutes(artifactName: keyof typeof artifactRoutePolicies, routes: string[]): void {
  const policy = artifactRoutePolicies[artifactName];

  for (const route of routes) {
    const pathname = new URL(route, 'https://docs.1mcp.app').pathname;
    const isStatic = pathname.endsWith('.txt');
    const isChinese = pathname === '/zh' || pathname.startsWith('/zh/');

    if (pathname === '/en' || pathname.startsWith('/en/')) {
      throw new Error(`${artifactName} must not use /en routes: ${route}`);
    }
    if (isStatic && !policy.allowStatic) {
      throw new Error(`${artifactName} must not link to static LLM artifacts: ${route}`);
    }
    if (isChinese && !policy.allowZh) {
      throw new Error(`${artifactName} must not link to Chinese routes: ${route}`);
    }
    if (!isStatic && !isChinese && !policy.allowRoot) {
      throw new Error(`${artifactName} must not link to English root routes: ${route}`);
    }
    if (!routeExists(route)) {
      throw new Error(`${artifactName} links to a missing canonical route: ${route}`);
    }
  }
}

function commandInvocations(artifacts: string[]): Set<string> {
  return new Set(artifacts.flatMap((artifact) => [...artifact.matchAll(/`(1mcp [^`]+)`/g)].map((match) => match[1])));
}

function validateLlmCommandForms(artifacts: string[]): void {
  const documented = commandInvocations(artifacts);
  const expected = new Set(llmCommandContracts.map(({ form }) => form));

  for (const form of documented) {
    if (!expected.has(form as (typeof llmCommandContracts)[number]['form'])) {
      throw new Error(`LLM artifacts contain an undocumented command form: ${form}`);
    }
  }
  for (const form of expected) {
    if (!documented.has(form)) {
      throw new Error(`LLM artifacts are missing the documented command form: ${form}`);
    }
  }
  for (const { builder, fragments } of llmCommandContracts) {
    const source = readRepoFile(builder);
    for (const fragment of fragments) {
      if (!source.includes(fragment)) {
        throw new Error(`${builder} no longer supports the documented command form: ${fragment}`);
      }
    }
  }
}

describe('publishing documentation', () => {
  it('keeps static LLM artifact routes canonical for their intended locales', () => {
    const artifacts = llmArtifacts.map((name) => ({
      name,
      content: readRepoFile(`docs/public/${name}`),
    }));

    for (const { name, content } of artifacts) {
      for (const route of internalRoutes(content)) {
        expect(route).not.toMatch(/\.md$/);
      }
      expect(() => validateArtifactRoutes(name, internalRoutes(content))).not.toThrow();
    }

    expect(() => validateArtifactRoutes('llms-en.txt', ['/en/guide/quick-start'])).toThrow('/en routes');
    expect(() => validateArtifactRoutes('llms-en.txt', ['/zh/guide/quick-start'])).toThrow('Chinese routes');
    expect(() => validateArtifactRoutes('llms.txt', ['/guide/quick-start'])).toThrow('English root routes');
  });

  it('keeps every LLM command invocation tied to current yargs builders', () => {
    const artifacts = llmArtifacts.map((name) => readRepoFile(`docs/public/${name}`));

    expect(() => validateLlmCommandForms(artifacts)).not.toThrow();
    expect(() => validateLlmCommandForms([...artifacts, '`1mcp registry info`'])).toThrow('undocumented command form');
    expect(() => validateLlmCommandForms([...artifacts, '`1mcp inspect <server> --made-up`'])).toThrow(
      'undocumented command form',
    );
  });

  it('keeps non-public research, ADR history, and Chinese metadata governed', () => {
    const vitepressConfig = readRepoFile('docs/.vitepress/config/index.ts');
    const roadmap = readRepoFile('docs/ROADMAP.md');
    const readme = readRepoFile('docs/README.md');
    const issueTracker = readRepoFile('docs/agents/issue-tracker.md');
    const architecture = readRepoFile('docs/agents/architecture-opportunities.md');

    expect(vitepressConfig).toContain("'research/**'");
    expect(roadmap).toContain('status: archived');
    expect(roadmap).toContain('not current product guidance');
    expect(readme).toContain('publishingDocs.test.ts');
    expect(issueTracker).toContain('rtk proxy gh issue create');
    expect(issueTracker).not.toMatch(/`gh issue/);
    expect(architecture).toContain('Milestones 1-6 are complete for their planned scopes.');
    expect(architecture).not.toContain('known follow-ups after the Milestone 1-6 roadmap');

    for (const path of markdownFiles('docs/zh')) {
      const content = readRepoFile(path);
      const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/);
      expect(frontmatter, `${path} needs frontmatter`).not.toBeNull();
      expect(frontmatter?.[1]).toMatch(/^title:\s*\S/m);
      expect(frontmatter?.[1]).toMatch(/^description:\s*\S/m);
    }

    const adrs = readdirSync(join(root, 'docs/adr')).filter((name) => name.endsWith('.md'));
    const identifiers = adrs.map((name) => name.match(/^(\d{4})-/)?.[1]);
    expect(identifiers).not.toContain(undefined);
    expect(new Set(identifiers).size).toBe(identifiers.length);

    const canonicalOauth = readRepoFile('docs/adr/0013-oauth-refresh-tokens-use-rotating-families.md');
    const duplicateRecord = readRepoFile('docs/adr/0014-oauth-refresh-token-duplicate-record.md');
    expect(canonicalOauth).toContain('status: accepted');
    expect(duplicateRecord).toContain('status: superseded');
    expect(duplicateRecord).toContain('superseded_by: 0013-oauth-refresh-tokens-use-rotating-families');
  });
});

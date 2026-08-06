import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

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
  if (pathname.endsWith('.txt')) {
    return existsSync(join(root, 'docs/public', pathname.slice(1)));
  }

  const segments = pathname.split('/').filter(Boolean);
  const locale = segments[0] === 'zh' ? 'zh' : 'en';
  const routeSegments = locale === 'zh' ? segments.slice(1) : segments;
  const page = join('docs', locale, ...routeSegments);

  return [join(root, `${page}.md`), join(root, page, 'index.md')].some(existsSync);
}

function internalRoutes(artifact: string): string[] {
  return [...artifact.matchAll(/\[[^\]]+\]\((\/[^)\s#?]+)(?:[?#][^)]*)?\)/g)].map((match) => match[1]);
}

describe('publishing documentation', () => {
  it('keeps static LLM artifacts canonical and free of retired command forms', () => {
    const artifacts = ['llms.txt', 'llms-en.txt', 'llms-zh.txt', 'llms-full.txt'].map((name) => ({
      name,
      content: readRepoFile(`docs/public/${name}`),
    }));

    for (const { content } of artifacts) {
      for (const route of internalRoutes(content)) {
        expect(route).not.toMatch(/\.md$/);
        expect(routeExists(route)).toBe(true);
      }
      expect(content).not.toContain('1mcp app backup');
      expect(content).not.toContain('1mcp preset select');
      expect(content).not.toContain('1mcp registry info');
    }

    const english = artifacts.find(({ name }) => name === 'llms-en.txt')?.content ?? '';
    const chinese = artifacts.find(({ name }) => name === 'llms-zh.txt')?.content ?? '';
    expect(english).not.toMatch(/\]\(\/en(?:\/|\))/);
    for (const route of internalRoutes(chinese)) {
      expect(route).toMatch(/^\/zh\//);
    }
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

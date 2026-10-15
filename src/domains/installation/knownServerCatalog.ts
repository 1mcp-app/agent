import type { MCPServerParams } from '@src/core/types/index.js';

export interface KnownServerExample {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly config?: Partial<MCPServerParams>;
  readonly prerequisites: readonly string[];
  readonly nativeNextSteps: readonly string[];
}

export const knownServerExamples: readonly KnownServerExample[] = [
  {
    id: 'codegraph',
    label: 'CodeGraph',
    description: 'Code intelligence over a checkout knowledge graph.',
    executable: 'codegraph',
    args: ['serve', '--mcp', '--path', '{{{project.path}}}', '--no-watch'],
    env: { CODEGRAPH_NO_DOWNLOAD: '1', CODEGRAPH_NO_DAEMON: '1' },
    config: { template: { shareable: true, perClient: false } },
    prerequisites: ['Install CodeGraph using its public installation instructions; make codegraph available on PATH.'],
    nativeNextSteps: ['Run codegraph init /selected/checkout --yes, substituting the authorized checkout path.'],
  },
  {
    id: 'code-review-graph',
    label: 'Code Review Graph',
    description: 'Persistent knowledge graph for checkout code reviews.',
    executable: 'code-review-graph',
    args: ['serve', '--repo', '{{{project.path}}}'],
    prerequisites: [
      'Install Code Review Graph using its public installation instructions; expose code-review-graph on PATH.',
    ],
    nativeNextSteps: [
      'Run code-review-graph build --repo /selected/checkout, substituting the authorized checkout path.',
    ],
  },
  {
    id: 'serena',
    label: 'Serena',
    description: 'Semantic code tools with native project activation and onboarding.',
    executable: 'serena',
    args: [
      'start-mcp-server',
      '--transport',
      'stdio',
      '--project',
      '{{{project.path}}}',
      '--context',
      'ide',
      '--enable-web-dashboard',
      'false',
      '--open-web-dashboard',
      'false',
      '--agent-interface',
      'tools',
    ],
    prerequisites: [
      'Install Serena 2.0.0 using its public installation instructions; make serena available on PATH. Other versions are unverified.',
      'Install the language server required by the project language; TypeScript projects require TypeScript and typescript-language-server.',
    ],
    nativeNextSteps: [
      'For TypeScript, run serena project create /selected/checkout --language typescript; select the actual project language for other projects. Complete Serena native onboarding when prompted.',
      'Verify language-server dependencies before startup. Native dependency acquisition is backend-controlled, not gated by 1MCP preparation permissions.',
    ],
  },
];

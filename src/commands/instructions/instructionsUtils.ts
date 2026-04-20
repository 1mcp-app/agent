import chalk from 'chalk';

export interface InstructionsServerSummary {
  server: string;
  type?: string;
  status?: string;
  available?: boolean;
  toolCount: number;
  hasInstructions: boolean;
}

export interface InstructionsServerDetail {
  server: string;
  type?: string;
  status?: string;
  available?: boolean;
  toolCount: number;
  hasInstructions: boolean;
  instructions?: string | null;
  note?: string;
}

export interface InstructionsOutput {
  servers: InstructionsServerSummary[];
  details: InstructionsServerDetail[];
}

function formatStatus(status?: string): string | undefined {
  if (!status) return undefined;
  return status === 'connected'
    ? chalk.green(status)
    : status === 'disconnected'
      ? chalk.red(status)
      : chalk.yellow(status);
}

function formatMetadataLines(item: InstructionsServerSummary | InstructionsServerDetail): string[] {
  const lines = [`server: ${chalk.bold(item.server)}`];

  if (item.type) {
    lines.push(`type: ${chalk.dim(item.type)}`);
  }

  const status = formatStatus(item.status);
  if (status) {
    lines.push(`status: ${status}`);
  }

  if (item.available !== undefined) {
    lines.push(`available: ${item.available ? 'yes' : 'no'}`);
  }

  lines.push(`tools: ${item.toolCount}`);
  lines.push(`instructions: ${item.hasInstructions ? 'yes' : 'no'}`);

  return lines;
}

export function formatInstructionsOutput(output: InstructionsOutput): string {
  const sections: string[] = [
    chalk.bold.cyan('1MCP CLI Instructions'),
    chalk.bold('=== PLAYBOOK ==='),
    [
      '1. Start here before selecting tools.',
      '2. Review the available servers below and choose the server that matches the task.',
      "3. Run `1mcp inspect <server>` to list that server's tools.",
      '4. Run `1mcp inspect <server>/<tool>` to inspect the tool schema and arguments.',
      "5. Run `1mcp run <server>/<tool> --args '<json>'` only after inspecting the tool.",
      '6. Use `--preset`, `--tags`, or `--tag-filter` to narrow the server set when needed.',
      '7. If authentication is required, run `1mcp auth login --url <server-url> --token <token>` and retry.',
    ].join('\n'),
  ];

  const serverLines = [chalk.bold('=== SERVER SUMMARY ===')];
  for (const server of output.servers) {
    serverLines.push('');
    serverLines.push(`<server_summary name="${server.server}">`);
    for (const line of formatMetadataLines(server)) {
      serverLines.push(`\t${line}`);
    }
    serverLines.push(`</server_summary>`);
  }
  sections.push(serverLines.join('\n'));

  const detailSections = [chalk.bold('=== SERVER DETAILS ===')];
  for (const detail of output.details) {
    const lines = [`<server_detail name="${detail.server}">`];
    for (const line of formatMetadataLines(detail)) {
      lines.push(`\t${line}`);
    }

    if (detail.instructions?.trim()) {
      lines.push(`\t<server_instructions name="${detail.server}">`);
      lines.push(detail.instructions);
      lines.push('\t</server_instructions>');
    } else if (detail.note) {
      lines.push(`\t<note>${chalk.dim(detail.note)}</note>`);
    } else {
      lines.push(`\t<note>${chalk.dim('(none provided)')}</note>`);
    }

    lines.push(`</server_detail>`);

    detailSections.push(lines.join('\n'));
  }
  sections.push(detailSections.join('\n\n'));

  return sections.join('\n\n');
}

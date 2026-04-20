import path from 'node:path';

import type { ProjectConfig } from '@src/config/projectConfigTypes.js';
import { AUTH_CONFIG } from '@src/constants/auth.js';
import type { ContextData } from '@src/types/context.js';

export interface BuildCliContextOptions {
  projectConfig?: ProjectConfig | null;
  cwd?: string;
  projectRoot?: string;
  transportType?: string;
  version?: string;
  sessionId?: string;
}

function getPrefixedEnvironmentVariables(prefixes?: string[]): Record<string, string> {
  const variables: Record<string, string> = {};

  if (!prefixes?.length) {
    return variables;
  }

  for (const prefix of prefixes) {
    if (!prefix) {
      continue;
    }

    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(prefix) && value) {
        variables[key] = value;
      }
    }
  }

  return variables;
}

export function buildCliContext(options: BuildCliContextOptions = {}): ContextData {
  const { projectConfig, projectRoot, transportType, version, sessionId } = options;
  const cwd = options.cwd ?? process.cwd();
  const canonicalProjectRoot = projectRoot ?? cwd;
  const projectName = path.basename(canonicalProjectRoot) || 'unknown';
  const prefixedEnvironmentVariables = getPrefixedEnvironmentVariables(projectConfig?.context?.envPrefixes);

  const context: ContextData = {
    project: {
      path: canonicalProjectRoot,
      cwd,
      name: projectName,
      environment: projectConfig?.context?.environment || process.env.NODE_ENV || 'development',
      ...(projectConfig?.context
        ? {
            custom: {
              projectId: projectConfig.context.projectId,
              team: projectConfig.context.team,
              ...projectConfig.context.custom,
            },
          }
        : {}),
    },
    user: {
      username: process.env.USER || process.env.USERNAME || 'unknown',
      home: process.env.HOME || process.env.USERPROFILE || '',
    },
    environment: {
      variables: {
        NODE_VERSION: process.version,
        PLATFORM: process.platform,
        ARCH: process.arch,
        PWD: cwd,
        ...prefixedEnvironmentVariables,
      },
    },
    timestamp: new Date().toISOString(),
    ...(version ? { version } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(transportType
      ? {
          transport: {
            type: transportType,
          },
        }
      : {}),
  };

  return context;
}

export function generateStreamableSessionId(): string {
  return `${AUTH_CONFIG.SERVER.STREAMABLE_SESSION.ID_PREFIX}${crypto.randomUUID()}`;
}

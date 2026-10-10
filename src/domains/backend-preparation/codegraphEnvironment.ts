import { getRuntimeParentEnvironment } from '../../config/runtimeBootstrap.js';

/** Checkout identity and read-only Git behavior must not inherit a caller's
 * alternate index, worktree, repository or external fsmonitor hook override.
 */
export function codeGraphEnvironment(): Record<string, string | undefined> {
  const environment = { ...getRuntimeParentEnvironment() };
  for (const key of Object.keys(environment)) {
    if (/^GIT_CONFIG_(?:PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) delete environment[key];
  }
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  ])
    delete environment[key];
  return {
    ...environment,
    CODEGRAPH_TELEMETRY: '0',
    CODEGRAPH_NO_DAEMON: '1',
    CODEGRAPH_NO_DOWNLOAD: '1',
    CODEGRAPH_DIR: '.codegraph',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: 'false',
  };
}

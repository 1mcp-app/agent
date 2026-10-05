import type { FieldRule } from '../privacy/fields.js';

/** Registered local instrumentation only; backend diagnostics are isolated. */
export const EVENT_REGISTRY = {
  'processIdentity.acquisition-failed': {
    message: 'Process birth evidence acquisition failed',
    fields: {
      platform: 'processPlatform',
      pid: 'number',
      elapsedMs: 'number',
      code: 'processEvidenceCode',
    },
  },
  'logger.sanitization-failed': {
    message: 'Sanitization error occurred',
    fields: {},
  },
  'supervisor.runtime-spawned': {
    message: 'Background supervisor runtime-spawned',
    fields: {
      supervisorPid: 'number',
      runtimePid: 'number',
      restartAttempt: 'number',
      delayMs: 'number',
      exitCode: 'number',
      error: 'error',
    },
  },
  'supervisor.runtime-ready': {
    message: 'Background supervisor runtime-ready',
    fields: {
      supervisorPid: 'number',
      runtimePid: 'number',
      restartAttempt: 'number',
      delayMs: 'number',
      exitCode: 'number',
      error: 'error',
    },
  },
  'supervisor.runtime-unreachable': {
    message: 'Background supervisor runtime-unreachable',
    fields: {
      supervisorPid: 'number',
      runtimePid: 'number',
      restartAttempt: 'number',
      delayMs: 'number',
      exitCode: 'number',
      error: 'error',
    },
  },
  'supervisor.runtime-exit': {
    message: 'Background supervisor runtime-exit',
    fields: {
      supervisorPid: 'number',
      runtimePid: 'number',
      restartAttempt: 'number',
      delayMs: 'number',
      exitCode: 'number',
      error: 'error',
    },
  },
  'supervisor.restart-scheduled': {
    message: 'Background supervisor restart-scheduled',
    fields: {
      supervisorPid: 'number',
      runtimePid: 'number',
      restartAttempt: 'number',
      delayMs: 'number',
      exitCode: 'number',
      error: 'error',
    },
  },
  'supervisor.restart-counter-reset': {
    message: 'Background supervisor restart-counter-reset',
    fields: {
      supervisorPid: 'number',
      runtimePid: 'number',
      restartAttempt: 'number',
      delayMs: 'number',
      exitCode: 'number',
      error: 'error',
    },
  },
  'supervisor.runtime-recovered': {
    message: 'Background supervisor runtime-recovered',
    fields: {
      supervisorPid: 'number',
      runtimePid: 'number',
      restartAttempt: 'number',
      delayMs: 'number',
      exitCode: 'number',
      error: 'error',
    },
  },
  'supervisor.retry-exhausted': {
    message: 'Background supervisor retry-exhausted',
    fields: {
      supervisorPid: 'number',
      runtimePid: 'number',
      restartAttempt: 'number',
      delayMs: 'number',
      exitCode: 'number',
      error: 'error',
    },
  },
  'supervisor.supervisor-stopping': {
    message: 'Background supervisor supervisor-stopping',
    fields: {
      supervisorPid: 'number',
      runtimePid: 'number',
      restartAttempt: 'number',
      delayMs: 'number',
      exitCode: 'number',
      error: 'error',
    },
  },
  'serve.deprecated-sse': {
    message: 'sse option is deprecated, use http instead',
    fields: {},
  },
  'http.response-error': {
    message: 'HTTP request failed',
    fields: {
      method: 'method',
      sessionId: 'identity:session',
      statusCode: 'number',
    },
  },
  'template-context.audit': {
    message: 'Template context audit',
    fields: {
      sessionId: 'identity:session',
    },
  },
  'healthService.health.check.failed.6a360f57': {
    message: 'Health check failed:',
    fields: {
      error: 'error',
    },
  },
  'healthService.error.getting.server.health.ff87a2d7': {
    message: 'Error getting server health:',
    fields: {
      error: 'error',
    },
  },
  'healthService.error.getting.configuration.health.dcd7cc00': {
    message: 'Error getting configuration health:',
    fields: {
      error: 'error',
    },
  },
  'tokenEstimationService.tokenestimationservice.initialized.with.tiktoken.encoding.55c8678d': {
    message: 'TokenEstimationService initialized with tiktoken <private> encoding',
    fields: {},
  },
  'tokenEstimationService.failed.to.initialize.tiktoken.encoder.for.model.e520fc7e': {
    message: 'Failed to initialize tiktoken encoder for model <private>:',
    fields: {
      error: 'error',
    },
  },
  'tokenEstimationService.falling.back.to.gpt.4o.encoding.f5140ee5': {
    message: 'Falling back to gpt-4o encoding',
    fields: {
      error: 'error',
    },
  },
  'tokenEstimationService.failed.to.initialize.fallback.encoder.6faf4f79': {
    message: 'Failed to initialize fallback encoder:',
    fields: {
      error: 'error',
    },
  },
  'tokenEstimationService.error.estimating.tokens.for.tool.a7a9df4e': {
    message: 'Error estimating tokens for tool <private>:',
    fields: {
      error: 'error',
    },
  },
  'tokenEstimationService.error.estimating.tokens.for.resource.72f3626b': {
    message: 'Error estimating tokens for resource <private>:',
    fields: {
      error: 'error',
    },
  },
  'tokenEstimationService.error.estimating.tokens.for.prompt.0f2738c2': {
    message: 'Error estimating tokens for prompt <private>:',
    fields: {
      error: 'error',
    },
  },
  'tokenEstimationService.estimating.tokens.for.server.0753edf6': {
    message: 'Estimating tokens for server: <private>',
    fields: {},
  },
  'tokenEstimationService.error.estimating.tokens.for.server.c1c0cb53': {
    message: 'Error estimating tokens for server <private>:',
    fields: {
      error: 'error',
    },
  },
  'tokenEstimationService.error.estimating.tokens.for.prompt.arguments.c1865a79': {
    message: 'Error estimating tokens for prompt arguments:',
    fields: {
      error: 'error',
    },
  },
  'tokenEstimationService.tokenestimationservice.encoder.disposed.ff22bb9f': {
    message: 'TokenEstimationService encoder disposed',
    fields: {},
  },
  'tokenEstimationService.error.disposing.tiktoken.encoder.ac89ffbd': {
    message: 'Error disposing tiktoken encoder:',
    fields: {
      error: 'error',
    },
  },
  'oauthAuthorizationFlow.oauth.callback.completion.failed.for.758a88bb': {
    message: 'OAuth callback completion failed for <private>',
    fields: {
      error: 'error',
    },
  },
  'authCodeRepository.created.auth.code.for.client.b3c876ec': {
    message: 'Created auth code for client: <private>',
    fields: {},
  },
  'authCodeRepository.deleted.auth.code.3a10cbdc': {
    message: 'Deleted auth code',
    fields: {},
  },
  'authRequestRepository.created.auth.request.for.client.fcf5cb7b': {
    message: 'Created auth request for client: <private>',
    fields: {},
  },
  'authRequestRepository.deleted.auth.request.446430f1': {
    message: 'Deleted auth request',
    fields: {},
  },
  'clientDataRepository.saved.client.data.a2a30621': {
    message: 'Saved client data: <private>',
    fields: {},
  },
  'clientDataRepository.deleted.client.data.26bb95c1': {
    message: 'Deleted client data: <private>',
    fields: {},
  },
  'clientSessionRepository.saved.client.session.for.server.7d984677': {
    message: 'Saved client session for server: <private>',
    fields: {},
  },
  'fileStorageService.chmod.unsupported.on.filesystem.lacks.posix.permission.capabilities.degradi.fa8e2186': {
    message:
      'chmod <private> unsupported on <private> (<private>) — filesystem lacks POSIX permission capabilities, degrading safely',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.created.storage.directory.457c7184': {
    message: 'Created storage directory: <private>',
    fields: {},
  },
  'fileStorageService.failed.to.create.storage.directory.8d6e79fa': {
    message: 'Failed to create storage directory: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.failed.to.harden.migration.flag.permissions.69dfb23b': {
    message: 'Failed to harden migration flag permissions: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.migration.from.to.already.completed.c86350f8': {
    message: 'Migration from <private> to <private> already completed',
    fields: {},
  },
  'fileStorageService.migrated.from.to.474c939b': {
    message: 'Migrated <private> from <private> to <private>',
    fields: {},
  },
  'fileStorageService.failed.to.migrate.7d2a3922': {
    message: 'Failed to migrate <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.migration.completed.files.migrated.to.9086112b': {
    message: 'Migration completed: <private> files migrated to <private>/',
    fields: {},
  },
  'fileStorageService.created.migration.flag.migrated.to.in.b89fe290': {
    message: 'Created migration flag: .migrated-to-<private> in <private>',
    fields: {},
  },
  'fileStorageService.failed.to.create.migration.flag.ef732c12': {
    message: 'Failed to create migration flag: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.extractuuidpart.failed.for.id.prefix.69442aa5': {
    message: 'extractUuidPart failed for id=<private>, prefix=<private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.wrote.data.to.0d444b04': {
    message: 'Wrote data to <private>',
    fields: {},
  },
  'fileStorageService.failed.to.write.data.for.1dcbea2a': {
    message: 'Failed to write data for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.rejected.readdata.with.invalid.id.81150da1': {
    message: 'Rejected readData with invalid ID: <private>',
    fields: {},
  },
  'fileStorageService.failed.to.read.data.for.709c6b64': {
    message: 'Failed to read data for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.rejected.deletedata.with.invalid.id.a25fcab7': {
    message: 'Rejected deleteData with invalid ID: <private>',
    fields: {},
  },
  'fileStorageService.deleted.data.file.8587c119': {
    message: 'Deleted data file: <private>',
    fields: {},
  },
  'fileStorageService.failed.to.delete.data.for.391c9b0b': {
    message: 'Failed to delete data for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.failed.to.clean.temporary.file.48c7fb76': {
    message: 'Failed to clean temporary file <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.skipping.unreadable.credential.file.b0d290a8': {
    message: 'Skipping unreadable credential file <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.cleaned.up.expired.file.c453faef': {
    message: 'Cleaned up expired file: <private>',
    fields: {},
  },
  'fileStorageService.failed.to.remove.expired.file.5348882d': {
    message: 'Failed to remove expired file <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.removing.corrupted.file.e49d8b38': {
    message: 'Removing corrupted file <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.failed.to.remove.corrupted.file.0c104eb3': {
    message: 'Failed to remove corrupted file <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.cleaned.up.expired.corrupted.files.5d2edba3': {
    message: 'Cleaned up <private> expired/corrupted files',
    fields: {},
  },
  'fileStorageService.failed.to.cleanup.expired.data.59c8a76e': {
    message: 'Failed to cleanup expired data: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.failed.to.list.files.b597413e': {
    message: 'Failed to list files: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.filestorageservice.cleanup.interval.stopped.381c8aed': {
    message: 'FileStorageService cleanup interval stopped',
    fields: {},
  },
  'fileStorageService.storage.lock.ownership.changed.before.release.f36c6767': {
    message: 'Storage lock ownership changed before release: <private>',
    fields: {},
  },
  'fileStorageService.storage.lock.disappeared.during.release.c47b3b4c': {
    message: 'Storage lock disappeared during release: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.storage.lock.ownership.changed.during.release.efa9d04b': {
    message: 'Storage lock ownership changed during release: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.failed.to.flush.storage.directory.after.lock.release.ff0f3139': {
    message: 'Failed to flush storage directory after lock release <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.released.storage.lock.without.rename.after.rename.failure.2f4c48e6': {
    message: 'Released storage lock without rename after rename failure: <private>',
    fields: {
      error: 'error',
    },
  },
  'fileStorageService.failed.to.release.storage.lock.f179f145': {
    message: 'Failed to release storage lock <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'oauthStorageService.oauth.authorization.granted.for.client.25a4e31b': {
    message: 'OAuth authorization granted for client <private>',
    fields: {
      clientId: 'identity:client',
    },
  },
  'oauthStorageService.oauth.authorization.denied.by.user.for.client.29791f5d': {
    message: 'OAuth authorization denied by user for client <private>',
    fields: {},
  },
  'sessionRepository.created.session.for.client.1462cd8c': {
    message: 'Created session: <private> for client: <private>',
    fields: {},
  },
  'sessionRepository.created.session.with.id.for.client.10772b23': {
    message: 'Created session with ID: <private> for client: <private>',
    fields: {},
  },
  'sessionRepository.deleted.session.52ed13ff': {
    message: 'Deleted session: <private>',
    fields: {},
  },
  'setupFiles.skipping.managed.update.for.because.the.file.contains.json.comments.0409427c': {
    message: 'Skipping managed update for <private> because the file contains JSON comments.',
    fields: {},
  },
  'install.starting.installation.process.9f68ffb6': {
    message: 'Starting installation process...',
    fields: {},
  },
  'install.parsed.registry.server.id.version.135a2e70': {
    message: 'Parsed registry server ID: <private>, version: <private>',
    fields: {},
  },
  'install.derived.local.server.name.from.registry.id.552c9131': {
    message: 'Derived local server name: <private> from registry ID: <private>',
    fields: {},
  },
  'install.configuration.saved.for.server.86522ad7': {
    message: "Configuration saved for server '<private>'",
    fields: {},
  },
  'install.installation.error.stack.33a9ab69': {
    message: 'Installation error stack:',
    fields: {
      error: 'error',
    },
  },
  'installSource.registry.server.id.validation.passed.96ae738a': {
    message: 'Registry server ID validation passed: <private>',
    fields: {},
  },
  'installSource.derived.local.server.name.from.registry.id.b62d5b61': {
    message: "Derived local server name '<private>' from registry ID '<private>'",
    fields: {},
  },
  'tokens.connecting.to.mcp.servers.for.capability.discovery.f8273e60': {
    message: 'Connecting to <private> MCP servers for capability discovery',
    fields: {},
  },
  'tokens.error.collecting.server.capabilities.17b0f066': {
    message: 'Error collecting server capabilities:',
    fields: {
      error: 'error',
    },
  },
  'tokens.starting.tokens.command.with.args.b08b694b': {
    message: 'Starting tokens command with args:',
    fields: {},
  },
  'tokens.using.preset.for.token.estimation.e925577e': {
    message: 'Using preset for token estimation:',
    fields: {},
  },
  'tokens.parsed.tag.filter.expression.0009d0c9': {
    message: 'Parsed tag filter expression:',
    fields: {},
  },
  'tokens.error.in.tokens.command.dba89057': {
    message: 'Error in tokens command:',
    fields: {
      error: 'error',
    },
  },
  'uninstall.starting.uninstall.process.0d392255': {
    message: 'Starting uninstall process...',
    fields: {},
  },
  'uninstall.removing.server.configuration.for.6593ee65': {
    message: "Removing server configuration for '<private>'...",
    fields: {},
  },
  'uninstall.backup.created.8cfc48c8': {
    message: 'Backup created: <private>',
    fields: {},
  },
  'uninstall.uninstall.error.stack.e0902bbb': {
    message: 'Uninstall error stack:',
    fields: {
      error: 'error',
    },
  },
  'installWizard.failed.to.fetch.server.details.4c06cdb1': {
    message: 'Failed to fetch server details',
    fields: {
      serverId: 'identity:server',
      error: 'error',
    },
  },
  'installWizard.wizard.failed.b5b2ad8d': {
    message: 'Wizard failed',
    fields: {
      error: 'error',
    },
  },
  'mcpServerConfig.cannot.set.metadata.for.non.existent.server.6b7bd7a4': {
    message: 'Cannot set metadata for non-existent server: <private>',
    fields: {},
  },
  'mcpServerConfig.cannot.update.metadata.for.non.existent.server.baf4ecbd': {
    message: 'Cannot update metadata for non-existent server: <private>',
    fields: {},
  },
  'mcpServerConfig.no.metadata.found.for.server.f6c7e306': {
    message: 'No metadata found for server: <private>',
    fields: {},
  },
  'mcpServerConfig.failed.to.get.installation.metadata.for.509a9169': {
    message: 'Failed to get installation metadata for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'serverUtils.checking.if.server.is.in.use.e2413145': {
    message: 'Checking if server <private> is in use',
    fields: {},
  },
  'serverUtils.server.has.an.active.client.connection.9ff8127b': {
    message: 'Server <private> has an active client connection',
    fields: {},
  },
  'serverUtils.server.is.in.outbound.connections.map.e62f22e6': {
    message: 'Server <private> is in outbound connections map',
    fields: {},
  },
  'serverUtils.servermanager.not.initialized.or.not.accessible.985955b7': {
    message: 'ServerManager not initialized or not accessible',
    fields: {},
  },
  'search.search.failed.755851da': {
    message: 'Search failed',
    fields: {
      error: 'error',
    },
  },
  'create.preset.create.command.failed.bb4c6462': {
    message: 'Preset create command failed',
    fields: {
      error: 'error',
    },
  },
  'delete.preset.delete.command.failed.2bcfe514': {
    message: 'Preset delete command failed',
    fields: {
      error: 'error',
    },
  },
  'edit.preset.edit.command.failed.b7193133': {
    message: 'Preset edit command failed',
    fields: {
      error: 'error',
    },
  },
  'interactive.preset.interactive.command.failed.162730ed': {
    message: 'Preset interactive command failed',
    fields: {
      error: 'error',
    },
  },
  'list.preset.list.command.failed.55721a78': {
    message: 'Preset list command failed',
    fields: {
      error: 'error',
    },
  },
  'show.preset.show.command.failed.a1b0efd1': {
    message: 'Preset show command failed',
    fields: {
      error: 'error',
    },
  },
  'test.preset.test.command.failed.aa4ea1b8': {
    message: 'Preset test command failed',
    fields: {
      error: 'error',
    },
  },
  'url.preset.url.command.failed.948ba859': {
    message: 'Preset URL command failed',
    fields: {
      error: 'error',
    },
  },
  'proxy.discovering.running.1mcp.server.9ae9a998': {
    message: '🔍 Discovering running 1MCP server...',
    fields: {},
  },
  'proxy.using.user.provided.url.5d95dba1': {
    message: '📍 Using user-provided URL: <private>',
    fields: {},
  },
  'proxy.found.server.via.pid.file.acea205d': {
    message: '✅ Found server via PID file: <private>',
    fields: {},
  },
  'proxy.found.server.via.port.scan.4262265e': {
    message: '✅ Found server via port scan: <private>',
    fields: {},
  },
  'proxy.using.preset.c16bbd2d': {
    message: '📦 Using preset: <private>',
    fields: {},
  },
  'proxy.using.filter.85e1ffb4': {
    message: '🔍 Using filter: <private>',
    fields: {},
  },
  'proxy.using.tags.20586b71': {
    message: '🏷️ Using tags: <private>',
    fields: {},
  },
  'proxy.starting.stdio.proxy.d415368c': {
    message: '📡 Starting STDIO proxy...',
    fields: {},
  },
  'proxy.stdio.proxy.running.forwarding.to.b084a797': {
    message: '📡 STDIO proxy running, forwarding to <private>',
    fields: {},
  },
  'proxy.shutting.down.stdio.proxy.0fa99376': {
    message: 'Shutting down STDIO proxy...',
    fields: {},
  },
  'proxy.stdio.proxy.shutdown.complete.eb154c73': {
    message: 'STDIO proxy shutdown complete',
    fields: {},
  },
  'proxy.proxycommand.diagnostic.de43c663': {
    message: 'proxyCommand diagnostic',
    fields: {
      error: 'error',
    },
  },
  'proxy.failed.to.start.stdio.proxy.2ee21544': {
    message: 'Failed to start STDIO proxy:',
    fields: {
      error: 'error',
    },
  },
  'search.searching.mcp.registry.7ad666a2': {
    message: 'Searching MCP registry...',
    fields: {},
  },
  'search.search.command.failed.3c7f64d2': {
    message: 'Search command failed:',
    fields: {
      error: 'error',
    },
  },
  'show.fetching.mcp.server.details.b2a7a76e': {
    message: 'Fetching MCP server details: <private><private>',
    fields: {},
  },
  'show.show.command.failed.82926490': {
    message: 'Show command failed:',
    fields: {
      error: 'error',
    },
  },
  'status.getting.mcp.registry.status.9fc5a43f': {
    message: 'Getting MCP registry status...',
    fields: {},
  },
  'status.registry.status.command.failed.284cbbf2': {
    message: 'Registry status command failed:',
    fields: {
      error: 'error',
    },
  },
  'versions.fetching.versions.for.mcp.server.0c6fcd0e': {
    message: 'Fetching versions for MCP server: <private>',
    fields: {},
  },
  'versions.versions.command.failed.508dbd17': {
    message: 'Versions command failed:',
    fields: {
      error: 'error',
    },
  },
  'run.fetchtoolinfofromapi.unexpected.response.status.4118cbd7': {
    message: 'fetchToolInfoFromApi: unexpected response status',
    fields: {
      status: 'number',
    },
  },
  'run.fetchtoolinfofromapi.invalid.inspect.response.a4a8e463': {
    message: 'fetchToolInfoFromApi: invalid inspect response',
    fields: {},
  },
  'run.cli.session.cleanup.close.failed.best.effort.bd4b5426': {
    message: 'CLI session cleanup close failed (best-effort):',
    fields: {
      error: 'error',
    },
  },
  'serveBackground.failed.to.terminate.background.supervisor.pid.97588dd9': {
    message: 'Failed to terminate background supervisor (PID: <private>): <private>',
    fields: {
      error: 'error',
    },
  },
  'serveOptions.failed.to.parse.internal.tools.list.ee9cd62e': {
    message: 'Failed to parse internal-tools list: <private>',
    fields: {
      error: 'error',
    },
  },
  'serveOptions.failed.to.load.presets.for.871e1a51': {
    message: "Failed to load presets for '<private>': <private>",
    fields: {
      error: 'error',
    },
  },
  'serveOptions.preset.not.found.ignoring.preset.option.78f04add': {
    message: "Preset '<private>' not found, ignoring preset option",
    fields: {},
  },
  'serveOptions.resolvestdiofilterconfig.diagnostic.5094434e': {
    message: 'resolveStdioFilterConfig diagnostic',
    fields: {},
  },
  'serveOptions.loaded.preset.for.stdio.transport.71846c5d': {
    message: "Loaded preset '<private>' for STDIO transport",
    fields: {},
  },
  'serveOptions.logfilterselectionerror.diagnostic.bf2602b0': {
    message: 'logFilterSelectionError diagnostic',
    fields: {},
  },
  'serveOptions.preset.tag.query.validation.failed.0851ef3c': {
    message: 'Preset tag query validation failed',
    fields: {},
  },
  'serveOptions.examples.d9ecfb49': {
    message: 'Examples:',
    fields: {},
  },
  'serveOptions.filter.web.api.database.or.logic.comma.separated.f732c461': {
    message: '--filter "web,api,database" # OR logic (comma-separated)',
    fields: {},
  },
  'serveOptions.filter.web.and.database.and.logic.558ce26c': {
    message: '--filter "web AND database" # AND logic',
    fields: {},
  },
  'serveOptions.filter.web.or.api.and.database.complex.expressions.4915f9cb': {
    message: '--filter "(web OR api) AND database" # Complex expressions',
    fields: {},
  },
  'serveStop.failed.to.send.sigterm.to.pid.bb13a763': {
    message: 'Failed to send SIGTERM to <private> PID <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'serveStop.pid.did.not.exit.after.sigterm.escalating.to.sigkill.554205a0': {
    message: '<private> (PID <private>) did not exit after SIGTERM; escalating to SIGKILL',
    fields: {},
  },
  'serveStop.failed.to.send.sigkill.to.pid.0e48ebe1': {
    message: 'Failed to send SIGKILL to <private> PID <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'authProfileStore.chmod.unsupported.on.auth.profiles.volume.profile.saved.without.mode.harden.900ce9b1': {
    message: 'chmod unsupported on auth-profiles volume (<private>); profile saved without mode hardening',
    fields: {
      error: 'error',
    },
  },
  'authProfileStore.skipping.auth.profile.with.unfixable.permissions.f5b320bf': {
    message: 'Skipping auth profile with unfixable permissions: <private>',
    fields: {
      error: 'error',
    },
  },
  'baseConfigUtils.configuration.saved.to.16509b4b': {
    message: 'Configuration saved to: <private>',
    fields: {},
  },
  'baseConfigUtils.failed.to.get.server.d63f7d69': {
    message: "Failed to get server '<private>': <private>",
    fields: {
      error: 'error',
    },
  },
  'baseConfigUtils.failed.to.resolve.server.target.79c0e848': {
    message: "Failed to resolve server target '<private>': <private>",
    fields: {
      error: 'error',
    },
  },
  'baseConfigUtils.failed.to.get.global.config.093f0ef1': {
    message: 'Failed to get global config: <private>',
    fields: {
      error: 'error',
    },
  },
  'baseConfigUtils.failed.to.get.effective.server.config.for.b3e07967': {
    message: "Failed to get effective server config for '<private>': <private>",
    fields: {
      error: 'error',
    },
  },
  'baseConfigUtils.failed.to.get.effective.server.target.config.for.13be43bf': {
    message: "Failed to get effective server target config for '<private>': <private>",
    fields: {
      error: 'error',
    },
  },
  'baseConfigUtils.failed.to.get.all.servers.bcf50cf6': {
    message: 'Failed to get all servers: <private>',
    fields: {
      error: 'error',
    },
  },
  'baseConfigUtils.failed.to.get.all.server.targets.5caa4107': {
    message: 'Failed to get all server targets: <private>',
    fields: {
      error: 'error',
    },
  },
  'baseConfigUtils.failed.to.get.all.effective.servers.6fd05cce': {
    message: 'Failed to get all effective servers: <private>',
    fields: {
      error: 'error',
    },
  },
  'baseConfigUtils.mcp.configuration.reloaded.53167346': {
    message: 'MCP configuration reloaded',
    fields: {},
  },
  'baseConfigUtils.failed.to.reload.mcp.configuration.ef37d781': {
    message: 'Failed to reload MCP configuration: <private>',
    fields: {
      error: 'error',
    },
  },
  'clientSurfaceAttachment.template.context.capability.unreadable.proceeding.without.proof.a0e180f0': {
    message: 'Template context capability unreadable, proceeding without proof: <private>',
    fields: {
      error: 'error',
    },
  },
  'configParsingUtils.configuration.backed.up.to.35558042': {
    message: 'Configuration backed up to: <private>',
    fields: {},
  },
  'connectionHelper.connecting.to.mcp.servers.461c8d6e': {
    message: 'Connecting to <private> MCP servers',
    fields: {},
  },
  'connectionHelper.created.transports.f05ade79': {
    message: 'Created <private> transports',
    fields: {},
  },
  'connectionHelper.connecting.to.server.18da2df3': {
    message: 'Connecting to server: <private>',
    fields: {},
  },
  'connectionHelper.successfully.connected.to.efd457e4': {
    message: 'Successfully connected to <private>',
    fields: {},
  },
  'connectionHelper.failed.to.connect.to.server.c68471ca': {
    message: 'Failed to connect to server <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'connectionHelper.connected.to.mcp.servers.e37c33e9': {
    message: 'Connected to <private>/<private> MCP servers',
    fields: {},
  },
  'connectionHelper.error.getting.capabilities.from.67bec470': {
    message: 'Error getting capabilities from <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'connectionHelper.got.from.9f852132': {
    message: 'Got <private> <private> from <private>',
    fields: {},
  },
  'connectionHelper.failed.to.get.from.37b44b45': {
    message: 'Failed to get <private> from <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'connectionHelper.cleaning.up.mcp.connections.1b42fca5': {
    message: 'Cleaning up MCP connections',
    fields: {},
  },
  'connectionHelper.error.closing.client.for.b4896484': {
    message: 'Error closing client for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'connectionHelper.closed.connection.to.b8f5aa07': {
    message: 'Closed connection to <private>',
    fields: {},
  },
  'configLoader.the.app.key.in.mcp.json.is.deprecated.please.move.your.app.settings.to.the..973af260': {
    message:
      'The "app" key in mcp.json is deprecated. Please move your app settings to <private>. The "app" key in mcp.json will be ignored.',
    fields: {},
  },
  'configLoader.the.lazyloading.mode.setting.in.is.deprecated.and.ignored.lazy.loading.is.c.21f87e57': {
    message:
      'The [lazyLoading].mode setting in <private> is deprecated and ignored. Lazy loading is controlled only by [lazyLoading] enabled = true. Remove mode because it does not change runtime behavior.',
    fields: {},
  },
  'configLoader.unknown.properties.in.global.mcp.configuration.were.ignored.b3b38387': {
    message: 'Unknown properties in global MCP configuration were ignored: <private>',
    fields: {},
  },
  'configLoader.invalid.app.configuration.in.config.toml.ignored.1d694a3c': {
    message: 'Invalid app configuration in config.toml (ignored): <private>',
    fields: {
      error: 'error',
    },
  },
  'configLoader.failed.to.load.app.configuration.from.7e70a1f8': {
    message: 'Failed to load app configuration from <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'configLoader.created.config.directory.fbb7f778': {
    message: 'Created config directory: <private>',
    fields: {},
  },
  'configLoader.created.default.config.file.06a17671': {
    message: 'Created default config file: <private>',
    fields: {},
  },
  'configLoader.failed.to.ensure.config.exists.927bf77f': {
    message: 'Failed to ensure config exists: <private>',
    fields: {
      error: 'error',
    },
  },
  'configLoader.cannot.check.file.modification.time.for.59fe199f': {
    message: 'Cannot check file modification time for <private>: <private>',
    fields: {},
  },
  'configLoader.failed.to.check.file.modification.time.bdf720cd': {
    message: 'Failed to check file modification time: <private>',
    fields: {
      error: 'error',
    },
  },
  'configLoader.added.schema.property.to.config.for.ide.autocompletion.6c801f82': {
    message: 'Added $schema property to config for IDE autocompletion',
    fields: {},
  },
  'configLoader.loadrawconfigresult.diagnostic.3af0e367': {
    message: 'loadRawConfigResult diagnostic',
    fields: {
      error: 'error',
    },
  },
  'configLoader.could.not.check.for.legacy.app.key.5cb7a5d5': {
    message: 'Could not check for legacy "app" key: <private>',
    fields: {},
  },
  'configLoader.loadparsedconfig.diagnostic.9ed41a05': {
    message: 'loadParsedConfig diagnostic',
    fields: {
      error: 'error',
    },
  },
  'configLoader.ignoring.invalid.serverdefaults.configuration.56393432': {
    message: 'Ignoring invalid serverDefaults configuration: <private>',
    fields: {
      error: 'error',
    },
  },
  'configLoader.validated.configuration.for.server.190b0b32': {
    message: 'Validated configuration for server: <private>',
    fields: {
      serverName: 'identity:server',
    },
  },
  'configLoader.configuration.validation.failed.fdd8b126': {
    message: 'Configuration validation failed: <private>',
    fields: {
      error: 'error',
    },
  },
  'configLoader.ignoring.static.server.s.that.conflict.with.template.servers.18d2369c': {
    message: 'Ignoring <private> static server(s) that conflict with template servers: <private>',
    fields: {},
  },
  'configManager.error.handling.config.change.f7e1f29f': {
    message: 'Error handling config change: <private>',
    fields: {},
  },
  'configManager.configmanager.initialized.6ad9fb75': {
    message: 'ConfigManager initialized',
    fields: {},
  },
  'configManager.initialize.diagnostic.5eee141c': {
    message: 'initialize diagnostic',
    fields: {
      error: 'error',
    },
  },
  'configManager.configmanager.stopped.2e54597f': {
    message: 'ConfigManager stopped',
    fields: {},
  },
  'configManager.configuration.loaded.successfully.environment.variable.substitution.c04b8bbe': {
    message: 'Configuration loaded successfully <private> environment variable substitution',
    fields: {},
  },
  'configManager.loadconfig.diagnostic.891dc011': {
    message: 'loadConfig diagnostic',
    fields: {
      error: 'error',
    },
  },
  'configManager.failed.to.parse.configuration.f51f3faf': {
    message: 'Failed to parse configuration: <private>',
    fields: {
      error: 'error',
    },
  },
  'configManager.static.server.validation.failed.for.142a3b32': {
    message: 'Static server validation failed for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'configManager.template.server.validation.failed.for.b189fd8d': {
    message: 'Template server validation failed for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'configManager.ignoring.static.server.s.that.conflict.with.template.servers.fbf7b8aa': {
    message: 'Ignoring <private> static server(s) that conflict with template servers: <private>',
    fields: {},
  },
  'configManager.template.processed.successfully.eb1c3b11': {
    message: 'Template processed successfully',
    fields: {
      serverName: 'identity:server',
    },
  },
  'configManager.processtemplates.diagnostic.d12a569b': {
    message: 'processTemplates diagnostic',
    fields: {
      error: 'error',
    },
  },
  'configManager.failed.to.apply.deferred.configuration.reload.6fe22f1a': {
    message: 'Failed to apply deferred configuration reload',
    fields: {
      error: 'error',
    },
  },
  'configManager.configuration.hot.reload.is.disabled.ignoring.file.changes.6fd262e2': {
    message: 'Configuration hot-reload is disabled, ignoring file changes',
    fields: {},
  },
  'configManager.failed.to.load.or.validate.configuration.9145e701': {
    message: 'Failed to load or validate configuration: <private>',
    fields: {
      error: 'error',
    },
  },
  'configManager.detected.configuration.changes.ffd1172b': {
    message: 'Detected <private> configuration changes',
    fields: {},
  },
  'configWatcher.configuration.hot.reload.is.disabled.skipping.file.watcher.setup.03b1b0a9': {
    message: 'Configuration hot-reload is disabled, skipping file watcher setup',
    fields: {},
  },
  'configWatcher.file.watcher.already.started.ignoring.duplicate.call.ad93bddf': {
    message: 'File watcher already started, ignoring duplicate call',
    fields: {},
  },
  'configWatcher.configuration.file.watcher.failed.falling.back.to.polling.c2323c67': {
    message: 'Configuration file watcher failed; falling back to polling',
    fields: {
      error: 'error',
    },
  },
  'configWatcher.started.watching.configuration.directory.for.file.dfe83f83': {
    message: 'Started watching configuration directory: <private> for file: <private>',
    fields: {},
  },
  'configWatcher.startwatching.diagnostic.55a6d834': {
    message: 'startWatching diagnostic',
    fields: {
      error: 'error',
    },
  },
  'configWatcher.stopped.watching.configuration.file.bf006a6f': {
    message: 'Stopped watching configuration file',
    fields: {},
  },
  'configWatcher.directory.change.detected.f4b0d074': {
    message: 'Directory change detected',
    fields: {},
  },
  'configWatcher.configuration.file.change.detected.debouncing.reload.80faa869': {
    message: 'Configuration file change detected, debouncing reload',
    fields: {},
  },
  'configWatcher.configuration.file.modification.detected.by.polling.debouncing.reload.994934b4': {
    message: 'Configuration file modification detected by polling, debouncing reload',
    fields: {},
  },
  'configWatcher.debounce.period.completed.reloading.configuration.94659153': {
    message: 'Debounce period completed, reloading configuration...',
    fields: {},
  },
  'envProcessor.skipping.dangerous.environment.variable.62436294': {
    message: 'Skipping dangerous environment variable: <private>',
    fields: {},
  },
  'envProcessor.environment.variable.not.found.keeping.placeholder.unchanged.9e4fa714': {
    message: 'Environment variable <private> not found, keeping placeholder unchanged',
    fields: {},
  },
  'envProcessor.sdk.default.environment.variables.0a428954': {
    message: 'SDK default environment variables: <private>',
    fields: {},
  },
  'envProcessor.inheriting.additional.environment.variables.from.parent.fec3533f': {
    message: 'Inheriting <private> additional environment variables from parent',
    fields: {},
  },
  'envProcessor.environment.filtering.removed.variables.43fe7eba': {
    message: 'Environment filtering removed <private> variables: <private>',
    fields: {},
  },
  'envProcessor.adding.custom.environment.variables.ff9cbb4f': {
    message: 'Adding <private> custom environment variables: <private>',
    fields: {},
  },
  'envProcessor.environment.processing.complete.total.variables.aaf53195': {
    message: 'Environment processing complete. Total variables: <private>',
    fields: {},
  },
  'mcpConfigManager.configuration.loaded.successfully.environment.variable.substitution.f9e03cc4': {
    message: 'Configuration loaded successfully <private> environment variable substitution',
    fields: {},
  },
  'mcpConfigManager.failed.to.load.configuration.4035e97b': {
    message: 'Failed to load configuration: <private>',
    fields: {
      error: 'error',
    },
  },
  'mcpConfigManager.failed.to.check.file.modification.time.09e698e9': {
    message: 'Failed to check file modification time: <private>',
    fields: {
      error: 'error',
    },
  },
  'mcpConfigManager.configuration.hot.reload.is.disabled.skipping.file.watcher.setup.a71d49d7': {
    message: 'Configuration hot-reload is disabled, skipping file watcher setup',
    fields: {},
  },
  'mcpConfigManager.directory.change.detected.4c6feb9e': {
    message: 'Directory change detected',
    fields: {},
  },
  'mcpConfigManager.configuration.file.change.detected.checking.modification.time.948657e8': {
    message: 'Configuration file change detected, checking modification time',
    fields: {},
  },
  'mcpConfigManager.file.modification.confirmed.debouncing.reload.0c3de65e': {
    message: 'File modification confirmed, debouncing reload',
    fields: {},
  },
  'mcpConfigManager.file.modification.time.unchanged.ignoring.event.dfe2f587': {
    message: 'File modification time unchanged, ignoring event',
    fields: {},
  },
  'mcpConfigManager.file.was.modified.but.event.did.not.match.criteria.debouncing.reload.anyway.a0941437': {
    message: 'File was modified but event did not match criteria, debouncing reload anyway',
    fields: {},
  },
  'mcpConfigManager.configuration.file.watcher.failed.c4b39877': {
    message: 'Configuration file watcher failed',
    fields: {
      error: 'error',
    },
  },
  'mcpConfigManager.started.watching.configuration.directory.for.file.6cfd05eb': {
    message: 'Started watching configuration directory: <private> for file: <private>',
    fields: {},
  },
  'mcpConfigManager.failed.to.start.watching.configuration.file.00929ce9': {
    message: 'Failed to start watching configuration file: <private>',
    fields: {
      error: 'error',
    },
  },
  'mcpConfigManager.stopped.watching.configuration.file.d4dd37a7': {
    message: 'Stopped watching configuration file',
    fields: {},
  },
  'mcpConfigManager.debounce.period.completed.reloading.configuration.0f648a97': {
    message: 'Debounce period completed, reloading configuration...',
    fields: {},
  },
  'mcpConfigManager.failed.to.apply.configuration.reload.8f06d810': {
    message: 'Failed to apply configuration reload',
    fields: {
      error: 'error',
    },
  },
  'mcpConfigManager.transport.configuration.changed.emitting.event.bf5828e5': {
    message: 'Transport configuration changed, emitting event',
    fields: {},
  },
  'mcpConfigManager.failed.to.reload.configuration.2a029532': {
    message: 'Failed to reload configuration: <private>',
    fields: {
      error: 'error',
    },
  },
  'projectConfigLoader.loading.project.config.from.fb26173f': {
    message: 'Loading project config from <private>',
    fields: {},
  },
  'projectConfigLoader.loaded.configuration.from.278ccfdb': {
    message: '📄 Loaded configuration from <private>',
    fields: {},
  },
  'projectConfigLoader.invalid.json.in.db426689': {
    message: 'Invalid JSON in <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'projectConfigLoader.failed.to.load.470dad92': {
    message: 'Failed to load <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'projectConfigLoader.failed.to.load.unknown.error.8b999c8e': {
    message: 'Failed to load <private>: Unknown error',
    fields: {
      error: 'error',
    },
  },
  'projectConfigLoader.no.found.for.using.repository.root.413dc0c6': {
    message: 'No <private> found for <private>, using repository root <private>',
    fields: {},
  },
  'projectConfigLoader.no.or.repository.root.found.for.using.cwd.51d43561': {
    message: 'No <private> or repository root found for <private>, using cwd',
    fields: {},
  },
  'templateProcessor.failed.to.parse.configuration.7d302e75': {
    message: 'Failed to parse configuration: <private>',
    fields: {
      error: 'error',
    },
  },
  'templateProcessor.ignoring.static.server.s.that.conflict.with.template.servers.fdc50eb5': {
    message: 'Ignoring <private> static server(s) that conflict with template servers: <private>',
    fields: {},
  },
  'templateProcessor.template.processed.successfully.5c8ba5e8': {
    message: 'Template processed successfully',
    fields: {
      serverName: 'identity:server',
    },
  },
  'templateProcessor.processtemplates.diagnostic.f6c39737': {
    message: 'processTemplates diagnostic',
    fields: {
      error: 'error',
    },
  },
  'asyncLoadingOrchestrator.asyncloadingorchestrator.already.initialized.8b366424': {
    message: 'AsyncLoadingOrchestrator already initialized',
    fields: {},
  },
  'asyncLoadingOrchestrator.async.loading.disabled.asyncloadingorchestrator.skipping.initialization.e7bfe337': {
    message: 'Async loading disabled - AsyncLoadingOrchestrator skipping initialization',
    fields: {},
  },
  'asyncLoadingOrchestrator.initializing.asyncloadingorchestrator.c18c24fd': {
    message: 'Initializing AsyncLoadingOrchestrator...',
    fields: {},
  },
  'asyncLoadingOrchestrator.1mcp.capabilities.provider.initialized.76a4df74': {
    message: '1mcp capabilities provider initialized',
    fields: {},
  },
  'asyncLoadingOrchestrator.asyncloadingorchestrator.initialized.successfully.f6981563': {
    message: 'AsyncLoadingOrchestrator initialized successfully',
    fields: {},
  },
  'asyncLoadingOrchestrator.notificationmanager.already.initialized.9b4a7b4f': {
    message: 'NotificationManager already initialized',
    fields: {},
  },
  'asyncLoadingOrchestrator.asyncloadingorchestrator.notification.manager.initialized.132f1042': {
    message: 'AsyncLoadingOrchestrator notification manager initialized',
    fields: {},
  },
  'asyncLoadingOrchestrator.server.became.ready.waiting.for.loading.cycle.completion.153e87d5': {
    message: 'Server <private> became ready, waiting for loading cycle completion',
    fields: {
      serverName: 'identity:server',
    },
  },
  'asyncLoadingOrchestrator.loading.cycle.completed.publishing.capability.snapshot.dc43dc0b': {
    message: 'Loading cycle completed, publishing capability snapshot',
    fields: {},
  },
  'asyncLoadingOrchestrator.capabilities.changed.processing.notifications.b9b52ad8': {
    message: 'Capabilities changed, processing notifications',
    fields: {},
  },
  'asyncLoadingOrchestrator.event.chain.setup.completed.5d5b6001': {
    message: 'Event chain setup completed',
    fields: {},
  },
  'asyncLoadingOrchestrator.sent.listchanged.notifications.to.clients.5d7a03f6': {
    message: 'Sent listChanged notifications to <private> clients: [<private>]',
    fields: {},
  },
  'asyncLoadingOrchestrator.failed.to.send.listchanged.notification.3ae391c3': {
    message: 'Failed to send <private> listChanged notification: <private>',
    fields: {},
  },
  'asyncLoadingOrchestrator.notification.event.handlers.setup.completed.13932b2d': {
    message: 'Notification event handlers setup completed',
    fields: {},
  },
  'asyncLoadingOrchestrator.loading.cycle.complete.tools.resources.prompts.now.available.e121d7b3': {
    message: 'Loading cycle complete: <private> tools, <private> resources, <private> prompts now available',
    fields: {},
  },
  'asyncLoadingOrchestrator.loading.cycle.completed.with.no.capability.changes.8c5f89f2': {
    message: 'Loading cycle completed with no capability changes',
    fields: {},
  },
  'asyncLoadingOrchestrator.failed.to.publish.capabilities.after.loading.completed.6544b04e': {
    message: 'Failed to publish capabilities after loading completed: <private>',
    fields: {
      error: 'error',
    },
  },
  'asyncLoadingOrchestrator.capability.changes.detected.but.no.notification.manager.available.yet.ee3e218b': {
    message: 'Capability changes detected but no notification manager available yet',
    fields: {},
  },
  'asyncLoadingOrchestrator.capability.update.complete.1b45dc6f': {
    message: 'Capability update complete: <private>',
    fields: {},
  },
  'asyncLoadingOrchestrator.cannot.refresh.capabilities.orchestrator.not.ready.d8def3cc': {
    message: 'Cannot refresh capabilities - orchestrator not ready',
    fields: {},
  },
  'asyncLoadingOrchestrator.manually.refreshing.capabilities.f27cec15': {
    message: 'Manually refreshing capabilities...',
    fields: {},
  },
  'asyncLoadingOrchestrator.manual.capability.refresh.completed.with.changes.ed9d1da6': {
    message: 'Manual capability refresh completed with changes',
    fields: {},
  },
  'asyncLoadingOrchestrator.manual.capability.refresh.completed.no.changes.detected.291b35c5': {
    message: 'Manual capability refresh completed - no changes detected',
    fields: {},
  },
  'asyncLoadingOrchestrator.failed.to.refresh.capabilities.9ab02978': {
    message: 'Failed to refresh capabilities: <private>',
    fields: {
      error: 'error',
    },
  },
  'asyncLoadingOrchestrator.asyncloadingorchestrator.configuration.updated.9dcb695c': {
    message: 'AsyncLoadingOrchestrator configuration updated',
    fields: {},
  },
  'asyncLoadingOrchestrator.shutting.down.asyncloadingorchestrator.0f1e2941': {
    message: 'Shutting down AsyncLoadingOrchestrator...',
    fields: {},
  },
  'asyncLoadingOrchestrator.asyncloadingorchestrator.shutdown.complete.82ee1abf': {
    message: 'AsyncLoadingOrchestrator shutdown complete',
    fields: {},
  },
  'asyncLoadingOrchestrator.error.during.asyncloadingorchestrator.shutdown.95ead01e': {
    message: 'Error during AsyncLoadingOrchestrator shutdown: <private>',
    fields: {
      error: 'error',
    },
  },
  'capabilityCatalog.failed.to.load.upstream.tool.schema.a7409f4d': {
    message: 'Failed to load upstream tool schema',
    fields: {
      error: 'error',
    },
  },
  'capabilityCatalog.tool.invocation.failed.828dabfb': {
    message: 'Tool invocation failed',
    fields: {
      error: 'error',
    },
  },
  'capabilityManager.capabilities.from.8e853808': {
    message: 'Capabilities from <private>: <private>',
    fields: {},
  },
  'capabilityManager.failed.to.get.capabilities.from.93e25efc': {
    message: 'Failed to get capabilities from <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'capabilityManager.capability.conflict.in.client.overriding.existing.value.fadeac61': {
    message: 'Capability conflict in <private>.<private>: client <private> overriding existing value',
    fields: {},
  },
  'capabilityManager.existing.new.9c54d92e': {
    message: 'Existing: <private>, New: <private>',
    fields: {},
  },
  'capabilityManager.client.has.capability.conflicts.439d33df': {
    message: 'Client <private> has <private> <private> capability conflicts: <private>',
    fields: {},
  },
  'internalCapabilitiesProvider.tool.argument.validation.failed.for.f4d97f37': {
    message: 'Tool argument validation failed for <private>',
    fields: {
      error: 'error',
    },
  },
  'internalCapabilitiesProvider.unexpected.validation.error.for.a09d9f5f': {
    message: 'Unexpected validation error for <private>',
    fields: {
      error: 'error',
    },
  },
  'internalCapabilitiesProvider.internal.capabilities.provider.not.initialized.5f95d660': {
    message: 'Internal capabilities provider not initialized',
    fields: {},
  },
  'internalCapabilitiesProvider.unknown.internal.tool.a138631e': {
    message: 'Unknown internal tool: <private>',
    fields: {},
  },
  'lazyLoadingOrchestrator.completed.capability.snapshot.published.refreshing.tool.registry.45a92b60': {
    message: 'Completed capability snapshot published, refreshing tool registry',
    fields: {},
  },
  'lazyLoadingOrchestrator.failed.to.refresh.tool.registry.after.capability.publication.e9fa75b7': {
    message: 'Failed to refresh tool registry after capability publication',
    fields: {
      error: 'error',
    },
  },
  'lazyLoadingOrchestrator.lazyloadingorchestrator.already.initialized.f99932cd': {
    message: 'LazyLoadingOrchestrator already initialized',
    fields: {},
  },
  'lazyLoadingOrchestrator.lazyloadingorchestrator.initialized.with.tools.241342ee': {
    message: 'LazyLoadingOrchestrator initialized with <private> tools',
    fields: {},
  },
  'lazyLoadingOrchestrator.lazyloadingorchestrator.initialized.in.full.mode.disabled.b540cc45': {
    message: 'LazyLoadingOrchestrator initialized in full mode (disabled)',
    fields: {},
  },
  'lazyLoadingOrchestrator.failed.to.rebuild.stale.tool.registry.e3259fed': {
    message: 'Failed to rebuild stale tool registry',
    fields: {
      error: 'error',
    },
  },
  'lazyLoadingOrchestrator.invalid.pattern.in.preload.configuration.0be109eb': {
    message: 'Invalid pattern in preload configuration',
    fields: {
      error: 'error',
    },
  },
  'lazyLoadingOrchestrator.no.tools.matched.preload.patterns.b01649c3': {
    message: 'No tools matched preload patterns',
    fields: {},
  },
  'lazyLoadingOrchestrator.preloading.tools.d9e5a23c': {
    message: 'Preloading <private> tools',
    fields: {},
  },
  'lazyLoadingOrchestrator.preloaded.tool.schemas.83afb0f7': {
    message: 'Preloaded <private> tool schemas',
    fields: {},
  },
  'lazyLoadingOrchestrator.no.tools.to.preload.0f255fe3': {
    message: 'No tools to preload',
    fields: {},
  },
  'lazyLoadingOrchestrator.preloading.specific.tools.5316dabc': {
    message: 'Preloading <private> specific tools',
    fields: {},
  },
  'lazyLoadingOrchestrator.logstatistics.diagnostic.f3e28cfb': {
    message: 'logStatistics diagnostic',
    fields: {},
  },
  'metaToolProvider.error.in.tool.list.meta.tool.eff4b338': {
    message: 'Error in tool_list meta-tool',
    fields: {},
  },
  'metaToolProvider.error.in.tool.schema.meta.tool.4ec3a241': {
    message: 'Error in tool_schema meta-tool',
    fields: {},
  },
  'metaToolProvider.meta.tool.invocation.failed.aaeb1f9d': {
    message: 'Meta-tool invocation failed',
    fields: {
      error: 'error',
    },
  },
  'schemaCache.evicted.oldest.cache.entry.c2dbf641': {
    message: 'Evicted oldest cache entry: <private>',
    fields: {},
  },
  'schemaCache.cache.hit.77e8d34e': {
    message: 'Cache hit: <private>',
    fields: {},
  },
  'schemaCache.cache.entry.expired.a16e883b': {
    message: 'Cache entry expired: <private>',
    fields: {},
  },
  'schemaCache.loaded.and.cached.88beceec': {
    message: 'Loaded and cached: <private>',
    fields: {},
  },
  'schemaCache.manually.cached.8852f2e0': {
    message: 'Manually cached: <private>',
    fields: {},
  },
  'schemaCache.cleared.tool.schemas.from.cache.7851056d': {
    message: 'Cleared <private> tool schemas from cache',
    fields: {},
  },
  'schemaCache.logstats.diagnostic.70e920b8': {
    message: 'logStats diagnostic',
    fields: {},
  },
  'schemaCache.preloading.tool.schemas.6330dc45': {
    message: 'Preloading <private> tool schemas',
    fields: {},
  },
  'schemaCache.failed.to.preload.tool.schema.2e407572': {
    message: 'Failed to preload tool schema <private>:<private>: <private>',
    fields: {},
  },
  'schemaCache.preload.completed.with.failures.out.of.tools.8c2ef121': {
    message: 'Preload completed with <private> failures out of <private> tools',
    fields: {},
  },
  'schemaCache.preloaded.tool.schemas.cache.size.49445ca5': {
    message: 'Preloaded <private> tool schemas, cache size: <private>',
    fields: {},
  },
  'toolRegistry.capabilities.excluded.from.catalog.by.quarantine.06fb2156': {
    message: 'Capabilities excluded from catalog by quarantine',
    fields: {},
  },
  'toolRegistry.invalid.pattern.regex.in.tool.filter.10735435': {
    message: 'Invalid pattern regex in tool filter',
    fields: {
      error: 'error',
    },
  },
  'toolRegistry.cursor.does.not.match.current.filters.resetting.to.first.page.c7cc0a9f': {
    message: 'Cursor does not match current filters, resetting to first page',
    fields: {},
  },
  'toolRegistry.failed.to.decode.cursor.961a9ed1': {
    message: 'Failed to decode cursor: <private>',
    fields: {
      error: 'error',
    },
  },
  'postAuthOAuthRecovery.failed.to.publish.oauth.recovery.state.for.5048637c': {
    message: 'Failed to publish OAuth recovery state for <private>',
    fields: {
      error: 'error',
    },
  },
  'postAuthOAuthRecovery.failed.to.close.unauthorized.client.febffa37': {
    message: 'Failed to close unauthorized client <private>',
    fields: {
      error: 'error',
    },
  },
  'postAuthOAuthRecovery.oauth.reauthorization.required.for.after.authenticated.request.returned.401.87746f61': {
    message: 'OAuth reauthorization required for <private> after authenticated request returned 401',
    fields: {},
  },
  'configChangeHandler.failed.to.apply.configuration.changes.c04a8608': {
    message: 'Failed to apply configuration changes',
    fields: {
      error: 'error',
    },
  },
  'configChangeHandler.failed.to.apply.runtime.scope.environment.changes.81abbdd0': {
    message: 'Failed to apply Runtime Scope environment changes',
    fields: {
      error: 'error',
    },
  },
  'configChangeHandler.configchangehandler.initialized.f312d3c9': {
    message: 'ConfigChangeHandler initialized',
    fields: {},
  },
  'configChangeHandler.processing.configuration.changes.76003a4f': {
    message: 'Processing <private> configuration changes',
    fields: {},
  },
  'configChangeHandler.failed.to.process.change.for.server.ba4a3660': {
    message: 'Failed to process change for server <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'configChangeHandler.failed.to.reload.templates.after.runtime.scope.environment.change.ac9ce5e9': {
    message: 'Failed to reload templates after Runtime Scope environment change',
    fields: {
      error: 'error',
    },
  },
  'configChangeHandler.skipping.template.reconciliation.because.the.declared.configuration.is.inva.f0aafc7d': {
    message: 'Skipping template reconciliation because the declared configuration is invalid',
    fields: {},
  },
  'configChangeHandler.processing.change.for.server.ea2503b1': {
    message: 'Processing <private> change for server <private>',
    fields: {},
  },
  'configChangeHandler.skipping.added.server.server.configuration.is.missing.after.reload.76945545': {
    message: 'Skipping added server <private>: server configuration is missing after reload',
    fields: {},
  },
  'configChangeHandler.skipping.modified.server.server.configuration.is.missing.after.reload.7b99998e': {
    message: 'Skipping modified server <private>: server configuration is missing after reload',
    fields: {},
  },
  'configChangeHandler.unknown.change.type.c3ca2270': {
    message: 'Unknown change type: <private>',
    fields: {},
  },
  'configChangeHandler.starting.new.server.9b90716d': {
    message: 'Starting new server: <private>',
    fields: {},
  },
  'configChangeHandler.stopping.server.2e863e16': {
    message: 'Stopping server: <private>',
    fields: {},
  },
  'configChangeHandler.stopping.server.disabled.f7c2723e': {
    message: 'Stopping server (disabled): <private>',
    fields: {},
  },
  'configChangeHandler.starting.server.re.enabled.c42cea8d': {
    message: 'Starting server (re-enabled): <private>',
    fields: {},
  },
  'configChangeHandler.restarting.server.functional.changes.b0a6f31f': {
    message: 'Restarting server (functional changes): <private>',
    fields: {},
  },
  'configChangeHandler.updating.server.metadata.only.no.restart.needed.519c8615': {
    message: 'Updating server metadata only (no restart needed): <private>',
    fields: {},
  },
  'configChangeHandler.updating.metadata.for.server.cb80b3e8': {
    message: 'Updating metadata for server <private>',
    fields: {},
  },
  'configChangeHandler.successfully.updated.metadata.for.server.6116c209': {
    message: 'Successfully updated metadata for server <private>',
    fields: {},
  },
  'configChangeHandler.failed.to.update.metadata.for.server.56841692': {
    message: 'Failed to update metadata for server <private>:',
    fields: {
      error: 'error',
    },
  },
  'configChangeHandler.successfully.updated.metadata.in.servermanager.for.server.4a7bf709': {
    message: 'Successfully updated metadata in ServerManager for server <private>',
    fields: {},
  },
  'configChangeHandler.failed.to.update.server.metadata.in.servermanager.for.48d0cff4': {
    message: 'Failed to update server metadata in ServerManager for <private>:',
    fields: {
      error: 'error',
    },
  },
  'configChangeHandler.updated.outbound.connection.metadata.for.server.bb5d2dc5': {
    message: 'Updated outbound connection metadata for server <private>',
    fields: {},
  },
  'configChangeHandler.failed.to.update.outbound.connection.metadata.for.a4a71b6b': {
    message: 'Failed to update outbound connection metadata for <private>:',
    fields: {
      error: 'error',
    },
  },
  'configChangeHandler.failed.to.notify.clients.of.metadata.change.for.73b5b124': {
    message: 'Failed to notify clients of metadata change for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'configChangeHandler.client.notifications.disabled.skipping.listchanged.notifications.9b90cbc2': {
    message: 'Client notifications disabled, skipping listChanged notifications',
    fields: {},
  },
  'configChangeHandler.sending.listchanged.notifications.to.clients.a8865155': {
    message: 'Sending listChanged notifications to clients',
    fields: {},
  },
  'configChangeHandler.failed.to.send.listchanged.notification.for.session.26cbafe5': {
    message: 'Failed to send listChanged notification for session <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'configChangeHandler.failed.to.send.listchanged.notifications.2b1028b3': {
    message: 'Failed to send listChanged notifications: <private>',
    fields: {
      error: 'error',
    },
  },
  'configChangeHandler.configchangehandler.stopped.6b441a59': {
    message: 'ConfigChangeHandler stopped',
    fields: {},
  },
  'globalContextManager.globalcontextmanager.is.already.initialized.49f1fa01': {
    message: 'GlobalContextManager is already initialized',
    fields: {},
  },
  'globalContextManager.globalcontextmanager.initialized.with.context.0f1bf2da': {
    message: 'GlobalContextManager initialized with context: <private> (<private>)',
    fields: {},
  },
  'globalContextManager.globalcontextmanager.initialized.without.context.5955c783': {
    message: 'GlobalContextManager initialized without context',
    fields: {},
  },
  'globalContextManager.context.updated.82bba4bc': {
    message: 'Context updated: <private> (<private>)',
    fields: {},
  },
  'globalContextManager.error.in.listener.247420ba': {
    message: 'Error in <private> listener:',
    fields: {
      error: 'error',
    },
  },
  'globalContextManager.context.cleared.7ea81849': {
    message: 'Context cleared',
    fields: {},
  },
  'clientFiltering.no.clients.found.matching.tags.efabd164': {
    message: 'No clients found matching tags: <private>',
    fields: {},
  },
  'clientFiltering.found.clients.matching.tags.8f0d8fc9': {
    message: 'Found <private> clients matching tags: <private>',
    fields: {},
  },
  'clientFiltering.no.clients.found.matching.capabilities.75ce4ab3': {
    message: 'No clients found matching capabilities: <private>',
    fields: {},
  },
  'clientFiltering.found.clients.matching.capabilities.1a19e976': {
    message: 'Found <private> clients matching capabilities: <private>',
    fields: {},
  },
  'clientFiltering.filterclients.starting.with.clients.217d7452': {
    message: 'filterClients: Starting with <private> clients',
    fields: {
      filterCount: 'number',
    },
  },
  'clientFiltering.filterclients.filter.reduced.clients.from.to.0ecf1f7d': {
    message: 'filterClients: Filter <private> reduced clients from <private> to <private>',
    fields: {},
  },
  'clientFiltering.filterclients.final.result.has.clients.48240deb': {
    message: 'filterClients: Final result has <private> clients',
    fields: {},
  },
  'clientFiltering.bycapabilities.filtering.for.capabilities.5aa9f27d': {
    message: 'byCapabilities: Filtering for capabilities: <private>',
    fields: {},
  },
  'clientFiltering.bycapabilities.client.4b06a55f': {
    message: 'byCapabilities: Client <private>',
    fields: {},
  },
  'clientFiltering.bytags.filtering.for.tags.6b4e9940': {
    message: 'byTags: Filtering for tags: <private>',
    fields: {},
  },
  'clientFiltering.bytags.no.tags.specified.returning.all.clients.4dba46f9': {
    message: 'byTags: No tags specified, returning all clients',
    fields: {},
  },
  'clientFiltering.bytags.client.5d287ddb': {
    message: 'byTags: Client <private>',
    fields: {},
  },
  'clientFiltering.bytagexpression.filtering.with.expression.dfc5da28': {
    message: 'byTagExpression: Filtering with expression: <private>',
    fields: {},
  },
  'clientFiltering.bytagexpression.client.9d7a0de8': {
    message: 'byTagExpression: Client <private>',
    fields: {},
  },
  'clientTemplateTracker.clienttemplatetracker.addclienttemplate.adding.client.to.template.3b944b87': {
    message: 'ClientTemplateTracker.addClientTemplate: Adding client <private> to template <private>:<private>',
    fields: {
      clientId: 'identity:client',
    },
  },
  'clientTemplateTracker.clienttemplatetracker.addclienttemplate.added.relationship.6e3cc259': {
    message: 'ClientTemplateTracker.addClientTemplate: Added relationship',
    fields: {
      clientCount: 'number',
      referenceCount: 'number',
    },
  },
  'clientTemplateTracker.clienttemplatetracker.removeclient.removing.client.f6a946c8': {
    message: 'ClientTemplateTracker.removeClient: Removing client <private>',
    fields: {
      clientId: 'identity:client',
    },
  },
  'clientTemplateTracker.clienttemplatetracker.removeclient.no.relationships.found.for.client.16c74540': {
    message: 'ClientTemplateTracker.removeClient: No relationships found for client <private>',
    fields: {},
  },
  'clientTemplateTracker.clienttemplatetracker.removeclient.removed.client.from.instance.58d9bdb7': {
    message: 'ClientTemplateTracker.removeClient: Removed client from instance <private>',
    fields: {
      referenceCount: 'number',
    },
  },
  'clientTemplateTracker.clienttemplatetracker.removeclient.client.removal.completed.5ff8e26e': {
    message: 'ClientTemplateTracker.removeClient: Client <private> removal completed',
    fields: {},
  },
  'clientTemplateTracker.clienttemplatetracker.removeclientfrominstance.removed.client.from.e7cd2997': {
    message: 'ClientTemplateTracker.removeClientFromInstance: Removed client <private> from <private>',
    fields: {
      referenceCount: 'number',
    },
  },
  'clientTemplateTracker.clienttemplatetracker.cleanupinstance.cleaned.up.instance.43a082e0': {
    message: 'ClientTemplateTracker.cleanupInstance: Cleaned up instance <private>',
    fields: {},
  },
  'filterCache.filtercache.getorparseexpression.cache.hit.for.expression.97482bac': {
    message: 'FilterCache.getOrParseExpression: Cache hit for expression: <private>',
    fields: {
      accessCount: 'number',
    },
  },
  'filterCache.filtercache.getorparseexpression.parsed.and.cached.expression.1b592373': {
    message: 'FilterCache.getOrParseExpression: Parsed and cached expression: <private>',
    fields: {},
  },
  'filterCache.filtercache.getorparseexpression.failed.to.parse.expression.791a4828': {
    message: 'FilterCache.getOrParseExpression: Failed to parse expression: <private>',
    fields: {
      error: 'error',
    },
  },
  'filterCache.filtercache.getcachedresults.cache.hit.for.key.55c01014': {
    message: 'FilterCache.getCachedResults: Cache hit for key: <private>',
    fields: {
      resultCount: 'number',
      accessCount: 'number',
    },
  },
  'filterCache.filtercache.setcachedresults.cached.results.for.key.f6cc34cf': {
    message: 'FilterCache.setCachedResults: Cached results for key: <private>',
    fields: {
      resultCount: 'number',
    },
  },
  'filterCache.filtercache.clearexpired.cleared.expired.entries.1698e9ef': {
    message: 'FilterCache.clearExpired: Cleared <private> expired entries',
    fields: {
      expiredCount: 'number',
    },
  },
  'filterCache.filtercache.clear.cleared.all.cache.entries.788c852b': {
    message: 'FilterCache.clear: Cleared all cache entries',
    fields: {},
  },
  'filterCache.filtercache.warmup.warming.up.cache.with.expressions.5008759d': {
    message: 'FilterCache.warmup: Warming up cache with <private> expressions',
    fields: {
      expressionCount: 'number',
    },
  },
  'filterCache.filtercache.warmup.warmup.completed.expressions.cached.611395cd': {
    message: 'FilterCache.warmup: Warmup completed, <private> expressions cached',
    fields: {},
  },
  'filteringService.filteringservice.filtering.connections.0b15644d': {
    message: 'FilteringService: Filtering connections',
    fields: {},
  },
  'filteringService.filteringservice.connected.clients.4f0827db': {
    message: 'FilteringService: Connected clients',
    fields: {
      connectedCount: 'number',
    },
  },
  'filteringService.filteringservice.no.filtering.specified.returning.all.connected.clients.c197a274': {
    message: 'FilteringService: No filtering specified, returning all connected clients',
    fields: {},
  },
  'filteringService.filteringservice.filtering.completed.e2b35696': {
    message: 'FilteringService: Filtering completed',
    fields: {
      filteredCount: 'number',
    },
  },
  'filteringService.filteringservice.bytags.filtering.for.tags.1d7c85c5': {
    message: 'FilteringService.byTags: Filtering for tags: <private>',
    fields: {},
  },
  'filteringService.filteringservice.bytags.no.tags.specified.returning.all.connections.718dca0c': {
    message: 'FilteringService.byTags: No tags specified, returning all connections',
    fields: {},
  },
  'filteringService.filteringservice.bytags.connection.87681228': {
    message: 'FilteringService.byTags: Connection <private>',
    fields: {},
  },
  'filteringService.filteringservice.bytagexpression.filtering.with.expression.edcca341': {
    message: 'FilteringService.byTagExpression: Filtering with expression: <private>',
    fields: {},
  },
  'filteringService.filteringservice.bytagexpression.connection.782bff76': {
    message: 'FilteringService.byTagExpression: Connection <private>',
    fields: {},
  },
  'filteringService.filteringservice.bytagquery.filtering.with.tag.query.c1767066': {
    message: 'FilteringService.byTagQuery: Filtering with tag query',
    fields: {},
  },
  'filteringService.filteringservice.bytagquery.connection.matches.query.9a48d2c4': {
    message: 'FilteringService.byTagQuery: Connection <private> matches query',
    fields: {},
  },
  'filteringService.filteringservice.bytagquery.failed.to.evaluate.query.for.connection.ec67443f': {
    message: 'FilteringService.byTagQuery: Failed to evaluate query for connection <private>',
    fields: {
      error: 'error',
    },
  },
  'filteringService.filteringservice.bycapabilities.filtering.for.capabilities.3676f48d': {
    message: 'FilteringService.byCapabilities: Filtering for capabilities: <private>',
    fields: {},
  },
  'filteringService.filteringservice.bycapabilities.connection.e77084c0': {
    message: 'FilteringService.byCapabilities: Connection <private>',
    fields: {},
  },
  'filteringService.filteringservice.combinefilters.starting.with.connections.bcec49f2': {
    message: 'FilteringService.combineFilters: Starting with <private> connections',
    fields: {
      filterCount: 'number',
    },
  },
  'filteringService.filteringservice.combinefilters.filter.reduced.connections.from.to.d4ebcf5e': {
    message: 'FilteringService.combineFilters: Filter <private> reduced connections from <private> to <private>',
    fields: {},
  },
  'filteringService.filteringservice.combinefilters.final.result.has.connections.b44a70ab': {
    message: 'FilteringService.combineFilters: Final result has <private> connections',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.filtering.templates.2419e4ac': {
    message: 'TemplateFilteringService: Filtering templates',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.filtering.by.preset.e1c2a17b': {
    message: 'TemplateFilteringService: Filtering by preset: <private>',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.using.preset.tag.query.for.filtering.22fe77a8': {
    message: 'TemplateFilteringService: Using preset tag query for filtering',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.no.filtering.specified.returning.all.templates.72b5c81d': {
    message: 'TemplateFilteringService: No filtering specified, returning all templates',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.filtering.completed.33a5ef8e': {
    message: 'TemplateFilteringService: Filtering completed',
    fields: {
      originalCount: 'number',
      filteredCount: 'number',
      removedCount: 'number',
    },
  },
  'templateFilteringService.templatefilteringservice.bytags.filtering.for.tags.9f2765ca': {
    message: 'TemplateFilteringService.byTags: Filtering for tags: <private>',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.bytags.no.tags.specified.returning.all.templates.5544bcda': {
    message: 'TemplateFilteringService.byTags: No tags specified, returning all templates',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.bytags.template.41ff62f8': {
    message: 'TemplateFilteringService.byTags: Template <private>',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.bypreset.filtering.for.preset.920b4f6f': {
    message: 'TemplateFilteringService.byPreset: Filtering for preset: <private>',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.bypreset.template.5819a00b': {
    message: 'TemplateFilteringService.byPreset: Template <private>',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.bytagexpression.filtering.with.expression.262b994c': {
    message: 'TemplateFilteringService.byTagExpression: Filtering with expression: <private>',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.bytagexpression.failed.to.parse.expression.ff6c19a4': {
    message: 'TemplateFilteringService.byTagExpression: Failed to parse expression: <private>',
    fields: {
      error: 'error',
    },
  },
  'templateFilteringService.templatefilteringservice.bytagexpression.template.d8360e6c': {
    message: 'TemplateFilteringService.byTagExpression: Template <private>',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.bytagquery.filtering.with.tag.query.e9c3aae4': {
    message: 'TemplateFilteringService.byTagQuery: Filtering with tag query',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.bytagquery.template.query.a18b625d': {
    message: 'TemplateFilteringService.byTagQuery: Template <private> <private> query',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.bytagquery.failed.to.evaluate.query.for.template.c9b2438d': {
    message: 'TemplateFilteringService.byTagQuery: Failed to evaluate query for template <private>',
    fields: {
      error: 'error',
    },
  },
  'templateFilteringService.templatefilteringservice.combinefilters.starting.with.templates.75cef24a': {
    message: 'TemplateFilteringService.combineFilters: Starting with <private> templates',
    fields: {
      filterCount: 'number',
    },
  },
  'templateFilteringService.templatefilteringservice.combinefilters.filter.reduced.templates.from.to.9398ece6': {
    message: 'TemplateFilteringService.combineFilters: Filter <private> reduced templates from <private> to <private>',
    fields: {},
  },
  'templateFilteringService.templatefilteringservice.combinefilters.final.result.has.templates.8bbd9345': {
    message: 'TemplateFilteringService.combineFilters: Final result has <private> templates',
    fields: {},
  },
  'templateIndex.templateindex.buildindex.building.index.for.templates.9bec56f8': {
    message: 'TemplateIndex.buildIndex: Building index for <private> templates',
    fields: {
      templateCount: 'number',
    },
  },
  'templateIndex.templateindex.buildindex.index.built.successfully.58026db5': {
    message: 'TemplateIndex.buildIndex: Index built successfully',
    fields: {},
  },
  'templateIndex.templateindex.gettemplatesbytag.index.not.built.returning.empty.result.304ff545': {
    message: 'TemplateIndex.getTemplatesByTag: Index not built, returning empty result',
    fields: {},
  },
  'templateIndex.templateindex.evaluateexpression.index.not.built.returning.empty.result.7afd3f4c': {
    message: 'TemplateIndex.evaluateExpression: Index not built, returning empty result',
    fields: {},
  },
  'templateIndex.templateindex.evaluateexpression.failed.to.parse.expression.637476be': {
    message: 'TemplateIndex.evaluateExpression: Failed to parse expression: <private>',
    fields: {
      error: 'error',
    },
  },
  'templateIndex.templateindex.evaluatetagquery.index.not.built.returning.empty.result.d8bf49a9': {
    message: 'TemplateIndex.evaluateTagQuery: Index not built, returning empty result',
    fields: {},
  },
  'templateIndex.templateindex.evaluatetagquery.failed.to.evaluate.query.for.template.585e54ad': {
    message: 'TemplateIndex.evaluateTagQuery: Failed to evaluate query for template <private>',
    fields: {
      error: 'error',
    },
  },
  'templateIndex.templateindex.evaluateparsedexpression.unknown.expression.type.406f8a9e': {
    message: 'TemplateIndex.evaluateParsedExpression: Unknown expression type: <private>',
    fields: {},
  },
  'templateIndex.templateindex.optimize.index.optimization.completed.ada2c265': {
    message: 'TemplateIndex.optimize: Index optimization completed',
    fields: {},
  },
  'flagManager.flagmanager.initialized.and.watching.for.configuration.changes.ab60391e': {
    message: 'FlagManager initialized and watching for configuration changes',
    fields: {
      categoryCount: 'number',
    },
  },
  'flagManager.flag.changed.from.to.30850216': {
    message: 'Flag changed: <private><private><private> from <private> to <private>',
    fields: {},
  },
  'instructionAggregator.lazy.loading.orchestrator.set.for.instructionaggregator.ebbc1076': {
    message: 'Lazy loading orchestrator set for InstructionAggregator',
    fields: {},
  },
  'instructionAggregator.updated.instructions.for.server.f28421b1': {
    message: 'Updated instructions for server: <private>',
    fields: {
      serverName: 'identity:server',
    },
  },
  'instructionAggregator.removed.instructions.for.server.f565074a': {
    message: 'Removed instructions for server: <private>',
    fields: {
      serverName: 'identity:server',
    },
  },
  'instructionAggregator.instructionaggregator.initialized.c665e431': {
    message: 'InstructionAggregator initialized',
    fields: {},
  },
  'instructionAggregator.instructions.changed.total.servers.with.instructions.00d57195': {
    message: 'Instructions changed. Total servers with instructions: <private>',
    fields: {},
  },
  'instructionAggregator.removed.server.instructions.remaining.servers.f026ca79': {
    message: 'Removed server instructions: <private>. Remaining servers: <private>',
    fields: {},
  },
  'instructionAggregator.instructionaggregator.getting.filtered.instructions.91e6c103': {
    message: 'InstructionAggregator: Getting filtered instructions',
    fields: {},
  },
  'instructionAggregator.instructionaggregator.filtering.applied.bff38756': {
    message: 'InstructionAggregator: Filtering applied',
    fields: {},
  },
  'instructionAggregator.instructionaggregator.trying.custom.template.9186cfd2': {
    message: 'InstructionAggregator: Trying custom template',
    fields: {},
  },
  'instructionAggregator.instructionaggregator.custom.template.failed.falling.back.to.default.templa.33a863b9': {
    message: 'InstructionAggregator: Custom template failed, falling back to default template',
    fields: {
      error: 'error',
    },
  },
  'instructionAggregator.instructionaggregator.managed.template.failed.falling.back.to.built.in.vari.55809495': {
    message: 'InstructionAggregator: Managed template failed, falling back to built-in variant',
    fields: {
      error: 'error',
    },
  },
  'instructionAggregator.cleared.all.server.instructions.ae0bc22b': {
    message: 'Cleared all server instructions',
    fields: {},
  },
  'instructionAggregator.instructionaggregator.compiled.and.cached.new.template.6d692dbd': {
    message: 'InstructionAggregator: Compiled and cached new template',
    fields: {
      variableCount: 'number',
    },
  },
  'instructionAggregator.instructionaggregator.starting.cleanup.b011a99f': {
    message: 'InstructionAggregator: Starting cleanup',
    fields: {},
  },
  'instructionAggregator.instructionaggregator.cleanup.completed.all.listeners.cleared.61adff3f': {
    message: 'InstructionAggregator: Cleanup completed - all listeners cleared',
    fields: {},
  },
  'loadingStateTracker.started.tracking.loading.for.servers.156f137b': {
    message: 'Started tracking loading for <private> servers',
    fields: {},
  },
  'loadingStateTracker.registered.server.for.loading.tracker.e72049be': {
    message: 'Registered server for loading tracker: <private>',
    fields: {},
  },
  'loadingStateTracker.attempted.to.update.unknown.server.7788f6f5': {
    message: 'Attempted to update unknown server: <private>',
    fields: {},
  },
  'loadingStateTracker.server.state.changed.to.ebef067f': {
    message: 'Server <private> state changed to <private><private>',
    fields: {},
  },
  'loadingStateTracker.server.retry.count.40156781': {
    message: 'Server <private> retry count: <private>',
    fields: {},
  },
  'loadingStateTracker.removed.server.from.loading.tracker.b2043257': {
    message: 'Removed server from loading tracker: <private>',
    fields: {},
  },
  'loadingStateTracker.loading.state.tracker.reset.a8410c7a': {
    message: 'Loading state tracker reset',
    fields: {},
  },
  'loadingStateTracker.loading.complete.servers.ready.success.rate.16c0dd6f': {
    message: 'Loading complete: <private>/<private> servers ready (<private>% success rate)',
    fields: {},
  },
  'mcpLoadingManager.no.mcp.servers.to.load.c3b2be31': {
    message: 'No MCP servers to load',
    fields: {},
  },
  'mcpLoadingManager.starting.async.loading.of.mcp.servers.b40171ec': {
    message: 'Starting async loading of <private> MCP servers',
    fields: {},
  },
  'mcpLoadingManager.initial.mcp.loading.failed.e9e56036': {
    message: 'Initial MCP loading failed',
    fields: {},
  },
  'mcpLoadingManager.server.is.disabled.skipping.load.52ad48bb': {
    message: 'Server <private> is disabled, skipping load',
    fields: {},
  },
  'mcpLoadingManager.failed.to.create.transport.for.f5b1976f': {
    message: 'Failed to create transport for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'mcpLoadingManager.no.transport.created.for.possibly.disabled.skipping.30daed4b': {
    message: 'No transport created for <private> (possibly disabled); skipping',
    fields: {},
  },
  'mcpLoadingManager.unloadserver.removeclient.noop.err.022e4e54': {
    message: 'unloadServer: removeClient(<private>) noop/err: <private>',
    fields: {},
  },
  'mcpLoadingManager.unloaded.mcp.server.199f0ce9': {
    message: 'Unloaded MCP server: <private>',
    fields: {},
  },
  'mcpLoadingManager.initial.server.loading.phase.completed.5c61dce3': {
    message: 'Initial server loading phase completed',
    fields: {},
  },
  'mcpLoadingManager.successfully.loaded.mcp.server.retries.30f53981': {
    message: 'Successfully loaded MCP server: <private> (<private> retries)',
    fields: {},
  },
  'mcpLoadingManager.loadsingleserver.operation.cancelled.for.27923175': {
    message: 'loadSingleServer: operation cancelled for <private>',
    fields: {},
  },
  'mcpLoadingManager.oauth.required.for.143d2b37': {
    message: 'OAuth required for <private>',
    fields: {},
  },
  'mcpLoadingManager.failed.to.load.non.retryable.24de04a0': {
    message: 'Failed to load <private>: <private> (non-retryable)',
    fields: {
      error: 'error',
    },
  },
  'mcpLoadingManager.failed.to.load.attempt.5c21425d': {
    message: 'Failed to load <private> (attempt <private>): <private>',
    fields: {
      error: 'error',
    },
  },
  'mcpLoadingManager.retrying.in.ms.6b403f13': {
    message: 'Retrying <private> in <private>ms...',
    fields: {},
  },
  'mcpLoadingManager.failed.to.load.with.a.non.retryable.error.continuing.with.other.servers.487a4944': {
    message: 'Failed to load <private> with a non-retryable error, continuing with other servers',
    fields: {},
  },
  'mcpLoadingManager.failed.to.load.after.retries.continuing.with.other.servers.0ff6dccb': {
    message: 'Failed to load <private> after <private> retries, continuing with other servers',
    fields: {},
  },
  'mcpLoadingManager.background.retry.enabled.for.failed.servers.b0bcb89b': {
    message: 'Background retry enabled for failed servers',
    fields: {},
  },
  'mcpLoadingManager.background.retry.for.failed.servers.8ac42468': {
    message: 'Background retry for <private> failed servers',
    fields: {},
  },
  'mcpLoadingManager.background.retry.failed.for.f7ebe05f': {
    message: 'Background retry failed for <private>: <private>',
    fields: {},
  },
  'mcpLoadingManager.could.not.extract.authorization.url.for.f0455b11': {
    message: 'Could not extract authorization URL for <private>: <private>',
    fields: {},
  },
  'mcpLoadingManager.no.active.loading.operation.found.for.server.8ff2171e': {
    message: 'No active loading operation found for server: <private>',
    fields: {},
  },
  'mcpLoadingManager.cancelling.loading.of.server.c6875d4d': {
    message: 'Cancelling loading of server: <private>',
    fields: {},
  },
  'mcpLoadingManager.cancelling.loading.of.servers.eaed33b5': {
    message: 'Cancelling loading of <private> servers',
    fields: {},
  },
  'mcpLoadingManager.mcp.loading.manager.shutdown.complete.995e246f': {
    message: 'MCP loading manager shutdown complete',
    fields: {},
  },
  'parallelExecutor.failed.to.process.item.in.parallel.execution.e51696a2': {
    message: 'Failed to process item in parallel execution: <private>',
    fields: {
      error: 'error',
    },
  },
  'notificationManager.client.notifications.are.globally.disabled.skipping.capability.change.notif.ea3cab66': {
    message: 'Client notifications are globally disabled, skipping capability change notifications',
    fields: {},
  },
  'notificationManager.no.capability.changes.detected.skipping.notifications.9fd8c6a7': {
    message: 'No capability changes detected, skipping notifications',
    fields: {},
  },
  'notificationManager.handling.capability.changes.tools.resources.prompts.8e887fc2': {
    message: 'Handling capability changes: tools=<private>, resources=<private>, prompts=<private>',
    fields: {},
  },
  'notificationManager.scheduled.batched.notifications.to.be.sent.in.ms.c0439ae6': {
    message: 'Scheduled batched notifications to be sent in <private>ms',
    fields: {
      delayMs: 'number',
    },
  },
  'notificationManager.sent.batched.listchanged.notifications.f6c2e7de': {
    message: 'Sent batched listChanged notifications: [<private>]',
    fields: {},
  },
  'notificationManager.cannot.send.listchanged.notification.server.not.connected.48052ee3': {
    message: 'Cannot send <private> listChanged notification - server not connected',
    fields: {},
  },
  'notificationManager.sent.listchanged.notification.to.client.dca498ab': {
    message: 'Sent <private> listChanged notification to client',
    fields: {},
  },
  'notificationManager.failed.to.send.listchanged.notification.1bc97c1f': {
    message: 'Failed to send <private> listChanged notification: <private>',
    fields: {},
  },
  'notificationManager.client.connection.lost.during.notification.sending.a2a42f8d': {
    message: 'Client connection lost during notification sending',
    fields: {},
  },
  'notificationManager.notificationmanager.configuration.updated.cb79b63c': {
    message: 'NotificationManager configuration updated',
    fields: {},
  },
  'notificationManager.notificationmanager.shutdown.complete.9fe87097': {
    message: 'NotificationManager shutdown complete',
    fields: {},
  },
  'TemplateServerAdapter.templateserveradapter.no.sessionid.provided.in.context.3f3a2fab': {
    message: 'TemplateServerAdapter: No sessionId provided in context',
    fields: {
      serverName: 'identity:server',
    },
  },
  'TemplateServerAdapter.templateserveradapter.no.connection.found.for.template.server.5614d119': {
    message: 'TemplateServerAdapter: No connection found for template server',
    fields: {
      serverName: 'identity:server',
      sessionId: 'identity:session',
    },
  },
  'connectionResolver.failed.to.get.rendered.hash.for.template.connection.lookup.efcf33df': {
    message: 'Failed to get rendered hash for template connection lookup',
    fields: {
      sessionId: 'identity:session',
      error: 'error',
    },
  },
  'connectionResolver.invalid.connection.key.format.expected.clean.name.or.exactly.one.colon.deli.dc9d4e0b': {
    message: 'Invalid connection key format: expected clean name or exactly one colon delimiter',
    fields: {},
  },
  'connectionResolver.failed.to.get.rendered.hash.while.filtering.connections.for.session.2401fe74': {
    message: 'Failed to get rendered hash while filtering connections for session',
    fields: {
      sessionId: 'identity:session',
      error: 'error',
    },
  },
  'connectionResolver.failed.to.get.rendered.hashes.while.filtering.connections.for.session.c8c80565': {
    message: 'Failed to get rendered hashes while filtering connections for session',
    fields: {
      sessionId: 'identity:session',
      error: 'error',
    },
  },
  'pidFileManager.pid.file.written.41a5471a': {
    message: 'PID file written: <private>',
    fields: {},
  },
  'pidFileManager.failed.to.write.pid.file.a3c738c2': {
    message: 'Failed to write PID file: <private>',
    fields: {
      error: 'error',
    },
  },
  'pidFileManager.pid.file.present.but.unreadable.cddec101': {
    message: 'PID file present but unreadable (<private>): <private>',
    fields: {
      error: 'error',
    },
  },
  'pidFileManager.invalid.pid.file.format.d7ae7117': {
    message: 'Invalid PID file format (<private>): <private>',
    fields: {},
  },
  'pidFileManager.pid.file.cleaned.up.b559389a': {
    message: 'PID file cleaned up: <private>',
    fields: {},
  },
  'pidFileManager.failed.to.cleanup.pid.file.f7696569': {
    message: 'Failed to cleanup PID file: <private>',
    fields: {
      error: 'error',
    },
  },
  'runtimeLifecycle.discoverscopedruntime.diagnostic.ef8b70e8': {
    message: 'discoverScopedRuntime diagnostic',
    fields: {
      error: 'error',
    },
  },
  'runtimeLifecycle.pid.file.points.to.dead.process.pid.removing.stale.pid.file.6a7b9b92': {
    message: 'PID file points to dead process (PID: <private>); removing stale PID file',
    fields: {},
  },
  'runtimeScopeOwnership.runtime.ownership.candidate.cleanup.failed.f3f3f24d': {
    message: 'Runtime ownership candidate cleanup failed (<private>): <private>',
    fields: {
      error: 'error',
    },
  },
  'templateConfigurationManager.template.processing.temporarily.disabled.due.to.repeated.failures.b2ad37a7': {
    message: 'Template processing temporarily disabled due to repeated failures',
    fields: {},
  },
  'templateConfigurationManager.template.reprocessing.completed.with.errors.bd10403a': {
    message: 'Template reprocessing completed with <private> errors:',
    fields: {},
  },
  'templateConfigurationManager.reprocessed.template.servers.with.new.context.8b389171': {
    message: 'Reprocessed <private> template servers with new context',
    fields: {},
  },
  'templateConfigurationManager.failed.to.reprocess.templates.with.new.context.b78012e6': {
    message: 'Failed to reprocess templates with new context (<private>/<private>):',
    fields: {
      error: 'error',
    },
  },
  'templateConfigurationManager.template.processing.disabled.due.to.consecutive.failures.cf9104c7': {
    message: 'Template processing disabled due to <private> consecutive failures',
    fields: {
      error: 'error',
    },
  },
  'templateConfigurationManager.template.processing.re.enabled.after.timeout.53c73a3e': {
    message: 'Template processing re-enabled after timeout',
    fields: {},
  },
  'templateConfigurationManager.successfully.updated.server.d3792672': {
    message: 'Successfully updated server: <private>',
    fields: {},
  },
  'templateConfigurationManager.failed.to.update.server.d4020326': {
    message: 'Failed to update server <private>:',
    fields: {
      error: 'error',
    },
  },
  'templateConfigurationManager.stopping.server.no.longer.in.configuration.206a3906': {
    message: 'Stopping server no longer in configuration: <private>',
    fields: {},
  },
  'templateConfigurationManager.restarting.server.with.updated.configuration.6c6d6977': {
    message: 'Restarting server with updated configuration: <private>',
    fields: {},
  },
  'templateConfigurationManager.starting.new.server.d11f5171': {
    message: 'Starting new server: <private>',
    fields: {},
  },
  'templateConfigurationManager.circuit.breaker.reset.template.processing.re.enabled.19a7d7e5': {
    message: 'Circuit breaker reset - template processing re-enabled',
    fields: {},
  },
  'registryHandler.processing.get.registry.status.request.e955f68b': {
    message: 'Processing get_registry_status request',
    fields: {},
  },
  'registryHandler.registry.status.retrieved.successfully.90b05297': {
    message: 'Registry status retrieved successfully',
    fields: {},
  },
  'searchHandler.processing.search.mcp.servers.request.c9abe536': {
    message: 'Processing search_mcp_servers request',
    fields: {},
  },
  'searchHandler.found.servers.matching.search.criteria.84faa199': {
    message: 'Found <private> servers matching search criteria',
    fields: {},
  },
  'serverManagementHandler.handleinstallmcpserver.diagnostic.57984dd1': {
    message: 'handleInstallMCPServer diagnostic',
    fields: {},
  },
  'serverManagementHandler.mcp.server.added.to.configuration.b73ab254': {
    message: 'MCP server added to configuration',
    fields: {
      serverName: 'identity:server',
    },
  },
  'serverManagementHandler.mcp.server.removed.from.configuration.ab2a57e1': {
    message: 'MCP server removed from configuration',
    fields: {
      serverName: 'identity:server',
    },
  },
  'serverManagementHandler.mcp.server.configuration.updated.74d96044': {
    message: 'MCP server configuration updated',
    fields: {
      serverName: 'identity:server',
    },
  },
  'serverManagementHandler.mcp.server.enabled.608ba8f9': {
    message: 'MCP server enabled',
    fields: {
      serverName: 'identity:server',
    },
  },
  'serverManagementHandler.mcp.server.disabled.a8cc95d6': {
    message: 'MCP server disabled',
    fields: {
      serverName: 'identity:server',
    },
  },
  'serverManagementHandler.reload.operation.requested.5d2c1ff7': {
    message: 'Reload operation requested',
    fields: {},
  },
  'serverManagementHandler.restarting.server.f83b9622': {
    message: 'Restarting server: <private>',
    fields: {},
  },
  'serverManagementHandler.failed.to.restart.server.75045aa2': {
    message: 'Failed to restart server <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'showHandler.processing.show.mcp.server.request.9e99dce7': {
    message: 'Processing show_mcp_server request',
    fields: {},
  },
  'showHandler.successfully.fetched.server.details.for.c555d231': {
    message: 'Successfully fetched server details for: <private>',
    fields: {},
  },
  'versionsHandler.processing.list.mcp.server.versions.request.42d0b98c': {
    message: 'Processing list_mcp_server_versions request',
    fields: {},
  },
  'versionsHandler.successfully.fetched.versions.for.d9069ff0': {
    message: 'Successfully fetched <private> versions for: <private>',
    fields: {},
  },
  'discoveryAdapter.adapter.searching.servers.in.registry.ee1ac44f': {
    message: 'Adapter: Searching servers in registry',
    fields: {},
  },
  'discoveryAdapter.registry.search.failed.1fecc7fb': {
    message: 'Registry search failed',
    fields: {
      error: 'error',
    },
  },
  'discoveryAdapter.adapter.getting.server.by.id.from.registry.54161885': {
    message: 'Adapter: Getting server by ID from registry',
    fields: {},
  },
  'discoveryAdapter.registry.get.server.failed.d571a1d0': {
    message: 'Registry get server failed',
    fields: {
      error: 'error',
    },
  },
  'discoveryAdapter.adapter.getting.registry.status.e84bf5f0': {
    message: 'Adapter: Getting registry status',
    fields: {},
  },
  'discoveryAdapter.registry.status.check.failed.445d98cb': {
    message: 'Registry status check failed',
    fields: {
      error: 'error',
    },
  },
  'discoveryAdapter.adapter.discovering.installed.apps.d997f6b6': {
    message: 'Adapter: Discovering installed apps',
    fields: {},
  },
  'discoveryAdapter.app.discovery.failed.966f8a82': {
    message: 'App discovery failed',
    fields: {
      error: 'error',
    },
  },
  'discoveryAdapter.adapter.discovering.app.configs.b3ecb728': {
    message: 'Adapter: Discovering app configs',
    fields: {},
  },
  'discoveryAdapter.app.config.discovery.failed.87c4904c': {
    message: 'App config discovery failed',
    fields: {
      error: 'error',
    },
  },
  'discoveryAdapter.adapter.checking.app.consolidation.status.09a6a361': {
    message: 'Adapter: Checking app consolidation status',
    fields: {},
  },
  'discoveryAdapter.app.consolidation.status.check.failed.6bd497dd': {
    message: 'App consolidation status check failed',
    fields: {
      error: 'error',
    },
  },
  'directInstallation.adapter.starting.direct.package.installation.a906f46c': {
    message: 'Adapter: Starting direct package installation',
    fields: {
      serverName: 'identity:server',
    },
  },
  'directInstallation.direct.package.installation.error.8b2fff9e': {
    message: 'Direct package installation error',
    fields: {
      serverName: 'identity:server',
      error: 'error',
    },
  },
  'packageResolver.adapter.trying.organization.search.67ea0532': {
    message: 'Adapter: Trying organization search',
    fields: {},
  },
  'packageResolver.adapter.trying.server.component.search.09ff5656': {
    message: 'Adapter: Trying server component search',
    fields: {},
  },
  'packageResolver.adapter.resolved.package.to.registry.server.40d09eb5': {
    message: 'Adapter: Resolved package to registry server',
    fields: {
      serverName: 'identity:server',
    },
  },
  'packageResolver.adapter.using.package.name.as.server.id.881107c3': {
    message: 'Adapter: Using package name as server ID',
    fields: {
      serverName: 'identity:server',
    },
  },
  'packageResolver.adapter.package.search.failed.using.original.server.name.997cc88b': {
    message: 'Adapter: Package search failed, using original server name',
    fields: {
      serverName: 'identity:server',
      error: 'error',
    },
  },
  'installationAdapter.adapter.installing.server.9d3fee6f': {
    message: 'Adapter: Installing server',
    fields: {
      serverName: 'identity:server',
    },
  },
  'installationAdapter.server.installation.failed.a296db17': {
    message: 'Server installation failed',
    fields: {
      error: 'error',
      serverName: 'identity:server',
    },
  },
  'installationAdapter.adapter.uninstalling.server.a0a8506b': {
    message: 'Adapter: Uninstalling server',
    fields: {
      serverName: 'identity:server',
    },
  },
  'installationAdapter.removed.server.from.configuration.31fddd83': {
    message: 'Removed server <private> from configuration',
    fields: {},
  },
  'installationAdapter.server.not.found.in.configuration.7057fa2c': {
    message: 'Server <private> not found in configuration',
    fields: {},
  },
  'installationAdapter.failed.to.remove.server.from.configuration.fc087b27': {
    message: 'Failed to remove server from configuration',
    fields: {
      error: 'error',
      serverName: 'identity:server',
    },
  },
  'installationAdapter.server.uninstallation.failed.6af2a149': {
    message: 'Server uninstallation failed',
    fields: {
      error: 'error',
      serverName: 'identity:server',
    },
  },
  'installationAdapter.adapter.updating.server.64ff33b4': {
    message: 'Adapter: Updating server',
    fields: {
      serverName: 'identity:server',
    },
  },
  'installationAdapter.server.update.failed.bdba3e5f': {
    message: 'Server update failed',
    fields: {
      error: 'error',
      serverName: 'identity:server',
    },
  },
  'installationAdapter.adapter.listing.installed.servers.12797994': {
    message: 'Adapter: Listing installed servers',
    fields: {},
  },
  'installationAdapter.server.listing.failed.17ff87f1': {
    message: 'Server listing failed',
    fields: {
      error: 'error',
    },
  },
  'installationAdapter.adapter.validating.tags.e150fb3f': {
    message: 'Adapter: Validating tags',
    fields: {},
  },
  'installationAdapter.tag.validation.failed.c796a389': {
    message: 'Tag validation failed',
    fields: {
      error: 'error',
    },
  },
  'installationAdapter.adapter.parsing.tags.37a9512d': {
    message: 'Adapter: Parsing tags',
    fields: {},
  },
  'installationAdapter.tag.parsing.failed.3eb5e4b5': {
    message: 'Tag parsing failed',
    fields: {
      error: 'error',
    },
  },
  'installationAdapter.adapter.getting.server.metadata.3d140a30': {
    message: 'Adapter: Getting server metadata',
    fields: {
      serverName: 'identity:server',
    },
  },
  'installationAdapter.failed.to.get.server.metadata.72219710': {
    message: 'Failed to get server metadata',
    fields: {
      error: 'error',
      serverName: 'identity:server',
    },
  },
  'installationAdapter.adapter.checking.for.updates.9ccc1c52': {
    message: 'Adapter: Checking for updates',
    fields: {},
  },
  'installationAdapter.update.check.failed.fde5c6b2': {
    message: 'Update check failed',
    fields: {
      error: 'error',
    },
  },
  'managementAdapter.adapter.listing.servers.edbf3728': {
    message: 'Adapter: Listing servers',
    fields: {},
  },
  'managementAdapter.server.listing.failed.0dc16e3f': {
    message: 'Server listing failed',
    fields: {
      error: 'error',
    },
  },
  'managementAdapter.adapter.getting.server.status.716f48b0': {
    message: 'Adapter: Getting server status',
    fields: {
      serverName: 'identity:server',
    },
  },
  'managementAdapter.server.status.check.failed.1a469764': {
    message: 'Server status check failed',
    fields: {
      error: 'error',
    },
  },
  'managementAdapter.adapter.enabling.server.c13276d8': {
    message: 'Adapter: Enabling server',
    fields: {
      serverName: 'identity:server',
    },
  },
  'managementAdapter.server.enable.failed.185d648b': {
    message: 'Server enable failed',
    fields: {
      error: 'error',
      serverName: 'identity:server',
    },
  },
  'managementAdapter.adapter.disabling.server.b9bc9ead': {
    message: 'Adapter: Disabling server',
    fields: {
      serverName: 'identity:server',
    },
  },
  'managementAdapter.server.disable.failed.ef84f36f': {
    message: 'Server disable failed',
    fields: {
      error: 'error',
      serverName: 'identity:server',
    },
  },
  'managementAdapter.adapter.reloading.configuration.a3daacfc': {
    message: 'Adapter: Reloading configuration',
    fields: {},
  },
  'managementAdapter.configuration.reload.failed.398d4189': {
    message: 'Configuration reload failed',
    fields: {
      error: 'error',
    },
  },
  'managementAdapter.adapter.updating.server.config.18395639': {
    message: 'Adapter: Updating server config',
    fields: {
      serverName: 'identity:server',
    },
  },
  'managementAdapter.server.config.update.failed.ca162694': {
    message: 'Server config update failed',
    fields: {
      error: 'error',
      serverName: 'identity:server',
    },
  },
  'managementAdapter.adapter.getting.server.url.129c4643': {
    message: 'Adapter: Getting server URL',
    fields: {},
  },
  'managementAdapter.failed.to.get.server.url.9bda30f6': {
    message: 'Failed to get server URL',
    fields: {
      error: 'error',
    },
  },
  'toolHandlers.error.previewing.configuration.changes.cd32dd5c': {
    message: 'Error previewing configuration changes',
    fields: {
      error: 'error',
      serverName: 'identity:server',
    },
  },
  'toolHandlers.executing.mcp.edit.tool.c0f5fd45': {
    message: 'Executing mcp_edit tool',
    fields: {},
  },
  'toolHandlers.creating.backup.before.editing.server.configuration.e7527acc': {
    message: 'Creating backup before editing server configuration',
    fields: {
      serverName: 'identity:server',
    },
  },
  'toolHandlers.error.in.mcp.edit.tool.handler.189d9093': {
    message: 'Error in mcp_edit tool handler',
    fields: {
      error: 'error',
      serverName: 'identity:server',
    },
  },
  'validation.adapter.validating.server.config.d058708f': {
    message: 'Adapter: Validating server config',
    fields: {
      serverName: 'identity:server',
    },
  },
  'validation.server.config.validation.failed.82ac52aa': {
    message: 'Server config validation failed',
    fields: {
      error: 'error',
      serverName: 'identity:server',
    },
  },
  'discoveryHandlers.executing.mcp.search.tool.845230c7': {
    message: 'Executing mcp_search tool',
    fields: {},
  },
  'discoveryHandlers.error.in.mcp.search.tool.handler.6d657ab8': {
    message: 'Error in mcp_search tool handler',
    fields: {
      error: 'error',
    },
  },
  'discoveryHandlers.executing.mcp.registry.status.tool.aecabda0': {
    message: 'Executing mcp_registry_status tool',
    fields: {},
  },
  'discoveryHandlers.error.in.mcp.registry.status.tool.handler.b2310b7e': {
    message: 'Error in mcp_registry_status tool handler',
    fields: {
      error: 'error',
    },
  },
  'discoveryHandlers.executing.mcp.registry.info.tool.b6187e32': {
    message: 'Executing mcp_registry_info tool',
    fields: {},
  },
  'discoveryHandlers.error.in.mcp.registry.info.tool.handler.ec4bb259': {
    message: 'Error in mcp_registry_info tool handler',
    fields: {
      error: 'error',
    },
  },
  'discoveryHandlers.executing.mcp.registry.list.tool.d0912276': {
    message: 'Executing mcp_registry_list tool',
    fields: {},
  },
  'discoveryHandlers.error.in.mcp.registry.list.tool.handler.74170233': {
    message: 'Error in mcp_registry_list tool handler',
    fields: {
      error: 'error',
    },
  },
  'discoveryHandlers.executing.mcp.info.tool.4931ee9d': {
    message: 'Executing mcp_info tool',
    fields: {},
  },
  'discoveryHandlers.error.in.mcp.info.tool.handler.64c66f95': {
    message: 'Error in mcp_info tool handler',
    fields: {
      error: 'error',
    },
  },
  'index.error.during.internal.tool.cleanup.6b8b5420': {
    message: 'Error during internal tool cleanup:',
    fields: {
      error: 'error',
    },
  },
  'index.adapter.cleanup.skipped.module.not.found.or.other.error.13d05164': {
    message: 'Adapter cleanup skipped (module not found or other error):',
    fields: {
      error: 'error',
    },
  },
  'index.error.during.local.cleanup.e1f79fe8': {
    message: 'Error during local cleanup:',
    fields: {
      error: 'error',
    },
  },
  'installationHandlers.executing.mcp.install.tool.ecf12fac': {
    message: 'Executing mcp_install tool',
    fields: {},
  },
  'installationHandlers.fetched.registry.information.for.prerequisites.b3c68676': {
    message: 'Fetched registry information for prerequisites',
    fields: {},
  },
  'installationHandlers.failed.to.fetch.registry.information.08c07f16': {
    message: 'Failed to fetch registry information',
    fields: {
      error: 'error',
    },
  },
  'installationHandlers.error.in.mcp.install.tool.handler.30691d5d': {
    message: 'Error in mcp_install tool handler',
    fields: {
      error: 'error',
    },
  },
  'installationHandlers.executing.mcp.uninstall.tool.5c54a84b': {
    message: 'Executing mcp_uninstall tool',
    fields: {},
  },
  'installationHandlers.error.in.mcp.uninstall.tool.handler.b174da03': {
    message: 'Error in mcp_uninstall tool handler',
    fields: {
      error: 'error',
    },
  },
  'installationHandlers.executing.mcp.update.tool.ff03c8a4': {
    message: 'Executing mcp_update tool',
    fields: {},
  },
  'installationHandlers.error.in.mcp.update.tool.handler.67369f38': {
    message: 'Error in mcp_update tool handler',
    fields: {
      error: 'error',
    },
  },
  'managementHandlers.executing.mcp.enable.tool.4920bb7d': {
    message: 'Executing mcp_enable tool',
    fields: {},
  },
  'managementHandlers.error.in.mcp.enable.tool.handler.205318b6': {
    message: 'Error in mcp_enable tool handler',
    fields: {
      error: 'error',
    },
  },
  'managementHandlers.executing.mcp.disable.tool.83f96ae3': {
    message: 'Executing mcp_disable tool',
    fields: {},
  },
  'managementHandlers.error.in.mcp.disable.tool.handler.2e682256': {
    message: 'Error in mcp_disable tool handler',
    fields: {
      error: 'error',
    },
  },
  'managementHandlers.executing.mcp.list.tool.e7515613': {
    message: 'Executing mcp_list tool',
    fields: {},
  },
  'managementHandlers.error.in.mcp.list.tool.handler.1824402f': {
    message: 'Error in mcp_list tool handler',
    fields: {
      error: 'error',
    },
  },
  'managementHandlers.executing.mcp.status.tool.470b2cef': {
    message: 'Executing mcp_status tool',
    fields: {},
  },
  'managementHandlers.error.in.mcp.status.tool.handler.4280f319': {
    message: 'Error in mcp_status tool handler',
    fields: {
      error: 'error',
    },
  },
  'managementHandlers.executing.mcp.reload.tool.2a0b92c6': {
    message: 'Executing mcp_reload tool',
    fields: {},
  },
  'managementHandlers.error.in.mcp.reload.tool.handler.15a62ac4': {
    message: 'Error in mcp_reload tool handler',
    fields: {
      error: 'error',
    },
  },
  'runtimeScopeAdminLock.runtime.scope.admin.lock.is.legacy.corrupt.or.unreadable.stop.every.runtime.42d0a1b0': {
    message:
      'Runtime Scope Admin Lock is legacy, corrupt, or unreadable: <private>. Stop every runtime for this scope, verify that no 1mcp process owns it, then remove this lock file manually.',
    fields: {},
  },
  'configChange.failed.to.read.config.backup.retention.from.565ac585': {
    message: 'Failed to read config backup retention from <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'configChange.failed.to.reload.mcp.configuration.after.config.change.b788dd7a': {
    message: 'Failed to reload MCP configuration after config change',
    fields: {
      error: 'error',
    },
  },
  'presetManager.failed.to.cleanup.presetmanager.during.reset.601df09b': {
    message: 'Failed to cleanup PresetManager during reset:',
    fields: {
      error: 'error',
    },
  },
  'presetManager.presetmanager.initialized.successfully.2a672d11': {
    message: 'PresetManager initialized successfully',
    fields: {},
  },
  'presetManager.failed.to.initialize.presetmanager.bbdee411': {
    message: 'Failed to initialize PresetManager',
    fields: {
      error: 'error',
    },
  },
  'presetManager.presets.loaded.from.file.e0a97eb0': {
    message: 'Presets loaded from file',
    fields: {
      presetCount: 'number',
    },
  },
  'presetManager.no.preset.file.found.starting.with.empty.presets.9d07f410': {
    message: 'No preset file found, starting with empty presets',
    fields: {},
  },
  'presetManager.failed.to.load.presets.af6c702e': {
    message: 'Failed to load presets',
    fields: {
      error: 'error',
    },
  },
  'presetManager.failed.to.get.server.list.before.reload.6bc286a6': {
    message: 'Failed to get server list before reload',
    fields: {
      error: 'error',
    },
  },
  'presetManager.detected.server.list.changes.for.preset.eb9e7825': {
    message: 'Detected server list changes for preset',
    fields: {
      previousCount: 'number',
      currentCount: 'number',
    },
  },
  'presetManager.failed.to.update.change.detector.for.preset.a442171c': {
    message: 'Failed to update change detector for preset',
    fields: {
      error: 'error',
    },
  },
  'presetManager.failed.to.check.for.preset.changes.08d8b540': {
    message: 'Failed to check for preset changes',
    fields: {
      error: 'error',
    },
  },
  'presetManager.preset.was.deleted.cleaning.up.tracking.40235f8d': {
    message: 'Preset was deleted, cleaning up tracking',
    fields: {},
  },
  'presetManager.notifying.clients.of.preset.changes.64b339ca': {
    message: 'Notifying clients of preset changes',
    fields: {},
  },
  'presetManager.no.preset.server.list.changes.detected.skipping.notifications.fc7805c7': {
    message: 'No preset server list changes detected, skipping notifications',
    fields: {},
  },
  'presetManager.initialized.change.detector.for.preset.7c64c2ab': {
    message: 'Initialized change detector for preset',
    fields: {
      serverCount: 'number',
    },
  },
  'presetManager.failed.to.initialize.change.detector.for.preset.7fa4da23': {
    message: 'Failed to initialize change detector for preset',
    fields: {
      error: 'error',
    },
  },
  'presetManager.presets.saved.to.file.88dc37af': {
    message: 'Presets saved to file',
    fields: {
      presetCount: 'number',
    },
  },
  'presetManager.failed.to.save.presets.e0270919': {
    message: 'Failed to save presets',
    fields: {
      error: 'error',
    },
  },
  'presetManager.preset.file.changed.scheduling.reload.80da3c96': {
    message: 'Preset file changed, scheduling reload...',
    fields: {},
  },
  'presetManager.presets.reloaded.successfully.dd2471d7': {
    message: 'Presets reloaded successfully',
    fields: {},
  },
  'presetManager.failed.to.reload.presets.6d7c844a': {
    message: 'Failed to reload presets',
    fields: {
      error: 'error',
    },
  },
  'presetManager.started.watching.preset.file.28e8837e': {
    message: 'Started watching preset file',
    fields: {},
  },
  'presetManager.failed.to.start.preset.file.watching.7ed8d6dc': {
    message: 'Failed to start preset file watching',
    fields: {
      error: 'error',
    },
  },
  'presetManager.preset.saved.successfully.2cfdc0b1': {
    message: 'Preset saved successfully',
    fields: {},
  },
  'presetManager.preset.deleted.successfully.1f4ef783': {
    message: 'Preset deleted successfully',
    fields: {},
  },
  'presetManager.attempted.to.resolve.non.existent.preset.bed33632': {
    message: 'Attempted to resolve non-existent preset',
    fields: {},
  },
  'presetManager.preset.resolved.to.empty.expression.3df23610': {
    message: 'Preset resolved to empty expression',
    fields: {},
  },
  'presetManager.failed.to.resolve.preset.to.expression.c273c525': {
    message: 'Failed to resolve preset to expression',
    fields: {
      error: 'error',
    },
  },
  'presetManager.preset.change.notification.failed.f4c5d0fc': {
    message: 'Preset change notification failed',
    fields: {
      error: 'error',
    },
  },
  'presetManager.preset.change.notifications.sent.c08156b1': {
    message: 'Preset change notifications sent',
    fields: {
      callbackCount: 'number',
    },
  },
  'presetManagerCleanup.starting.presetmanager.cleanup.aa7d3c68': {
    message: 'Starting PresetManager cleanup',
    fields: {},
  },
  'presetManagerCleanup.cleared.pending.reload.timeout.71589886': {
    message: 'Cleared pending reload timeout',
    fields: {},
  },
  'presetManagerCleanup.stopped.watching.preset.file.d2b94074': {
    message: 'Stopped watching preset file',
    fields: {},
  },
  'presetManagerCleanup.cleared.notification.callbacks.83aa6c0b': {
    message: 'Cleared notification callbacks',
    fields: {
      count: 'number',
    },
  },
  'presetManagerCleanup.cleared.change.detector.a4b42813': {
    message: 'Cleared change detector',
    fields: {},
  },
  'presetManagerCleanup.cleared.presets.from.memory.2a42cc3c': {
    message: 'Cleared presets from memory',
    fields: {
      count: 'number',
    },
  },
  'presetManagerCleanup.presetmanager.cleanup.completed.successfully.0047ca52': {
    message: 'PresetManager cleanup completed successfully',
    fields: {},
  },
  'presetManagerCleanup.error.during.presetmanager.cleanup.ea747462': {
    message: 'Error during PresetManager cleanup',
    fields: {
      error: 'error',
    },
  },
  'presetTesting.failed.to.evaluate.preset.against.server.cf37abcb': {
    message: 'Failed to evaluate preset against server',
    fields: {
      error: 'error',
    },
  },
  'presetNotificationService.client.tracked.for.preset.675ef187': {
    message: 'Client tracked for preset',
    fields: {
      clientId: 'identity:client',
    },
  },
  'presetNotificationService.client.tracked.without.preset.353291d9': {
    message: 'Client tracked without preset',
    fields: {
      clientId: 'identity:client',
    },
  },
  'presetNotificationService.client.untracked.from.preset.51d05737': {
    message: 'Client untracked from preset',
    fields: {
      clientId: 'identity:client',
    },
  },
  'presetNotificationService.attempted.to.update.preset.for.unknown.client.802e49d3': {
    message: 'Attempted to update preset for unknown client',
    fields: {
      clientId: 'identity:client',
    },
  },
  'presetNotificationService.client.preset.updated.853efb4d': {
    message: 'Client preset updated',
    fields: {
      clientId: 'identity:client',
    },
  },
  'presetNotificationService.no.clients.to.notify.for.preset.change.a177ae84': {
    message: 'No clients to notify for preset change',
    fields: {},
  },
  'presetNotificationService.sending.preset.change.notifications.56dd5eb7': {
    message: 'Sending preset change notifications',
    fields: {
      clientCount: 'number',
    },
  },
  'presetNotificationService.skipping.disconnected.client.de17d19f': {
    message: 'Skipping disconnected client',
    fields: {
      clientId: 'identity:client',
    },
  },
  'presetNotificationService.preset.change.notifications.sent.to.client.ca4b0ff4': {
    message: 'Preset change notifications sent to client',
    fields: {
      clientId: 'identity:client',
    },
  },
  'presetNotificationService.failed.to.send.preset.change.notification.to.client.2f24f6f0': {
    message: 'Failed to send preset change notification to client',
    fields: {
      clientId: 'identity:client',
      error: 'error',
    },
  },
  'presetNotificationService.preset.change.notifications.completed.05952580': {
    message: 'Preset change notifications completed',
    fields: {
      clientCount: 'number',
    },
  },
  'presetNotificationService.cleaned.up.disconnected.clients.6ee227f9': {
    message: 'Cleaned up disconnected clients',
    fields: {
      removedCount: 'number',
    },
  },
  'cacheManager.cache.set.ttl.s.13fedf3b': {
    message: 'Cache set: <private> (TTL: <private>s)',
    fields: {},
  },
  'cacheManager.cache.invalidated.entries.matching.6d1f9f62': {
    message: 'Cache invalidated: <private> entries matching "<private>"',
    fields: {},
  },
  'cacheManager.cache.cleared.entries.removed.33fa692a': {
    message: 'Cache cleared: <private> entries removed',
    fields: {},
  },
  'cacheManager.cache.cleanup.expired.entries.removed.8f0f350d': {
    message: 'Cache cleanup: <private> expired entries removed',
    fields: {},
  },
  'cacheManager.cache.eviction.oldest.entries.removed.8d79f505': {
    message: 'Cache eviction: <private> oldest entries removed',
    fields: {},
  },
  'mcpRegistryClient.server.has.no.remotes.defined.installation.methods.may.be.limited.b5075669': {
    message: 'Server <private> has no remotes defined - installation methods may be limited',
    fields: {},
  },
  'mcpRegistryClient.server.has.remotes.de7a9fb7': {
    message: 'Server <private> has <private> remotes: <private>',
    fields: {},
  },
  'mcpRegistryClient.registry.status.check.failed.872c5a93': {
    message: 'Registry status check failed:',
    fields: {
      error: 'error',
    },
  },
  'mcpRegistryClient.cache.hit.for.ae19459f': {
    message: 'Cache hit for <private>: <private>',
    fields: {},
  },
  'mcpRegistryClient.using.proxy.3d6295e7': {
    message: 'Using proxy: <private>',
    fields: {},
  },
  'mcpRegistryClient.failed.to.configure.proxy.proceeding.without.71d2dae0': {
    message: 'Failed to configure proxy, proceeding without: <private>',
    fields: {
      error: 'error',
    },
  },
  'mcpRegistryClient.making.request.to.391745be': {
    message: 'Making request to: <private>',
    fields: {},
  },
  'mcpRegistryClient.request.successful.45a5ba8a': {
    message: 'Request successful: <private>',
    fields: {},
  },
  'mcpRegistryClient.invalid.proxy.url.fbb97db1': {
    message: 'Invalid proxy URL: <private>',
    fields: {
      error: 'error',
    },
  },
  'progressTrackingService.operation.started.ba75ab0a': {
    message: '🚀 <private> operation started: <private>',
    fields: {},
  },
  'progressTrackingService.no.progress.tracked.for.operation.60f790b6': {
    message: 'No progress tracked for operation: <private>',
    fields: {},
  },
  'progressTrackingService.diagnostic.d29253aa': {
    message: '[<private>] <private>% - <private>',
    fields: {},
  },
  'progressTrackingService.operation.completed.in.ms.15793588': {
    message: '✅ Operation completed in <private>ms: <private>',
    fields: {},
  },
  'progressTrackingService.operation.failed.after.ms.54534b3f': {
    message: '❌ Operation failed after <private>ms: <private> - <private>',
    fields: {},
  },
  'serverInstallationService.starting.installation.of.8adb8e75': {
    message: 'Starting installation of <private><private>',
    fields: {},
  },
  'serverInstallationService.successfully.prepared.installation.configuration.for.dfa3c3ff': {
    message: 'Successfully prepared installation configuration for <private>',
    fields: {},
  },
  'serverInstallationService.installation.failed.for.cbeab30b': {
    message: 'Installation failed for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'serverInstallationService.direct.lookup.failed.for.trying.search.based.resolution.9ef9a44a': {
    message: 'Direct lookup failed for <private>, trying search-based resolution',
    fields: {
      error: 'error',
    },
  },
  'serverInstallationService.found.server.as.in.registry.ea1491e9': {
    message: 'Found server "<private>" as "<private>" in registry',
    fields: {},
  },
  'serverInstallationService.updating.server.3e4e4b9c': {
    message: 'Updating server <private><private>',
    fields: {},
  },
  'serverInstallationService.update.failed.for.07902538': {
    message: 'Update failed for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'serverInstallationService.uninstalling.server.0a40d156': {
    message: 'Uninstalling server <private>',
    fields: {},
  },
  'serverInstallationService.checking.for.updates.d6475fda': {
    message: 'Checking for updates<private>',
    fields: {},
  },
  'serverInstallationService.could.not.check.updates.for.ddce3667': {
    message: 'Could not check updates for <private>: <private>',
    fields: {},
  },
  'serverInstallationService.listing.installed.servers.0b1768ea': {
    message: 'Listing installed servers',
    fields: {},
  },
  'sdkOAuthClientProvider.oauth.client.configured.for.with.redirect.url.configured.f624fff1': {
    message: 'OAuth client configured for <private> with redirect URL configured: <private>',
    fields: {},
  },
  'sdkOAuthClientProvider.oauth.client.registered.for.a7d64162': {
    message: 'OAuth client registered for <private>: <private>',
    fields: {},
  },
  'sdkOAuthClientProvider.oauth.tokens.saved.for.22916b52': {
    message: 'OAuth tokens saved for <private>',
    fields: {},
  },
  'sdkOAuthClientProvider.oauth.credentials.invalidated.for.a8274c9f': {
    message: 'OAuth credentials invalidated for <private>: <private>',
    fields: {},
  },
  'sdkOAuthClientProvider.oauth.tokens.expired.for.clearing.aa3cd964': {
    message: 'OAuth tokens expired for <private>, clearing',
    fields: {},
  },
  'sdkOAuthServerProvider.oauth.store.refused.insecure.credential.file.49dbe688': {
    message: 'OAuth store refused insecure credential file: <private>',
    fields: {
      error: 'error',
    },
  },
  'sdkOAuthServerProvider.registered.oauth.client.1661d38f': {
    message: 'Registered OAuth client: <private>',
    fields: {},
  },
  'sdkOAuthServerProvider.failed.to.register.client.6886b57e': {
    message: 'Failed to register client <private>:',
    fields: {
      error: 'error',
    },
  },
  'sdkOAuthServerProvider.authorizing.client.375bc6df': {
    message: 'Authorizing client',
    fields: {
      clientId: 'identity:client',
    },
  },
  'sdkOAuthServerProvider.invalid.scopes.requested.by.client.cdde0cd5': {
    message: 'Invalid scopes requested by client <private>',
    fields: {},
  },
  'sdkOAuthServerProvider.authorization.error.09b795f4': {
    message: 'Authorization error:',
    fields: {
      error: 'error',
    },
  },
  'sdkOAuthServerProvider.requires.user.consent.13e2955f': {
    message: 'Requires user consent',
    fields: {
      clientId: 'identity:client',
    },
  },
  'sdkOAuthServerProvider.approving.authorization.ff36652b': {
    message: 'Approving authorization',
    fields: {
      clientId: 'identity:client',
    },
  },
  'sdkOAuthServerProvider.oauth.authorization.granted.for.client.d4fcb391': {
    message: 'OAuth authorization granted for client <private>',
    fields: {
      clientId: 'identity:client',
    },
  },
  'sdkOAuthServerProvider.challenge.for.authorization.code.9be5806a': {
    message: 'Challenge for authorization code',
    fields: {
      clientId: 'identity:client',
    },
  },
  'sdkOAuthServerProvider.exchanging.authorization.code.6ed093e7': {
    message: 'Exchanging authorization code',
    fields: {
      clientId: 'identity:client',
    },
  },
  'sdkOAuthServerProvider.exchanged.authorization.code.for.access.token.f9c5dc9f': {
    message: 'Exchanged authorization code for access token',
    fields: {
      clientId: 'identity:client',
    },
  },
  'sdkOAuthServerProvider.verifying.access.token.ee1c29d4': {
    message: 'Verifying access token',
    fields: {},
  },
  'sdkOAuthServerProvider.revoking.oauth.token.f78e2487': {
    message: 'Revoking OAuth token',
    fields: {
      clientId: 'identity:client',
    },
  },
  'sdkOAuthServerProvider.revoked.access.token.for.client.2a08dfe9': {
    message: 'Revoked access token for client <private>',
    fields: {},
  },
  'clientManager.cached.instructions.for.characters.60751cf8': {
    message: 'Cached instructions for <private>: <private> characters',
    fields: {},
  },
  'clientManager.no.instructions.available.for.ee166e39': {
    message: 'No instructions available for <private>',
    fields: {},
  },
  'clientManager.failed.to.extract.instructions.from.05217e1a': {
    message: 'Failed to extract instructions from <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'clientManager.client.disconnected.827fca0a': {
    message: 'Client <private> disconnected',
    fields: {},
  },
  'clientManager.client.received.a.response.for.an.unknown.message.id.a605b144': {
    message: 'Client <private> received a response for an unknown message ID',
    fields: {},
  },
  'clientManager.client.error.775bd985': {
    message: 'Client <private> error: <private>',
    fields: {},
  },
  'clientManager.session.for.was.lost.backend.likely.restarted.reconnecting.with.a.fresh.ses.11164b75': {
    message: 'Session for <private> was lost (backend likely restarted) — reconnecting with a fresh session',
    fields: {},
  },
  'clientManager.cannot.recover.from.session.loss.9b3fa9e8': {
    message: 'Cannot recover <private> from session loss: <private>',
    fields: {
      error: 'error',
    },
  },
  'clientManager.failed.to.recover.after.session.loss.501b50bc': {
    message: 'Failed to recover <private> after session loss: <private>',
    fields: {},
  },
  'clientManager.some.clients.failed.to.initialize.cc2bd21d': {
    message: 'Some clients failed to initialize: <private>/<private>',
    fields: {},
  },
  'clientManager.clients.awaiting.oauth.authorization.cb150b25': {
    message: 'Clients awaiting OAuth authorization: <private>/<private>',
    fields: {},
  },
  'clientManager.creating.client.for.744dd700': {
    message: 'Creating client for <private>',
    fields: {},
  },
  'clientManager.keeping.healthy.client.after.replacement.failed.fe11642b': {
    message: 'Keeping healthy client <private> after replacement failed: <private>',
    fields: {
      error: 'error',
    },
  },
  'clientManager.oauth.authorization.required.for.c0a14ccd': {
    message: 'OAuth authorization required for <private>',
    fields: {},
  },
  'clientManager.failed.to.create.client.for.a61aad6b': {
    message: 'Failed to create client for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'clientManager.client.created.for.44950b76': {
    message: 'Client created for <private>',
    fields: {},
  },
  'clientManager.could.not.close.superseded.client.3029a8f0': {
    message: 'Could not close superseded client <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'clientManager.initialized.client.storage.for.transports.6bd3aa3d': {
    message: 'Initialized client storage for <private> transports',
    fields: {},
  },
  'clientManager.removing.client.833781e6': {
    message: 'Removing client <private>...',
    fields: {},
  },
  'clientManager.error.closing.transport.for.76ac70c0': {
    message: 'Error closing transport for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'clientManager.client.removed.successfully.0f36fffb': {
    message: 'Client <private> removed successfully',
    fields: {},
  },
  'clientManager.error.removing.client.df5d67cc': {
    message: 'Error removing client <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'clientManager.error.closing.client.during.shutdown.for.2f1b1528': {
    message: 'Error closing client during shutdown for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'clientManager.clientmanager.shutdown.complete.30a0c3d8': {
    message: 'ClientManager shutdown complete',
    fields: {},
  },
  'clientManager.could.not.close.previous.supervised.client.b79e7fcc': {
    message: 'Could not close previous supervised client <private>: <private>',
    fields: {},
  },
  'clientManager.backend.stdio.supervision.state.changed.for.3a724099': {
    message: 'Backend stdio supervision state changed for <private>',
    fields: {
      attempt: 'number',
      error: 'error',
    },
  },
  'clientManager.failed.to.publish.backend.availability.for.9f2d28de': {
    message: 'Failed to publish backend availability for <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'connectionHandler.successfully.connected.to.with.server.version.6ee89a19': {
    message: 'Successfully connected to <private> with server <private> version <private>',
    fields: {},
  },
  'connectionHandler.oauth.authorization.required.for.visit.oauth.to.authorize.875e3320': {
    message: 'OAuth authorization required for <private>. Visit <private>/oauth to authorize',
    fields: {},
  },
  'connectionHandler.failed.to.connect.to.d9f2b821': {
    message: 'Failed to connect to <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'connectionHandler.retrying.in.ms.0a9db4e6': {
    message: 'Retrying in <private>ms...',
    fields: {},
  },
  'connectionHandler.error.closing.transport.during.retry.d23eee71': {
    message: 'Error closing transport during retry: <private>',
    fields: {},
  },
  'connectionHandler.error.closing.failed.retry.candidate.648a7c0b': {
    message: 'Error closing failed retry candidate: <private>',
    fields: {},
  },
  'legacySdkClientAdapter.failed.to.publish.oauth.recovery.state.for.ff1647d0': {
    message: 'Failed to publish OAuth recovery state for <private>',
    fields: {
      error: 'error',
    },
  },
  'legacySdkClientAdapter.failed.to.invalidate.oauth.credentials.for.648dfbe1': {
    message: 'Failed to invalidate OAuth credentials for <private>',
    fields: {
      error: 'error',
    },
  },
  'legacySdkClientAdapter.failed.to.close.unauthorized.client.1a04864e': {
    message: 'Failed to close unauthorized client <private>',
    fields: {
      error: 'error',
    },
  },
  'legacySdkClientAdapter.oauth.reauthorization.required.for.after.authenticated.request.returned.401.852cc6fa': {
    message: 'OAuth reauthorization required for <private> after authenticated request returned 401',
    fields: {},
  },
  'oauthFlowHandler.could.not.extract.authorization.url.f9cc0cc9': {
    message: 'Could not extract authorization URL: <private>',
    fields: {
      error: 'error',
    },
  },
  'oauthFlowHandler.oauth.authorization.required.for.b495d670': {
    message: 'OAuth authorization required for <private>',
    fields: {},
  },
  'oauthFlowHandler.completing.oauth.and.reconnecting.053f0a15': {
    message: 'Completing OAuth and reconnecting <private>...',
    fields: {},
  },
  'oauthFlowHandler.oauth.reconnection.completed.successfully.for.65c16552': {
    message: 'OAuth reconnection completed successfully for <private>',
    fields: {},
  },
  'oauthFlowHandler.oauth.reconnection.failed.for.4dd2fa2f': {
    message: 'OAuth reconnection failed for <private>:',
    fields: {
      error: 'error',
    },
  },
  'serveClient.failed.to.read.cli.session.cache.starting.fresh.6f5bbc92': {
    message: 'Failed to read CLI session cache, starting fresh:',
    fields: {
      error: 'error',
    },
  },
  'serve.invalid.instructions.template.811a8b70': {
    message: 'Invalid instructions template: <private>',
    fields: {},
  },
  'serve.template.validation.failed.server.will.use.built.in.template.7078ba5c': {
    message: 'Template validation failed. Server will use built-in template.',
    fields: {},
  },
  'serve.loaded.and.validated.custom.instructions.template.from.3751f580': {
    message: 'Loaded and validated custom instructions template from: <private>',
    fields: {},
  },
  'serve.template.length.details.9ac93eda': {
    message: 'Template length details',
    fields: {},
  },
  'serve.custom.instructions.template.file.not.found.659ae3c3': {
    message: 'Custom instructions template file not found: <private>',
    fields: {},
  },
  'serve.template.file.resolution.606e9dfc': {
    message: 'Template file resolution:',
    fields: {},
  },
  'serve.check.that.the.file.path.is.correct.cc805876': {
    message: '• Check that the file path is correct',
    fields: {},
  },
  'serve.ensure.the.file.has.read.permissions.d3e15e7b': {
    message: '• Ensure the file has read permissions',
    fields: {},
  },
  'serve.use.absolute.paths.or.paths.relative.to.current.directory.6a968d90': {
    message: '• Use absolute paths or paths relative to current directory',
    fields: {},
  },
  'serve.server.will.use.built.in.template.as.fallback.5dd65ea9': {
    message: '• Server will use built-in template as fallback',
    fields: {},
  },
  'serve.default.instructions.template.file.not.found.using.built.in.template.3fd48023': {
    message: 'Default instructions template file not found, using built-in template',
    fields: {},
  },
  'serve.failed.to.load.instructions.template.from.cf604d83': {
    message: 'Failed to load instructions template from <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'serve.template.loading.failed.troubleshooting.steps.d7a3ed11': {
    message: 'Template loading failed. Troubleshooting steps:',
    fields: {},
  },
  'serve.verify.file.exists.and.has.read.permissions.04b2cb6d': {
    message: '• Verify file exists and has read permissions',
    fields: {},
  },
  'serve.check.file.encoding.should.be.utf.8.347ababb': {
    message: '• Check file encoding (should be UTF-8)',
    fields: {},
  },
  'serve.ensure.no.other.process.is.locking.the.file.e98e6671': {
    message: '• Ensure no other process is locking the file',
    fields: {},
  },
  'serve.try.using.an.absolute.file.path.7145b186': {
    message: '• Try using an absolute file path',
    fields: {},
  },
  'serve.deprecation.warning.lazy.mode.is.ignored.lazy.loading.is.controlled.only.by.9d79d3a4': {
    message:
      'DEPRECATION WARNING: --lazy-mode is ignored. Lazy loading is controlled only by --enable-lazy-loading; for a persistent setting, use [lazyLoading] enabled = true in config.toml. Remove --lazy-mode because it does not change runtime behavior.',
    fields: {},
  },
  'serve.deprecation.warning.lazy.direct.expose.is.ignored.lazy.loading.exposes.only.bac35051': {
    message:
      'DEPRECATION WARNING: --lazy-direct-expose is ignored. Lazy loading exposes only meta-tools when enabled; for a persistent setting, use [lazyLoading] enabled = true in config.toml. Remove --lazy-direct-expose because it does not change runtime behavior.',
    fields: {},
  },
  'serve.shutting.down.server.7bd0e75c': {
    message: 'Shutting down server...',
    fields: {},
  },
  'serve.loading.manager.shutdown.complete.0bedfd3f': {
    message: 'Loading manager shutdown complete',
    fields: {},
  },
  'serve.error.shutting.down.loading.manager.ecaf9547': {
    message: 'Error shutting down loading manager: <private>',
    fields: {
      error: 'error',
    },
  },
  'serve.clientmanager.shutdown.complete.6185d545': {
    message: 'ClientManager shutdown complete',
    fields: {},
  },
  'serve.error.shutting.down.clientmanager.c3553270': {
    message: 'Error shutting down ClientManager: <private>',
    fields: {
      error: 'error',
    },
  },
  'serve.servermanager.cleanup.complete.7aa4ec75': {
    message: 'ServerManager cleanup complete',
    fields: {},
  },
  'serve.error.cleaning.up.servermanager.b2e3ed7d': {
    message: 'Error cleaning up ServerManager: <private>',
    fields: {
      error: 'error',
    },
  },
  'serve.expressserver.shutdown.complete.83758030': {
    message: 'ExpressServer shutdown complete',
    fields: {},
  },
  'serve.error.shutting.down.expressserver.582eaa65': {
    message: 'Error shutting down ExpressServer: <private>',
    fields: {
      error: 'error',
    },
  },
  'serve.closed.transport.0211d5c5': {
    message: 'Closed transport: <private>',
    fields: {},
  },
  'serve.error.closing.transport.7d2d3d15': {
    message: 'Error closing transport <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'serve.instructionaggregator.cleanup.complete.efba68f2': {
    message: 'InstructionAggregator cleanup complete',
    fields: {},
  },
  'serve.error.cleaning.up.instructionaggregator.46768b4e': {
    message: 'Error cleaning up InstructionAggregator: <private>',
    fields: {
      error: 'error',
    },
  },
  'serve.presetmanager.cleanup.complete.b9467741': {
    message: 'PresetManager cleanup complete',
    fields: {},
  },
  'serve.error.cleaning.up.presetmanager.55eb9b77': {
    message: 'Error cleaning up PresetManager: <private>',
    fields: {
      error: 'error',
    },
  },
  'serve.pid.file.cleanup.complete.85339e55': {
    message: 'PID file cleanup complete',
    fields: {},
  },
  'serve.error.cleaning.up.pid.file.336e4ac3': {
    message: 'Error cleaning up PID file: <private>',
    fields: {
      error: 'error',
    },
  },
  'serve.server.shutdown.complete.fad6a0b9': {
    message: 'Server shutdown complete',
    fields: {},
  },
  'serve.deprecation.warning.config.keys.are.deprecated.use.the.structured.logging.b.600bd41d': {
    message:
      '⚠️ DEPRECATION WARNING: config keys <private> are deprecated. Use the structured `logging` block (logging.level / logging.file) instead. The flat keys still work but will be removed in a future release.',
    fields: {},
  },
  'serve.security.warning.authentication.is.disabled.but.scope.validation.is.enabled.cc1337b3': {
    message:
      '⚠️ SECURITY WARNING: authentication is DISABLED but scope validation is ENABLED. Requests will be served without a verified identity, so authorization cannot be enforced (fail-open, CWE-862 / CWE-636). Action: either enable authentication via `--enable-auth`, or disable scope validation via `--enable-scope-validation=false`. Test/local use only.',
    fields: {},
  },
  'serve.asyncloading.diagnostic.912acccb': {
    message: 'asyncLoading diagnostic',
    fields: {},
  },
  'serve.template.context.trust.is.legacy.unverified.clients.may.render.command.args.867a89a9': {
    message: 'Template context trust is LEGACY: unverified clients may render command, args, cwd, and env templates',
    fields: {},
  },
  'serve.deprecation.warning.serve.transport.stdio.is.deprecated.a3288aee': {
    message: '⚠️ DEPRECATION WARNING: `serve --transport stdio` is deprecated',
    fields: {},
  },
  'serve.please.use.1mcp.proxy.instead.for.better.compatibility.9caa3485': {
    message: '⚠️ Please use `1mcp proxy` instead for better compatibility',
    fields: {},
  },
  'serve.this.mode.may.be.removed.in.a.future.major.version.9f1100ff': {
    message: '⚠️ This mode may be removed in a future major version',
    fields: {},
  },
  'serve.diagnostic.c82ead89': {
    message: '',
    fields: {},
  },
  'serve.migration.guide.a032bb4f': {
    message: 'Migration guide:',
    fields: {},
  },
  'serve.1.start.http.server.1mcp.serve.5c75ce98': {
    message: '1. Start HTTP server: 1mcp serve',
    fields: {},
  },
  'serve.2.use.proxy.command.1mcp.proxy.75b19e38': {
    message: '2. Use proxy command: 1mcp proxy',
    fields: {},
  },
  'serve.async.loading.notifications.initialized.for.stdio.transport.2f38a5e7': {
    message: 'Async loading notifications initialized for stdio transport',
    fields: {},
  },
  'serve.server.started.with.stdio.transport.ea94ea8d': {
    message: 'Server started with stdio transport',
    fields: {},
  },
  'serve.invalid.transport.1860e43c': {
    message: 'Invalid transport: <private>',
    fields: {},
  },
  'serve.mcp.loading.progress.servers.ready.loading.failed.90307638': {
    message: 'MCP loading progress: <private>/<private> servers ready (<private> loading, <private> failed)',
    fields: {},
  },
  'serve.mcp.loading.complete.servers.ready.success.rate.0a0fdab1': {
    message: 'MCP loading complete: <private>/<private> servers ready (<private>% success rate)',
    fields: {},
  },
  'serve.server.error.a68bf449': {
    message: 'Server error: <private>',
    fields: {
      error: 'error',
    },
  },
  'notificationHandlers.received.notification.in.client.689f962c': {
    message: 'Received notification in client: <private> <private>',
    fields: {},
  },
  'notificationHandlers.server.transport.not.connected.dropping.notification.from.9ee58811': {
    message: 'Server transport not connected. Dropping notification from <private>',
    fields: {
      error: 'error',
    },
  },
  'notificationHandlers.failed.to.send.notification.from.5fd1ccf3': {
    message: 'Failed to send notification from <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'requestHandlers.health.check.successful.for.client.e172fbf8': {
    message: 'Health check successful for client: <private>',
    fields: {},
  },
  'requestHandlers.health.check.failed.for.client.36ff3103': {
    message: 'Health check failed for client <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'resourceSubscriptions.resource.subscription.cleanup.incomplete.0640deca': {
    message: 'Resource subscription cleanup incomplete',
    fields: {
      error: 'error',
    },
  },
  'clientInstancePool.clientinstancepool.initialized.bc827c78': {
    message: 'ClientInstancePool initialized',
    fields: {},
  },
  'clientInstancePool.template.rendering.details.9f3abae5': {
    message: 'Template rendering details',
    fields: {
      clientId: 'identity:client',
    },
  },
  'clientInstancePool.processing.template.for.client.instance.b0d9550d': {
    message: 'Processing template for client instance',
    fields: {
      clientId: 'identity:client',
    },
  },
  'clientInstancePool.template.renderedhash.instance.key.78f982b5': {
    message: 'Template <private>, renderedHash: <private>, Instance key: <private>',
    fields: {},
  },
  'clientInstancePool.created.new.client.instance.from.template.383bd90b': {
    message: 'Created new client instance from template',
    fields: {
      clientId: 'identity:client',
    },
  },
  'clientInstancePool.added.client.to.existing.client.instance.c1fc1d9e': {
    message: 'Added client to existing client instance',
    fields: {
      clientId: 'identity:client',
      clientCount: 'number',
    },
  },
  'clientInstancePool.removed.client.from.client.instance.1bece201': {
    message: 'Removed client from client instance',
    fields: {
      clientId: 'identity:client',
      clientCount: 'number',
    },
  },
  'clientInstancePool.client.instance.marked.as.idle.11131bab': {
    message: 'Client instance marked as idle',
    fields: {},
  },
  'clientInstancePool.removed.client.instance.from.pool.0595d1e2': {
    message: 'Removed client instance from pool',
    fields: {
      clientCount: 'number',
    },
  },
  'clientInstancePool.cleaning.up.idle.client.instances.e51e9e32': {
    message: 'Cleaning up idle client instances',
    fields: {
      count: 'number',
    },
  },
  'clientInstancePool.clientinstancepool.shutdown.complete.929283e2': {
    message: 'ClientInstancePool shutdown complete',
    fields: {},
  },
  'clientInstancePool.error.closing.client.for.instance.55a390b9': {
    message: 'Error closing client for instance <private>:',
    fields: {
      error: 'error',
    },
  },
  'clientInstancePool.error.closing.transport.for.instance.312c23b4': {
    message: 'Error closing transport for instance <private>:',
    fields: {
      error: 'error',
    },
  },
  'clientInstancePool.could.not.close.template.instance.879417ae': {
    message: 'Could not close template instance <private>: <private>',
    fields: {},
  },
  'clientInstancePool.template.backend.stdio.supervision.state.changed.for.841a0aba': {
    message: 'Template backend stdio supervision state changed for <private>',
    fields: {
      attempt: 'number',
      error: 'error',
    },
  },
  'clientInstancePool.failed.to.remove.idle.template.instance.after.child.exit.ab6feca9': {
    message: 'Failed to remove idle template instance <private> after child exit:',
    fields: {
      error: 'error',
    },
  },
  'connectionManager.connection.already.in.progress.for.session.waiting.ab0b4dbd': {
    message: 'Connection already in progress for session <private>, waiting...',
    fields: {},
  },
  'connectionManager.transport.already.connected.for.session.82eea7e1': {
    message: 'Transport already connected for session <private>',
    fields: {},
  },
  'connectionManager.error.closing.transport.for.session.03d80826': {
    message: 'Error closing transport for session <private>:',
    fields: {
      error: 'error',
    },
  },
  'connectionManager.untracked.client.from.preset.notifications.6a97d47f': {
    message: 'Untracked client from preset notifications',
    fields: {
      sessionId: 'identity:session',
    },
  },
  'connectionManager.disconnected.transport.for.session.9a08187a': {
    message: 'Disconnected transport for session <private>',
    fields: {},
  },
  'connectionManager.failed.to.connect.transport.for.session.06b49e4e': {
    message: 'Failed to connect transport for session <private>:',
    fields: {
      error: 'error',
    },
  },
  'connectionManager.connected.transport.for.session.8c692c82': {
    message: 'Connected transport for session <private>',
    fields: {},
  },
  'connectionManager.sent.notification.to.client.615bc0d2': {
    message: 'Sent notification to client',
    fields: {
      sessionId: 'identity:session',
      method: 'method',
    },
  },
  'connectionManager.cannot.send.notification.to.disconnected.client.9715f96c': {
    message: 'Cannot send notification to disconnected client',
    fields: {
      sessionId: 'identity:session',
      method: 'method',
    },
  },
  'connectionManager.failed.to.send.notification.to.client.e18f96b7': {
    message: 'Failed to send notification to client',
    fields: {
      sessionId: 'identity:session',
      method: 'method',
      error: 'error',
    },
  },
  'connectionManager.registered.client.for.preset.notifications.81bba02b': {
    message: 'Registered client for preset notifications',
    fields: {
      sessionId: 'identity:session',
    },
  },
  'mcpLoggingEnhancer.mcp.request.837d8877': {
    message: 'MCP Request',
    fields: {
      requestId: 'identity:request',
      method: 'method',
    },
  },
  'mcpLoggingEnhancer.mcp.response.7a62c1df': {
    message: 'MCP Response',
    fields: {
      requestId: 'identity:request',
      duration: 'number',
    },
  },
  'mcpLoggingEnhancer.mcp.error.62447971': {
    message: 'MCP Error',
    fields: {
      requestId: 'identity:request',
      error: 'error',
      duration: 'number',
    },
  },
  'mcpLoggingEnhancer.mcp.notification.867bb301': {
    message: 'MCP Notification',
    fields: {
      method: 'method',
    },
  },
  'mcpLoggingEnhancer.sending.notification.20ae8d0b': {
    message: 'Sending notification',
    fields: {
      requestId: 'identity:request',
    },
  },
  'mcpLoggingEnhancer.sending.request.ee0ac423': {
    message: 'Sending request',
    fields: {
      requestId: 'identity:request',
    },
  },
  'mcpLoggingEnhancer.attempted.to.send.notification.on.disconnected.transport.244c8d91': {
    message: 'Attempted to send notification on disconnected transport',
    fields: {
      error: 'error',
    },
  },
  'mcpServerLifecycleManager.starting.mcp.server.c60fd61a': {
    message: 'Starting MCP server: <private>',
    fields: {},
  },
  'mcpServerLifecycleManager.server.is.already.running.67a5851c': {
    message: 'Server <private> is already running',
    fields: {},
  },
  'mcpServerLifecycleManager.server.is.disabled.skipping.start.ba9a2684': {
    message: 'Server <private> is disabled, skipping start',
    fields: {},
  },
  'mcpServerLifecycleManager.successfully.started.mcp.server.3355cad1': {
    message: 'Successfully started MCP server: <private>',
    fields: {},
  },
  'mcpServerLifecycleManager.failed.to.start.mcp.server.3fd8e8c1': {
    message: 'Failed to start MCP server <private>:',
    fields: {
      error: 'error',
    },
  },
  'mcpServerLifecycleManager.stopping.mcp.server.f57921e8': {
    message: 'Stopping MCP server: <private>',
    fields: {},
  },
  'mcpServerLifecycleManager.server.is.not.running.8e5bdcc3': {
    message: 'Server <private> is not running',
    fields: {},
  },
  'mcpServerLifecycleManager.error.closing.transport.for.server.4689317f': {
    message: 'Error closing transport for server <private>:',
    fields: {
      error: 'error',
    },
  },
  'mcpServerLifecycleManager.successfully.stopped.mcp.server.f5e283e8': {
    message: 'Successfully stopped MCP server: <private>',
    fields: {},
  },
  'mcpServerLifecycleManager.failed.to.stop.mcp.server.b33787bf': {
    message: 'Failed to stop MCP server <private>:',
    fields: {
      error: 'error',
    },
  },
  'mcpServerLifecycleManager.restarting.mcp.server.dd07115c': {
    message: 'Restarting MCP server: <private>',
    fields: {},
  },
  'mcpServerLifecycleManager.stopping.existing.server.before.restart.f0a20e9f': {
    message: 'Stopping existing server <private> before restart',
    fields: {},
  },
  'mcpServerLifecycleManager.successfully.restarted.mcp.server.c9b33cb7': {
    message: 'Successfully restarted MCP server: <private>',
    fields: {},
  },
  'mcpServerLifecycleManager.failed.to.restart.mcp.server.8b93a852': {
    message: 'Failed to restart MCP server <private>:',
    fields: {
      error: 'error',
    },
  },
  'mcpServerLifecycleManager.tracked.mcp.server.lifecycle.state.9f4bff42': {
    message: 'Tracked MCP server lifecycle state: <private>',
    fields: {
      serverName: 'identity:server',
    },
  },
  'mcpServerLifecycleManager.untracked.mcp.server.lifecycle.state.5d6dfa5a': {
    message: 'Untracked MCP server lifecycle state: <private>',
    fields: {},
  },
  'mcpServerLifecycleManager.cannot.update.metadata.for.server.not.running.f11c2348': {
    message: 'Cannot update metadata for <private>: server not running',
    fields: {},
  },
  'mcpServerLifecycleManager.updating.metadata.for.server.e21816d0': {
    message: 'Updating metadata for server <private>',
    fields: {},
  },
  'mcpServerLifecycleManager.successfully.updated.metadata.for.server.03355998': {
    message: 'Successfully updated metadata for server <private>',
    fields: {},
  },
  'mcpServerLifecycleManager.failed.to.update.metadata.for.server.5f509b50': {
    message: 'Failed to update metadata for server <private>:',
    fields: {
      error: 'error',
    },
  },
  'mcpServerLifecycleManager.creating.transport.for.server.b7871772': {
    message: 'Creating transport for server <private>',
    fields: {
      serverName: 'identity:server',
    },
  },
  'mcpServerLifecycleManager.successfully.created.transport.for.server.8226be48': {
    message: 'Successfully created transport for server <private>',
    fields: {
      serverName: 'identity:server',
    },
  },
  'mcpServerLifecycleManager.failed.to.create.transport.for.server.98caaa0f': {
    message: 'Failed to create transport for server <private>:',
    fields: {
      error: 'error',
    },
  },
  'mcpServerLifecycleManager.successfully.connected.to.server.80d84788': {
    message: 'Successfully connected to server <private>',
    fields: {
      serverName: 'identity:server',
      status: 'status',
    },
  },
  'mcpServerLifecycleManager.failed.to.connect.to.server.143a5977': {
    message: 'Failed to connect to server <private>:',
    fields: {
      error: 'error',
    },
  },
  'mcpServerLifecycleManager.successfully.disconnected.from.server.7a6f427d': {
    message: 'Successfully disconnected from server <private>',
    fields: {
      serverName: 'identity:server',
    },
  },
  'mcpServerLifecycleManager.failed.to.disconnect.from.server.98663348': {
    message: 'Failed to disconnect from server <private>:',
    fields: {
      error: 'error',
    },
  },
  'serverManager.instruction.aggregator.set.for.servermanager.628c189d': {
    message: 'Instruction aggregator set for ServerManager',
    fields: {},
  },
  'serverManager.lazy.loading.orchestrator.set.for.servermanager.5ed9fbc7': {
    message: 'Lazy loading orchestrator set for ServerManager',
    fields: {},
  },
  'serverManager.context.changed.reprocessing.templates.8032c915': {
    message: 'Context changed, reprocessing templates',
    fields: {
      sessionId: 'identity:session',
    },
  },
  'serverManager.failed.to.update.all.servers.with.new.config.attempting.individual.updates.e3f92fcd': {
    message: 'Failed to update all servers with new config, attempting individual updates:',
    fields: {
      error: 'error',
    },
  },
  'serverManager.failed.to.reprocess.templates.after.context.change.6336fe5a': {
    message: 'Failed to reprocess templates after context change:',
    fields: {
      error: 'error',
    },
  },
  'serverManager.context.change.listener.set.up.for.servermanager.c29a6af5': {
    message: 'Context change listener set up for ServerManager',
    fields: {},
  },
  'serverManager.server.instructions.have.changed.active.sessions.1b5c23dd': {
    message: 'Server instructions have changed. Active sessions: <private>',
    fields: {},
  },
  'serverManager.instructions.changed.notification.for.session.e77f51eb': {
    message: 'Instructions changed notification for session <private>',
    fields: {
      sessionId: 'identity:session',
    },
  },
  'serverManager.failed.to.process.instruction.change.for.session.7812ecda': {
    message: 'Failed to process instruction change for session <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'serverManager.some.templates.could.not.be.rendered.during.runtime.scope.environment.reloa.8735ff3f': {
    message: 'Some templates could not be rendered during Runtime Scope environment reload',
    fields: {
      templateCount: 'number',
      errorCount: 'number',
    },
  },
  'serverManager.failed.to.refresh.lazy.backend.capabilities.e65163b1': {
    message: 'Failed to refresh lazy backend capabilities: <private>',
    fields: {
      error: 'error',
    },
  },
  'serverManager.failed.to.send.to.an.inbound.client.cefdc74d': {
    message: 'Failed to send <private> to an inbound client: <private>',
    fields: {
      error: 'error',
    },
  },
  'serverManager.skipping.lifecycle.tracking.for.loading.state.is.251276d7': {
    message: 'Skipping lifecycle tracking for <private>; loading state is <private>',
    fields: {},
  },
  'serverManager.no.config.available.to.track.lifecycle.for.aed42e6a': {
    message: 'No config available to track lifecycle for <private>',
    fields: {},
  },
  'serverManager.no.connected.transport.available.to.track.lifecycle.for.a989596e': {
    message: 'No connected transport available to track lifecycle for <private>',
    fields: {},
  },
  'serverManager.could.not.resolve.config.for.1b2ab699': {
    message: 'Could not resolve config for <private>: <private>',
    fields: {},
  },
  'serverManager.filter.cache.cleared.fa88f2ab': {
    message: 'Filter cache cleared',
    fields: {},
  },
  'serverManager.servermanager.cleanup.completed.155038e7': {
    message: 'ServerManager cleanup completed',
    fields: {},
  },
  'templateServerCleanup.removing.client.from.template.instances.5ecc2955': {
    message: 'Removing client from <private> template instances',
    fields: {
      sessionId: 'identity:session',
    },
  },
  'templateServerCleanup.templateservermanager.cleanuptemplateservers.successfully.removed.client.fr.69ab5186': {
    message: 'TemplateServerManager.cleanupTemplateServers: Successfully removed client from client instance',
    fields: {
      sessionId: 'identity:session',
    },
  },
  'templateServerCleanup.failed.to.cleanup.client.instance.795b730f': {
    message: 'Failed to cleanup client instance <private>:',
    fields: {
      error: 'error',
      sessionId: 'identity:session',
    },
  },
  'templateServerCleanup.cleaned.up.template.client.instances.for.session.61999099': {
    message: 'Cleaned up template client instances for session <private>',
    fields: {},
  },
  'templateServerCleanup.expired.ephemeral.template.client.17c64c77': {
    message: 'Expired ephemeral template client',
    fields: {
      sessionId: 'identity:session',
    },
  },
  'templateServerCleanup.removed.shareable.template.server.from.outbound.connections.45ac528c': {
    message: 'Removed shareable template server from outbound connections: <private>',
    fields: {},
  },
  'templateServerCleanup.removed.template.server.from.outbound.connections.705ab981': {
    message: 'Removed template server from outbound connections: <private>',
    fields: {},
  },
  'templateServerCleanup.shareable.template.server.still.has.clients.keeping.connection.f619a95b': {
    message: 'Shareable template server still has clients, keeping connection',
    fields: {},
  },
  'templateServerCleanup.removed.transport.for.instance.29f67138': {
    message: 'Removed transport for instance: <private>',
    fields: {},
  },
  'templateServerCleanup.client.instance.has.no.more.clients.marking.as.idle.for.cleanup.after.timeo.f1e0ff23': {
    message: 'Client instance <private> has no more clients, marking as idle for cleanup after timeout',
    fields: {},
  },
  'templateServerCleanup.client.instance.still.has.clients.keeping.connection.open.31b49148': {
    message: 'Client instance <private> still has <private> clients, keeping connection open',
    fields: {},
  },
  'templateServerManager.error.during.idle.instance.cleanup.0cf54b4e': {
    message: 'Error during idle instance cleanup:',
    fields: {
      error: 'error',
    },
  },
  'templateServerManager.templateservermanager.cleanup.timer.started.cd54a757': {
    message: 'TemplateServerManager cleanup timer started',
    fields: {},
  },
  'templateServerManager.creating.template.based.servers.for.session.63a3dddd': {
    message: 'Creating <private> template-based servers for session <private>',
    fields: {},
  },
  'templateServerManager.cached.instructions.for.template.server.ee449e76': {
    message: 'Cached instructions for template server: <private>',
    fields: {},
  },
  'templateServerManager.failed.to.extract.instructions.from.template.server.07ebbee8': {
    message: 'Failed to extract instructions from template server <private>: <private>',
    fields: {
      error: 'error',
    },
  },
  'templateServerManager.templateservermanager.createtemplatebasedservers.tracked.client.template.re.b792872d': {
    message: 'TemplateServerManager.createTemplateBasedServers: Tracked client-template relationship',
    fields: {
      sessionId: 'identity:session',
      referenceCount: 'number',
    },
  },
  'templateServerManager.connected.to.template.client.instance.871228b8': {
    message: 'Connected to template client instance: <private> (<private>)',
    fields: {
      sessionId: 'identity:session',
      clientCount: 'number',
    },
  },
  'templateServerManager.failed.to.create.client.instance.from.template.eac81d4e': {
    message: 'Failed to create client instance from template <private>:',
    fields: {
      error: 'error',
    },
  },
  'templateServerManager.templateservermanager.getmatchingtemplateconfigs.using.enhanced.filtering.f761ab86': {
    message: 'TemplateServerManager.getMatchingTemplateConfigs: Using enhanced filtering',
    fields: {},
  },
  'templateServerManager.cleaned.up.idle.client.instance.e6d1bdd9': {
    message: 'Cleaned up idle client instance: <private>:<private>',
    fields: {},
  },
  'templateServerManager.failed.to.cleanup.idle.client.instance.3f56809c': {
    message: 'Failed to cleanup idle client instance <private>:<private>:',
    fields: {
      error: 'error',
    },
  },
  'templateServerManager.cleaned.up.idle.client.instances.dbdf5f7d': {
    message: 'Cleaned up <private> idle client instances',
    fields: {},
  },
  'templateServerManager.template.index.rebuilt.6dc6c57a': {
    message: 'Template index rebuilt',
    fields: {},
  },
  'templateServerManager.failed.to.retire.template.instances.for.8a4fcc86': {
    message: 'Failed to retire template instances for <private>:',
    fields: {
      error: 'error',
    },
  },
  'templateServerManager.retired.template.instance.s.after.configuration.replacement.a1e75268': {
    message: 'Retired <private> template instance(s) after configuration replacement',
    fields: {},
  },
  'templateServerManager.failed.to.clean.up.template.server.manager.3b6ac013': {
    message: 'Failed to clean up template server manager:',
    fields: {
      error: 'error',
    },
  },
  'loggingSseTransport.json.rpc.error.response.6ba80f1a': {
    message: 'JSON-RPC error response',
    fields: {
      error: 'error',
      requestId: 'identity:request',
      sessionId: 'identity:session',
    },
  },
  'scopeAuthMiddleware.scope.auth.middleware.error.8db4aa86': {
    message: 'Scope auth middleware error:',
    fields: {
      error: 'error',
    },
  },
  'sseRoutes.async.loading.notifications.initialized.for.sse.session.2bbc6561': {
    message: 'Async loading notifications initialized for SSE session <private>',
    fields: {},
  },
  'sseRoutes.sse.heartbeat.failed.for.session.closing.connection.e0165d88': {
    message: 'SSE heartbeat failed for session <private>, closing connection',
    fields: {
      error: 'error',
    },
  },
  'sseRoutes.sse.transport.error.for.session.d3add0c1': {
    message: 'SSE transport error for session <private>:',
    fields: {
      error: 'error',
    },
  },
  'sseRoutes.sse.connection.error.b6fc4ad6': {
    message: 'SSE connection error:',
    fields: {
      error: 'error',
    },
  },
  'sseRoutes.message.handling.error.353d0f66': {
    message: 'Message handling error:',
    fields: {
      error: 'error',
    },
  },
  'server.authentication.enabled.oauth.2.1.endpoints.available.via.sdk.2d8726c6': {
    message: 'Authentication enabled - OAuth 2.1 endpoints available via SDK',
    fields: {},
  },
  'server.authentication.disabled.all.endpoints.accessible.without.auth.1dd4346d': {
    message: 'Authentication disabled - all endpoints accessible without auth',
    fields: {},
  },
  'server.server.is.running.on.port.with.http.sse.and.streamable.http.transport.b730b0c1': {
    message: 'Server is running on port <private> with HTTP/SSE and Streamable HTTP transport <private>',
    fields: {},
  },
  'server.oauth.management.dashboard.oauth.4eaf12e9': {
    message: '📋 OAuth Management Dashboard: <private>/oauth',
    fields: {},
  },
  'streamableSessionLifecycle.invalid.sessionid.provided.to.streamable.lifecycle.lookup.946c0da3': {
    message: 'Invalid sessionId provided to streamable lifecycle lookup',
    fields: {},
  },
  'streamableSessionLifecycle.no.persisted.session.found.for.1fd9955e': {
    message: 'No persisted session found for: <private>',
    fields: {},
  },
  'streamableSessionLifecycle.session.exists.but.lacks.initialize.response.data.cannot.restore.01883ab6': {
    message: 'Session <private> exists but lacks initialize response data, cannot restore',
    fields: {},
  },
  'streamableSessionLifecycle.failed.to.parse.session.config.for.db7489eb': {
    message: 'Failed to parse session config for <private>',
    fields: {},
  },
  'streamableSessionLifecycle.restoring.streamable.session.35290bd2': {
    message: 'Restoring streamable session: <private>',
    fields: {},
  },
  'streamableSessionLifecycle.failed.to.connect.transport.90a65f89': {
    message: 'Failed to connect transport <private>:',
    fields: {
      error: 'error',
    },
  },
  'streamableSessionLifecycle.could.not.set.initialized.state.during.session.restoration.69095992': {
    message: 'Could not set initialized state during session restoration',
    fields: {
      method: 'method',
      sessionId: 'identity:session',
    },
  },
  'streamableSessionLifecycle.successfully.restored.streamable.session.restored.9648c603': {
    message: 'Successfully restored streamable session: <private> (restored: <private>)',
    fields: {},
  },
  'streamableSessionLifecycle.failed.to.restore.streamable.session.bf5b6a04': {
    message: 'Failed to restore streamable session <private>:',
    fields: {
      error: 'error',
    },
  },
  'streamableSessionLifecycle.failed.to.create.transport.for.session.9aa73ada': {
    message: 'Failed to create transport for session <private>:',
    fields: {
      error: 'error',
    },
  },
  'streamableSessionLifecycle.new.session.with.context.90e138c1': {
    message: 'New session with context: <private> (<private>)<private>',
    fields: {},
  },
  'streamableSessionLifecycle.failed.to.connect.transport.43c1f33b': {
    message: 'Failed to connect transport <private>:',
    fields: {
      error: 'error',
    },
  },
  'streamableSessionLifecycle.failed.to.persist.session.to.repository.b76407ee': {
    message: 'Failed to persist session <private> to repository: <private>',
    fields: {
      error: 'error',
    },
  },
  'streamableSessionLifecycle.session.deletion.failed.b8bfdce6': {
    message: 'Session deletion failed',
    fields: {
      method: 'method',
      sessionId: 'identity:session',
      error: 'error',
    },
  },
  'streamableSessionLifecycle.async.loading.notifications.initialized.for.streamable.http.session.a7a97183': {
    message: 'Async loading notifications initialized for Streamable HTTP session <private>',
    fields: {},
  },
  'streamableSessionLifecycle.streamable.http.transport.error.for.session.e5ad1f60': {
    message: 'Streamable HTTP transport error for session <private>:',
    fields: {
      error: 'error',
    },
  },
  'streamableSessionLifecycle.sdk.internal.property.initialized.is.not.a.boolean.94489996': {
    message: 'SDK internal property _initialized is not a boolean',
    fields: {
      method: 'method',
      sessionId: 'identity:session',
    },
  },
  'streamableSessionLifecycle.sdk.internal.property.sessionid.is.not.a.string.bfe837aa': {
    message: 'SDK internal property sessionId is not a string',
    fields: {
      method: 'method',
      sessionId: 'identity:session',
    },
  },
  'streamableSessionLifecycle.sdk.internal.structure.changed.webstandardtransport.not.found.19217e0c': {
    message: 'SDK internal structure changed - _webStandardTransport not found',
    fields: {
      method: 'method',
      sessionId: 'identity:session',
    },
  },
  'streamableSessionLifecycle.failed.to.set.initialized.state.0d182a79': {
    message: 'Failed to set initialized state',
    fields: {
      method: 'method',
      sessionId: 'identity:session',
      error: 'error',
    },
  },
  'restartableStdioTransport.creating.restartablestdiotransport.for.command.47f816cd': {
    message: 'Creating RestartableStdioTransport for command: <private>',
    fields: {},
  },
  'restartableStdioTransport.transport.error.206094be': {
    message: 'Transport error: <private>',
    fields: {},
  },
  'restartableStdioTransport.max.restart.limit.reached.stopping.transport.9801e607': {
    message: 'Max restart limit reached (<private>), stopping transport',
    fields: {},
  },
  'restartableStdioTransport.attempting.transport.restart.in.ms.9f524f64': {
    message: 'Attempting transport restart <private> in <private>ms...',
    fields: {},
  },
  'restartableStdioTransport.transport.restarted.successfully.attempt.471bf3a9': {
    message: 'Transport restarted successfully (attempt <private>)',
    fields: {},
  },
  'restartableStdioTransport.transport.restart.failed.9ee7466c': {
    message: 'Transport restart failed: <private>',
    fields: {
      error: 'error',
    },
  },
  'restartableStdioTransport.restartablestdiotransport.started.successfully.4b4aa2ac': {
    message: 'RestartableStdioTransport started successfully',
    fields: {},
  },
  'restartableStdioTransport.restartablestdiotransport.closed.9292005e': {
    message: 'RestartableStdioTransport closed',
    fields: {},
  },
  'stdioProxyTransport.detected.proxy.context.2cbf19e3': {
    message: '🔍 Detected proxy context',
    fields: {
      sessionId: 'identity:session',
    },
  },
  'stdioProxyTransport.proxy.connecting.with.meta.field.approach.7b806ac5': {
    message: '📡 Proxy connecting with _meta field approach',
    fields: {},
  },
  'stdioProxyTransport.connected.to.1mcp.http.server.a68b24a9': {
    message: 'Connected to 1MCP HTTP server',
    fields: {},
  },
  'stdioProxyTransport.stdio.proxy.started.successfully.a07d7f6c': {
    message: 'STDIO proxy started successfully',
    fields: {},
  },
  'stdioProxyTransport.failed.to.start.stdio.proxy.4f7542ea': {
    message: 'Failed to start STDIO proxy: <private>',
    fields: {
      error: 'error',
    },
  },
  'stdioProxyTransport.error.forwarding.http.message.to.stdio.8ee2e23a': {
    message: 'Error forwarding HTTP message to STDIO: <private>',
    fields: {
      error: 'error',
    },
  },
  'stdioProxyTransport.http.transport.error.f0ffb32a': {
    message: 'HTTP transport error: <private>',
    fields: {},
  },
  'stdioProxyTransport.http.server.connection.closed.18f12143': {
    message: 'HTTP server connection closed',
    fields: {},
  },
  'stdioProxyTransport.extracted.client.info.from.initialize.request.3006194b': {
    message: '🔍 Extracted client info from initialize request',
    fields: {},
  },
  'stdioProxyTransport.client.info.extracted.user.agent.will.be.updated.for.all.requests.0f9d91f0': {
    message: '✅ Client info extracted - User-Agent will be updated for all requests',
    fields: {},
  },
  'stdioProxyTransport.error.forwarding.stdio.message.to.http.a4e22130': {
    message: 'Error forwarding STDIO message to HTTP: <private>',
    fields: {
      error: 'error',
    },
  },
  'stdioProxyTransport.stdio.transport.error.c61c2ede': {
    message: 'STDIO transport error: <private>',
    fields: {},
  },
  'stdioProxyTransport.stdio.transport.closed.6ca9f513': {
    message: 'STDIO transport closed',
    fields: {},
  },
  'stdioProxyTransport.error.closing.stdio.proxy.7c69038d': {
    message: 'Error closing STDIO proxy: <private>',
    fields: {},
  },
  'stdioProxyTransport.stdio.proxy.closed.abcc8556': {
    message: 'STDIO proxy closed',
    fields: {},
  },
  'transportFactory.transport.type.is.missing.for.inferring.type.9480baa6': {
    message: 'Transport type is missing for <private>, inferring type...',
    fields: {},
  },
  'transportFactory.inferred.transport.type.for.as.stdio.872f7bbf': {
    message: 'Inferred transport type for <private> as stdio',
    fields: {},
  },
  'transportFactory.inferred.transport.type.for.as.http.streamablehttp.a04e00f3': {
    message: 'Inferred transport type for <private> as http/streamableHttp',
    fields: {},
  },
  'transportFactory.inferred.transport.type.for.as.sse.cb39afb8': {
    message: 'Inferred transport type for <private> as sse',
    fields: {},
  },
  'transportFactory.creating.oauth.client.provider.for.transport.8f8cab56': {
    message: 'Creating OAuth client provider for transport: <private>',
    fields: {},
  },
  'transportFactory.environment.processing.for.8d6ae20a': {
    message: 'Environment processing for <private>:',
    fields: {},
  },
  'transportFactory.creating.stdio.transport.for.5144d47e': {
    message: 'Creating stdio transport for: <private>',
    fields: {},
  },
  'transportFactory.enabling.runtime.owned.stdio.supervision.for.2c7492df': {
    message: 'Enabling runtime-owned stdio supervision for: <private>',
    fields: {},
  },
  'transportFactory.skipping.disabled.transport.73e8cdef': {
    message: 'Skipping disabled transport: <private>',
    fields: {},
  },
  'transportFactory.created.transport.ceb8aba0': {
    message: 'Created transport: <private>',
    fields: {},
  },
  'transportFactory.invalid.transport.configuration.for.16ba9e31': {
    message: 'Invalid transport configuration for <private>:',
    fields: {
      error: 'error',
    },
  },
  'transportFactory.error.creating.transport.41b4df19': {
    message: 'Error creating transport <private>:',
    fields: {
      error: 'error',
    },
  },
  'transportFactory.processing.templates.for.server.2b8ad056': {
    message: 'Processing templates for server',
    fields: {
      serverName: 'identity:server',
    },
  },
  'transportFactory.templates.processed.successfully.07a2246b': {
    message: 'Templates processed successfully',
    fields: {
      serverName: 'identity:server',
    },
  },
  'server.created.static.transports.template.servers.will.be.created.per.client.c973cddd': {
    message: 'Created <private> static transports (template servers will be created per-client)',
    fields: {},
  },
  'server.skipping.initial.template.index.because.the.declared.configuration.is.inval.4ec2bdfc': {
    message: 'Skipping initial template index because the declared configuration is invalid',
    fields: {},
  },
  'server.using.async.loading.mode.http.server.will.start.immediately.mcp.servers.loa.d02f7566': {
    message: 'Using async loading mode - HTTP server will start immediately, MCP servers load in background',
    fields: {},
  },
  'server.using.legacy.synchronous.loading.mode.waiting.for.all.mcp.servers.before.st.0511e111': {
    message: 'Using legacy synchronous loading mode - waiting for all MCP servers before starting HTTP server',
    fields: {},
  },
  'server.failed.to.set.up.server.8f1b49ea': {
    message: 'Failed to set up server: <private>',
    fields: {
      error: 'error',
    },
  },
  'server.instruction.aggregator.initialized.e753c4c6': {
    message: 'Instruction aggregator initialized',
    fields: {},
  },
  'server.initialized.storage.for.mcp.servers.fbc15149': {
    message: 'Initialized storage for <private> MCP servers',
    fields: {},
  },
  'server.lazy.loading.orchestrator.initialized.630c4de5': {
    message: 'Lazy loading orchestrator initialized',
    fields: {},
  },
  'server.all.mcp.servers.finished.loading.successfully.or.failed.c38ed544': {
    message: 'All MCP servers finished loading (successfully or failed)',
    fields: {},
  },
  'server.mcp.loading.process.encountered.an.error.7f0984df': {
    message: 'MCP loading process encountered an error:',
    fields: {},
  },
  'server.async.server.setup.completed.http.server.ready.mcp.servers.loading.in.backg.c75ae6ef': {
    message: 'Async server setup completed - HTTP server ready, MCP servers loading in background',
    fields: {},
  },
  'server.connected.to.mcp.servers.synchronously.cb5b7480': {
    message: 'Connected to <private> MCP servers synchronously',
    fields: {},
  },
  'server.synchronous.server.setup.completed.all.mcp.servers.connected.5893f787': {
    message: 'Synchronous server setup completed - all MCP servers connected',
    fields: {},
  },
  'server.preset.changed.sending.notifications.0e9970c7': {
    message: 'Preset changed, sending notifications',
    fields: {},
  },
  'server.preset.management.system.initialized.successfully.df5fbccc': {
    message: 'Preset management system initialized successfully',
    fields: {},
  },
  'server.failed.to.initialize.preset.system.7da5a6aa': {
    message: 'Failed to initialize preset system',
    fields: {
      error: 'error',
    },
  },
  'errorHandler.express.error.037179d1': {
    message: 'Express error:',
    fields: {
      error: 'error',
    },
  },
  'httpRequestLogger.diagnostic.ed4616ea': {
    message: 'HTTP request received',
    fields: {
      method: 'method',
    },
  },
  'httpRequestLogger.completed.0faf4b4c': {
    message: 'HTTP request completed',
    fields: {
      statusCode: 'number',
      duration: 'number',
    },
  },
  'mcpAvailabilityMiddleware.no.loading.manager.assuming.all.servers.available.a8e72968': {
    message: 'No loading manager - assuming all servers available',
    fields: {},
  },
  'mcpAvailabilityMiddleware.filtered.servers.with.tags.dd0e332f': {
    message: 'Filtered <private>/<private> servers with tags: <private>',
    fields: {},
  },
  'mcpAvailabilityMiddleware.checking.availability.for.all.servers.bc8c113e': {
    message: 'Checking availability for all <private> servers',
    fields: {},
  },
  'mcpAvailabilityMiddleware.mcp.availability.ready.5134e4c0': {
    message: 'MCP Availability: <private>/<private> ready, <private> <private>',
    fields: {},
  },
  'mcpAvailabilityMiddleware.no.mcp.servers.available.for.request.068382c0': {
    message: 'No MCP servers available for request',
    fields: {},
  },
  'mcpAvailabilityMiddleware.proceeding.with.partial.mcp.availability.servers.ready.415db11a': {
    message: 'Proceeding with partial MCP availability: <private>/<private> servers ready',
    fields: {},
  },
  'mcpAvailabilityMiddleware.partial.mcp.availability.not.allowed.blocking.request.c8b5f2c0': {
    message: 'Partial MCP availability not allowed - blocking request',
    fields: {},
  },
  'mcpAvailabilityMiddleware.mcp.availability.check.failed.31542fd1': {
    message: 'MCP availability check failed:',
    fields: {
      error: 'error',
    },
  },
  'securityMiddleware.rate.limit.exceeded.for.sensitive.operation.a7edd8d0': {
    message: 'Rate limit exceeded for sensitive operation',
    fields: {},
  },
  'securityMiddleware.suspicious.content.detected.in.ead2ecd1': {
    message: 'Suspicious content detected in <private>',
    fields: {},
  },
  'securityMiddleware.security.relevant.request.0633a217': {
    message: 'Security-relevant request',
    fields: {
      method: 'method',
    },
  },
  'securityMiddleware.security.relevant.response.9de4a676': {
    message: 'Security-relevant response',
    fields: {
      statusCode: 'number',
      duration: 'number',
    },
  },
  'tagsExtractor.failed.to.process.preset.tag.query.0a4eeb36': {
    message: 'Failed to process preset tag query',
    fields: {},
  },
  'tagsExtractor.filter.selection.failed.95a9f552': {
    message: 'Filter selection failed',
    fields: {
      error: 'error',
    },
  },
  'cliTokenRoute.cli.token.generated.for.localhost.71ee18e2': {
    message: 'CLI token generated for localhost',
    fields: {},
  },
  'healthRoutes.health.check.requested.c7d30314': {
    message: 'Health check requested',
    fields: {},
  },
  'healthRoutes.health.check.completed.with.status.09839ae4': {
    message: 'Health check completed with status: <private>',
    fields: {},
  },
  'healthRoutes.health.check.failed.cbb24dd0': {
    message: 'Health check failed:',
    fields: {
      error: 'error',
    },
  },
  'healthRoutes.readiness.check.failed.47f64368': {
    message: 'Readiness check failed:',
    fields: {
      error: 'error',
    },
  },
  'healthRoutes.mcp.loading.status.check.failed.a32dd491': {
    message: 'MCP loading status check failed:',
    fields: {
      error: 'error',
    },
  },
  'healthRoutes.server.specific.loading.status.check.failed.for.6b09a123': {
    message: 'Server-specific loading status check failed for <private>:',
    fields: {
      error: 'error',
    },
  },
  'inspectRoutes.failed.to.fetch.tool.count.for.server.dd730669': {
    message: "Failed to fetch tool count for server '<private>':",
    fields: {
      error: 'error',
    },
  },
  'inspectRoutes.api.servers.handler.error.3f8f6a2f': {
    message: 'API servers handler error:',
    fields: {
      error: 'error',
    },
  },
  'inspectRoutes.api.inspect.handler.error.82182dae': {
    message: 'API inspect handler error:',
    fields: {
      error: 'error',
    },
  },
  'instructionsRoutes.api.instructions.handler.error.cbd7a545': {
    message: 'API instructions handler error:',
    fields: {
      error: 'error',
    },
  },
  'oauthRoutes.error.starting.oauth.for.88e8a703': {
    message: 'Error starting OAuth for <private>:',
    fields: {
      error: 'error',
    },
  },
  'oauthRoutes.oauth.callback.failed.for.e5feb0e3': {
    message: 'OAuth callback failed for <private>:',
    fields: {},
  },
  'oauthRoutes.error.handling.oauth.callback.for.41be0569': {
    message: 'Error handling OAuth callback for <private>:',
    fields: {
      error: 'error',
    },
  },
  'oauthRoutes.error.restarting.oauth.for.c39e1d9b': {
    message: 'Error restarting OAuth for <private>:',
    fields: {
      error: 'error',
    },
  },
  'oauthRoutes.error.handling.consent.form.3b43829f': {
    message: 'Error handling consent form:',
    fields: {
      error: 'error',
    },
  },
  'oauthRoutes.updated.loadingstatetracker.is.now.ready.after.oauth.completion.83008138': {
    message: 'Updated LoadingStateTracker: <private> is now Ready after OAuth completion',
    fields: {},
  },
  'oauthRoutes.could.not.update.loadingstatetracker.for.2da895a0': {
    message: 'Could not update LoadingStateTracker for <private>',
    fields: {
      error: 'error',
    },
  },
  'streamableHttpRoutes.failed.to.extract.protocol.version.from.request.body.3edac56e': {
    message: 'Failed to extract protocol version from request body',
    fields: {},
  },
  'streamableHttpRoutes.sdk.error.details.0633179d': {
    message: 'SDK error details',
    fields: {
      sessionId: 'identity:session',
    },
  },
  'streamableHttpRoutes.client.disconnected.for.session.cleaning.up.transport.eca47590': {
    message: 'Client disconnected for session <private>, cleaning up transport',
    fields: {},
  },
  'streamableHttpRoutes.new.session.was.created.but.not.persisted.c1345354': {
    message: 'New session <private> was created but not persisted: <private>',
    fields: {},
  },
  'streamableHttpRoutes.handling.request.for.restored.session.3031f880': {
    message: 'Handling request for restored session',
    fields: {
      sessionId: 'identity:session',
      method: 'method',
    },
  },
  'streamableHttpRoutes.stored.initialize.response.for.session.9fcc1c4d': {
    message: 'Stored initialize response for session <private>',
    fields: {},
  },
  'streamableHttpRoutes.failed.to.store.initialize.response.for.92e5cefc': {
    message: 'Failed to store initialize response for <private>:',
    fields: {
      error: 'error',
    },
  },
  'toolRoutes.failed.to.list.tools.736c81c7': {
    message: 'Failed to list tools',
    fields: {
      error: 'error',
    },
  },
  'toolRoutes.api.tools.handler.error.92efa583': {
    message: 'API tools handler error',
    fields: {
      error: 'error',
    },
  },
  'toolRoutes.direct.tool.invocation.error.ba32e1c5': {
    message: 'Direct tool invocation error',
    fields: {
      error: 'error',
    },
  },
  'toolRoutes.api.tool.invocations.handler.error.398a77aa': {
    message: 'API tool-invocations handler error',
    fields: {
      error: 'error',
    },
  },
  'streamableSessionRepository.created.streamable.session.with.persistence.557ffb00': {
    message: 'Created streamable session with persistence: <private>',
    fields: {},
  },
  'streamableSessionRepository.created.streamable.session.memory.only.177edf2d': {
    message: 'Created streamable session (memory-only): <private>',
    fields: {},
  },
  'streamableSessionRepository.failed.to.parse.tagexpression.for.session.3062cdba': {
    message: 'Failed to parse tagExpression for session <private>:',
    fields: {
      error: 'error',
    },
  },
  'streamableSessionRepository.failed.to.parse.tagquery.for.session.e2fdea72': {
    message: 'Failed to parse tagQuery for session <private>:',
    fields: {
      error: 'error',
    },
  },
  'streamableSessionRepository.failed.to.read.session.from.disk.for.initialize.response.storage.53a45f52': {
    message: 'Failed to read session from disk for initialize response storage',
    fields: {
      method: 'method',
      sessionId: 'identity:session',
      error: 'error',
    },
  },
  'streamableSessionRepository.failed.to.persist.initialize.response.to.disk.1670d212': {
    message: 'Failed to persist initialize response to disk',
    fields: {
      method: 'method',
      sessionId: 'identity:session',
      error: 'error',
    },
  },
  'streamableSessionRepository.stored.initialize.response.for.session.0bb8db59': {
    message: 'Stored initialize response for session <private>',
    fields: {},
  },
  'streamableSessionRepository.session.not.found.for.storing.initialize.response.953c2a35': {
    message: 'Session not found for storing initialize response',
    fields: {
      method: 'method',
      sessionId: 'identity:session',
    },
  },
  'streamableSessionRepository.unexpected.error.storing.initialize.response.c53c0757': {
    message: 'Unexpected error storing initialize response',
    fields: {
      method: 'method',
      sessionId: 'identity:session',
      error: 'error',
    },
  },
  'streamableSessionRepository.deleted.streamable.session.3753f41c': {
    message: 'Deleted streamable session: <private>',
    fields: {},
  },
  'streamableSessionRepository.deleted.streamable.session.from.memory.b7e93c14': {
    message: 'Deleted streamable session from memory: <private>',
    fields: {},
  },
  'streamableSessionRepository.persisted.access.time.for.streamable.session.014d887e': {
    message: 'Persisted access time for streamable session: <private>',
    fields: {},
  },
  'streamableSessionRepository.failed.to.persist.background.session.access.f1b04c62': {
    message: 'Failed to persist background session access',
    fields: {
      method: 'method',
      sessionId: 'identity:session',
      error: 'error',
    },
  },
  'streamableSessionRepository.flushed.dirty.sessions.a83d53f1': {
    message: 'Flushed <private> dirty sessions',
    fields: {},
  },
  'streamableSessionRepository.stopped.periodic.flush.and.flushed.remaining.dirty.sessions.8bacd338': {
    message: 'Stopped periodic flush and flushed remaining dirty sessions',
    fields: {},
  },
  'contextExtractor.invalid.context.structure.in.meta.field.ignoring.context.1c280335': {
    message: 'Invalid context structure in _meta field, ignoring context',
    fields: {},
  },
  'contextExtractor.failed.to.extract.context.from.meta.field.aac6295e': {
    message: 'Failed to extract context from _meta field:',
    fields: {
      error: 'error',
    },
  },
  'contextExtractor.invalid.context.structure.in.request.query.ignoring.context.3abfbf58': {
    message: 'Invalid context structure in request query, ignoring context',
    fields: {},
  },
  'contextExtractor.failed.to.extract.context.from.request.query.24bc92b4': {
    message: 'Failed to extract context from request query:',
    fields: {
      error: 'error',
    },
  },
  'httpErrorHandler.http.error.400.13c3edd2': {
    message: 'HTTP error 400',
    fields: {
      method: 'method',
      statusCode: 'number',
    },
  },
  'httpErrorHandler.http.error.404.663a1410': {
    message: 'HTTP error 404',
    fields: {
      method: 'method',
      statusCode: 'number',
    },
  },
  'httpErrorHandler.http.error.500.a81f1c79': {
    message: 'HTTP error 500',
    fields: {
      method: 'method',
      sessionId: 'identity:session',
      statusCode: 'number',
      error: 'error',
    },
  },
  'templateContextAuthority.template.context.capability.unreadable.denying.template.context.trust.0baf75b3': {
    message: 'Template context capability unreadable; denying template context trust: <private>',
    fields: {},
  },
  'templateContextAuthority.template.context.audit.detail.167701e4': {
    message: 'Template context audit detail',
    fields: {},
  },
  'errorHandling.witherrorhandling.diagnostic.02762c34': {
    message: 'withErrorHandling diagnostic',
    fields: {
      error: 'error',
    },
  },
  'operationExecution.retrying.operation.on.after.ms.983be1ef': {
    message: 'Retrying operation <private> on <private> after <private>ms',
    fields: {},
  },
  'operationExecution.operation.failed.on.after.attempts.edadbce0': {
    message: 'Operation failed on <private> after <private> attempts: <private>',
    fields: {},
  },
  'filePermissions.self.healed.insecure.0.permissions.to.0600.on.data.file.6c08f3ca': {
    message: 'Self-healed insecure 0<private> permissions to 0600 on <private> data file',
    fields: {},
  },
  'filePermissions.chmod.unsupported.on.volume.filesystem.lacks.posix.modes.degrading.a14d6e0a': {
    message: 'chmod unsupported on <private> volume (<private>) — filesystem lacks POSIX modes, degrading',
    fields: {},
  },
  'filePermissions.self.healed.insecure.storage.directory.permissions.to.0700.9aec7689': {
    message: 'Self-healed insecure storage directory permissions to 0700',
    fields: {},
  },
  'interactiveSelector.interactive.selection.failed.57d1e632': {
    message: 'Interactive selection failed',
    fields: {
      error: 'error',
    },
  },
  'urlGenerator.generated.preset.url.9f63d187': {
    message: 'Generated preset URL',
    fields: {},
  },
  'urlGenerator.generated.tag.filter.url.5064cfdf': {
    message: 'Generated tag filter URL',
    fields: {},
  },
  'urlGenerator.generated.tags.url.deprecated.3e28188a': {
    message: 'Generated tags URL (deprecated)',
    fields: {},
  },
  'urlGenerator.generated.url.9d390e38': {
    message: 'Generated URL',
    fields: {},
  },
  'urlGenerator.url.validation.and.generation.failed.9dfb7037': {
    message: 'URL validation and generation failed',
    fields: {
      error: 'error',
    },
  },
  'urlGenerator.failed.to.parse.url.e2366536': {
    message: 'Failed to parse URL',
    fields: {
      error: 'error',
    },
  },
  'scopeValidation.invalid.tag.scope.format.1dccb63c': {
    message: 'Invalid tag scope format: <private>',
    fields: {},
  },
  'scopeValidation.invalid.input.to.hasrequiredscopes.d06735c9': {
    message: 'Invalid input to hasRequiredScopes',
    fields: {},
  },
  'scopeValidation.insufficient.scopes.for.requested.tags.bbdd46f0': {
    message: 'Insufficient scopes for requested tags',
    fields: {},
  },
  'scopeValidation.scope.operation.614ee0e5': {
    message: 'Scope operation: <private>',
    fields: {
      clientId: 'identity:client',
      success: 'boolean',
      error: 'error',
    },
  },
  'urlDetection.port.scan.probe.failed.on.2076508b': {
    message: 'Port scan probe failed on <private>',
    fields: {
      port: 'number',
      error: 'error',
    },
  },
  'urlDetection.runtime.identity.endpoint.is.unavailable.trying.legacy.oauth.discovery.95d7f295': {
    message: 'Runtime identity endpoint is unavailable; trying legacy OAuth discovery',
    fields: {
      error: 'error',
    },
  },
  'logger.deprecated-level': {
    message:
      'LOG_LEVEL environment variable is deprecated. Please use ONE_MCP_LOG_LEVEL or --log-level CLI option instead.',
    fields: {},
  },
  'logger.callback-failed': {
    message: 'Conditional logging callback failed',
    fields: {
      error: 'error',
    },
  },
  'logger.callback-invalid': {
    message: 'Conditional logging callback returned an invalid event',
    fields: {},
  },
  'runtime.cli-failed': {
    message: 'CLI execution failed',
    fields: {
      error: 'error',
    },
  },
} as const satisfies Record<string, { readonly message: string; readonly fields: Readonly<Record<string, FieldRule>> }>;
export type EventName = keyof typeof EVENT_REGISTRY;
for (const definition of Object.values(EVENT_REGISTRY)) {
  Object.freeze(definition.fields);
  Object.freeze(definition);
}
Object.freeze(EVENT_REGISTRY);

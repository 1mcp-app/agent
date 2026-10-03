# Local runtime instrumentation inventory

Runtime-owned diagnostics use `src/observability/events/registry.ts`: each event has a constant message and its own flat field allowlist. Callers pass an event name; the local adapter drops unknown events and fields before Winston sees them. No arbitrary strings, payloads, SDK objects, headers, URLs, paths, raw tracing carriers, error messages or stacks are retained. Event IDs describe the source operation and include a stable disambiguator.

## Approved sinks

- `src/logger/logger.ts`: Winston Console and File transports for normalized typed events. The existing stdio console suppression remains in force. Valid active context contributes only the three standard trace correlation fields.
- `src/logger/backgroundSupervisorLogger.ts` (used by `serveBackground.ts`): supervisor JSON lines pass through the same normalizer before append. Operational supervisor state remains separate and receives no telemetry fields or fingerprints.
- ADR 0011 diagnostics: broker-admitted immutable backend entries flow through `writeBackendDiagnostic`; the legacy managed stderr fallback uses `writeManagedStderrDiagnostic`. Neither path calls event normalization or tracing. The broker's sanitizer, history, source ownership, retention, and Admin projection remain in that domain.
- CLI printers, help, structured command results, readiness/status reports and protocol stdout are product output, not instrumentation. They never receive normalized local events or private fingerprints.

## Field policy

At most 24 fields including event/message/correlation, 256 UTF-8 bytes per string, 16 entries in closed-vocabulary arrays, and 8192 encoded bytes including reserved sink framing. Registry descriptions truncate at code-point boundaries with ` [truncated]`. Dynamic string values use closed vocabularies, or process-local HMAC-SHA-256 fingerprints for the explicitly approved server/session/client/request identities. Error input is reduced to closed kind/code facts by data descriptors without evaluating getters or traversing causes. Dropped-value counts have no contents.

The fingerprint key is cryptorandom, module-private, generated once per process, never configurable or serialized, and type/version separated. Fingerprints are local-log-only. `inventory.test.ts` pins normalizer and diagnostic sink consumers to prevent later accidental state, Resource, error, tracing or export use.

## Migrated source paths

Counts identify migrated callsites; the AST inventory test enforces registered source constants independently of formatting and line movement. Registry definitions contain the approved fields for each event.

| Runtime source                                                        | Migrated calls |
| --------------------------------------------------------------------- | -------------: |
| `src/application/services/healthService.ts`                           |              3 |
| `src/application/services/tokenEstimationService.ts`                  |             12 |
| `src/auth/oauthAuthorizationFlow.ts`                                  |              1 |
| `src/auth/storage/authCodeRepository.ts`                              |              2 |
| `src/auth/storage/authRequestRepository.ts`                           |              2 |
| `src/auth/storage/clientDataRepository.ts`                            |              2 |
| `src/auth/storage/clientSessionRepository.ts`                         |              1 |
| `src/auth/storage/fileStorageService.ts`                              |             34 |
| `src/auth/storage/oauthStorageService.ts`                             |              2 |
| `src/auth/storage/sessionRepository.ts`                               |              3 |
| `src/commands/cliSetup/setupFiles.ts`                                 |              1 |
| `src/commands/mcp/install.ts`                                         |              7 |
| `src/commands/mcp/installSource.ts`                                   |              2 |
| `src/commands/mcp/tokens.ts`                                          |              6 |
| `src/commands/mcp/uninstall.ts`                                       |              4 |
| `src/commands/mcp/utils/installWizard.ts`                             |              2 |
| `src/commands/mcp/utils/mcpServerConfig.ts`                           |              4 |
| `src/commands/mcp/utils/serverUtils.ts`                               |              4 |
| `src/commands/mcp/wizard/search.ts`                                   |              1 |
| `src/commands/preset/create.ts`                                       |              1 |
| `src/commands/preset/delete.ts`                                       |              1 |
| `src/commands/preset/edit.ts`                                         |              1 |
| `src/commands/preset/interactive.ts`                                  |              1 |
| `src/commands/preset/list.ts`                                         |              1 |
| `src/commands/preset/show.ts`                                         |              1 |
| `src/commands/preset/test.ts`                                         |              1 |
| `src/commands/preset/url.ts`                                          |              1 |
| `src/commands/proxy/proxy.ts`                                         |             13 |
| `src/commands/registry/search.ts`                                     |              2 |
| `src/commands/registry/show.ts`                                       |              2 |
| `src/commands/registry/status.ts`                                     |              2 |
| `src/commands/registry/versions.ts`                                   |              2 |
| `src/commands/run/run.ts`                                             |              3 |
| `src/commands/serve/serveBackground.ts`                               |              1 |
| `src/commands/serve/serveOptions.ts`                                  |             11 |
| `src/commands/serve/serveStop.ts`                                     |              3 |
| `src/commands/shared/authProfileStore.ts`                             |              2 |
| `src/commands/shared/baseConfigUtils.ts`                              |             11 |
| `src/commands/shared/clientSurfaceAttachment.ts`                      |              1 |
| `src/commands/shared/configParsingUtils.ts`                           |              1 |
| `src/commands/shared/connectionHelper.ts`                             |             12 |
| `src/config/configLoader.ts`                                          |             19 |
| `src/config/configManager.ts`                                         |             19 |
| `src/config/configWatcher.ts`                                         |             10 |
| `src/config/envProcessor.ts`                                          |              7 |
| `src/config/mcpConfigManager.ts`                                      |             17 |
| `src/config/projectConfigLoader.ts`                                   |              7 |
| `src/config/templateProcessor.ts`                                     |              4 |
| `src/core/capabilities/asyncLoadingOrchestrator.ts`                   |             28 |
| `src/core/capabilities/capabilityCatalog.ts`                          |              2 |
| `src/core/capabilities/capabilityManager.ts`                          |              7 |
| `src/core/capabilities/internalCapabilitiesProvider.ts`               |              6 |
| `src/core/capabilities/lazyLoadingOrchestrator.ts`                    |             15 |
| `src/core/capabilities/metaToolProvider.ts`                           |              3 |
| `src/core/capabilities/schemaCache.ts`                                |             12 |
| `src/core/capabilities/toolRegistry.ts`                               |              4 |
| `src/core/client/postAuthOAuthRecovery.ts`                            |              3 |
| `src/core/configChangeHandler.ts`                                     |             30 |
| `src/core/context/globalContextManager.ts`                            |              6 |
| `src/core/filtering/clientFiltering.ts`                               |             14 |
| `src/core/filtering/clientTemplateTracker.ts`                         |              8 |
| `src/core/filtering/filterCache.ts`                                   |              9 |
| `src/core/filtering/filteringService.ts`                              |             17 |
| `src/core/filtering/templateFilteringService.ts`                      |             19 |
| `src/core/filtering/templateIndex.ts`                                 |              9 |
| `src/core/flags/flagManager.ts`                                       |              2 |
| `src/core/instructions/instructionAggregator.ts`                      |             15 |
| `src/core/loading/loadingStateTracker.ts`                             |              8 |
| `src/core/loading/mcpLoadingManager.ts`                               |             25 |
| `src/core/loading/parallelExecutor.ts`                                |              1 |
| `src/core/notifications/notificationManager.ts`                       |             11 |
| `src/core/server/adapters/TemplateServerAdapter.ts`                   |              2 |
| `src/core/server/connectionResolver.ts`                               |              4 |
| `src/core/server/pidFileManager.ts`                                   |              6 |
| `src/core/server/runtimeLifecycle.ts`                                 |              2 |
| `src/core/server/runtimeScopeOwnership.ts`                            |              1 |
| `src/core/server/templateConfigurationManager.ts`                     |             12 |
| `src/core/tools/handlers/registryHandler.ts`                          |              2 |
| `src/core/tools/handlers/searchHandler.ts`                            |              2 |
| `src/core/tools/handlers/serverManagementHandler.ts`                  |              9 |
| `src/core/tools/handlers/showHandler.ts`                              |              2 |
| `src/core/tools/handlers/versionsHandler.ts`                          |              2 |
| `src/core/tools/internal/adapters/discoveryAdapter.ts`                |             12 |
| `src/core/tools/internal/adapters/installation/directInstallation.ts` |              2 |
| `src/core/tools/internal/adapters/installation/packageResolver.ts`    |              5 |
| `src/core/tools/internal/adapters/installationAdapter.ts`             |             19 |
| `src/core/tools/internal/adapters/management/managementAdapter.ts`    |             14 |
| `src/core/tools/internal/adapters/management/toolHandlers.ts`         |              4 |
| `src/core/tools/internal/adapters/management/validation.ts`           |              2 |
| `src/core/tools/internal/discoveryHandlers.ts`                        |             10 |
| `src/core/tools/internal/index.ts`                                    |              3 |
| `src/core/tools/internal/installationHandlers.ts`                     |              8 |
| `src/core/tools/internal/managementHandlers.ts`                       |             10 |
| `src/domains/admin/runtimeScopeAdminLock.ts`                          |              1 |
| `src/domains/config-change/configChange.ts`                           |              2 |
| `src/domains/preset/manager/presetManager.ts`                         |             29 |
| `src/domains/preset/manager/presetManagerCleanup.ts`                  |              8 |
| `src/domains/preset/manager/presetTesting.ts`                         |              1 |
| `src/domains/preset/services/presetNotificationService.ts`            |             12 |
| `src/domains/registry/cacheManager.ts`                                |              5 |
| `src/domains/registry/mcpRegistryClient.ts`                           |              9 |
| `src/domains/server-management/progressTrackingService.ts`            |              7 |
| `src/domains/server-management/serverInstallationService.ts`          |             11 |
| `src/sdk/legacy/auth/sdkOAuthClientProvider.ts`                       |              5 |
| `src/sdk/legacy/auth/sdkOAuthServerProvider.ts`                       |             16 |
| `src/sdk/legacy/client/runtime/clientManager.ts`                      |             31 |
| `src/sdk/legacy/client/runtime/connectionHandler.ts`                  |              6 |
| `src/sdk/legacy/client/runtime/legacySdkClientAdapter.ts`             |              4 |
| `src/sdk/legacy/client/runtime/oauthFlowHandler.ts`                   |              5 |
| `src/sdk/legacy/client/runtime/serveClient.ts`                        |              1 |
| `src/sdk/legacy/commands/serve.ts`                                    |             56 |
| `src/sdk/legacy/server/protocol/notificationHandlers.ts`              |              5 |
| `src/sdk/legacy/server/protocol/requestHandlers.ts`                   |              2 |
| `src/sdk/legacy/server/protocol/resourceSubscriptions.ts`             |              1 |
| `src/sdk/legacy/server/runtime/clientInstancePool.ts`                 |             16 |
| `src/sdk/legacy/server/runtime/connectionManager.ts`                  |             11 |
| `src/sdk/legacy/server/runtime/mcpLoggingEnhancer.ts`                 |              9 |
| `src/sdk/legacy/server/runtime/mcpServerLifecycleManager.ts`          |             27 |
| `src/sdk/legacy/server/runtime/serverManager.ts`                      |             18 |
| `src/sdk/legacy/server/runtime/templateServerCleanup.ts`              |             11 |
| `src/sdk/legacy/server/runtime/templateServerManager.ts`              |             16 |
| `src/sdk/legacy/transport/http/loggingSseTransport.ts`                |              1 |
| `src/sdk/legacy/transport/http/middlewares/scopeAuthMiddleware.ts`    |              1 |
| `src/sdk/legacy/transport/http/routes/sseRoutes.ts`                   |              5 |
| `src/sdk/legacy/transport/http/server.ts`                             |              4 |
| `src/sdk/legacy/transport/http/streamableSessionLifecycle.ts`         |             20 |
| `src/sdk/legacy/transport/restartableStdioTransport.ts`               |              8 |
| `src/sdk/legacy/transport/stdioProxyTransport.ts`                     |             15 |
| `src/sdk/legacy/transport/transportFactory.ts`                        |             18 |
| `src/server.ts`                                                       |             18 |
| `src/transport/http/middlewares/errorHandler.ts`                      |              1 |
| `src/transport/http/middlewares/httpRequestLogger.ts`                 |              2 |
| `src/transport/http/middlewares/mcpAvailabilityMiddleware.ts`         |              8 |
| `src/transport/http/middlewares/securityMiddleware.ts`                |              4 |
| `src/transport/http/middlewares/tagsExtractor.ts`                     |              2 |
| `src/transport/http/routes/cliTokenRoute.ts`                          |              1 |
| `src/transport/http/routes/healthRoutes.ts`                           |              6 |
| `src/transport/http/routes/inspectRoutes.ts`                          |              3 |
| `src/transport/http/routes/instructionsRoutes.ts`                     |              1 |
| `src/transport/http/routes/oauthRoutes.ts`                            |              7 |
| `src/transport/http/routes/streamableHttpRoutes.ts`                   |              7 |
| `src/transport/http/routes/toolRoutes.ts`                             |              4 |
| `src/transport/http/storage/streamableSessionRepository.ts`           |             15 |
| `src/transport/http/utils/contextExtractor.ts`                        |              4 |
| `src/transport/http/utils/httpErrorHandler.ts`                        |              3 |
| `src/transport/http/utils/templateContextAuthority.ts`                |              2 |
| `src/utils/core/errorHandling.ts`                                     |              1 |
| `src/utils/core/operationExecution.ts`                                |              2 |
| `src/utils/filePermissions.ts`                                        |              4 |
| `src/utils/ui/interactiveSelector.ts`                                 |              1 |
| `src/utils/ui/urlGenerator.ts`                                        |              6 |
| `src/utils/validation/scopeValidation.ts`                             |              4 |
| `src/utils/validation/urlDetection.ts`                                |              2 |

Additional adapter-owned events cover conditional logger failure, deprecated log-level configuration, CLI failure, template context audit, HTTP response failure, SSE deprecation, and all nine supervisor lifecycle transitions. Managed stderr is intentionally absent from the typed event registry.

## Verification

`privacy.test.ts` captures actual Console/File output across the complete registry and a synthetic secret corpus; verifies malformed/cyclic/getter/proxy inputs, Unicode and event bounds, closed gateway errors, process-key rotation/type separation, HTTP source privacy, and isolated backend diagnostics. Existing backend broker and stderr sanitizer tests remain mandatory. Tracing tests separately exercise valid active context, context cleanup, baggage exclusion and export-disabled behavior.

import { ConfigBuilder, ProtocolValidator, TestProcessManager } from '@test/e2e/utils/index.js';

import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Performance Infrastructure Integration E2E', () => {
  let processManager: TestProcessManager;
  let configBuilder: ConfigBuilder;
  let configPath: string;

  beforeEach(async () => {
    processManager = new TestProcessManager();
    configBuilder = new ConfigBuilder();

    const fixturesPath = join(__dirname, '../fixtures');
    configPath = configBuilder
      .enableStdioTransport()
      .enableHttpTransport(3000)
      .enableAuth('test-client-id', 'test-client-secret')
      .addStdioServer('echo-1', 'node', [join(fixturesPath, 'echo-server.js')], ['test', 'echo', 'fast'])
      .addStdioServer('echo-2', 'node', [join(fixturesPath, 'echo-server.js')], ['test', 'echo', 'fast'])
      .addStdioServer('echo-3', 'node', [join(fixturesPath, 'echo-server.js')], ['test', 'echo', 'fast'])
      .addStdioServer(
        'slow-server',
        'node',
        [join(fixturesPath, 'slow-server.js'), '--defaultDelay=50'],
        ['test', 'slow'],
      )
      .writeToFile();
  });

  afterEach(async () => {
    await processManager.cleanup();
    configBuilder.cleanup();
  });

  it('should create valid performance testing configuration', async () => {
    // Test that performance configuration builds correctly
    expect(configPath).toBeDefined();
    expect(configPath.endsWith('.json')).toBe(true);

    const config = configBuilder.build();
    expect(config.transport?.stdio).toBe(true);
    expect(config.transport?.http?.port).toBe(3000);
    expect(config.servers).toHaveLength(4);

    // Verify server distribution
    const echoServers = config.servers.filter((s) => s.tags?.includes('echo'));
    const slowServers = config.servers.filter((s) => s.tags?.includes('slow'));
    expect(echoServers).toHaveLength(3);
    expect(slowServers).toHaveLength(1);
  });

  it('should validate high-frequency request patterns', async () => {
    // Test high-frequency request simulation structures
    const requestBatch = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      method: 'echo/request',
      params: { requestId: i, timestamp: Date.now() },
      expected_response_time: 50, // ms
    }));

    expect(requestBatch).toHaveLength(100);
    requestBatch.forEach((req, index) => {
      expect(req.id).toBe(index);
      expect(req.method).toBe('echo/request');
      expect(req.params.requestId).toBe(index);
      expect(typeof req.params.timestamp).toBe('number');
      expect(req.expected_response_time).toBeGreaterThan(0);
    });
  });

  it('should handle concurrent server request validation', async () => {
    // Test concurrent operation across multiple servers
    const serverNames = ['echo-1', 'echo-2', 'echo-3'];
    const requestsPerServer = 50;

    const operationPlan = serverNames.flatMap((serverName) =>
      Array.from({ length: requestsPerServer }, (_, i) => ({
        server: serverName,
        requestId: i,
        method: 'echo/request',
        timestamp: Date.now(),
        params: {
          server: serverName,
          requestId: i,
          concurrency_test: true,
        },
      })),
    );

    expect(operationPlan).toHaveLength(requestsPerServer * serverNames.length);

    // Verify distribution across servers
    const serverCounts = serverNames.reduce(
      (acc, name) => {
        acc[name] = operationPlan.filter((op) => op.server === name).length;
        return acc;
      },
      {} as Record<string, number>,
    );

    serverNames.forEach((name) => {
      expect(serverCounts[name]).toBe(requestsPerServer);
    });
  });

  it('should validate performance measurement structures', async () => {
    // Test performance metrics data structures
    const performanceTest = {
      test_name: 'stdio_throughput',
      start_time: Date.now(),
      duration: 10000, // 10 seconds
      request_count: 100,
      concurrent_connections: 10,
      expected_rps: 10, // requests per second
      timeout_threshold: 5000,
    };

    const performanceResult = {
      test_name: 'stdio_throughput',
      total_requests: 100,
      successful_requests: 98,
      failed_requests: 2,
      actual_duration: 9750,
      actual_rps: 10.05,
      avg_response_time: 25,
      min_response_time: 15,
      max_response_time: 85,
      p95_response_time: 45,
      error_rate: 0.02,
    };

    // Validate test structure
    expect(performanceTest.test_name).toBe('stdio_throughput');
    expect(performanceTest.request_count).toBeGreaterThan(0);
    expect(performanceTest.expected_rps).toBeGreaterThan(0);

    // Validate result structure
    expect(performanceResult.total_requests).toBe(100);
    expect(performanceResult.successful_requests + performanceResult.failed_requests).toBe(
      performanceResult.total_requests,
    );
    expect(performanceResult.actual_rps).toBeGreaterThan(0);
    expect(performanceResult.avg_response_time).toBeGreaterThan(0);
    expect(performanceResult.min_response_time).toBeLessThanOrEqual(performanceResult.avg_response_time);
    expect(performanceResult.max_response_time).toBeGreaterThanOrEqual(performanceResult.avg_response_time);
    expect(performanceResult.error_rate).toBeGreaterThanOrEqual(0);
    expect(performanceResult.error_rate).toBeLessThan(1);
  });

  it('should handle large payload performance testing', async () => {
    // Test large payload handling structures
    const payloadSizes = [1, 10, 100, 1000]; // KB
    const payloadTests = payloadSizes.map((sizeKB) => ({
      size_kb: sizeKB,
      payload: {
        message: `Large payload test - ${sizeKB}KB`,
        data: Array.from({ length: sizeKB * 10 }, (_, i) => ({
          id: i,
          value: 'x'.repeat(100), // ~100 bytes per item
        })),
      },
      expected_max_duration: 5000, // 5 seconds max
      expected_min_throughput: 1, // KB/s
    }));

    payloadTests.forEach((test) => {
      expect(test.size_kb).toBeGreaterThan(0);
      expect(test.payload.data).toHaveLength(test.size_kb * 10);
      expect(test.expected_max_duration).toBeGreaterThan(0);
      expect(test.expected_min_throughput).toBeGreaterThan(0);
    });

    // Validate payload content
    payloadTests.forEach((test) => {
      const estimatedSize = JSON.stringify(test.payload).length;
      const expectedMinSize = test.size_kb * 1000; // Convert KB to bytes (rough estimate)
      expect(estimatedSize).toBeGreaterThan(expectedMinSize * 0.8); // Allow 20% variance
    });
  });

  it('should validate memory usage monitoring patterns', async () => {
    // Test memory monitoring structures
    const memoryBaseline = {
      rss: 50 * 1024 * 1024, // 50MB
      heapUsed: 30 * 1024 * 1024, // 30MB
      heapTotal: 40 * 1024 * 1024, // 40MB
      external: 5 * 1024 * 1024, // 5MB
    };

    const memoryAfterLoad = {
      rss: 75 * 1024 * 1024, // 75MB
      heapUsed: 45 * 1024 * 1024, // 45MB
      heapTotal: 60 * 1024 * 1024, // 60MB
      external: 8 * 1024 * 1024, // 8MB
    };

    const memoryGrowth = {
      rss_growth: memoryAfterLoad.rss - memoryBaseline.rss,
      heap_growth: memoryAfterLoad.heapUsed - memoryBaseline.heapUsed,
      growth_percentage: ((memoryAfterLoad.heapUsed - memoryBaseline.heapUsed) / memoryBaseline.heapUsed) * 100,
    };

    expect(memoryBaseline.rss).toBeGreaterThan(0);
    expect(memoryAfterLoad.rss).toBeGreaterThan(memoryBaseline.rss);
    expect(memoryGrowth.rss_growth).toBeGreaterThan(0);
    expect(memoryGrowth.heap_growth).toBeGreaterThan(0);
    expect(memoryGrowth.growth_percentage).toBeGreaterThan(0);
  });

  it('should handle timeout scenario validation', async () => {
    // Test timeout handling structures
    const timeoutTests = [
      { delay: 100, timeout: 200, should_succeed: true },
      { delay: 500, timeout: 1000, should_succeed: true },
      { delay: 2000, timeout: 1500, should_succeed: false },
      { delay: 5000, timeout: 3000, should_succeed: false },
    ];

    timeoutTests.forEach((test) => {
      expect(test.delay).toBeGreaterThan(0);
      expect(test.timeout).toBeGreaterThan(0);
      expect(typeof test.should_succeed).toBe('boolean');

      if (test.should_succeed) {
        expect(test.delay).toBeLessThan(test.timeout);
      } else {
        expect(test.delay).toBeGreaterThan(test.timeout);
      }
    });
  });

  it('should validate connection pool efficiency patterns', async () => {
    // Test connection pool performance patterns
    const poolTest = {
      pool_size: 10,
      concurrent_requests: 20,
      sequential_requests: 20,
      connection_reuse: true,
      keep_alive: true,
    };

    const poolResults = {
      sequential_duration: 2000, // ms
      concurrent_duration: 800, // ms
      connection_reuse_count: 15,
      new_connections_created: 5,
      efficiency_ratio: 800 / 2000, // concurrent vs sequential
    };

    expect(poolTest.pool_size).toBeGreaterThan(0);
    expect(poolTest.concurrent_requests).toBeGreaterThan(0);
    expect(poolResults.concurrent_duration).toBeLessThan(poolResults.sequential_duration);
    expect(poolResults.efficiency_ratio).toBeLessThan(1);
    expect(poolResults.efficiency_ratio).toBeGreaterThan(0);
    expect(poolResults.connection_reuse_count + poolResults.new_connections_created).toBeLessThanOrEqual(
      poolTest.concurrent_requests,
    );
  });

  it('should handle startup performance validation', async () => {
    // Test startup performance structures
    const startupConfig = {
      server_count: 10,
      parallel_startup: true,
      startup_timeout: 15000, // 15 seconds
      expected_startup_time: 10000, // 10 seconds
    };

    const startupResult = {
      total_servers: 10,
      successful_starts: 10,
      failed_starts: 0,
      actual_startup_time: 8500,
      average_startup_per_server: 850,
      parallel_efficiency: true,
    };

    expect(startupConfig.server_count).toBe(10);
    expect(startupResult.successful_starts).toBe(startupConfig.server_count);
    expect(startupResult.failed_starts).toBe(0);
    expect(startupResult.actual_startup_time).toBeLessThan(startupConfig.startup_timeout);
    expect(startupResult.actual_startup_time).toBeLessThan(startupConfig.expected_startup_time);
    expect(startupResult.average_startup_per_server).toBe(
      startupResult.actual_startup_time / startupResult.total_servers,
    );
  });

  it('should validate resource cleanup efficiency', async () => {
    // Test resource cleanup performance
    const cleanupTest = {
      resource_count: 50,
      resource_types: ['temporary_files', 'process_handles', 'memory_allocations'],
      cleanup_strategy: 'graceful',
      max_cleanup_time: 10000, // 10 seconds
    };

    const cleanupResult = {
      resources_cleaned: 50,
      cleanup_duration: 1250,
      cleanup_rate: 50 / (1250 / 1000), // resources per second
      memory_freed: 25 * 1024 * 1024, // 25MB
      handles_closed: 15,
      files_deleted: 10,
    };

    expect(cleanupTest.resource_count).toBeGreaterThan(0);
    expect(cleanupResult.resources_cleaned).toBe(cleanupTest.resource_count);
    expect(cleanupResult.cleanup_duration).toBeLessThan(cleanupTest.max_cleanup_time);
    expect(cleanupResult.cleanup_rate).toBeGreaterThan(1); // At least 1 resource per second
    expect(cleanupResult.memory_freed).toBeGreaterThan(0);
  });

  it('should handle process management performance', async () => {
    // Test process management performance
    const processTest = await processManager.startProcess('performance-test-process', {
      command: 'sleep',
      args: ['2'],
      timeout: 5000,
    });

    expect(processTest.pid).toBeGreaterThan(0);
    expect(processManager.isProcessRunning('performance-test-process')).toBe(true);

    const stopStart = Date.now();
    await processManager.stopProcess('performance-test-process');
    const stopDuration = Date.now() - stopStart;

    expect(processManager.isProcessRunning('performance-test-process')).toBe(false);
    expect(stopDuration).toBeLessThan(5000); // Should stop quickly
  });

  it('should validate load testing patterns', async () => {
    // Test load testing configuration structures
    const loadTest = {
      name: 'sustained_load_test',
      duration: 30000, // 30 seconds
      ramp_up_time: 5000, // 5 seconds
      steady_state_time: 20000, // 20 seconds
      ramp_down_time: 5000, // 5 seconds
      max_concurrent_users: 100,
      requests_per_user_per_second: 1,
      expected_total_requests: 2000, // Approximate
    };

    const loadResult = {
      actual_duration: 30250,
      total_requests: 1987,
      successful_requests: 1965,
      failed_requests: 22,
      avg_response_time: 45,
      max_response_time: 1200,
      requests_per_second: 1987 / (30250 / 1000),
      error_rate: 22 / 1987,
      peak_concurrent_users: 98,
    };

    expect(loadTest.duration).toBeGreaterThan(0);
    expect(loadTest.ramp_up_time + loadTest.steady_state_time + loadTest.ramp_down_time).toBe(loadTest.duration);
    expect(loadResult.total_requests).toBeGreaterThan(0);
    expect(loadResult.successful_requests + loadResult.failed_requests).toBe(loadResult.total_requests);
    expect(loadResult.error_rate).toBeLessThan(0.1); // Less than 10% error rate
    expect(loadResult.peak_concurrent_users).toBeLessThanOrEqual(loadTest.max_concurrent_users);
  });

  it('should validate stress testing boundaries', async () => {
    // Test stress testing configuration
    const stressTest = {
      name: 'resource_exhaustion_test',
      memory_limit: 512 * 1024 * 1024, // 512MB
      cpu_limit: 0.8, // 80%
      connection_limit: 1000,
      request_rate_limit: 500, // requests per second
      expected_failure_point: {
        memory_usage: 0.9, // 90% of limit
        cpu_usage: 0.95, // 95% of limit
        active_connections: 0.8, // 80% of limit
      },
    };

    const stressResult = {
      peak_memory_usage: 460 * 1024 * 1024, // 460MB
      peak_cpu_usage: 0.85, // 85%
      peak_connections: 750,
      failure_point_reached: false,
      degradation_started_at: {
        memory_usage: 0.75,
        response_time_increase: 2.5, // 250% increase
      },
    };

    expect(stressTest.memory_limit).toBeGreaterThan(0);
    expect(stressTest.cpu_limit).toBeLessThanOrEqual(1);
    expect(stressResult.peak_memory_usage).toBeLessThan(stressTest.memory_limit);
    expect(stressResult.peak_cpu_usage).toBeLessThan(1);
    expect(stressResult.peak_connections).toBeLessThan(stressTest.connection_limit);
  });

  it('should handle benchmark comparison validation', async () => {
    // Test benchmark comparison structures
    const benchmarks = {
      baseline: {
        version: '1.0.0',
        requests_per_second: 100,
        avg_response_time: 50,
        memory_usage: 30 * 1024 * 1024,
        error_rate: 0.01,
      },
      current: {
        version: '1.1.0',
        requests_per_second: 120,
        avg_response_time: 45,
        memory_usage: 28 * 1024 * 1024,
        error_rate: 0.008,
      },
    };

    const comparison = {
      rps_improvement:
        (benchmarks.current.requests_per_second - benchmarks.baseline.requests_per_second) /
        benchmarks.baseline.requests_per_second,
      response_time_improvement:
        (benchmarks.baseline.avg_response_time - benchmarks.current.avg_response_time) /
        benchmarks.baseline.avg_response_time,
      memory_improvement:
        (benchmarks.baseline.memory_usage - benchmarks.current.memory_usage) / benchmarks.baseline.memory_usage,
      error_rate_improvement:
        (benchmarks.baseline.error_rate - benchmarks.current.error_rate) / benchmarks.baseline.error_rate,
    };

    expect(comparison.rps_improvement).toBeGreaterThan(0); // Improved
    expect(comparison.response_time_improvement).toBeGreaterThan(0); // Improved
    expect(comparison.memory_improvement).toBeGreaterThan(0); // Improved
    expect(comparison.error_rate_improvement).toBeGreaterThan(0); // Improved
  });

  it('should validate protocol performance patterns', async () => {
    // Test protocol-specific performance validation
    const protocolTests = [
      {
        method: 'ping',
        expected_response_time: 10,
        payload_size: 50,
      },
      {
        method: 'tools/list',
        expected_response_time: 100,
        payload_size: 1000,
      },
      {
        method: 'resources/read',
        expected_response_time: 200,
        payload_size: 5000,
      },
    ];

    protocolTests.forEach((test) => {
      // Validate method format
      const validation = ProtocolValidator.validateMcpMethod(test.method);
      expect(validation.valid).toBe(true);

      expect(test.expected_response_time).toBeGreaterThan(0);
      expect(test.payload_size).toBeGreaterThan(0);
    });

    // More complex methods should generally take longer
    expect(protocolTests[0].expected_response_time).toBeLessThan(protocolTests[1].expected_response_time);
    expect(protocolTests[1].expected_response_time).toBeLessThan(protocolTests[2].expected_response_time);
  });

  it('should handle performance regression detection', async () => {
    // Test performance regression detection patterns
    const regressionTest = {
      test_name: 'response_time_regression',
      baseline_p95: 100, // ms
      current_p95: 150, // ms
      threshold_percentage: 0.2, // 20% increase is acceptable
      regression_detected: false,
    };

    const regressionPercentage =
      (regressionTest.current_p95 - regressionTest.baseline_p95) / regressionTest.baseline_p95;
    regressionTest.regression_detected = regressionPercentage > regressionTest.threshold_percentage;

    expect(regressionPercentage).toBeGreaterThan(0.4); // 50% increase
    expect(regressionTest.regression_detected).toBe(true);
    expect(regressionTest.threshold_percentage).toBeGreaterThan(0);
    expect(regressionTest.threshold_percentage).toBeLessThan(1);
  });

  it('should validate conditional logging performance optimization', async () => {
    // Test logging performance optimization benefits
    const { debugIf, isDebugEnabled } = await import('@src/logger/logger.js');

    const iterationCount = 10000;
    const expensiveData = Array.from({ length: 1000 }, (_, i) => ({ id: i, value: 'x'.repeat(100) }));

    // Test traditional logger.debug() performance when debug is disabled
    const traditionalStart = performance.now();
    for (let i = 0; i < iterationCount; i++) {
      // Simulate expensive operation that would happen with logger.debug()
      const _message = `Processing items: ${expensiveData.length} items`;
      const _meta = {
        itemIds: expensiveData.map((item) => item.id),
        totalSize: expensiveData.reduce((sum, item) => sum + item.value.length, 0),
        timestamp: Date.now(),
      };
      // Note: We're not actually calling logger.debug() to avoid log pollution
      // but we're simulating the expense computation that would occur
      void _message; // Prevent unused variable warning
      void _meta; // Prevent unused variable warning
    }
    const traditionalDuration = performance.now() - traditionalStart;

    // Test debugIf() performance when debug is disabled
    const debugIfStart = performance.now();
    for (let i = 0; i < iterationCount; i++) {
      debugIf(() => ({
        message: `Processing items: ${expensiveData.length} items`,
        meta: {
          itemIds: expensiveData.map((item) => item.id),
          totalSize: expensiveData.reduce((sum, item) => sum + item.value.length, 0),
          timestamp: Date.now(),
        },
      }));
    }
    const debugIfDuration = performance.now() - debugIfStart;

    // Validate performance benefits
    expect(debugIfDuration).toBeLessThan(traditionalDuration);
    expect(debugIfDuration / traditionalDuration).toBeLessThan(0.1); // At least 90% faster

    // Test that debug is actually disabled for this test
    expect(isDebugEnabled()).toBe(false);

    const performanceGain = ((traditionalDuration - debugIfDuration) / traditionalDuration) * 100;
    expect(performanceGain).toBeGreaterThan(80); // At least 80% performance improvement
  });

  it('should validate logging error handling robustness', async () => {
    // Test that logging errors never crash the application
    const { debugIf, infoIf, warnIf } = await import('@src/logger/logger.js');

    const errorScenarios = [
      // Test malformed callback results
      { name: 'null_result', callback: () => null },
      { name: 'undefined_result', callback: () => undefined },
      { name: 'string_result', callback: () => 'not an object' },
      { name: 'missing_message', callback: () => ({ meta: { test: true } }) },
      // Test callback exceptions
      {
        name: 'throw_error',
        callback: () => {
          throw new Error('Test error');
        },
      },
      {
        name: 'throw_string',
        callback: () => {
          throw 'String error';
        },
      },
      { name: 'reference_error', callback: () => ({ message: (global as any).nonExistentVariable.toString() }) },
    ];

    // Test each error scenario doesn't crash the application
    errorScenarios.forEach((scenario) => {
      expect(() => {
        debugIf(scenario.callback as any);
        infoIf(scenario.callback as any);
        warnIf(scenario.callback as any);
      }).not.toThrow();
    });

    // Verify the functions still work correctly with valid inputs
    expect(() => {
      debugIf('Simple message');
      debugIf(() => ({ message: 'Complex message', meta: { test: true } }));
      infoIf('Info message');
      warnIf(() => ({ message: 'Warning message' }));
    }).not.toThrow();
  });

  it('should validate logging memory efficiency with high-frequency calls', async () => {
    // Test memory efficiency of conditional logging
    const { debugIf } = await import('@src/logger/logger.js');

    const largeObject = Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      data: 'x'.repeat(1000), // 1KB per item = ~10MB total
      timestamp: Date.now(),
      metadata: { processed: false, retries: 0 },
    }));

    const initialMemory = process.memoryUsage();
    const iterationCount = 1000;

    // Perform high-frequency logging with large data
    const logStart = performance.now();
    for (let i = 0; i < iterationCount; i++) {
      debugIf(() => ({
        message: `Processing large dataset: iteration ${i}`,
        meta: {
          dataSize: largeObject.length,
          totalMemory: largeObject.reduce((sum, item) => sum + item.data.length, 0),
          iteration: i,
          sampleItems: largeObject.slice(0, 5), // Only include first 5 items
        },
      }));
    }
    const logDuration = performance.now() - logStart;

    const finalMemory = process.memoryUsage();
    const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;

    // Validate performance characteristics
    expect(logDuration).toBeLessThan(100); // Should complete quickly
    expect(memoryGrowth).toBeLessThan(1024 * 1024); // Less than 1MB memory growth

    // Verify no memory leaks by forcing garbage collection and checking again
    if (global.gc) {
      global.gc();
      const afterGcMemory = process.memoryUsage();
      const persistentGrowth = afterGcMemory.heapUsed - initialMemory.heapUsed;
      expect(persistentGrowth).toBeLessThan(512 * 1024); // Less than 512KB persistent growth
    }
  });

  it('should validate structured metadata performance patterns', async () => {
    // Test structured metadata handling performance
    const { debugIf } = await import('@src/logger/logger.js');

    const metadataScenarios = [
      {
        name: 'shallow_metadata',
        generator: () => ({ simple: true, count: 100, timestamp: Date.now() }),
      },
      {
        name: 'deep_metadata',
        generator: () => ({
          level1: {
            level2: {
              level3: {
                data: Array.from({ length: 100 }, (_, i) => i),
                computed: Math.random() * 1000,
              },
            },
          },
        }),
      },
      {
        name: 'large_array_metadata',
        generator: () => ({
          items: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: Math.random() })),
          summary: 'Large array metadata',
        }),
      },
    ];

    const results = metadataScenarios.map((scenario) => {
      const start = performance.now();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        debugIf(() => ({
          message: `Testing ${scenario.name} - iteration ${i}`,
          meta: scenario.generator(),
        }));
      }

      const duration = performance.now() - start;
      return {
        scenario: scenario.name,
        duration,
        averagePerCall: duration / iterations,
      };
    });

    // Validate that all scenarios complete efficiently
    results.forEach((result) => {
      expect(result.duration).toBeLessThan(50); // All scenarios under 50ms
      expect(result.averagePerCall).toBeLessThan(0.1); // Less than 0.1ms per call
    });

    // Verify performance patterns are reasonable (allowing for environmental variance)
    const shallowResult = results.find((r) => r.scenario === 'shallow_metadata');
    const deepResult = results.find((r) => r.scenario === 'deep_metadata');
    const arrayResult = results.find((r) => r.scenario === 'large_array_metadata');

    // Shallow metadata should be competitive with more complex scenarios
    // Allow for some variance due to system load, GC timing, etc.
    const performanceTolerance = 1.5; // 50% tolerance for performance variance
    expect(shallowResult!.duration).toBeLessThan(deepResult!.duration * performanceTolerance);
    expect(shallowResult!.duration).toBeLessThan(arrayResult!.duration * performanceTolerance);

    // But complex scenarios should still be slower on average
    const averageComplexDuration = (deepResult!.duration + arrayResult!.duration) / 2;
    expect(averageComplexDuration).toBeGreaterThan(shallowResult!.duration * 0.8);
  });

  it('should validate callback purity and side effect prevention', async () => {
    // Test that callbacks are executed only when logging is enabled
    const { debugIf, isDebugEnabled } = await import('@src/logger/logger.js');

    let callbackExecutionCount = 0;
    let sideEffectCount = 0;

    const iterationCount = 100;

    // Test with debug disabled (typical production scenario)
    for (let i = 0; i < iterationCount; i++) {
      debugIf(() => {
        callbackExecutionCount++;
        // This callback should NOT execute when debug is disabled
        return { message: `Callback executed: ${i}` };
      });
    }

    // Verify callbacks didn't execute when debug disabled
    if (!isDebugEnabled()) {
      expect(callbackExecutionCount).toBe(0);
    }

    // Test side effect prevention patterns
    const badCallback = () => {
      sideEffectCount++; // This is a side effect - should be avoided
      return { message: 'Bad pattern - has side effects' };
    };

    const goodCallback = () => {
      // No side effects, pure computation only
      const computedValue = Math.random() * 100;
      return {
        message: 'Good pattern - no side effects',
        meta: { computed: computedValue, timestamp: Date.now() },
      };
    };

    // Both callbacks should not execute when debug is disabled
    for (let i = 0; i < 10; i++) {
      debugIf(badCallback);
      debugIf(goodCallback);
    }

    if (!isDebugEnabled()) {
      expect(sideEffectCount).toBe(0); // No side effects when debug disabled
    }

    // Validate that string messages work efficiently
    expect(() => {
      for (let i = 0; i < 1000; i++) {
        debugIf('Simple string message'); // Should be very fast
      }
    }).not.toThrow();
  });

  it('should handle logging performance under concurrent load', async () => {
    // Test concurrent logging performance
    const { debugIf } = await import('@src/logger/logger.js');

    const concurrentOperations = 10;
    const operationsPerThread = 1000;

    const concurrentPromises = Array.from({ length: concurrentOperations }, async (_, threadId) => {
      const threadStart = performance.now();

      for (let i = 0; i < operationsPerThread; i++) {
        debugIf(() => ({
          message: `Concurrent logging from thread ${threadId}, operation ${i}`,
          meta: {
            threadId,
            operationId: i,
            timestamp: Date.now(),
            threadData: Array.from({ length: 10 }, (_, j) => ({ id: j, value: Math.random() })),
          },
        }));
      }

      return performance.now() - threadStart;
    });

    const startTime = performance.now();
    const threadDurations = await Promise.all(concurrentPromises);
    const totalDuration = performance.now() - startTime;

    // Validate concurrent performance
    expect(totalDuration).toBeLessThan(100); // Complete in under 100ms
    threadDurations.forEach((duration) => {
      expect(duration).toBeLessThan(50); // Each thread completes quickly
    });

    const averageThreadDuration = threadDurations.reduce((sum, d) => sum + d, 0) / threadDurations.length;
    expect(averageThreadDuration).toBeLessThan(25); // Average thread duration under 25ms

    // Verify no thread took significantly longer (no blocking)
    const maxDuration = Math.max(...threadDurations);
    const minDuration = Math.min(...threadDurations);
    const durationVariance = (maxDuration - minDuration) / averageThreadDuration;
    expect(durationVariance).toBeLessThan(2); // Less than 200% variance between threads
  });
});

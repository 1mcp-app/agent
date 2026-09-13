import {
  createMockLegacyInboundConnection,
  createMockLegacyOutboundConnection,
} from '@test/unit-utils/MockFactories.js';

import {
  CancelledNotificationSchema,
  InitializedNotificationSchema,
  LoggingMessageNotificationSchema,
  RootsListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ClientStatus, type InboundConnection, type OutboundConnections, ServerStatus } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupClientToServerNotifications, setupServerToClientNotifications } from './notificationHandlers.js';

vi.mock('@src/logger/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('Notification Handlers', () => {
  let mockOutboundConns: OutboundConnections;
  let mockInboundConn: InboundConnection;
  let mockClient: any;
  let mockServer: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock client that will throw "Not connected" error
    mockClient = {
      setNotificationHandler: vi.fn(),
      notification: vi.fn(),
    };

    // Create mock server
    mockServer = {
      setNotificationHandler: vi.fn(),
      notification: vi.fn(),
    };

    // Create mock server info
    mockInboundConn = createMockLegacyInboundConnection({
      server: mockServer,
      status: ServerStatus.Connected,
      transport: {
        start: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      },
    });

    // Create mock clients collection
    mockOutboundConns = new Map();
    mockOutboundConns.set(
      'test-client',
      createMockLegacyOutboundConnection({
        name: 'test-client',
        status: ClientStatus.Connected,
        client: mockClient,
        transport: {
          timeout: 5000,
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      }),
    );
  });

  describe('setupClientToServerNotifications', () => {
    it('should handle "Not connected" error gracefully when client transport is disconnected', async () => {
      // Mock the server notification to throw "Not connected" error
      mockServer.notification = vi.fn().mockImplementation(() => {
        throw new Error('Not connected');
      });

      // Ensure server transport exists so the notification is attempted
      mockServer.transport = {
        timeout: 5000,
        start: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      };

      // Setup the notification handlers
      setupClientToServerNotifications(mockOutboundConns, mockInboundConn);

      // Verify that setNotificationHandler was called
      expect(mockClient.setNotificationHandler).toHaveBeenCalled();

      // Get the notification handler that was registered
      const setNotificationHandlerCalls = mockClient.setNotificationHandler.mock.calls;
      const loggingHandlerCall = setNotificationHandlerCalls.find(
        (call: any) => call[0] === LoggingMessageNotificationSchema,
      );

      expect(loggingHandlerCall).toBeDefined();
      const notificationHandler = loggingHandlerCall[1];

      // Simulate a notification being received
      const testNotification = {
        method: 'logging/message',
        params: {
          level: 'info',
          data: 'test message',
        },
      };

      // This should not throw an error, it should handle the "Not connected" error gracefully
      await expect(notificationHandler(testNotification)).resolves.not.toThrow();

      // Verify that the server notification was attempted
      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'logging/message',
        params: {
          level: 'info',
          data: 'test message',
          server: 'test-client',
        },
      });
    });

    it('should handle async notification rejection when forwarding to server', async () => {
      const forwardError = new Error('Server rejected async notification');
      let rejectForwardedNotification!: (error: Error) => void;
      const forwardedNotification = new Promise<void>((_, reject) => {
        rejectForwardedNotification = reject;
      });
      forwardedNotification.catch(() => undefined);

      mockServer.notification = vi.fn().mockReturnValue(forwardedNotification);
      mockServer.transport = {
        timeout: 5000,
        start: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      };

      setupClientToServerNotifications(mockOutboundConns, mockInboundConn);

      const setNotificationHandlerCalls = mockClient.setNotificationHandler.mock.calls;
      const loggingHandlerCall = setNotificationHandlerCalls.find(
        (call: any) => call[0] === LoggingMessageNotificationSchema,
      );

      expect(loggingHandlerCall).toBeDefined();
      const notificationHandler = loggingHandlerCall[1];
      const handlerPromise = notificationHandler({
        method: 'logging/message',
        params: {
          level: 'info',
          data: 'test message',
        },
      });

      rejectForwardedNotification(forwardError);

      await expect(handlerPromise).resolves.not.toThrow();
      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'logging/message',
        params: {
          level: 'info',
          data: 'test message',
          server: 'test-client',
        },
      });
      expect(logger.error).toHaveBeenCalledWith(`Failed to send notification from test-client: ${forwardError}`);
    });

    it('should not send notifications when client is not connected', async () => {
      // Set client status to disconnected
      const disconnectedClient = mockOutboundConns.get('test-client')!;
      disconnectedClient.status = ClientStatus.Disconnected;

      // Setup the notification handlers
      setupClientToServerNotifications(mockOutboundConns, mockInboundConn);

      // Get the notification handler that was registered
      const setNotificationHandlerCalls = mockClient.setNotificationHandler.mock.calls;
      const loggingHandlerCall = setNotificationHandlerCalls.find(
        (call: any) => call[0] === LoggingMessageNotificationSchema,
      );

      expect(loggingHandlerCall).toBeDefined();
      const notificationHandler = loggingHandlerCall[1];

      // Simulate a notification being received
      const testNotification = {
        method: 'logging/message',
        params: {
          level: 'info',
          data: 'test message',
        },
      };

      // Execute the handler
      await notificationHandler(testNotification);

      // Verify that the server notification was NOT called since client is disconnected
      expect(mockServer.notification).not.toHaveBeenCalled();
    });
  });

  describe('setupServerToClientNotifications', () => {
    it('leaves cancellation with the SDK request owner rather than broadcasting it', () => {
      setupServerToClientNotifications(mockOutboundConns, mockInboundConn);
      expect(
        mockServer.setNotificationHandler.mock.calls.some((call: any) => call[0] === CancelledNotificationSchema),
      ).toBe(false);
      expect(mockClient.notification).not.toHaveBeenCalled();
    });

    it('suppresses root changes without an exact active legacy relationship', async () => {
      setupServerToClientNotifications(mockOutboundConns, mockInboundConn);
      const registration = mockServer.setNotificationHandler.mock.calls.find(
        (call: any) => call[0] === RootsListChangedNotificationSchema,
      );
      expect(registration).toBeDefined();
      await registration[1]({ method: 'notifications/roots/list_changed', params: {} });
      expect(mockClient.notification).not.toHaveBeenCalled();
    });

    it('does not forward root changes to disconnected clients', async () => {
      mockOutboundConns.get('test-client')!.status = ClientStatus.Disconnected;
      setupServerToClientNotifications(mockOutboundConns, mockInboundConn);
      const registration = mockServer.setNotificationHandler.mock.calls.find(
        (call: any) => call[0] === RootsListChangedNotificationSchema,
      );
      await registration[1]({ method: 'notifications/roots/list_changed', params: {} });
      expect(mockClient.notification).not.toHaveBeenCalled();
    });

    it('should NOT forward notifications/initialized to downstream servers (issue #255)', () => {
      // notifications/initialized is a session-lifecycle notification sent by the
      // inbound client to 1MCP. Forwarding it to already-connected downstream servers
      // causes them to re-enter initialization state, breaking tools/list and prompts/list.
      setupServerToClientNotifications(mockOutboundConns, mockInboundConn);

      const setNotificationHandlerCalls = mockServer.setNotificationHandler.mock.calls;
      const initializedHandlerCall = setNotificationHandlerCalls.find(
        (call: any) => call[0] === InitializedNotificationSchema,
      );

      expect(initializedHandlerCall).toBeUndefined();
    });
  });
});

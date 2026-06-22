import {
  CancelledNotificationSchema,
  InitializedNotificationSchema,
  LoggingMessageNotificationSchema,
  RootsListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  ClientStatus,
  type InboundConnection,
  type OutboundConnection,
  type OutboundConnections,
  ServerStatus,
} from '@src/core/types/index.js';
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
    mockInboundConn = {
      server: mockServer,
      status: ServerStatus.Connected,
      transport: {
        timeout: 5000,
        start: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      },
    } as InboundConnection;

    // Create mock clients collection
    mockOutboundConns = new Map();
    mockOutboundConns.set('test-client', {
      name: 'test-client',
      status: ClientStatus.Connected,
      client: mockClient,
      transport: {
        timeout: 5000,
        start: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      },
    } as OutboundConnection);
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
    it('should handle "Not connected" error gracefully when server sends to disconnected client', async () => {
      // Mock the client notification to throw "Not connected" error
      mockClient.notification = vi.fn().mockImplementation(() => {
        throw new Error('Not connected');
      });

      // Ensure client transport exists so the notification is attempted
      mockClient.transport = {
        timeout: 5000,
        start: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      };

      // Setup the notification handlers
      setupServerToClientNotifications(mockOutboundConns, mockInboundConn);

      // Verify that setNotificationHandler was called on the server
      expect(mockServer.setNotificationHandler).toHaveBeenCalled();

      // Use CancelledNotificationSchema which is still forwarded server→client
      const setNotificationHandlerCalls = mockServer.setNotificationHandler.mock.calls;
      const cancelledHandlerCall = setNotificationHandlerCalls.find(
        (call: any) => call[0] === CancelledNotificationSchema,
      );

      expect(cancelledHandlerCall).toBeDefined();
      const notificationHandler = cancelledHandlerCall[1];

      // Simulate a notification being received from server
      const testNotification = {
        method: 'notifications/cancelled',
        params: { requestId: '1', reason: 'test' },
      };

      // This should not throw an error, it should handle the "Not connected" error gracefully
      await expect(notificationHandler(testNotification)).resolves.not.toThrow();

      // Verify that the client notification was attempted
      expect(mockClient.notification).toHaveBeenCalledWith({
        method: 'notifications/cancelled',
        params: {
          requestId: '1',
          reason: 'test',
          client: 'test-client',
        },
      });
    });

    it('should handle async capability rejection when forwarding to client', async () => {
      const capabilityError = new Error(
        'Client does not support roots list changed notifications (required for notifications/roots/list_changed)',
      );
      let rejectForwardedNotification!: (error: Error) => void;
      const forwardedNotification = new Promise<void>((_, reject) => {
        rejectForwardedNotification = reject;
      });
      forwardedNotification.catch(() => undefined);

      mockClient.notification = vi.fn().mockReturnValue(forwardedNotification);
      mockClient.transport = {
        timeout: 5000,
        start: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      };

      setupServerToClientNotifications(mockOutboundConns, mockInboundConn);

      const setNotificationHandlerCalls = mockServer.setNotificationHandler.mock.calls;
      const rootsChangedHandlerCall = setNotificationHandlerCalls.find(
        (call: any) => call[0] === RootsListChangedNotificationSchema,
      );

      expect(rootsChangedHandlerCall).toBeDefined();
      const notificationHandler = rootsChangedHandlerCall[1];
      const handlerPromise = notificationHandler({
        method: 'notifications/roots/list_changed',
        params: {},
      });

      rejectForwardedNotification(capabilityError);

      await expect(handlerPromise).resolves.not.toThrow();
      expect(mockClient.notification).toHaveBeenCalledWith({
        method: 'notifications/roots/list_changed',
        params: {
          client: 'test-client',
        },
      });
      expect(logger.error).toHaveBeenCalledWith(`Failed to send notification to test-client: ${capabilityError}`);
    });

    it('should not send notifications when client status is not connected', async () => {
      // Set client status to disconnected
      const disconnectedClient = mockOutboundConns.get('test-client')!;
      disconnectedClient.status = ClientStatus.Disconnected;

      // Setup the notification handlers
      setupServerToClientNotifications(mockOutboundConns, mockInboundConn);

      // Get the notification handler that was registered (CancelledNotificationSchema is still forwarded)
      const setNotificationHandlerCalls = mockServer.setNotificationHandler.mock.calls;
      const cancelledHandlerCall = setNotificationHandlerCalls.find(
        (call: any) => call[0] === CancelledNotificationSchema,
      );

      expect(cancelledHandlerCall).toBeDefined();
      const notificationHandler = cancelledHandlerCall[1];

      // Simulate a notification being received from server
      const testNotification = {
        method: 'notifications/cancelled',
        params: { requestId: '1', reason: 'test' },
      };

      // Execute the handler
      await notificationHandler(testNotification);

      // Verify that the client notification was NOT called since client is disconnected
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

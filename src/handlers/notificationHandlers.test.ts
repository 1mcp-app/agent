import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupClientToServerNotifications, setupServerToClientNotifications } from './notificationHandlers.js';
import {
  ClientStatus,
  ServerStatus,
  type OutboundConnections,
  type OutboundConnection,
  type InboundConnection,
} from '@src/core/types/index.js';
import { LoggingMessageNotificationSchema, InitializedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

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

      // Get the notification handler that was registered (using InitializedNotificationSchema which is in server-to-client)
      const setNotificationHandlerCalls = mockServer.setNotificationHandler.mock.calls;
      const initializedHandlerCall = setNotificationHandlerCalls.find(
        (call: any) => call[0] === InitializedNotificationSchema,
      );

      expect(initializedHandlerCall).toBeDefined();
      const notificationHandler = initializedHandlerCall[1];

      // Simulate a notification being received from server
      const testNotification = {
        method: 'notifications/initialized',
        params: {},
      };

      // This should not throw an error, it should handle the "Not connected" error gracefully
      await expect(notificationHandler(testNotification)).resolves.not.toThrow();

      // Verify that the client notification was attempted
      expect(mockClient.notification).toHaveBeenCalledWith({
        method: 'notifications/initialized',
        params: {
          client: 'test-client',
        },
      });
    });

    it('should not send notifications when client status is not connected', async () => {
      // Set client status to disconnected
      const disconnectedClient = mockOutboundConns.get('test-client')!;
      disconnectedClient.status = ClientStatus.Disconnected;

      // Setup the notification handlers
      setupServerToClientNotifications(mockOutboundConns, mockInboundConn);

      // Get the notification handler that was registered
      const setNotificationHandlerCalls = mockServer.setNotificationHandler.mock.calls;
      const initializedHandlerCall = setNotificationHandlerCalls.find(
        (call: any) => call[0] === InitializedNotificationSchema,
      );

      expect(initializedHandlerCall).toBeDefined();
      const notificationHandler = initializedHandlerCall[1];

      // Simulate a notification being received from server
      const testNotification = {
        method: 'notifications/initialized',
        params: {},
      };

      // Execute the handler
      await notificationHandler(testNotification);

      // Verify that the client notification was NOT called since client is disconnected
      expect(mockClient.notification).not.toHaveBeenCalled();
    });
  });
});

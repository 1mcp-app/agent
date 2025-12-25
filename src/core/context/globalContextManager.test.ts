import { getGlobalContextManager, GlobalContextManager } from '@src/core/context/globalContextManager.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('GlobalContextManager', () => {
  let contextManager: GlobalContextManager;
  let mockContext: ContextData;

  beforeEach(() => {
    // Reset singleton before each test
    (GlobalContextManager as any).instance = null;
    contextManager = GlobalContextManager.getInstance();

    mockContext = {
      sessionId: 'test-session-123',
      version: '1.0.0',
      project: {
        name: 'test-project',
        path: '/path/to/project',
        environment: 'development',
        git: {
          branch: 'main',
          commit: 'abc123',
          repository: 'origin',
        },
        custom: {
          projectId: 'proj-123',
          team: 'frontend',
          apiEndpoint: 'https://api.dev.local',
        },
      },
      user: {
        uid: 'user-456',
        username: 'testuser',
        email: 'test@example.com',
        name: 'Test User',
      },
      environment: {
        variables: {
          role: 'developer',
          permissions: 'read,write',
        },
      },
      timestamp: '2024-01-15T10:30:00Z',
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = GlobalContextManager.getInstance();
      const instance2 = GlobalContextManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance for testing', () => {
      const instance1 = GlobalContextManager.getInstance();
      (GlobalContextManager as any).instance = null;
      const instance2 = GlobalContextManager.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('getGlobalContextManager', () => {
    it('should return the singleton instance', () => {
      const instance = getGlobalContextManager();
      expect(instance).toBeInstanceOf(GlobalContextManager);
      expect(instance).toBe(contextManager);
    });
  });

  describe('Context Management', () => {
    it('should store and retrieve context', () => {
      contextManager.updateContext(mockContext);
      const retrievedContext = contextManager.getContext();

      expect(retrievedContext).toEqual(mockContext);
    });

    it('should return undefined when no context is set', () => {
      const retrievedContext = contextManager.getContext();
      expect(retrievedContext).toBeUndefined();
    });

    it('should update context and emit change event', () => {
      const changeListener = vi.fn();
      contextManager.on('context-changed', changeListener);

      contextManager.updateContext(mockContext);

      expect(changeListener).toHaveBeenCalledWith({
        oldContext: undefined,
        newContext: mockContext,
        sessionIdChanged: true,
        timestamp: expect.any(Number),
      });
    });

    it('should detect session ID changes', () => {
      const changeListener = vi.fn();
      contextManager.updateContext(mockContext);
      contextManager.on('context-changed', changeListener);

      const newContext = {
        ...mockContext,
        sessionId: 'different-session-456',
      };

      contextManager.updateContext(newContext);

      expect(changeListener).toHaveBeenCalledWith({
        oldContext: mockContext,
        newContext: newContext,
        sessionIdChanged: true,
        timestamp: expect.any(Number),
      });
    });

    it('should detect session ID unchanged', () => {
      const changeListener = vi.fn();
      contextManager.updateContext(mockContext);
      contextManager.on('context-changed', changeListener);

      const newContext = {
        ...mockContext,
        project: {
          ...mockContext.project,
          name: 'different-project-name',
        },
      };

      contextManager.updateContext(newContext);

      expect(changeListener).toHaveBeenCalledWith({
        oldContext: mockContext,
        newContext: newContext,
        sessionIdChanged: false,
        timestamp: expect.any(Number),
      });
    });

    it('should not emit event when context is the same', () => {
      const changeListener = vi.fn();
      contextManager.updateContext(mockContext);
      contextManager.on('context-changed', changeListener);

      contextManager.updateContext(mockContext); // Same context

      expect(changeListener).not.toHaveBeenCalled();
    });

    it('should handle context without sessionId', () => {
      const changeListener = vi.fn();
      contextManager.on('context-changed', changeListener);

      const contextWithoutSession = { ...mockContext };
      delete (contextWithoutSession as any).sessionId;

      contextManager.updateContext(contextWithoutSession);

      expect(changeListener).toHaveBeenCalledWith({
        oldContext: undefined,
        newContext: contextWithoutSession,
        sessionIdChanged: true, // Should treat as changed when sessionId is missing
        timestamp: expect.any(Number),
      });
    });

    it('should emit event when going from no context to context with sessionId', () => {
      const changeListener = vi.fn();
      contextManager.on('context-changed', changeListener);

      const contextWithoutSession = { ...mockContext };
      delete (contextWithoutSession as any).sessionId;

      contextManager.updateContext(contextWithoutSession);
      changeListener.mockClear();

      contextManager.updateContext(mockContext);

      expect(changeListener).toHaveBeenCalledWith({
        oldContext: contextWithoutSession,
        newContext: mockContext,
        sessionIdChanged: true,
        timestamp: expect.any(Number),
      });
    });
  });

  describe('Event Emission', () => {
    it('should handle multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      contextManager.on('context-changed', listener1);
      contextManager.on('context-changed', listener2);
      contextManager.on('different-event', listener3);

      contextManager.updateContext(mockContext);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener3).not.toHaveBeenCalled();
    });

    it('should handle listener removal', () => {
      const listener = vi.fn();

      contextManager.on('context-changed', listener);
      contextManager.updateContext(mockContext);
      expect(listener).toHaveBeenCalledTimes(1);

      contextManager.off('context-changed', listener);
      contextManager.updateContext({ ...mockContext, sessionId: 'new-session' });
      expect(listener).toHaveBeenCalledTimes(1); // Should not be called again
    });

    it('should handle once listeners', () => {
      const listener = vi.fn();

      contextManager.once('context-changed', listener);

      contextManager.updateContext(mockContext);
      expect(listener).toHaveBeenCalledTimes(1);

      contextManager.updateContext({ ...mockContext, sessionId: 'new-session' });
      expect(listener).toHaveBeenCalledTimes(1); // Should not be called again
    });

    it('should emit all events when context is updated', () => {
      const listeners = {
        'context-changed': vi.fn(),
        'context-updated': vi.fn(),
        'session-changed': vi.fn(),
      };

      Object.entries(listeners).forEach(([event, listener]) => {
        contextManager.on(event, listener);
      });

      contextManager.updateContext(mockContext);

      expect(listeners['context-changed']).toHaveBeenCalled();
      expect(listeners['context-updated']).toHaveBeenCalled();
      expect(listeners['session-changed']).toHaveBeenCalled();
    });

    it('should handle errors in listeners gracefully', () => {
      const errorListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const normalListener = vi.fn();

      contextManager.on('context-changed', errorListener);
      contextManager.on('context-changed', normalListener);

      // Should not throw even if a listener throws
      expect(() => {
        contextManager.updateContext(mockContext);
      }).not.toThrow();

      expect(errorListener).toHaveBeenCalled();
      expect(normalListener).toHaveBeenCalled();
    });
  });

  describe('Context Validation', () => {
    it('should accept partial context data', () => {
      const partialContext = {
        sessionId: 'session-123',
        project: {
          name: 'test',
          path: '/path',
          environment: 'dev',
        },
        user: {
          uid: 'user-456',
          username: 'testuser',
          email: 'test@example.com',
        },
        environment: {
          variables: {},
        },
        timestamp: '2024-01-15T10:30:00Z',
      };

      expect(() => {
        contextManager.updateContext(partialContext as ContextData);
      }).not.toThrow();

      expect(contextManager.getContext()).toEqual(partialContext);
    });

    it('should handle context with nested objects', () => {
      const complexContext = {
        ...mockContext,
        project: {
          ...mockContext.project,
          custom: {
            ...mockContext.project.custom,
            nested: {
              deep: {
                value: 'nested-value',
              },
            },
          },
        },
      };

      contextManager.updateContext(complexContext);

      expect(contextManager.getContext()).toEqual(complexContext);
    });

    it('should handle context with arrays', () => {
      const contextWithArrays = {
        ...mockContext,
        environment: {
          ...mockContext.environment,
          variables: {
            ...mockContext.environment?.variables,
            tags: 'developer,frontend,react',
            scores: '1,2,3',
          },
        },
      };

      contextManager.updateContext(contextWithArrays);

      expect(contextManager.getContext()).toEqual(contextWithArrays);
    });
  });

  describe('Memory Management', () => {
    it('should handle large context objects', () => {
      const largeContext = {
        ...mockContext,
        project: {
          ...mockContext.project,
          custom: {
            largeData: 'x'.repeat(10000), // 10KB string
          },
        },
      };

      expect(() => {
        contextManager.updateContext(largeContext);
      }).not.toThrow();

      expect(contextManager.getContext()?.project.custom?.largeData).toBe('x'.repeat(10000));
    });

    it('should handle frequent context updates', () => {
      const listener = vi.fn();
      contextManager.on('context-changed', listener);

      // Update context many times rapidly
      for (let i = 0; i < 100; i++) {
        contextManager.updateContext({
          ...mockContext,
          environment: {
            ...mockContext.environment,
            variables: {
              ...mockContext.environment?.variables,
              counter: i.toString(),
            },
          },
        });
      }

      expect(listener).toHaveBeenCalledTimes(100);
    });
  });
});

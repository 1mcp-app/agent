import { JSON_VALUE_LIMITS, type JsonValueLimits, toJsonValue } from '@src/sdk/contracts/index.js';

import { describe, expect, it, vi } from 'vitest';

import {
  type CapabilityPage,
  type CapabilityPaginationResult,
  CapabilityResponseBudgetError,
  walkCapabilityPages,
} from './capabilityPagination.js';

// The walk keeps 64 nodes for the response envelope; each test item below is one node.
const limits: JsonValueLimits = { ...JSON_VALUE_LIMITS, maxNodes: 64 + 3 };

function provider(id: string, pages: Record<string, CapabilityPage<string>>) {
  return { id, name: id, list: vi.fn(async (cursor?: string) => pages[cursor ?? '']) };
}

function expectFits(response: CapabilityPaginationResult<string>) {
  expect(() =>
    toJsonValue(
      {
        tools: response.items,
        ...(response.nextCursor === undefined ? {} : { nextCursor: response.nextCursor }),
        ...(response._meta === undefined ? {} : { _meta: response._meta }),
      },
      limits,
    ),
  ).not.toThrow();
}

async function walkAll(options: Parameters<typeof walkCapabilityPages<string>>[0]) {
  const responses: CapabilityPaginationResult<string>[] = [];
  let cursor: string | undefined;
  do {
    const response = await walkCapabilityPages<string>({ ...options, cursor });
    expectFits(response);
    responses.push(response);
    cursor = response.nextCursor;
  } while (cursor !== undefined && responses.length < 20);
  return responses;
}

describe('capability walks with a response budget', () => {
  it('splits an upstream page that does not fit and resumes at the next item', async () => {
    const responses = await walkAll({
      connections: new Map(),
      providers: [
        provider('a', { '': { items: ['a1', 'a2', 'a3', 'a4', 'a5'], nextCursor: 'next' }, next: { items: ['a6'] } }),
        provider('b', { '': { items: ['b1'] } }),
      ],
      kind: 'tools',
      filterSelection: null,
      enablePagination: true,
      responseBudget: { limits },
    });

    expect(responses.map((response) => response.items)).toEqual([['a1', 'a2', 'a3'], ['a4', 'a5'], ['a6'], ['b1']]);
  });

  it('fills a non-paginated response up to the budget and continues across providers', async () => {
    const failing = { id: 'c', name: 'c', list: vi.fn(async () => Promise.reject(new Error('down'))) };
    const options = {
      connections: new Map(),
      providers: [
        provider('a', { '': { items: ['a1', 'a2'], nextCursor: 'next' }, next: { items: ['a3', 'a4'] } }),
        provider('b', { '': { items: ['b1', 'b2'] } }),
        failing,
      ],
      kind: 'tools' as const,
      filterSelection: null,
      enablePagination: false,
      responseBudget: { limits },
    };

    const responses = await walkAll(options);

    expect(responses.map((response) => response.items)).toEqual([
      ['a1', 'a2', 'a3'],
      ['a4', 'b1', 'b2'],
    ]);
    expect(responses[1]._meta).toMatchObject({
      'app.1mcp/capability-pagination': { partial: true, failedSourceCount: 1 },
    });
  });

  it.each([true, false])(
    'retains admission failures across budget continuations (pagination %s)',
    async (enablePagination) => {
      const responses = await walkAll({
        connections: new Map(),
        providers: [provider('a', { '': { items: ['a1', 'a2', 'a3', 'a4', 'a5'] } })],
        kind: 'tools',
        filterSelection: null,
        enablePagination,
        responseBudget: { limits },
        upstreamToolAdmissionTimeouts: ['a', 'a'],
      });

      expect(responses.map((response) => response.items)).toEqual([
        ['a1', 'a2', 'a3'],
        ['a4', 'a5'],
      ]);
      for (const response of responses) {
        expect(response._meta).toMatchObject({
          'app.1mcp/capability-pagination': {
            partial: true,
            complete: false,
            failedSourceCount: 1,
            failureCategories: { upstream_tool_admission_timeout: 2 },
            retryable: true,
          },
        });
      }
    },
  );

  it('retains admission and provider failures when all budgeted providers fail', async () => {
    await expect(
      walkCapabilityPages<string>({
        connections: new Map(),
        providers: [
          {
            id: 'a',
            name: 'a',
            list: async () => {
              throw new Error('down');
            },
          },
        ],
        kind: 'tools',
        filterSelection: null,
        enablePagination: false,
        responseBudget: { limits },
        upstreamToolAdmissionTimeouts: ['a'],
      }),
    ).rejects.toMatchObject({
      _meta: {
        'app.1mcp/capability-pagination': {
          partial: true,
          failedSourceCount: 1,
          failureCategories: { upstream_list_failed: 1, upstream_tool_admission_timeout: 1 },
        },
      },
    });
  });

  it('keeps returning every item when no budget is given', async () => {
    const response = await walkCapabilityPages<string>({
      connections: new Map(),
      providers: [provider('a', { '': { items: ['a1', 'a2', 'a3', 'a4', 'a5'] } })],
      kind: 'tools',
      filterSelection: null,
      enablePagination: false,
    });

    expect(response).toMatchObject({ items: ['a1', 'a2', 'a3', 'a4', 'a5'] });
    expect(response.nextCursor).toBeUndefined();
  });

  // Items sit three levels below the response frame root: `result`, the list key, the index.
  it.each([
    { enablePagination: true, item: ['x', 'y', 'z', 'w'], itemLimits: limits },
    { enablePagination: false, item: ['x', 'y', 'z', 'w'], itemLimits: limits },
    { enablePagination: true, item: [[0]], itemLimits: { ...JSON_VALUE_LIMITS, maxDepth: 4 } },
    { enablePagination: false, item: [[0]], itemLimits: { ...JSON_VALUE_LIMITS, maxDepth: 4 } },
  ])(
    'refuses an item that cannot fit any response (pagination $enablePagination, $item)',
    async ({ enablePagination, item, itemLimits }) => {
      await expect(
        walkCapabilityPages<unknown>({
          connections: new Map(),
          providers: [{ id: 'a', name: 'a', list: async () => ({ items: [item] }) }],
          kind: 'tools',
          filterSelection: null,
          enablePagination,
          responseBudget: { limits: itemLimits },
        }),
      ).rejects.toBeInstanceOf(CapabilityResponseBudgetError);
    },
  );

  it('ends a filled response before an item that cannot fit any response', async () => {
    const options = {
      connections: new Map(),
      providers: [{ id: 'a', name: 'a', list: async () => ({ items: ['a1', ['a2']] }) }],
      kind: 'tools' as const,
      filterSelection: null,
      enablePagination: false,
      responseBudget: { limits: { ...JSON_VALUE_LIMITS, maxDepth: 3 } },
    };
    const first = await walkCapabilityPages<unknown>(options);

    expect(first.items).toEqual(['a1']);
    expect(first.nextCursor).toBeDefined();
    await expect(walkCapabilityPages<unknown>({ ...options, cursor: first.nextCursor })).rejects.toBeInstanceOf(
      CapabilityResponseBudgetError,
    );
  });

  it('measures items in the form the caller projects them to', async () => {
    const project = vi.fn((item: string) => [item]);
    const responses = await walkAll({
      connections: new Map(),
      providers: [provider('a', { '': { items: ['a1', 'a2', 'a3'] } })],
      kind: 'tools',
      filterSelection: null,
      enablePagination: true,
      responseBudget: { limits, project },
    });

    expect(responses.map((response) => response.items)).toEqual([['a1'], ['a2'], ['a3']]);
    expect(project).toHaveBeenCalledWith('a1');
  });
});

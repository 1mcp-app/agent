import { createHash } from 'node:crypto';

import { z } from 'zod';

const cursorSchema = z.object({
  version: z.literal(1),
  inventory: z.string(),
  offset: z.number().int().positive().safe(),
});

export class InspectCursorError extends Error {
  constructor() {
    super('Invalid or stale inspect cursor. Restart inspection without --cursor.');
  }
}

/** Page a freshly authorized, complete inventory; cursors never carry tool data. */
export function paginateInspectTools<T>(
  tools: T[],
  options: { limit: number; all?: boolean; cursor?: string; scope: unknown },
): { tools: T[]; totalTools: number; hasMore: boolean; nextCursor?: string } {
  const inventory = createHash('sha256')
    .update(JSON.stringify([options.scope, tools]))
    .digest('hex');
  let offset = 0;
  if (options.cursor !== undefined) {
    try {
      const cursor = cursorSchema.parse(JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')));
      if (cursor.inventory !== inventory || cursor.offset >= tools.length) throw new InspectCursorError();
      offset = cursor.offset;
    } catch {
      throw new InspectCursorError();
    }
  }
  const end = options.all ? tools.length : Math.min(offset + options.limit, tools.length);
  const hasMore = end < tools.length;
  return {
    tools: tools.slice(offset, end),
    totalTools: tools.length,
    hasMore,
    nextCursor: hasMore
      ? Buffer.from(JSON.stringify({ version: 1, inventory, offset: end })).toString('base64url')
      : undefined,
  };
}

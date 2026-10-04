import { describe, expect, it } from 'vitest';

import { partitionByDuration } from '../../test/e2e/setup/duration-sequencer.js';

const root = '/checkout';
const files = Array.from({ length: 8 }, (_, index) => ({ moduleId: `${root}/test/${index}.test.ts` }));
const durations = Object.fromEntries(
  [60, 40, 30, 30, 20, 20, 10, 10].map((value, index) => [`test/${index}.test.ts`, value]),
);

describe('duration-balanced E2E shards', () => {
  it('covers every supplied file exactly once while balancing known durations', () => {
    const shards = partitionByDuration(files, root, durations, 4);
    expect(shards.flat()).toHaveLength(files.length);
    expect(new Set(shards.flat())).toEqual(new Set(files));
    const totals = shards.map((shard) =>
      shard.reduce((sum, file) => sum + durations[file.moduleId.slice(root.length + 1)], 0),
    );
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(10);
  });

  it('keeps assignments and longest-first order independent of discovery order', () => {
    const shards = partitionByDuration(files, root, durations, 4);
    expect(partitionByDuration([...files].reverse(), root, durations, 4)).toEqual(shards);
    for (const shard of shards) {
      const times = shard.map((file) => durations[file.moduleId.slice(root.length + 1)]);
      expect(times).toEqual([...times].sort((a, b) => b - a));
    }
  });

  it('uses relative paths across checkout locations and Windows separators', () => {
    const windows = files.map((file) => ({
      moduleId: file.moduleId.replace(root, 'C:/checkout').replaceAll('/', '\\'),
    }));
    const relative = (shards: { moduleId: string }[][]) =>
      shards.map((shard) => shard.map((file) => file.moduleId.split(/[\\/]/).at(-1)));
    expect(relative(partitionByDuration(windows, 'C:\\checkout', durations, 4))).toEqual(
      relative(partitionByDuration(files, root, durations, 4)),
    );
  });

  it('includes new files without timings and ignores obsolete timing entries', () => {
    const added = { moduleId: `${root}/test/new.test.ts` };
    const withNew = [...files, added];
    const shards = partitionByDuration(withNew, root, { ...durations, 'test/deleted.test.ts': 999_999 }, 4);
    expect(shards.flat()).toHaveLength(withNew.length);
    expect(new Set(shards.flat())).toEqual(new Set(withNew));
    expect(partitionByDuration([...withNew].reverse(), root, durations, 4)).toEqual(shards);
  });

  it('preserves coverage for empty inputs and more shards than files', () => {
    expect(partitionByDuration([], root, durations, 4)).toEqual([[], [], [], []]);
    const shards = partitionByDuration(files.slice(0, 2), root, durations, 4);
    expect(shards.flat()).toHaveLength(2);
    expect(new Set(shards.flat())).toEqual(new Set(files.slice(0, 2)));
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid shard counts (%s)', (count) => {
    expect(() => partitionByDuration(files, root, durations, count)).toThrow('positive integer');
  });
});

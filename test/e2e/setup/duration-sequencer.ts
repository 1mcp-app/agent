import path from 'node:path';

import { BaseSequencer, type TestSpecification } from 'vitest/node';

import timings from './e2e-durations.json';

interface TestFile {
  moduleId: string;
}

export function partitionByDuration<T extends TestFile>(
  files: T[],
  root: string,
  durations: Record<string, number>,
  count: number,
): T[][] {
  if (!Number.isInteger(count) || count < 1) throw new Error('Shard count must be a positive integer');
  const shards: T[][] = Array.from({ length: count }, () => []);
  const totals = Array<number>(count).fill(0);
  const estimated = files.map((file) => {
    const name = path.posix.relative(root.replaceAll('\\', '/'), file.moduleId.replaceAll('\\', '/'));
    return { file, name, duration: durations[name] ?? 10_000 };
  });
  estimated.sort((a, b) => {
    if (a.duration !== b.duration) return b.duration - a.duration;
    if (a.name < b.name) return -1;
    return a.name > b.name ? 1 : 0;
  });
  for (const { file, duration } of estimated) {
    let lightest = 0;
    for (let index = 1; index < count; index++) {
      if (totals[index] < totals[lightest]) lightest = index;
    }
    shards[lightest].push(file);
    totals[lightest] += duration;
  }
  return shards;
}

export default class DurationSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    if (!shard) return files;
    return partitionByDuration(files, this.ctx.config.root, timings.durationsMs, shard.count)[shard.index - 1];
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    // Sharded files already run longest first; preserve normal local/watch ordering.
    if (this.ctx.config.shard) return files;
    return super.sort(files);
  }
}

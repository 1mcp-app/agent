import { getConfiguredServerTargets } from '@src/config/configuredServerTargets.js';

/** Re-evaluate the untagged-installation exception against current configuration on each selection. */
export function tagGrantAllows(grantedTags: readonly string[] | undefined): (tags: readonly string[]) => boolean {
  if (grantedTags === undefined) return () => true;
  if (grantedTags.length === 0) {
    const hasConfiguredTags = Object.values(getConfiguredServerTargets()).some((target) => target.tags?.length);
    return (tags) => !hasConfiguredTags && tags.length === 0;
  }
  const granted = new Set(grantedTags);
  return (tags) => tags.some((tag) => granted.has(tag));
}

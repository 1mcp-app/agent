import { parseAllDocuments } from 'yaml';

export function parsePnpmDependencyLockfile(source) {
  // pnpm 12 prepends a separate document for package-manager/config dependencies.
  const locks = parseAllDocuments(source).map((document) => {
    if (document.errors.length > 0) throw document.errors[0];
    return document.toJS();
  });
  const dependencyLocks = locks.filter((lock) => {
    const importer = lock?.importers?.['.'];
    if (!importer) return false;
    if (Object.hasOwn(importer, 'packageManagerDependencies')) return false;
    if (Object.hasOwn(importer, 'configDependencies')) return false;
    return true;
  });
  if (dependencyLocks.length !== 1) {
    throw new Error('Expected one pnpm dependency lockfile document with a root importer');
  }
  return dependencyLocks[0];
}

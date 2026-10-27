export interface CollectionPolicy {
  testSuppressed: boolean;
  doNotTrack?: boolean;
  processEnabled?: boolean;
  storedEnabled?: boolean;
  ci: boolean;
  ciEnabled?: boolean;
}

export function collectionEnabled(policy: CollectionPolicy): boolean {
  if (policy.testSuppressed) return false;
  if (policy.doNotTrack) return false;
  if (policy.processEnabled === false) return false;
  if (policy.storedEnabled === false) return false;
  if (policy.ci && policy.ciEnabled !== true) return false;
  return true;
}

/** Used only at the environment/configuration boundary. */
export function parseEnvironmentBoolean(value: string | undefined): boolean {
  if (value === undefined || value === '') return false;
  switch (value.toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
      return true;
    case '0':
    case 'false':
    case 'no':
      return false;
    default:
      throw new Error('Expected boolean environment value: true/false, 1/0, yes/no');
  }
}

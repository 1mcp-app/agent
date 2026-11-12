const MAX_SUBSCRIPTION_OWNERS = 1024;
let subscriptionOwners = 0;

export class SessionAdmissionCapacityError extends Error {
  constructor() {
    super('Subscription owner admission limit exceeded');
    this.name = 'SessionAdmissionCapacityError';
  }
}

export function hasSessionAdmissionCapacity(): boolean {
  return subscriptionOwners < MAX_SUBSCRIPTION_OWNERS;
}

export function reserveSubscriptionOwner(): void {
  if (!hasSessionAdmissionCapacity()) throw new SessionAdmissionCapacityError();
  subscriptionOwners++;
}

export function releaseSubscriptionOwner(): void {
  subscriptionOwners--;
}

const authRevalidators = new WeakMap<object, () => Promise<boolean>>();

/** Register only original, admitted auth objects with their provider-backed grant fence. */
export function registerRequestAuthRevalidator(auth: object, revalidate: () => Promise<boolean>): void {
  authRevalidators.set(auth, revalidate);
}

/** Revalidate the admitted request grant without initializing an HTTP middleware. */
export async function revalidateLegacyRequestAuthInfo(auth: object | undefined): Promise<boolean> {
  const revalidate = auth && authRevalidators.get(auth);
  if (!revalidate) return false;
  try {
    return await revalidate();
  } catch {
    // Credential storage and verifier errors must not leak tokens or permit a stale grant.
    return false;
  }
}

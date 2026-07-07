import { RuntimeIdentity } from '@src/core/runtime/runtimeIdentityService.js';

import { Router } from 'express';

export interface RuntimeIdentityProvider {
  getRuntimeIdentity(): RuntimeIdentity;
}

export function createRuntimeIdentityRoutes(identityProvider: RuntimeIdentityProvider): Router {
  const router = Router();

  router.get('/runtime-identity', (_req, res) => {
    res.status(200).json(identityProvider.getRuntimeIdentity());
  });

  return router;
}

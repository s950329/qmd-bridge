import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

/**
 * POST /index
 * Trigger a re-index for the authenticated tenant.
 * Returns 202 Accepted immediately; indexing runs in the background.
 * Returns 409 Conflict if indexing is already in progress for this tenant.
 */
router.post('/index', authMiddleware, (req, res) => {
  const logger = req.app.get('logger');
  const indexingManager = req.app.get('indexingManager');
  const tenant = req.tenant;

  if (!indexingManager) {
    return res.status(503).json({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Indexing service is not available' },
    });
  }

  if (indexingManager.isInProgress(tenant.label)) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'INDEX_IN_PROGRESS',
        message: `Indexing already in progress for collection "${tenant.collection}"`,
      },
    });
  }

  indexingManager.triggerIndex(tenant);

  logger.info({ label: tenant.label, collection: tenant.collection }, 'Index triggered via API');

  return res.status(202).json({
    success: true,
    message: `Indexing started for collection "${tenant.collection}"`,
  });
});

export default router;

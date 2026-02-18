import { Router } from 'express';
import { VERSION } from '../constants.js';

const router = Router();

const startTime = Date.now();

/**
 * GET /health — Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: VERSION,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

export default router;

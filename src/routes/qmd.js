import { Router } from 'express';
import { z } from 'zod';
import { executeQmd } from '../services/executor.js';
import { authMiddleware } from '../middleware/auth.js';
import { ALLOWED_COMMANDS, MAX_QUERY_LENGTH } from '../constants.js';

const router = Router();

// Zod schema for request validation
const qmdRequestSchema = z.object({
  command: z.enum(ALLOWED_COMMANDS, {
    errorMap: () => ({ message: 'Command not in allowed list' }),
  }),
  query: z
    .string()
    .min(1, 'Query is required')
    .max(MAX_QUERY_LENGTH, `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`),
});

/**
 * POST /qmd — Execute a qmd query
 * Requires Bearer Token authentication.
 */
router.post('/qmd', authMiddleware, async (req, res) => {
  // Validate request body
  const result = qmdRequestSchema.safeParse(req.body);

  if (!result.success) {
    const firstError = result.error.errors[0];
    let errorCode = 'INVALID_REQUEST';
    let message = firstError.message;

    if (firstError.path.includes('command')) {
      errorCode = 'INVALID_COMMAND';
    } else if (firstError.path.includes('query') && firstError.code === 'too_big') {
      errorCode = 'QUERY_TOO_LONG';
    }

    return res.status(400).json({
      success: false,
      error: { code: errorCode, message },
    });
  }

  const { command, query } = result.data;
  const logger = req.app.get('logger');

  try {
    const { stdout, executionTime } = await executeQmd({
      command,
      query,
      collection: req.tenant.collection,
      logger,
    });

    return res.json({
      success: true,
      data: stdout,
      executionTime,
    });
  } catch (err) {
    if (logger) {
      logger.error({ err: err.message, code: err.code, tenant: req.tenant.label }, 'qmd execution error');
    }

    const statusMap = {
      INVALID_COMMAND: 400,
      TOO_MANY_REQUESTS: 503,
      EXECUTION_TIMEOUT: 504,
      EXECUTION_FAILED: 500,
    };

    const status = statusMap[err.code] || 500;
    const code = err.code || 'EXECUTION_FAILED';

    // Do not leak host paths or stack traces
    const safeMessages = {
      INVALID_COMMAND: 'Command not in allowed list',
      TOO_MANY_REQUESTS: 'Max concurrent executions reached',
      EXECUTION_TIMEOUT: 'qmd execution timed out',
      EXECUTION_FAILED: 'qmd execution failed',
    };

    return res.status(status).json({
      success: false,
      error: {
        code,
        message: safeMessages[code] || 'Internal server error',
      },
    });
  }
});

export default router;

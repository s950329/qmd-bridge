/**
 * Test helper: creates a minimal Express app that mirrors the production server
 * but without starting a listener or writing PID files.
 *
 * Tests should mock `execFile` and config before importing this.
 */
import express from 'express';
import healthRouter from '../../src/routes/health.js';
import qmdRouter from '../../src/routes/qmd.js';
import { createMcpHandler } from '../../src/mcp/index.js';

/**
 * Build and return the Express app used in integration tests.
 * @param {object} [options]
 * @param {pino.Logger} [options.logger] - Logger to attach
 * @returns {import('express').Express}
 */
export function createTestApp({ logger } = {}) {
  const app = express();
  app.use(express.json());

  if (logger) {
    app.set('logger', logger);
  } else {
    // Silent logger for tests
    app.set('logger', {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
    });
  }

  // MCP endpoint
  app.post('/mcp', createMcpHandler());

  // REST routes
  app.use(healthRouter);
  app.use(qmdRouter);

  // Error handler
  app.use((err, req, res, _next) => {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  return app;
}

/**
 * Test helper: creates a minimal Express app that mirrors the production server
 * but without starting a listener or writing PID files.
 *
 * Tests should mock `execFile` and config before importing this.
 */
import express from 'express';
import healthRouter from '../../src/routes/health.js';
import qmdRouter from '../../src/routes/qmd.js';
import indexRouter from '../../src/routes/index.js';
import { createMcpHandler } from '../../src/mcp/index.js';

const SILENT_LOGGER = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
};

/**
 * Build and return the Express app used in integration tests.
 * @param {object} [options]
 * @param {pino.Logger} [options.logger] - Logger to attach
 * @param {object} [options.indexingManager] - IndexingManager instance to attach
 * @returns {import('express').Express}
 */
export function createTestApp({ logger, indexingManager } = {}) {
  const app = express();
  app.use(express.json());

  app.set('logger', logger ?? SILENT_LOGGER);

  if (indexingManager !== undefined) {
    app.set('indexingManager', indexingManager);
  }

  // MCP endpoint
  app.post('/mcp', createMcpHandler());

  // REST routes
  app.use(healthRouter);
  app.use(qmdRouter);
  app.use(indexRouter);

  // Error handler
  app.use((err, req, res, _next) => {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  return app;
}

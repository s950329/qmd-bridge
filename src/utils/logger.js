import pino from 'pino';
import { mkdirSync } from 'node:fs';
import { LOG_DIR } from '../constants.js';

// Ensure log directory exists
mkdirSync(LOG_DIR, { recursive: true });

/**
 * Get the current log file path (date-based rotation).
 * @returns {string} Path to today's log file
 */
function getLogFilePath() {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `${LOG_DIR}/qmd-bridge-${date}.log`;
}

/**
 * Create a pino logger instance.
 * When running as a daemon (server), logs go to file.
 * When running as CLI, logs go to stdout.
 * @param {object} options
 * @param {boolean} [options.toFile=false] - Whether to log to file
 * @returns {pino.Logger}
 */
export function createLogger({ toFile = false } = {}) {
  if (toFile) {
    return pino(
      { level: 'info' },
      pino.destination({ dest: getLogFilePath(), sync: false }),
    );
  }
  return pino({ level: 'info' });
}

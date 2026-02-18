import { execFile } from 'node:child_process';
import { getQmdPath, getServerConfig } from '../utils/config.js';
import { MAX_BUFFER, ALLOWED_COMMANDS } from '../constants.js';

// Simple semaphore for concurrency control
let activeCount = 0;

/**
 * Execute a qmd command scoped to a specific collection.
 * Uses `-c <collection>` to ensure tenant isolation (qmd uses a global index,
 * not cwd-based scoping).
 * @param {object} options
 * @param {string} options.command - qmd subcommand (must be in whitelist)
 * @param {string} options.query - Search query string
 * @param {string} options.collection - qmd collection name for tenant isolation
 * @param {pino.Logger} [options.logger] - Logger instance
 * @returns {Promise<{stdout: string, executionTime: number}>}
 */
export async function executeQmd({ command, query, collection, logger }) {
  const serverConfig = getServerConfig();
  const qmdPath = getQmdPath();
  const maxConcurrent = serverConfig.maxConcurrent;

  // Check concurrency limit
  if (maxConcurrent > 0 && activeCount >= maxConcurrent) {
    const err = new Error('Max concurrent executions reached');
    err.code = 'TOO_MANY_REQUESTS';
    throw err;
  }

  // Validate command is in whitelist
  if (!ALLOWED_COMMANDS.includes(command)) {
    const err = new Error(`Command not in allowed list: ${command}`);
    err.code = 'INVALID_COMMAND';
    throw err;
  }

  activeCount++;
  const startTime = Date.now();

  try {
    // Build args: qmd <command> <query> -c <collection>
    const args = [command, query, '-c', collection];

    const stdout = await new Promise((resolve, reject) => {
      execFile(
        qmdPath,
        args,
        {
          timeout: serverConfig.executionTimeout,
          maxBuffer: MAX_BUFFER,
        },
        (error, stdout, stderr) => {
          if (error) {
            if (error.killed || error.signal === 'SIGTERM') {
              const timeoutErr = new Error('qmd execution timed out');
              timeoutErr.code = 'EXECUTION_TIMEOUT';
              reject(timeoutErr);
            } else {
              const execErr = new Error(`qmd execution failed: ${error.message}`);
              execErr.code = 'EXECUTION_FAILED';
              reject(execErr);
            }
            return;
          }
          resolve(stdout);
        },
      );
    });

    const executionTime = Date.now() - startTime;

    if (logger) {
      logger.info({ command, executionTime, collection }, 'qmd execution completed');
    }

    return { stdout, executionTime };
  } finally {
    activeCount--;
  }
}

/**
 * Get the current number of active executions.
 * @returns {number}
 */
export function getActiveCount() {
  return activeCount;
}

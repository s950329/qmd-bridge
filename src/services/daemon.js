import { spawn, execSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PID_FILE, LOG_DIR, CONFIG_DIR } from '../constants.js';
import { getConfig } from '../utils/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Check if a process with the given PID is running.
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read PID from PID file.
 * @returns {number|null}
 */
function readPid() {
  if (!existsSync(PID_FILE)) {
    return null;
  }
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Start the qmd-bridge server as a daemon.
 * @param {object} [options] - Options to pass (port, host, maxConcurrent)
 * @returns {{ success: boolean, pid?: number, error?: string }}
 */
export function startDaemon(options = {}) {
  // Check if already running
  const existingPid = readPid();
  if (existingPid && isProcessRunning(existingPid)) {
    return { success: false, error: `Server is already running (PID: ${existingPid})` };
  }

  // Ensure directories exist
  mkdirSync(CONFIG_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });

  // Save options to config if provided
  const config = getConfig();
  if (options.port) config.set('server.port', options.port);
  if (options.host) config.set('server.host', options.host);
  if (options.maxConcurrent !== undefined) config.set('server.maxConcurrent', options.maxConcurrent);

  const serverPath = join(__dirname, '..', 'server.js');

  // Get current log file path for stdout/stderr redirect
  const date = new Date().toISOString().split('T')[0];
  const logFile = join(LOG_DIR, `qmd-bridge-${date}.log`);

  const out = openSync(logFile, 'a');
  const err = openSync(logFile, 'a');

  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env },
  });

  child.unref();

  return { success: true, pid: child.pid };
}

/**
 * Stop the running qmd-bridge server.
 * @returns {{ success: boolean, error?: string }}
 */
export function stopDaemon() {
  const pid = readPid();

  if (!pid) {
    return { success: false, error: 'No PID file found. Server may not be running.' };
  }

  if (!isProcessRunning(pid)) {
    // Clean up stale PID file
    try {
      unlinkSync(PID_FILE);
    } catch { /* ignore */ }
    return { success: false, error: 'Server process not found. Cleaned up stale PID file.' };
  }

  try {
    process.kill(pid, 'SIGTERM');

    // Wait briefly for process to stop
    let attempts = 0;
    while (attempts < 20 && isProcessRunning(pid)) {
      execSync('sleep 0.25');
      attempts++;
    }

    // Clean up PID file if it still exists
    try {
      unlinkSync(PID_FILE);
    } catch { /* ignore */ }

    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to stop server: ${err.message}` };
  }
}

/**
 * Get the status of the qmd-bridge server.
 * @returns {{ running: boolean, pid?: number }}
 */
export function getDaemonStatus() {
  const pid = readPid();

  if (!pid || !isProcessRunning(pid)) {
    return { running: false };
  }

  return {
    running: true,
    pid,
  };
}

export { readPid, isProcessRunning };

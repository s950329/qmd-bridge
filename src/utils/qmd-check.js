import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import { getQmdPath } from './config.js';

const QMD_INSTALL_CMD = 'npm install -g @tobilu/qmd';
const QMD_REPO_URL = 'https://github.com/tobi/qmd';

/**
 * Check if qmd is installed and reachable.
 * @returns {{ installed: boolean, version?: string }}
 */
export function checkQmdInstalled() {
  const qmdPath = getQmdPath();

  try {
    const output = execFileSync(qmdPath, ['--version'], {
      timeout: 5_000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const version = output.trim();
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

/**
 * Print a warning message when qmd is not found.
 * Guides the user to install it.
 */
export function printQmdNotFoundWarning() {
  console.error();
  console.error(chalk.red.bold('  ✗ qmd is not installed or not found in PATH'));
  console.error();
  console.error(chalk.white('  qmd-bridge requires the qmd CLI to function.'));
  console.error(chalk.white('  Install it with:'));
  console.error();
  console.error(chalk.cyan(`    ${QMD_INSTALL_CMD}`));
  console.error();
  console.error(chalk.dim(`  For more info: ${QMD_REPO_URL}`));
  console.error();
}

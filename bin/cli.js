#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, createReadStream, watchFile, statSync } from 'node:fs';
import { VERSION, LOG_DIR, PID_FILE } from '../src/constants.js';
import { getConfig, getServerConfig } from '../src/utils/config.js';
import { checkQmdInstalled, printQmdNotFoundWarning } from '../src/utils/qmd-check.js';
import {
  listTenants,
  addTenant,
  removeTenant,
  editTenant,
  getTenant,
  rotateTenantToken,
} from '../src/services/tenant.js';
import { startDaemon, stopDaemon, getDaemonStatus } from '../src/services/daemon.js';
import { join } from 'node:path';

const program = new Command();

// Commands that do not require qmd to be installed
const QMD_FREE_COMMANDS = new Set(['config', 'logs', 'help']);

program
  .name('qmd-bridge')
  .description('A lightweight HTTP proxy for bridging Docker containers to host qmd with GPU acceleration.')
  .version(VERSION)
  .hook('preAction', (thisCommand) => {
    const commandName = thisCommand.args?.[0] || thisCommand.name();
    if (QMD_FREE_COMMANDS.has(commandName)) return;

    const { installed } = checkQmdInstalled();
    if (!installed) {
      printQmdNotFoundWarning();
      process.exit(1);
    }
  });

// ─── start ───────────────────────────────────────────────────────────
program
  .command('start')
  .description('Start the qmd-bridge server as a background daemon')
  .option('-p, --port <number>', 'Port to listen on', parseInt)
  .option('-h, --host <address>', 'Host to bind to')
  .option('--max-concurrent <number>', 'Max concurrent qmd executions (0 = unlimited)', parseInt)
  .action((options) => {
    const spinner = ora('Starting qmd-bridge server...').start();

    if (options.host === '0.0.0.0') {
      spinner.warn(chalk.yellow('⚠ Binding to 0.0.0.0 exposes the server to all network interfaces!'));
      spinner.start('Starting qmd-bridge server...');
    }

    const result = startDaemon(options);

    if (result.success) {
      spinner.succeed(
        chalk.green(`qmd-bridge server started (PID: ${result.pid})`)
      );
      const config = getServerConfig();
      console.log(chalk.dim(`  Listening on http://${config.host}:${config.port}`));
    } else {
      spinner.fail(chalk.red(result.error));
      process.exit(1);
    }
  });

// ─── stop ────────────────────────────────────────────────────────────
program
  .command('stop')
  .description('Stop the running qmd-bridge server')
  .action(() => {
    const spinner = ora('Stopping qmd-bridge server...').start();
    const result = stopDaemon();

    if (result.success) {
      spinner.succeed(chalk.green('qmd-bridge server stopped.'));
    } else {
      spinner.fail(chalk.red(result.error));
      process.exit(1);
    }
  });

// ─── restart ─────────────────────────────────────────────────────────
program
  .command('restart')
  .description('Restart the qmd-bridge server (stop + start)')
  .action(() => {
    const spinner = ora('Restarting qmd-bridge server...').start();

    // Stop first (ignore errors if not running)
    stopDaemon();

    // Brief delay to allow cleanup
    setTimeout(() => {
      const result = startDaemon();
      if (result.success) {
        spinner.succeed(chalk.green(`qmd-bridge server restarted (PID: ${result.pid})`));
        const config = getServerConfig();
        console.log(chalk.dim(`  Listening on http://${config.host}:${config.port}`));
      } else {
        spinner.fail(chalk.red(result.error));
        process.exit(1);
      }
    }, 500);
  });

// ─── status ──────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show the current server status')
  .action(() => {
    const status = getDaemonStatus();
    const config = getServerConfig();

    if (status.running) {
      console.log(chalk.green.bold('● qmd-bridge is running'));
      console.log(`  PID:  ${chalk.cyan(status.pid)}`);
      console.log(`  URL:  ${chalk.cyan(`http://${config.host}:${config.port}`)}`);
    } else {
      console.log(chalk.red.bold('● qmd-bridge is not running'));
    }
  });

// ─── list ────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all tenants')
  .action(() => {
    const tenants = listTenants();
    const entries = Object.values(tenants);

    if (entries.length === 0) {
      console.log(chalk.dim('No tenants configured. Use `qmd-bridge add` to add one.'));
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan('Label'),
        chalk.cyan('Display Name'),
        chalk.cyan('Collection'),
        chalk.cyan('Path'),
        chalk.cyan('Created'),
      ],
      style: { head: [], border: [] },
    });

    for (const t of entries) {
      table.push([
        t.label,
        t.displayName,
        t.collection || t.label,
        t.path,
        new Date(t.createdAt).toLocaleDateString(),
      ]);
    }

    console.log(table.toString());
  });

// ─── add ─────────────────────────────────────────────────────────────
program
  .command('add')
  .description('Interactively add a new tenant')
  .action(async () => {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'label',
        message: 'Tenant label (unique identifier):',
        validate: (val) => (val.trim() ? true : 'Label is required.'),
      },
      {
        type: 'input',
        name: 'displayName',
        message: 'Display name:',
        validate: (val) => (val.trim() ? true : 'Display name is required.'),
      },
      {
        type: 'input',
        name: 'path',
        message: 'Host absolute path to project directory:',
        validate: (val) => (val.trim() ? true : 'Path is required.'),
      },
      {
        type: 'input',
        name: 'collection',
        message: 'qmd collection name (used for search isolation):',
        default: (prev) => prev.label,
      },
      {
        type: 'confirm',
        name: 'autoIndex',
        message: 'Run `qmd collection add` to build index now?',
        default: true,
      },
    ]);

    const label = answers.label.trim();
    const collectionName = answers.collection.trim();
    const path = answers.path.trim();

    const result = addTenant({
      label,
      displayName: answers.displayName.trim(),
      path,
      collection: collectionName,
    });

    if (!result.success) {
      console.log(chalk.red(`✗ ${result.error}`));
      process.exit(1);
    }

    console.log(chalk.green(`✓ Tenant "${label}" added successfully.`));
    console.log(`  Token:      ${chalk.yellow(result.token)}`);
    console.log(`  Collection: ${chalk.cyan(collectionName)}`);
    console.log(chalk.dim('  Save this token — you will need it to authenticate requests.'));

    // Auto-index: run `qmd collection add <path> --name <collection>`
    if (answers.autoIndex) {
      const spinner = ora(`Running \`qmd collection add ${path} --name ${collectionName}\`...`).start();
      const qmdPath = getConfig().get('qmdPath') || 'qmd';

      execFile(qmdPath, ['collection', 'add', path, '--name', collectionName], { timeout: 120_000 }, (err, stdout) => {
        if (err) {
          spinner.warn(chalk.yellow(`Index build failed: ${err.message}. You can run it manually later.`));
        } else {
          spinner.succeed(chalk.green('Collection indexed successfully.'));
          if (stdout.trim()) console.log(chalk.dim(stdout.trim()));
        }
      });
    }
  });

// ─── rm ──────────────────────────────────────────────────────────────
program
  .command('rm <label>')
  .description('Remove a tenant')
  .action(async (label) => {
    const tenant = getTenant(label);
    if (!tenant) {
      console.log(chalk.red(`✗ Tenant "${label}" not found.`));
      process.exit(1);
    }

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Remove tenant "${label}" (${tenant.displayName})? This cannot be undone.`,
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.dim('Cancelled.'));
      return;
    }

    const result = removeTenant(label);
    if (result.success) {
      console.log(chalk.green(`✓ Tenant "${label}" removed.`));
    } else {
      console.log(chalk.red(`✗ ${result.error}`));
      process.exit(1);
    }
  });

// ─── edit ────────────────────────────────────────────────────────────
program
  .command('edit <label>')
  .description('Interactively edit a tenant')
  .action(async (label) => {
    const tenant = getTenant(label);
    if (!tenant) {
      console.log(chalk.red(`✗ Tenant "${label}" not found.`));
      process.exit(1);
    }

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'label',
        message: 'Label:',
        default: tenant.label,
      },
      {
        type: 'input',
        name: 'displayName',
        message: 'Display name:',
        default: tenant.displayName,
      },
      {
        type: 'input',
        name: 'path',
        message: 'Path:',
        default: tenant.path,
      },
      {
        type: 'input',
        name: 'collection',
        message: 'Collection:',
        default: tenant.collection || tenant.label,
      },
    ]);

    const updates = {};
    if (answers.label.trim() !== tenant.label) updates.label = answers.label.trim();
    if (answers.displayName.trim() !== tenant.displayName) updates.displayName = answers.displayName.trim();
    if (answers.path.trim() !== tenant.path) updates.path = answers.path.trim();
    if (answers.collection.trim() !== (tenant.collection || tenant.label)) updates.collection = answers.collection.trim();

    if (Object.keys(updates).length === 0) {
      console.log(chalk.dim('No changes made.'));
      return;
    }

    const result = editTenant(label, updates);
    if (result.success) {
      console.log(chalk.green(`✓ Tenant "${updates.label || label}" updated.`));
    } else {
      console.log(chalk.red(`✗ ${result.error}`));
      process.exit(1);
    }
  });

// ─── token ───────────────────────────────────────────────────────────
const tokenCmd = program
  .command('token')
  .description('Token management');

tokenCmd
  .command('show <label>')
  .description('Show the token for a tenant')
  .action((label) => {
    const tenant = getTenant(label);
    if (!tenant) {
      console.log(chalk.red(`✗ Tenant "${label}" not found.`));
      process.exit(1);
    }
    console.log(tenant.token);
  });

tokenCmd
  .command('rotate <label>')
  .description('Rotate (regenerate) the token for a tenant')
  .action(async (label) => {
    const tenant = getTenant(label);
    if (!tenant) {
      console.log(chalk.red(`✗ Tenant "${label}" not found.`));
      process.exit(1);
    }

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Rotate token for "${label}"? The old token will be immediately invalidated.`,
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.dim('Cancelled.'));
      return;
    }

    const result = rotateTenantToken(label);
    if (result.success) {
      console.log(chalk.green('✓ Token rotated.'));
      console.log(`  New token: ${chalk.yellow(result.token)}`);
    } else {
      console.log(chalk.red(`✗ ${result.error}`));
      process.exit(1);
    }
  });

// ─── logs ────────────────────────────────────────────────────────────
program
  .command('logs')
  .description('View server logs')
  .option('-f, --follow', 'Follow log output in real-time')
  .action((options) => {
    const date = new Date().toISOString().split('T')[0];
    const logFile = join(LOG_DIR, `qmd-bridge-${date}.log`);

    if (!existsSync(logFile)) {
      console.log(chalk.dim('No log file found for today. Is the server running?'));
      return;
    }

    if (options.follow) {
      // Print existing content
      const content = readFileSync(logFile, 'utf-8');
      if (content) process.stdout.write(content);

      // Watch for changes
      let lastSize = statSync(logFile).size;
      console.log(chalk.dim('--- Following logs (Ctrl+C to exit) ---'));

      watchFile(logFile, { interval: 300 }, () => {
        const currentSize = statSync(logFile).size;
        if (currentSize > lastSize) {
          const stream = createReadStream(logFile, { start: lastSize, end: currentSize - 1 });
          stream.pipe(process.stdout);
          lastSize = currentSize;
        }
      });
    } else {
      // Just print the file
      const content = readFileSync(logFile, 'utf-8');
      if (content) {
        process.stdout.write(content);
      } else {
        console.log(chalk.dim('Log file is empty.'));
      }
    }
  });

// ─── config ──────────────────────────────────────────────────────────
program
  .command('config')
  .description('Show configuration file path and current settings')
  .action(() => {
    const config = getConfig();
    console.log(chalk.bold('Config file:'), chalk.cyan(config.path));
    console.log();

    const serverConfig = getServerConfig();
    const table = new Table({
      style: { head: [], border: [] },
    });

    table.push(
      { [chalk.cyan('Port')]: serverConfig.port },
      { [chalk.cyan('Host')]: serverConfig.host },
      { [chalk.cyan('Execution Timeout')]: `${serverConfig.executionTimeout}ms` },
      { [chalk.cyan('Max Concurrent')]: serverConfig.maxConcurrent === 0 ? 'Unlimited' : serverConfig.maxConcurrent },
      { [chalk.cyan('qmd Path')]: config.get('qmdPath') || '(system $PATH)' },
    );

    console.log(table.toString());
  });

program.parse();

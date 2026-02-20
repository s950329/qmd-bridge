import { execFile } from 'node:child_process';
import chokidar from 'chokidar';
import { getQmdPath, getIndexingConfig } from '../utils/config.js';
import { MAX_INDEX_TIMEOUT } from '../constants.js';

export class IndexingManager {
  constructor(logger) {
    this._logger = logger;
    this._watchers = new Map();  // label → chokidar.FSWatcher
    this._intervals = new Map(); // label → intervalId
    this._inProgress = new Set(); // labels currently being indexed
  }

  /**
   * Start background indexing for all tenants based on the configured strategy.
   * @param {object} tenants - All tenants keyed by label
   */
  start(tenants) {
    const { strategy } = getIndexingConfig();
    if (strategy === 'manual') return;

    const tenantList = Object.values(tenants);
    for (const tenant of tenantList) {
      this._setupTenant(tenant, strategy);
    }

    this._logger.info(
      { strategy, tenantCount: tenantList.length },
      'IndexingManager started',
    );
  }

  /**
   * Stop all background indexing tasks.
   */
  stop() {
    for (const watcher of this._watchers.values()) {
      watcher.close();
    }
    for (const id of this._intervals.values()) {
      clearInterval(id);
    }
    this._watchers.clear();
    this._intervals.clear();
    this._logger.info('IndexingManager stopped');
  }

  /**
   * Check whether a tenant's collection is currently being indexed.
   * @param {string} label - Tenant label
   * @returns {boolean}
   */
  isInProgress(label) {
    return this._inProgress.has(label);
  }

  /**
   * Manually trigger indexing for a tenant (used by POST /index).
   * @param {object} tenant
   */
  triggerIndex(tenant) {
    this._runIndex(tenant);
  }

  _setupTenant(tenant, strategy) {
    if (strategy === 'periodic') {
      this._startPeriodic(tenant);
    } else if (strategy === 'watch') {
      this._startWatch(tenant);
    }
  }

  _startPeriodic(tenant) {
    const { periodicInterval } = getIndexingConfig();
    const id = setInterval(() => this._runIndex(tenant), periodicInterval * 1000);
    this._intervals.set(tenant.label, id);
    this._logger.info(
      { label: tenant.label, intervalSecs: periodicInterval },
      'Periodic indexing scheduled',
    );
  }

  _startWatch(tenant) {
    const { watchDebounce } = getIndexingConfig();
    const watcher = chokidar.watch(tenant.path, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: watchDebounce * 1000, pollInterval: 200 },
    });

    watcher.on('all', () => this._runIndex(tenant));
    watcher.on('error', (err) => {
      this._logger.warn({ label: tenant.label, err: err.message }, 'Watch error');
    });

    this._watchers.set(tenant.label, watcher);
    this._logger.info(
      { label: tenant.label, path: tenant.path, debounceSecs: watchDebounce },
      'File watching started',
    );
  }

  /**
   * Run the full index pipeline for a tenant:
   * 1. Check if collection exists (qmd collection list)
   * 2. Create collection if missing (qmd collection add)
   * 3. Run embed (qmd embed -c <collection>)
   */
  async _runIndex(tenant) {
    if (this._inProgress.has(tenant.label)) {
      this._logger.info({ label: tenant.label }, 'Index already in progress, skipping');
      return;
    }

    this._inProgress.add(tenant.label);
    const qmdPath = getQmdPath();
    const startTime = Date.now();

    try {
      this._logger.info(
        { label: tenant.label, collection: tenant.collection },
        'Starting index',
      );

      // Step 1: Check if collection exists
      const collectionExists = await this._collectionExists(qmdPath, tenant.collection);

      // Step 2: Create collection if missing
      if (!collectionExists) {
        this._logger.info(
          { label: tenant.label, collection: tenant.collection },
          'Collection not found, creating...',
        );
        await this._execQmd(qmdPath, ['collection', 'add', tenant.path, '--name', tenant.collection]);
      }

      // Step 3: Run embed
      await this._execQmd(qmdPath, ['embed', '-c', tenant.collection]);

      const elapsed = Date.now() - startTime;
      this._logger.info({ label: tenant.label, elapsed }, 'Index completed');
    } catch (err) {
      const elapsed = Date.now() - startTime;
      this._logger.error({ label: tenant.label, err: err.message, elapsed }, 'Index failed');
    } finally {
      this._inProgress.delete(tenant.label);
    }
  }

  _collectionExists(qmdPath, collectionName) {
    return new Promise((resolve) => {
      execFile(qmdPath, ['collection', 'list'], { timeout: 10_000 }, (err, stdout) => {
        if (err) {
          resolve(false);
          return;
        }
        resolve(stdout.includes(collectionName));
      });
    });
  }

  _execQmd(qmdPath, args) {
    return new Promise((resolve, reject) => {
      execFile(qmdPath, args, { timeout: MAX_INDEX_TIMEOUT }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
  }
}

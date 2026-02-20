import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (must be hoisted before imports) ────────────────────────────

vi.mock('../../src/utils/config.js', () => ({
  getQmdPath: vi.fn(() => 'qmd'),
  getIndexingConfig: vi.fn(() => ({
    strategy: 'manual',
    periodicInterval: 60,
    watchDebounce: 2,
  })),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockWatcherInstance = {
  on: vi.fn().mockReturnThis(),
  close: vi.fn(),
};
vi.mock('chokidar', () => ({
  default: { watch: vi.fn(() => mockWatcherInstance) },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────

import { IndexingManager } from '../../src/services/indexing.js';
import { execFile } from 'node:child_process';
import { getIndexingConfig } from '../../src/utils/config.js';
import chokidar from 'chokidar';

// ── Fixtures ──────────────────────────────────────────────────────────

const TENANT = {
  label: 'my-docs',
  displayName: 'My Docs',
  path: '/data/my-docs',
  collection: 'my-docs',
  token: 'qmd_sk_test',
  createdAt: '2026-01-01T00:00:00Z',
};

const SILENT_LOGGER = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Mock execFile to return success for a specific qmd subcommand.
 * Calls that don't match fall through to a default success response.
 */
function mockExecFileSuccess({ collectionListOutput = '' } = {}) {
  execFile.mockImplementation((cmd, args, opts, cb) => {
    if (args[0] === 'collection' && args[1] === 'list') {
      cb(null, collectionListOutput, '');
    } else {
      cb(null, '', '');
    }
  });
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('IndexingManager', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWatcherInstance.on.mockReturnThis();
    manager = new IndexingManager(SILENT_LOGGER);
  });

  afterEach(() => {
    manager.stop();
  });

  // ─── isInProgress ──────────────────────────────────────────────────

  describe('isInProgress()', () => {
    it('returns false when no indexing is running', () => {
      expect(manager.isInProgress(TENANT.label)).toBe(false);
    });

    it('returns true while _runIndex is executing', async () => {
      let resolveLater;
      execFile.mockImplementation((cmd, args, opts, cb) => {
        if (args[0] === 'collection' && args[1] === 'list') {
          cb(null, TENANT.collection, '');
        } else {
          // embed hangs until we resolve
          resolveLater = () => cb(null, '', '');
        }
      });

      const indexPromise = manager._runIndex(TENANT);
      await new Promise((r) => setTimeout(r, 20)); // let execution start

      expect(manager.isInProgress(TENANT.label)).toBe(true);

      resolveLater();
      await indexPromise;

      expect(manager.isInProgress(TENANT.label)).toBe(false);
    });
  });

  // ─── _runIndex pipeline ────────────────────────────────────────────

  describe('_runIndex()', () => {
    it('runs embed directly when collection already exists', async () => {
      mockExecFileSuccess({ collectionListOutput: `my-docs\nother-col` });

      await manager._runIndex(TENANT);

      const calls = execFile.mock.calls.map((c) => c[1]);
      expect(calls).toContainEqual(['collection', 'list']);
      expect(calls).toContainEqual(['embed', '-c', 'my-docs']);
      // Should NOT call collection add
      expect(calls.some((a) => a[0] === 'collection' && a[1] === 'add')).toBe(false);
    });

    it('creates collection then runs embed when collection is missing', async () => {
      mockExecFileSuccess({ collectionListOutput: 'other-col' });

      await manager._runIndex(TENANT);

      const calls = execFile.mock.calls.map((c) => c[1]);
      expect(calls).toContainEqual(['collection', 'list']);
      expect(calls).toContainEqual(['collection', 'add', TENANT.path, '--name', TENANT.collection]);
      expect(calls).toContainEqual(['embed', '-c', TENANT.collection]);
    });

    it('creates collection when collection list returns empty', async () => {
      mockExecFileSuccess({ collectionListOutput: '' });

      await manager._runIndex(TENANT);

      const calls = execFile.mock.calls.map((c) => c[1]);
      expect(calls.some((a) => a[0] === 'collection' && a[1] === 'add')).toBe(true);
    });

    it('skips when already in progress (prevents duplicate runs)', async () => {
      let resolveFirst;
      execFile.mockImplementation((cmd, args, opts, cb) => {
        if (args[0] === 'collection' && args[1] === 'list') {
          cb(null, TENANT.collection, '');
        } else {
          resolveFirst = () => cb(null, '', '');
        }
      });

      const first = manager._runIndex(TENANT);
      await new Promise((r) => setTimeout(r, 20));

      // Second call while first is running
      await manager._runIndex(TENANT);

      // Only one set of execFile calls (one embed, not two)
      const embedCalls = execFile.mock.calls.filter((c) => c[1][0] === 'embed');
      expect(embedCalls).toHaveLength(1);

      resolveFirst();
      await first;
    });

    it('clears inProgress flag even when embed fails', async () => {
      execFile.mockImplementation((cmd, args, opts, cb) => {
        if (args[0] === 'collection' && args[1] === 'list') {
          cb(null, TENANT.collection, '');
        } else {
          cb(new Error('embed failed'), '', '');
        }
      });

      await manager._runIndex(TENANT);

      expect(manager.isInProgress(TENANT.label)).toBe(false);
    });

    it('logs error but does not throw when embed fails', async () => {
      execFile.mockImplementation((cmd, args, opts, cb) => {
        if (args[0] === 'collection' && args[1] === 'list') {
          cb(null, TENANT.collection, '');
        } else {
          cb(new Error('embed failed'), '', '');
        }
      });

      await expect(manager._runIndex(TENANT)).resolves.not.toThrow();
      expect(SILENT_LOGGER.error).toHaveBeenCalled();
    });
  });

  // ─── triggerIndex ──────────────────────────────────────────────────

  describe('triggerIndex()', () => {
    it('delegates to _runIndex', async () => {
      const spy = vi.spyOn(manager, '_runIndex').mockResolvedValue();
      manager.triggerIndex(TENANT);
      expect(spy).toHaveBeenCalledWith(TENANT);
    });
  });

  // ─── start() strategy: manual ─────────────────────────────────────

  describe('start() with manual strategy', () => {
    it('does not set up any intervals or watchers', () => {
      getIndexingConfig.mockReturnValue({ strategy: 'manual', periodicInterval: 60, watchDebounce: 2 });

      manager.start({ [TENANT.label]: TENANT });

      expect(chokidar.watch).not.toHaveBeenCalled();
    });
  });

  // ─── start() strategy: periodic ───────────────────────────────────

  describe('start() with periodic strategy', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      getIndexingConfig.mockReturnValue({ strategy: 'periodic', periodicInterval: 10, watchDebounce: 2 });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sets up an interval per tenant', () => {
      manager.start({ [TENANT.label]: TENANT });
      expect(manager._intervals.has(TENANT.label)).toBe(true);
    });

    it('triggers _runIndex after the interval elapses', async () => {
      mockExecFileSuccess({ collectionListOutput: TENANT.collection });

      manager.start({ [TENANT.label]: TENANT });

      // Advance exactly one interval period and let async tasks settle
      await vi.advanceTimersByTimeAsync(10_000);

      const embedCalls = execFile.mock.calls.filter((c) => c[1][0] === 'embed');
      expect(embedCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('stop() clears the interval', () => {
      manager.start({ [TENANT.label]: TENANT });
      expect(manager._intervals.size).toBe(1);

      manager.stop();
      expect(manager._intervals.size).toBe(0);
    });
  });

  // ─── start() strategy: watch ───────────────────────────────────────

  describe('start() with watch strategy', () => {
    beforeEach(() => {
      getIndexingConfig.mockReturnValue({ strategy: 'watch', periodicInterval: 3600, watchDebounce: 2 });
    });

    it('calls chokidar.watch with the tenant path', () => {
      manager.start({ [TENANT.label]: TENANT });

      expect(chokidar.watch).toHaveBeenCalledWith(
        TENANT.path,
        expect.objectContaining({ ignoreInitial: true }),
      );
    });

    it('registers an "all" event listener on the watcher', () => {
      manager.start({ [TENANT.label]: TENANT });

      expect(mockWatcherInstance.on).toHaveBeenCalledWith('all', expect.any(Function));
    });

    it('registers an "error" event listener on the watcher', () => {
      manager.start({ [TENANT.label]: TENANT });

      expect(mockWatcherInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('stop() closes all watchers', () => {
      manager.start({ [TENANT.label]: TENANT });
      expect(manager._watchers.size).toBe(1);

      manager.stop();
      expect(mockWatcherInstance.close).toHaveBeenCalled();
      expect(manager._watchers.size).toBe(0);
    });
  });
});

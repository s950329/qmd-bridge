import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config module
vi.mock('../../src/utils/config.js', () => ({
  getServerConfig: vi.fn(() => ({
    executionTimeout: 30_000,
    maxConcurrent: 0,
  })),
  getQmdPath: vi.fn(() => 'qmd'),
}));

// Mock child_process.execFile
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { executeQmd, getActiveCount } from '../../src/services/executor.js';
import { execFile } from 'node:child_process';
import { getServerConfig } from '../../src/utils/config.js';

describe('executor service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset active count by ensuring any mock state is clean
    getServerConfig.mockReturnValue({
      executionTimeout: 30_000,
      maxConcurrent: 0,
    });
  });

  describe('executeQmd', () => {
    it('should execute qmd successfully and return stdout + executionTime', async () => {
      const mockStdout = 'search result data';
      execFile.mockImplementation((cmd, args, opts, callback) => {
        callback(null, mockStdout, '');
      });

      const result = await executeQmd({
        command: 'search',
        query: 'test query',
        collection: 'my-collection',
      });

      expect(result.stdout).toBe(mockStdout);
      expect(typeof result.executionTime).toBe('number');
      expect(result.executionTime).toBeGreaterThanOrEqual(0);

      // Verify execFile was called with correct arguments
      expect(execFile).toHaveBeenCalledWith(
        'qmd',
        ['search', 'test query', '-c', 'my-collection'],
        expect.objectContaining({
          timeout: 30_000,
          maxBuffer: 10 * 1024 * 1024,
        }),
        expect.any(Function),
      );
    });

    it('should pass collection via -c flag for tenant isolation', async () => {
      execFile.mockImplementation((cmd, args, opts, callback) => {
        callback(null, '', '');
      });

      await executeQmd({
        command: 'vsearch',
        query: 'semantic query',
        collection: 'project-alpha',
      });

      const calledArgs = execFile.mock.calls[0][1];
      expect(calledArgs).toEqual(['vsearch', 'semantic query', '-c', 'project-alpha']);
    });

    it('should throw INVALID_COMMAND for commands not in whitelist', async () => {
      await expect(
        executeQmd({
          command: 'delete',
          query: 'test',
          collection: 'test-col',
        }),
      ).rejects.toThrow();

      try {
        await executeQmd({ command: 'delete', query: 'test', collection: 'col' });
      } catch (err) {
        expect(err.code).toBe('INVALID_COMMAND');
      }
    });

    it('should throw EXECUTION_TIMEOUT when process is killed', async () => {
      execFile.mockImplementation((cmd, args, opts, callback) => {
        const error = new Error('timed out');
        error.killed = true;
        callback(error, '', '');
      });

      await expect(
        executeQmd({ command: 'search', query: 'test', collection: 'col' }),
      ).rejects.toMatchObject({ code: 'EXECUTION_TIMEOUT' });
    });

    it('should throw EXECUTION_TIMEOUT when SIGTERM is received', async () => {
      execFile.mockImplementation((cmd, args, opts, callback) => {
        const error = new Error('sigterm');
        error.signal = 'SIGTERM';
        callback(error, '', '');
      });

      await expect(
        executeQmd({ command: 'search', query: 'test', collection: 'col' }),
      ).rejects.toMatchObject({ code: 'EXECUTION_TIMEOUT' });
    });

    it('should throw EXECUTION_FAILED on generic error', async () => {
      execFile.mockImplementation((cmd, args, opts, callback) => {
        callback(new Error('some error'), '', '');
      });

      await expect(
        executeQmd({ command: 'search', query: 'test', collection: 'col' }),
      ).rejects.toMatchObject({ code: 'EXECUTION_FAILED' });
    });

    it('should throw TOO_MANY_REQUESTS when concurrency limit reached', async () => {
      getServerConfig.mockReturnValue({
        executionTimeout: 30_000,
        maxConcurrent: 1,
      });

      // First call: hang indefinitely
      execFile.mockImplementation(() => {
        // Never call callback — simulates a long-running process
      });

      // Start first execution (will hang)
      const promise1 = executeQmd({ command: 'search', query: 'q1', collection: 'col' });

      // Wait a tick
      await new Promise((r) => setTimeout(r, 10));

      // Second call should be rejected
      await expect(
        executeQmd({ command: 'search', query: 'q2', collection: 'col' }),
      ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });

      // Clean up: resolve the first promise by calling its callback
      const firstCallback = execFile.mock.calls[0][3];
      firstCallback(null, 'done', '');
      await promise1;
    });

    it('should log execution when logger is provided', async () => {
      execFile.mockImplementation((cmd, args, opts, callback) => {
        callback(null, 'result', '');
      });

      const mockLogger = { info: vi.fn(), error: vi.fn() };
      await executeQmd({
        command: 'search',
        query: 'test',
        collection: 'col',
        logger: mockLogger,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'search', collection: 'col' }),
        'qmd execution completed',
      );
    });
  });

  describe('getActiveCount', () => {
    it('should return 0 when no executions are running', () => {
      expect(getActiveCount()).toBe(0);
    });
  });
});

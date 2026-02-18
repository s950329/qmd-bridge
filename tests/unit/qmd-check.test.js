import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config module
vi.mock('../../src/utils/config.js', () => ({
  getQmdPath: vi.fn(() => 'qmd'),
}));

// Mock child_process.execFileSync
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

// Mock chalk to simplify output assertions
vi.mock('chalk', () => {
  const identity = (str) => str;
  const handler = {
    get(target, prop) {
      if (prop === 'default') return target;
      // Return a callable proxy that also supports chaining
      const fn = (...args) => args.join('');
      return new Proxy(fn, {
        get(_, nestedProp) {
          if (nestedProp === 'bold') return fn;
          return fn;
        },
        apply(_, __, args) {
          return args.join('');
        },
      });
    },
  };
  return { default: new Proxy(identity, handler) };
});

import { checkQmdInstalled, printQmdNotFoundWarning } from '../../src/utils/qmd-check.js';
import { execFileSync } from 'node:child_process';
import { getQmdPath } from '../../src/utils/config.js';

describe('qmd-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQmdPath.mockReturnValue('qmd');
  });

  describe('checkQmdInstalled', () => {
    it('should return installed: true with version when qmd is found', () => {
      execFileSync.mockReturnValue('1.2.3\n');

      const result = checkQmdInstalled();

      expect(result).toEqual({ installed: true, version: '1.2.3' });
      expect(execFileSync).toHaveBeenCalledWith(
        'qmd',
        ['--version'],
        expect.objectContaining({
          timeout: 5_000,
          encoding: 'utf-8',
        }),
      );
    });

    it('should return installed: false when qmd is not found', () => {
      execFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = checkQmdInstalled();

      expect(result).toEqual({ installed: false });
    });

    it('should use custom qmd path from config', () => {
      getQmdPath.mockReturnValue('/opt/homebrew/bin/qmd');
      execFileSync.mockReturnValue('2.0.0\n');

      const result = checkQmdInstalled();

      expect(result).toEqual({ installed: true, version: '2.0.0' });
      expect(execFileSync).toHaveBeenCalledWith(
        '/opt/homebrew/bin/qmd',
        ['--version'],
        expect.any(Object),
      );
    });

    it('should return installed: false when execFileSync times out', () => {
      execFileSync.mockImplementation(() => {
        const err = new Error('timed out');
        err.killed = true;
        throw err;
      });

      const result = checkQmdInstalled();

      expect(result).toEqual({ installed: false });
    });
  });

  describe('printQmdNotFoundWarning', () => {
    it('should print warning with install instructions to stderr', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      printQmdNotFoundWarning();

      const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('npm install -g @tobilu/qmd');
      expect(output).toContain('https://github.com/tobi/qmd');

      errorSpy.mockRestore();
    });
  });
});

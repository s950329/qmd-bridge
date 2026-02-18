import { describe, it, expect } from 'vitest';
import {
  ALLOWED_COMMANDS,
  DEFAULT_PORT,
  DEFAULT_HOST,
  DEFAULT_EXECUTION_TIMEOUT,
  DEFAULT_MAX_CONCURRENT,
  MAX_QUERY_LENGTH,
  MAX_BUFFER,
  GRACEFUL_SHUTDOWN_TIMEOUT,
  TOKEN_PREFIX,
  DANGEROUS_PATHS,
  VERSION,
} from '../../src/constants.js';
import { homedir } from 'node:os';

describe('constants', () => {
  describe('ALLOWED_COMMANDS', () => {
    it('should contain exactly search, vsearch, query', () => {
      expect(ALLOWED_COMMANDS).toEqual(['search', 'vsearch', 'query']);
    });

    it('should not contain dangerous commands', () => {
      const dangerous = ['exec', 'rm', 'delete', 'eval', 'shell'];
      for (const cmd of dangerous) {
        expect(ALLOWED_COMMANDS).not.toContain(cmd);
      }
    });
  });

  describe('DANGEROUS_PATHS', () => {
    it('should include root directory', () => {
      expect(DANGEROUS_PATHS).toContain('/');
    });

    it('should include home directory', () => {
      expect(DANGEROUS_PATHS).toContain(homedir());
    });
  });

  describe('defaults', () => {
    it('should have correct default port', () => {
      expect(DEFAULT_PORT).toBe(3333);
    });

    it('should have correct default host', () => {
      expect(DEFAULT_HOST).toBe('127.0.0.1');
    });

    it('should have 30s execution timeout', () => {
      expect(DEFAULT_EXECUTION_TIMEOUT).toBe(30_000);
    });

    it('should have unlimited concurrency by default', () => {
      expect(DEFAULT_MAX_CONCURRENT).toBe(0);
    });

    it('should have 1000 char query limit', () => {
      expect(MAX_QUERY_LENGTH).toBe(1000);
    });

    it('should have 10MB buffer limit', () => {
      expect(MAX_BUFFER).toBe(10 * 1024 * 1024);
    });

    it('should have 10s graceful shutdown timeout', () => {
      expect(GRACEFUL_SHUTDOWN_TIMEOUT).toBe(10_000);
    });
  });

  describe('TOKEN_PREFIX', () => {
    it('should be qmd_sk_', () => {
      expect(TOKEN_PREFIX).toBe('qmd_sk_');
    });
  });

  describe('VERSION', () => {
    it('should be a semver string', () => {
      expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
});

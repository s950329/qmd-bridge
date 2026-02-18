import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Mock the config module before importing tenant service
const _store = { tenants: {} };

vi.mock('../../src/utils/config.js', () => {
  return {
    getConfig: vi.fn(() => ({
      path: '/tmp/mock-config.json',
    })),
    getTenants: vi.fn(() => _store.tenants),
    getTenant: vi.fn((label) => _store.tenants[label] || null),
    getTenantByToken: vi.fn((token) => {
      for (const tenant of Object.values(_store.tenants)) {
        if (tenant.token === token) return tenant;
      }
      return null;
    }),
    saveTenant: vi.fn((label, data) => {
      _store.tenants[label] = data;
    }),
    deleteTenant: vi.fn((label) => {
      delete _store.tenants[label];
    }),
    getServerConfig: vi.fn(() => ({})),
    getQmdPath: vi.fn(() => 'qmd'),
  };
});

// Mock chmodSync to avoid actual file system permission changes
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    chmodSync: vi.fn(),
  };
});

import {
  validateTenantPath,
  addTenant,
  removeTenant,
  editTenant,
  rotateTenantToken,
  listTenants,
} from '../../src/services/tenant.js';

function resetStore() {
  _store.tenants = {};
}

describe('tenant service', () => {
  let tempDir;

  beforeEach(() => {
    resetStore();
    // Create a real temp directory for path validation tests
    tempDir = mkdtempSync(join(tmpdir(), 'qmd-test-'));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  describe('validateTenantPath', () => {
    it('should reject relative paths', () => {
      const result = validateTenantPath('relative/path');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('absolute');
    });

    it('should reject root directory', () => {
      const result = validateTenantPath('/');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('root');
    });

    it('should reject home directory', () => {
      const result = validateTenantPath(homedir());
      expect(result.valid).toBe(false);
      expect(result.error).toContain('home');
    });

    it('should reject non-existent paths', () => {
      const result = validateTenantPath('/this/path/does/not/exist');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    it('should reject file paths (non-directory)', () => {
      const filePath = join(tempDir, 'testfile.txt');
      writeFileSync(filePath, 'test');
      const result = validateTenantPath(filePath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('directory');
    });

    it('should accept valid absolute directory paths', () => {
      const result = validateTenantPath(tempDir);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('addTenant', () => {
    it('should add a tenant with generated token', () => {
      const result = addTenant({
        label: 'project-a',
        displayName: 'Project A',
        path: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.token).toMatch(/^qmd_sk_[0-9a-f]{32}$/);
    });

    it('should use label as default collection name', () => {
      addTenant({
        label: 'my-project',
        displayName: 'My Project',
        path: tempDir,
      });

      expect(_store.tenants['my-project'].collection).toBe('my-project');
    });

    it('should use custom collection name when provided', () => {
      addTenant({
        label: 'my-project',
        displayName: 'My Project',
        path: tempDir,
        collection: 'custom-col',
      });

      expect(_store.tenants['my-project'].collection).toBe('custom-col');
    });

    it('should reject duplicate labels', () => {
      addTenant({ label: 'dup', displayName: 'First', path: tempDir });
      const result = addTenant({ label: 'dup', displayName: 'Second', path: tempDir });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should reject invalid paths', () => {
      const result = addTenant({
        label: 'bad-path',
        displayName: 'Bad Path',
        path: '/nonexistent/path',
      });

      expect(result.success).toBe(false);
    });

    it('should include createdAt timestamp', () => {
      addTenant({ label: 'ts-test', displayName: 'TS', path: tempDir });

      expect(_store.tenants['ts-test'].createdAt).toBeDefined();
      // Should be a valid ISO 8601 string
      expect(new Date(_store.tenants['ts-test'].createdAt).toISOString()).toBe(
        _store.tenants['ts-test'].createdAt,
      );
    });
  });

  describe('removeTenant', () => {
    it('should remove existing tenant', () => {
      addTenant({ label: 'to-remove', displayName: 'TBR', path: tempDir });
      const result = removeTenant('to-remove');
      expect(result.success).toBe(true);
    });

    it('should fail for non-existent tenant', () => {
      const result = removeTenant('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('editTenant', () => {
    beforeEach(() => {
      addTenant({ label: 'editable', displayName: 'Editable', path: tempDir });
    });

    it('should update displayName', () => {
      const result = editTenant('editable', { displayName: 'New Name' });
      expect(result.success).toBe(true);
    });

    it('should update label and re-key the tenant', () => {
      const result = editTenant('editable', { label: 'new-label' });
      expect(result.success).toBe(true);

      expect(_store.tenants['new-label']).toBeDefined();
      expect(_store.tenants['editable']).toBeUndefined();
    });

    it('should reject editing to an existing label', () => {
      addTenant({ label: 'other', displayName: 'Other', path: tempDir });
      const result = editTenant('editable', { label: 'other' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should fail for non-existent tenant', () => {
      const result = editTenant('ghost', { displayName: 'Ghost' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('rotateTenantToken', () => {
    it('should generate a new token', () => {
      const addResult = addTenant({ label: 'rotate-me', displayName: 'Rotate', path: tempDir });
      const oldToken = addResult.token;

      const result = rotateTenantToken('rotate-me');
      expect(result.success).toBe(true);
      expect(result.token).toMatch(/^qmd_sk_[0-9a-f]{32}$/);
      expect(result.token).not.toBe(oldToken);
    });

    it('should fail for non-existent tenant', () => {
      const result = rotateTenantToken('ghost');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('listTenants', () => {
    it('should return empty object when no tenants exist', () => {
      const tenants = listTenants();
      expect(Object.keys(tenants)).toHaveLength(0);
    });

    it('should return all added tenants', () => {
      addTenant({ label: 'a', displayName: 'A', path: tempDir });
      addTenant({ label: 'b', displayName: 'B', path: tempDir });

      const tenants = listTenants();
      expect(Object.keys(tenants)).toHaveLength(2);
      expect(tenants['a']).toBeDefined();
      expect(tenants['b']).toBeDefined();
    });
  });
});

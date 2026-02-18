import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/setup.js';

// Must mock config before the app loads health route
vi.mock('../../src/utils/config.js', () => ({
  getConfig: vi.fn(() => ({
    get: vi.fn((key) => {
      const defaults = {
        'server.port': 3333,
        'server.host': '127.0.0.1',
        'server.executionTimeout': 30000,
        'server.maxConcurrent': 0,
        qmdPath: '',
        tenants: {},
      };
      return defaults[key];
    }),
    path: '/tmp/mock-config.json',
  })),
  getServerConfig: vi.fn(() => ({
    port: 3333,
    host: '127.0.0.1',
    executionTimeout: 30000,
    maxConcurrent: 0,
  })),
  getTenants: vi.fn(() => ({})),
  getTenant: vi.fn(() => null),
  getTenantByToken: vi.fn(() => null),
  saveTenant: vi.fn(),
  deleteTenant: vi.fn(),
  getQmdPath: vi.fn(() => 'qmd'),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('GET /health', () => {
  const app = createTestApp();

  it('should return 200 with status ok', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('should include version string', async () => {
    const res = await request(app).get('/health');

    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should include uptime as a number', async () => {
    const res = await request(app).get('/health');

    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/setup.js';

// In-memory tenant store
let tenantStore = {};

vi.mock('../../src/utils/config.js', () => ({
  getConfig: vi.fn(() => ({
    get: vi.fn((key) => {
      if (key === 'tenants') return tenantStore;
      const defaults = {
        'server.port': 3333,
        'server.host': '127.0.0.1',
        'server.executionTimeout': 30000,
        'server.maxConcurrent': 0,
        qmdPath: '',
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
  getTenants: vi.fn(() => tenantStore),
  getTenant: vi.fn((label) => tenantStore[label] || null),
  getTenantByToken: vi.fn((token) => {
    for (const t of Object.values(tenantStore)) {
      if (t.token === token) return t;
    }
    return null;
  }),
  saveTenant: vi.fn((label, data) => {
    tenantStore[label] = data;
  }),
  deleteTenant: vi.fn((label) => {
    delete tenantStore[label];
  }),
  getQmdPath: vi.fn(() => 'qmd'),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { getServerConfig } from '../../src/utils/config.js';

const TENANT_A = {
  label: 'project-a',
  displayName: 'Project A',
  path: '/test/project-a',
  collection: 'project-a',
  token: 'qmd_sk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
  createdAt: '2026-01-01T00:00:00Z',
};

const TENANT_B = {
  label: 'project-b',
  displayName: 'Project B',
  path: '/test/project-b',
  collection: 'project-b',
  token: 'qmd_sk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('POST /qmd', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    tenantStore = {
      'project-a': { ...TENANT_A },
      'project-b': { ...TENANT_B },
    };
    getServerConfig.mockReturnValue({
      port: 3333,
      host: '127.0.0.1',
      executionTimeout: 30000,
      maxConcurrent: 0,
    });
    app = createTestApp();
  });

  // ─── Authentication ──────────────────────────────────────────

  it('should return 401 when no token is provided', async () => {
    const res = await request(app)
      .post('/qmd')
      .send({ command: 'search', query: 'test' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('should return 401 for invalid token', async () => {
    const res = await request(app)
      .post('/qmd')
      .set('Authorization', 'Bearer invalid_token')
      .send({ command: 'search', query: 'test' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  // ─── Input Validation ────────────────────────────────────────

  it('should return 400 INVALID_COMMAND for unknown commands', async () => {
    const res = await request(app)
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_A.token}`)
      .send({ command: 'delete', query: 'test' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_COMMAND');
  });

  it('should return 400 QUERY_TOO_LONG for oversized queries', async () => {
    const longQuery = 'a'.repeat(1001);
    const res = await request(app)
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_A.token}`)
      .send({ command: 'search', query: longQuery });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('QUERY_TOO_LONG');
  });

  it('should return 400 INVALID_REQUEST when command is missing', async () => {
    const res = await request(app)
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_A.token}`)
      .send({ query: 'test' });

    expect(res.status).toBe(400);
  });

  it('should return 400 INVALID_REQUEST when query is missing', async () => {
    const res = await request(app)
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_A.token}`)
      .send({ command: 'search' });

    expect(res.status).toBe(400);
  });

  it('should return 400 INVALID_REQUEST when body is empty', async () => {
    const res = await request(app)
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_A.token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  // ─── Successful Execution ────────────────────────────────────

  it('should return 200 with search results on success', async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      callback(null, 'search results here', '');
    });

    const res = await request(app)
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_A.token}`)
      .send({ command: 'search', query: 'authentication' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBe('search results here');
    expect(typeof res.body.executionTime).toBe('number');
  });

  it('should support all allowed commands: search, vsearch, query', async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      callback(null, `result for ${args[0]}`, '');
    });

    for (const command of ['search', 'vsearch', 'query']) {
      const res = await request(app)
        .post('/qmd')
        .set('Authorization', `Bearer ${TENANT_A.token}`)
        .send({ command, query: 'test' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }
  });

  // ─── Multi-Tenant Isolation ──────────────────────────────────

  it('should pass the correct collection for tenant A', async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      callback(null, 'result', '');
    });

    await request(app)
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_A.token}`)
      .send({ command: 'search', query: 'test' });

    const calledArgs = execFile.mock.calls[0][1];
    expect(calledArgs).toContain('-c');
    expect(calledArgs).toContain('project-a');
  });

  it('should pass the correct collection for tenant B', async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      callback(null, 'result', '');
    });

    await request(app)
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_B.token}`)
      .send({ command: 'search', query: 'test' });

    const calledArgs = execFile.mock.calls[0][1];
    expect(calledArgs).toContain('-c');
    expect(calledArgs).toContain('project-b');
  });

  it('should not allow tenant A token to access tenant B collection', async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      callback(null, 'result', '');
    });

    await request(app)
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_A.token}`)
      .send({ command: 'search', query: 'test' });

    const calledArgs = execFile.mock.calls[0][1];
    expect(calledArgs).not.toContain('project-b');
  });

  // ─── Execution Errors ────────────────────────────────────────

  it('should return 504 EXECUTION_TIMEOUT when qmd times out', async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      const err = new Error('timed out');
      err.killed = true;
      callback(err, '', '');
    });

    const res = await request(app)
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_A.token}`)
      .send({ command: 'search', query: 'test' });

    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('EXECUTION_TIMEOUT');
  });

  it('should return 500 EXECUTION_FAILED when qmd fails', async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      callback(new Error('qmd crashed'), '', '');
    });

    const res = await request(app)
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_A.token}`)
      .send({ command: 'search', query: 'test' });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('EXECUTION_FAILED');
  });

  it('should return 503 TOO_MANY_REQUESTS when concurrency limit reached', async () => {
    // Concurrency logic is thoroughly tested in the executor unit tests.
    // Here we verify the route maps the error code to 503 correctly
    // by forcing the executor to reject via a high activeCount.
    // We use a real server with two parallel requests.

    getServerConfig.mockReturnValue({
      port: 3333,
      host: '127.0.0.1',
      executionTimeout: 30000,
      maxConcurrent: 1,
    });

    // First execFile call: never resolve (hangs the first request)
    // Second execFile call: should never be called (rejected before reaching execFile)
    let resolveHanging;
    const hangingDone = new Promise((r) => { resolveHanging = r; });
    execFile.mockImplementation((cmd, args, opts, callback) => {
      hangingDone.then(() => callback(null, 'done', ''));
    });

    const server = app.listen(0);
    const port = server.address().port;
    const agent = request(`http://127.0.0.1:${port}`);

    // Fire first request (won't complete because execFile hangs)
    const firstPromise = agent
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_A.token}`)
      .send({ command: 'search', query: 'first' })
      .timeout({ response: 5000, deadline: 5000 })
      .catch(() => {}); // swallow timeout

    // Give it time to enter executeQmd and increment activeCount
    await new Promise((r) => setTimeout(r, 200));

    // Second request should be rejected immediately with 503
    const secondRes = await agent
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_A.token}`)
      .send({ command: 'search', query: 'second' });

    expect(secondRes.status).toBe(503);
    expect(secondRes.body.error.code).toBe('TOO_MANY_REQUESTS');

    // Release the hanging request and clean up
    resolveHanging();
    await firstPromise;
    server.close();
  });

  // ─── Security ────────────────────────────────────────────────

  it('should not leak host paths in error responses', async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      callback(new Error('ENOENT: /secret/host/path/qmd'), '', '');
    });

    const res = await request(app)
      .post('/qmd')
      .set('Authorization', `Bearer ${TENANT_A.token}`)
      .send({ command: 'search', query: 'test' });

    expect(res.status).toBe(500);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('/secret/host/path');
  });

  // ─── Response Format ─────────────────────────────────────────

  it('should always return the standard error format', async () => {
    const res = await request(app)
      .post('/qmd')
      .send({ command: 'search', query: 'test' });

    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code');
    expect(res.body.error).toHaveProperty('message');
  });
});

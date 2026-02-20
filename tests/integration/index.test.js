import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/setup.js';

// ── Mocks ─────────────────────────────────────────────────────────────

let tenantStore = {};

vi.mock('../../src/utils/config.js', () => ({
  getConfig: vi.fn(() => ({ get: vi.fn(), path: '/tmp/mock-config.json' })),
  getServerConfig: vi.fn(() => ({ port: 3333, host: '127.0.0.1', executionTimeout: 30000, maxConcurrent: 0 })),
  getTenants: vi.fn(() => tenantStore),
  getTenant: vi.fn((label) => tenantStore[label] ?? null),
  getTenantByToken: vi.fn((token) => {
    for (const t of Object.values(tenantStore)) {
      if (t.token === token) return t;
    }
    return null;
  }),
  saveTenant: vi.fn((label, data) => { tenantStore[label] = data; }),
  deleteTenant: vi.fn((label) => { delete tenantStore[label]; }),
  getQmdPath: vi.fn(() => 'qmd'),
  getIndexingConfig: vi.fn(() => ({ strategy: 'manual', periodicInterval: 3600, watchDebounce: 5 })),
  saveIndexingConfig: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────

const TENANT = {
  label: 'my-docs',
  displayName: 'My Docs',
  path: '/data/my-docs',
  collection: 'my-docs',
  token: 'qmd_sk_validtokenaaaaaaaaaaaaaaaaaaaa1',
  createdAt: '2026-01-01T00:00:00Z',
};

const VALID_TOKEN = `Bearer ${TENANT.token}`;

// ── Tests ─────────────────────────────────────────────────────────────

describe('POST /index', () => {
  let app;
  let mockIndexingManager;

  beforeEach(() => {
    vi.clearAllMocks();
    tenantStore = { [TENANT.label]: { ...TENANT } };

    mockIndexingManager = {
      isInProgress: vi.fn(() => false),
      triggerIndex: vi.fn(),
    };

    app = createTestApp({ indexingManager: mockIndexingManager });
  });

  // ─── Authentication ────────────────────────────────────────────────

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).post('/index').send();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for an invalid token', async () => {
    const res = await request(app)
      .post('/index')
      .set('Authorization', 'Bearer invalid_token')
      .send();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  // ─── Success: 202 Accepted ─────────────────────────────────────────

  it('returns 202 and starts indexing when not already in progress', async () => {
    mockIndexingManager.isInProgress.mockReturnValue(false);

    const res = await request(app)
      .post('/index')
      .set('Authorization', VALID_TOKEN)
      .send();

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain(TENANT.collection);
  });

  it('calls triggerIndex with the correct tenant', async () => {
    await request(app)
      .post('/index')
      .set('Authorization', VALID_TOKEN)
      .send();

    expect(mockIndexingManager.triggerIndex).toHaveBeenCalledWith(
      expect.objectContaining({ label: TENANT.label, collection: TENANT.collection }),
    );
  });

  it('returns immediately without waiting for indexing to complete', async () => {
    // triggerIndex that never resolves (simulates long-running embed)
    mockIndexingManager.triggerIndex.mockImplementation(() => new Promise(() => {}));

    const start = Date.now();
    const res = await request(app)
      .post('/index')
      .set('Authorization', VALID_TOKEN)
      .send();
    const elapsed = Date.now() - start;

    expect(res.status).toBe(202);
    expect(elapsed).toBeLessThan(500); // must return immediately
  });

  // ─── Conflict: 409 when already indexing ──────────────────────────

  it('returns 409 INDEX_IN_PROGRESS when indexing is already running', async () => {
    mockIndexingManager.isInProgress.mockReturnValue(true);

    const res = await request(app)
      .post('/index')
      .set('Authorization', VALID_TOKEN)
      .send();

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INDEX_IN_PROGRESS');
  });

  it('does not call triggerIndex when already in progress', async () => {
    mockIndexingManager.isInProgress.mockReturnValue(true);

    await request(app)
      .post('/index')
      .set('Authorization', VALID_TOKEN)
      .send();

    expect(mockIndexingManager.triggerIndex).not.toHaveBeenCalled();
  });

  // ─── Service unavailable ──────────────────────────────────────────

  it('returns 503 when indexingManager is not available', async () => {
    const appWithoutManager = createTestApp(); // no indexingManager attached

    const res = await request(appWithoutManager)
      .post('/index')
      .set('Authorization', VALID_TOKEN)
      .send();

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  // ─── Response format ──────────────────────────────────────────────

  it('always returns standard error format on failure', async () => {
    const res = await request(app).post('/index').send(); // no token

    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code');
    expect(res.body.error).toHaveProperty('message');
  });
});

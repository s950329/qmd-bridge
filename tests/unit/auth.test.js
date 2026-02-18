import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authMiddleware } from '../../src/middleware/auth.js';

// Mock the tenant service
vi.mock('../../src/services/tenant.js', () => ({
  getTenantByToken: vi.fn(),
}));

import { getTenantByToken } from '../../src/services/tenant.js';

function createMockReqRes(authHeader) {
  const req = {
    headers: {
      ...(authHeader !== undefined && { authorization: authHeader }),
    },
  };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('authMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when no Authorization header is present', () => {
    const { req, res, next } = createMockReqRes(undefined);
    // Remove authorization entirely
    delete req.headers.authorization;

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or missing authentication token',
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when Authorization header does not start with Bearer', () => {
    const { req, res, next } = createMockReqRes('Basic abc123');

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when token is invalid', () => {
    getTenantByToken.mockReturnValue(null);
    const { req, res, next } = createMockReqRes('Bearer invalid_token');

    authMiddleware(req, res, next);

    expect(getTenantByToken).toHaveBeenCalledWith('invalid_token');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() and set req.tenant when token is valid', () => {
    const mockTenant = {
      label: 'test-tenant',
      displayName: 'Test Tenant',
      path: '/some/path',
      collection: 'test-tenant',
      token: 'qmd_sk_abc123',
    };
    getTenantByToken.mockReturnValue(mockTenant);

    const { req, res, next } = createMockReqRes('Bearer qmd_sk_abc123');

    authMiddleware(req, res, next);

    expect(getTenantByToken).toHaveBeenCalledWith('qmd_sk_abc123');
    expect(req.tenant).toBe(mockTenant);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should correctly extract token from Bearer prefix', () => {
    getTenantByToken.mockReturnValue(null);
    const token = 'qmd_sk_0123456789abcdef0123456789abcdef';
    const { req, res, next } = createMockReqRes(`Bearer ${token}`);

    authMiddleware(req, res, next);

    expect(getTenantByToken).toHaveBeenCalledWith(token);
  });
});

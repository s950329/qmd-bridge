import { getTenantByToken } from '../services/tenant.js';

/**
 * Express middleware for Bearer Token authentication.
 * Extracts the token from the Authorization header,
 * looks up the corresponding tenant, and attaches it to req.tenant.
 */
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or missing authentication token',
      },
    });
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix
  const tenant = getTenantByToken(token);

  if (!tenant) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or missing authentication token',
      },
    });
  }

  req.tenant = tenant;
  next();
}

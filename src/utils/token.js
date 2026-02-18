import crypto from 'node:crypto';
import { TOKEN_PREFIX } from '../constants.js';

/**
 * Generate a secure random token with the qmd_sk_ prefix.
 * @returns {string} A token like "qmd_sk_a1b2c3d4e5f6..."
 */
export function generateToken() {
  return `${TOKEN_PREFIX}${crypto.randomBytes(16).toString('hex')}`;
}

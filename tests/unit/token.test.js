import { describe, it, expect } from 'vitest';
import { generateToken } from '../../src/utils/token.js';
import { TOKEN_PREFIX } from '../../src/constants.js';

describe('generateToken', () => {
  it('should return a string with the correct prefix', () => {
    const token = generateToken();
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
  });

  it('should have format qmd_sk_<32 hex chars>', () => {
    const token = generateToken();
    expect(token).toMatch(/^qmd_sk_[0-9a-f]{32}$/);
  });

  it('should generate unique tokens on each call', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()));
    expect(tokens.size).toBe(50);
  });
});

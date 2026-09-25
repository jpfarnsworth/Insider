import { describe, expect, it } from 'vitest';
import { isAllowedEmail } from './allowlist';

describe('isAllowedEmail', () => {
  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(isAllowedEmail(' Me@Example.com ', 'me@example.com')).toBe(true);
  });

  it('rejects other addresses', () => {
    expect(isAllowedEmail('other@example.com', 'me@example.com')).toBe(false);
  });

  it('rejects everything when no allowlist is configured', () => {
    expect(isAllowedEmail('me@example.com', '')).toBe(false);
    expect(isAllowedEmail('me@example.com', undefined)).toBe(false);
  });

  it('rejects missing emails', () => {
    expect(isAllowedEmail(null, 'me@example.com')).toBe(false);
    expect(isAllowedEmail(undefined, 'me@example.com')).toBe(false);
  });
});

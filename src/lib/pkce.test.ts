import { describe, expect, it } from 'vitest';
import { codeChallenge, createCodeVerifier } from '@/lib/pkce';

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B example', () => {
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes verifiers in the allowed alphabet and length, different each time', () => {
    const a = createCodeVerifier();
    expect(a).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(createCodeVerifier()).not.toBe(a);
  });
});

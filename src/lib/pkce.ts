import { createHash, randomBytes } from 'crypto';

// PKCE (RFC 7636) lets the Spotify login finish without a client secret: the
// login route keeps a random verifier and sends only its hash, and the token
// exchange proves possession of the verifier. Server-side only.

/** 64 random bytes as base64url: 86 characters, inside RFC 7636's 43 to 128. */
export const createCodeVerifier = (): string => randomBytes(64).toString('base64url');

/** The S256 code challenge for a verifier. */
export const codeChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

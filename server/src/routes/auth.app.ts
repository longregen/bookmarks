import { Hono } from '@hono/hono';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';
import type { AppDependencies, AppVariables } from '../app.ts';
import type { AuthResponse } from '../types/index.ts';
import { generateId, now } from '../utils/common.ts';

const DEFAULT_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_CHALLENGE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 50;
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validateUsername(username: string): { valid: true } | { valid: false; error: string } {
  if (username.length < USERNAME_MIN_LENGTH) {
    return { valid: false, error: `Username must be at least ${USERNAME_MIN_LENGTH} characters` };
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return { valid: false, error: `Username must be at most ${USERNAME_MAX_LENGTH} characters` };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return { valid: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' };
  }
  return { valid: true };
}

// TODO: Add rate limiting to prevent brute force attacks on authentication endpoints.
// This requires additional infrastructure (e.g., Redis for distributed rate limiting).
// Recommended limits: 5 requests per minute for /register/options and /login/options.

export function createAuthRoutes(deps: AppDependencies): Hono<{ Variables: AppVariables }> {
  const auth = new Hono<{ Variables: AppVariables }>();

  const RP_NAME = deps.env.get('RP_NAME') || 'Bookmark RAG';
  const RP_ID = deps.env.get('RP_ID') || 'localhost';
  const ORIGIN_ENV = deps.env.get('ORIGIN') || 'http://localhost:3000';
  const EXPECTED_ORIGINS: string | string[] = ORIGIN_ENV.includes(',')
    ? ORIGIN_ENV.split(',').map(o => o.trim())
    : ORIGIN_ENV;

  const SESSION_DURATION_MS = parseInt(deps.env.get('SESSION_DURATION_MS') || '', 10) || DEFAULT_SESSION_DURATION_MS;
  const CHALLENGE_DURATION_MS = parseInt(deps.env.get('CHALLENGE_DURATION_MS') || '', 10) || DEFAULT_CHALLENGE_DURATION_MS;

  // POST /api/v1/auth/register/options
  auth.post('/register/options', async (c) => {
    const body = await c.req.json() as { username?: string };
    const username = body.username?.trim();

    if (!username) {
      return c.json({ error: 'Username is required', code: 'INVALID_REQUEST' }, 400);
    }

    const validation = validateUsername(username);
    if (!validation.valid) {
      return c.json({ error: validation.error, code: 'INVALID_REQUEST' }, 400);
    }

    const existingUser = await deps.db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (existingUser) {
      return c.json({ error: 'Unable to complete registration', code: 'REGISTRATION_FAILED' }, 400);
    }

    const tempUserId = generateId();
    const sessionId = generateId();

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: username,
      userDisplayName: username,
      userID: new TextEncoder().encode(tempUserId),
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
      },
    });

    const expiresAt = new Date(Date.now() + CHALLENGE_DURATION_MS).toISOString();
    await deps.db.prepare(`
      INSERT INTO webauthn_challenges (session_id, challenge, user_id, username, type, expires_at, created_at)
      VALUES (?, ?, ?, ?, 'register', ?, ?)
    `).bind(sessionId, options.challenge, tempUserId, username, expiresAt, now()).run();

    return c.json({ sessionId, options });
  });

  // POST /api/v1/auth/register/verify
  auth.post('/register/verify', async (c) => {
    const body = await c.req.json() as { sessionId: string; credential: RegistrationResponseJSON };
    const { sessionId, credential } = body;

    if (!sessionId || !credential) {
      return c.json({ error: 'Session ID and credential are required', code: 'INVALID_REQUEST' }, 400);
    }

    const challenge = await deps.db.prepare<{
      session_id: string;
      challenge: string;
      user_id: string;
      username: string;
    }>(`
      SELECT * FROM webauthn_challenges
      WHERE session_id = ? AND type = 'register' AND expires_at > ?
    `).bind(sessionId, now()).first();

    if (!challenge) {
      return c.json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' }, 400);
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge: challenge.challenge,
        expectedOrigin: EXPECTED_ORIGINS,
        expectedRPID: RP_ID,
      });
    } catch (error) {
      console.error('Registration verification failed:', error);
      return c.json({ error: 'Verification failed', code: 'VERIFICATION_FAILED' }, 400);
    }

    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: 'Verification failed', code: 'VERIFICATION_FAILED' }, 400);
    }

    const { credential: regCredential } = verification.registrationInfo;
    const userId = challenge.user_id;
    const username = challenge.username;

    await deps.db.prepare(`
      INSERT INTO users (id, username, created_at)
      VALUES (?, ?, ?)
    `).bind(userId, username, now()).run();

    const transports = credential.response.transports ?? [];
    await deps.db.prepare(`
      INSERT INTO passkey_credentials (id, user_id, public_key, counter, transports, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      regCredential.id,
      userId,
      regCredential.publicKey,
      regCredential.counter,
      JSON.stringify(transports),
      now()
    ).run();

    const newSessionId = generateId();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

    await deps.db.prepare(`
      INSERT INTO sessions (id, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(newSessionId, userId, expiresAt, now()).run();

    await deps.db.prepare('DELETE FROM webauthn_challenges WHERE session_id = ?').bind(sessionId).run();

    const response: AuthResponse = {
      sessionToken: newSessionId,
      sessionExpiry: expiresAt,
      userId,
      username,
    };

    return c.json(response);
  });

  // POST /api/v1/auth/login/options
  auth.post('/login/options', async (c) => {
    const body = await c.req.json() as { username?: string };
    const username = body.username?.trim();

    let allowCredentials: { id: string; transports?: string[] }[] = [];
    let userId: string | null = null;

    if (username) {
      const user = await deps.db.prepare<{ id: string }>('SELECT id FROM users WHERE username = ?').bind(username).first();

      if (!user) {
        return c.json({ error: 'Invalid credentials', code: 'AUTHENTICATION_FAILED' }, 401);
      }

      userId = user.id;

      const credentials = await deps.db.prepare<{ id: string; transports: string | null }>(`
        SELECT id, transports FROM passkey_credentials WHERE user_id = ?
      `).bind(userId).all();

      allowCredentials = credentials.map(cred => ({
        id: cred.id,
        transports: cred.transports ? JSON.parse(cred.transports) : undefined,
      }));

      if (allowCredentials.length === 0) {
        return c.json({ error: 'Invalid credentials', code: 'AUTHENTICATION_FAILED' }, 401);
      }
    }

    const sessionId = generateId();

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: 'preferred',
      allowCredentials: allowCredentials.length > 0
        ? allowCredentials.map(cred => ({
            id: cred.id,
            transports: cred.transports as AuthenticatorTransport[] | undefined,
          }))
        : undefined,
    });

    const expiresAt = new Date(Date.now() + CHALLENGE_DURATION_MS).toISOString();
    await deps.db.prepare(`
      INSERT INTO webauthn_challenges (session_id, challenge, user_id, username, type, expires_at, created_at)
      VALUES (?, ?, ?, ?, 'login', ?, ?)
    `).bind(sessionId, options.challenge, userId ?? null, username ?? null, expiresAt, now()).run();

    return c.json({ sessionId, options });
  });

  // POST /api/v1/auth/login/verify
  auth.post('/login/verify', async (c) => {
    const body = await c.req.json() as { sessionId: string; credential: AuthenticationResponseJSON };
    const { sessionId, credential } = body;

    if (!sessionId || !credential) {
      return c.json({ error: 'Session ID and credential are required', code: 'INVALID_REQUEST' }, 400);
    }

    const challenge = await deps.db.prepare<{
      session_id: string;
      challenge: string;
      user_id: string | null;
      username: string | null;
    }>(`
      SELECT * FROM webauthn_challenges
      WHERE session_id = ? AND type = 'login' AND expires_at > ?
    `).bind(sessionId, now()).first();

    if (!challenge) {
      return c.json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' }, 400);
    }

    const storedCredential = await deps.db.prepare<{
      id: string;
      user_id: string;
      public_key: Uint8Array;
      counter: number;
      transports: string | null;
      username: string;
    }>(`
      SELECT pc.*, u.username
      FROM passkey_credentials pc
      JOIN users u ON pc.user_id = u.id
      WHERE pc.id = ?
    `).bind(credential.id).first();

    if (!storedCredential) {
      return c.json({ error: 'Authentication failed', code: 'AUTHENTICATION_FAILED' }, 401);
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: challenge.challenge,
        expectedOrigin: EXPECTED_ORIGINS,
        expectedRPID: RP_ID,
        credential: {
          id: storedCredential.id,
          publicKey: storedCredential.public_key,
          counter: storedCredential.counter,
          transports: storedCredential.transports
            ? JSON.parse(storedCredential.transports)
            : undefined,
        },
      });
    } catch (error) {
      console.error('Authentication verification failed:', error);
      return c.json({ error: 'Authentication failed', code: 'AUTHENTICATION_FAILED' }, 401);
    }

    if (!verification.verified) {
      return c.json({ error: 'Authentication failed', code: 'AUTHENTICATION_FAILED' }, 401);
    }

    await deps.db.prepare(`
      UPDATE passkey_credentials SET counter = ? WHERE id = ?
    `).bind(verification.authenticationInfo.newCounter, storedCredential.id).run();

    const newSessionId = generateId();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

    await deps.db.prepare(`
      INSERT INTO sessions (id, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(newSessionId, storedCredential.user_id, expiresAt, now()).run();

    await deps.db.prepare('DELETE FROM webauthn_challenges WHERE session_id = ?').bind(sessionId).run();

    const response: AuthResponse = {
      sessionToken: newSessionId,
      sessionExpiry: expiresAt,
      userId: storedCredential.user_id,
      username: storedCredential.username,
    };

    return c.json(response);
  });

  // POST /api/v1/auth/logout
  auth.post('/logout', async (c) => {
    const authHeader = c.req.header('Authorization');

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      await deps.db.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run();
    }

    return c.body(null, 204);
  });

  return auth;
}

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
} from '@simplewebauthn/server';
import { getDatabase, generateId, now } from '../db/database.ts';
import { getAuth } from '../middleware/auth.ts';
import type { AuthResponse, PasskeyCredential } from '../types/index.ts';

const auth = new Hono();

// Configuration
const RP_NAME = Deno.env.get('RP_NAME') || 'Bookmark RAG';
const RP_ID = Deno.env.get('RP_ID') || 'localhost';
// ORIGIN can be comma-separated list of allowed origins (e.g., for extensions)
const ORIGIN_ENV = Deno.env.get('ORIGIN') || 'http://localhost:3000';
const EXPECTED_ORIGINS: string | string[] = ORIGIN_ENV.includes(',')
  ? ORIGIN_ENV.split(',').map(o => o.trim())
  : ORIGIN_ENV;
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CHALLENGE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// POST /api/v1/auth/register/options
auth.post('/register/options', async (c) => {
  const body = await c.req.json() as { username?: string };
  const username = body.username?.trim();

  if (!username) {
    return c.json({ error: 'Username is required' }, 400);
  }

  const db = getDatabase();

  // Check if username already exists
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUser) {
    return c.json({ error: 'Username already exists', code: 'USERNAME_EXISTS' }, 409);
  }

  // Generate a temporary user ID for registration
  const tempUserId = generateId();
  const sessionId = generateId();

  // Get existing credentials to exclude (none for new user)
  const excludeCredentials: { id: string; transports?: string[] }[] = [];

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: username,
    userDisplayName: username,
    userID: new TextEncoder().encode(tempUserId),
    attestationType: 'none',
    excludeCredentials: excludeCredentials.map(cred => ({
      id: cred.id,
      transports: cred.transports as AuthenticatorTransport[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',
    },
  });

  // Store challenge
  const expiresAt = new Date(Date.now() + CHALLENGE_DURATION_MS).toISOString();
  db.prepare(`
    INSERT INTO webauthn_challenges (session_id, challenge, user_id, username, type, expires_at, created_at)
    VALUES (?, ?, ?, ?, 'register', ?, ?)
  `).run(sessionId, options.challenge, tempUserId, username, expiresAt, now());

  return c.json({
    sessionId,
    options,
  });
});

// POST /api/v1/auth/register/verify
auth.post('/register/verify', async (c) => {
  const body = await c.req.json() as { sessionId: string; credential: RegistrationResponseJSON };
  const { sessionId, credential } = body;

  if (!sessionId || !credential) {
    return c.json({ error: 'Session ID and credential are required' }, 400);
  }

  const db = getDatabase();

  // Get challenge
  const challenge = db.prepare(`
    SELECT * FROM webauthn_challenges
    WHERE session_id = ? AND type = 'register' AND expires_at > ?
  `).get(sessionId, now()) as {
    session_id: string;
    challenge: string;
    user_id: string;
    username: string;
  } | undefined;

  if (!challenge) {
    return c.json({ error: 'Invalid or expired session' }, 400);
  }

  // Verify registration
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
    return c.json({ error: 'Verification failed' }, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: 'Verification failed' }, 400);
  }

  const { credential: regCredential } = verification.registrationInfo;

  // Create user
  const userId = challenge.user_id;
  const username = challenge.username;

  db.prepare(`
    INSERT INTO users (id, username, created_at)
    VALUES (?, ?, ?)
  `).run(userId, username, now());

  // Store credential - public key is now inside the credential object
  const transports = credential.response.transports ?? [];
  db.prepare(`
    INSERT INTO passkey_credentials (id, user_id, public_key, counter, transports, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    regCredential.id,
    userId,
    regCredential.publicKey,
    regCredential.counter,
    JSON.stringify(transports),
    now()
  );

  // Create session
  const newSessionId = generateId();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(newSessionId, userId, expiresAt, now());

  // Clean up challenge
  db.prepare('DELETE FROM webauthn_challenges WHERE session_id = ?').run(sessionId);

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

  const db = getDatabase();
  let allowCredentials: { id: string; transports?: string[] }[] = [];
  let userId: string | null = null;

  if (username) {
    // Find user and their credentials
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string } | undefined;

    if (!user) {
      return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404);
    }

    userId = user.id;

    const credentials = db.prepare(`
      SELECT id, transports FROM passkey_credentials WHERE user_id = ?
    `).all(userId) as { id: string; transports: string | null }[];

    allowCredentials = credentials.map(cred => ({
      id: cred.id,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    }));

    if (allowCredentials.length === 0) {
      return c.json({ error: 'No passkeys registered', code: 'NO_PASSKEYS' }, 404);
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

  // Store challenge
  const expiresAt = new Date(Date.now() + CHALLENGE_DURATION_MS).toISOString();
  db.prepare(`
    INSERT INTO webauthn_challenges (session_id, challenge, user_id, username, type, expires_at, created_at)
    VALUES (?, ?, ?, ?, 'login', ?, ?)
  `).run(sessionId, options.challenge, userId ?? null, username ?? null, expiresAt, now());

  return c.json({
    sessionId,
    options,
  });
});

// POST /api/v1/auth/login/verify
auth.post('/login/verify', async (c) => {
  const body = await c.req.json() as { sessionId: string; credential: AuthenticationResponseJSON };
  const { sessionId, credential } = body;

  if (!sessionId || !credential) {
    return c.json({ error: 'Session ID and credential are required' }, 400);
  }

  const db = getDatabase();

  // Get challenge
  const challenge = db.prepare(`
    SELECT * FROM webauthn_challenges
    WHERE session_id = ? AND type = 'login' AND expires_at > ?
  `).get(sessionId, now()) as {
    session_id: string;
    challenge: string;
    user_id: string | null;
    username: string | null;
  } | undefined;

  if (!challenge) {
    return c.json({ error: 'Invalid or expired session' }, 400);
  }

  // Find the credential
  const storedCredential = db.prepare(`
    SELECT pc.*, u.username
    FROM passkey_credentials pc
    JOIN users u ON pc.user_id = u.id
    WHERE pc.id = ?
  `).get(credential.id) as {
    id: string;
    user_id: string;
    public_key: Uint8Array;
    counter: number;
    transports: string | null;
    username: string;
  } | undefined;

  if (!storedCredential) {
    return c.json({ error: 'Unknown credential' }, 401);
  }

  // Verify authentication
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
    return c.json({ error: 'Verification failed' }, 401);
  }

  if (!verification.verified) {
    return c.json({ error: 'Verification failed' }, 401);
  }

  // Update counter
  db.prepare(`
    UPDATE passkey_credentials SET counter = ? WHERE id = ?
  `).run(verification.authenticationInfo.newCounter, storedCredential.id);

  // Create session
  const newSessionId = generateId();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(newSessionId, storedCredential.user_id, expiresAt, now());

  // Clean up challenge
  db.prepare('DELETE FROM webauthn_challenges WHERE session_id = ?').run(sessionId);

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
    const db = getDatabase();
    db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
  }

  return c.body(null, 204);
});

export default auth;

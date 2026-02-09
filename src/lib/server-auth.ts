import { ServerApiClient } from './server-api';
import { getErrorMessage } from './errors';

export interface AuthResult {
  sessionToken: string;
  sessionExpiry: string;
  created: boolean;
}

export function generateToken(): string {
  return crypto.randomUUID();
}

export async function authenticate(
  serverUrl: string,
  token: string
): Promise<AuthResult> {
  if (!token.trim()) {
    throw new Error('Token is required');
  }

  const client = new ServerApiClient(serverUrl, '');

  try {
    const response = await client.authenticate(token);
    return {
      sessionToken: response.sessionToken,
      sessionExpiry: response.sessionExpiry,
      created: response.created,
    };
  } catch (error) {
    throw new Error(`Authentication failed: ${getErrorMessage(error)}`);
  }
}

export async function logout(
  serverUrl: string,
  sessionToken: string
): Promise<void> {
  if (!sessionToken) {
    return;
  }

  const client = new ServerApiClient(serverUrl, sessionToken);

  try {
    await client.logout();
  } catch (error) {
    console.warn('Server logout failed:', getErrorMessage(error));
  }
}

export async function deleteAccount(
  serverUrl: string,
  sessionToken: string
): Promise<void> {
  if (!sessionToken) {
    throw new Error('Not authenticated');
  }

  const client = new ServerApiClient(serverUrl, sessionToken);
  await client.deleteAccount();
}

export function isSessionValid(sessionExpiry: string): boolean {
  if (!sessionExpiry) {
    return false;
  }

  try {
    const expiryDate = new Date(sessionExpiry);
    if (isNaN(expiryDate.getTime())) {
      return false;
    }
    // Add a small buffer (30 seconds) to account for clock skew
    const now = new Date();
    return expiryDate.getTime() > now.getTime() + 30000;
  } catch {
    return false;
  }
}

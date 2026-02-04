import {
  ServerApiClient,
  ServerApiError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationCredentialJSON,
  type AuthenticationCredentialJSON,
} from './server-api';
import { getErrorMessage } from './errors';

export interface AuthResult {
  sessionToken: string;
  sessionExpiry: string;
  username: string;
}

function base64UrlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toAuthenticatorTransport(transport: string): AuthenticatorTransport {
  const validTransports: AuthenticatorTransport[] = ['usb', 'nfc', 'ble', 'internal', 'hybrid'];
  if (validTransports.includes(transport as AuthenticatorTransport)) {
    return transport as AuthenticatorTransport;
  }
  return 'internal';
}

function prepareRegistrationOptions(
  options: PublicKeyCredentialCreationOptionsJSON
): PublicKeyCredentialCreationOptions {
  return {
    challenge: base64UrlToBuffer(options.challenge),
    rp: {
      name: options.rp.name,
      id: options.rp.id,
    },
    user: {
      id: base64UrlToBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams.map((param) => ({
      type: param.type,
      alg: param.alg,
    })),
    timeout: options.timeout,
    attestation: options.attestation,
    authenticatorSelection: options.authenticatorSelection,
    excludeCredentials: options.excludeCredentials?.map((cred) => ({
      type: cred.type,
      id: base64UrlToBuffer(cred.id),
      transports: cred.transports?.map(toAuthenticatorTransport),
    })),
  };
}

function prepareLoginOptions(
  options: PublicKeyCredentialRequestOptionsJSON
): PublicKeyCredentialRequestOptions {
  return {
    challenge: base64UrlToBuffer(options.challenge),
    timeout: options.timeout,
    rpId: options.rpId,
    allowCredentials: options.allowCredentials?.map((cred) => ({
      type: cred.type,
      id: base64UrlToBuffer(cred.id),
      transports: cred.transports?.map(toAuthenticatorTransport),
    })),
    userVerification: options.userVerification,
  };
}

function serializeRegistrationCredential(
  credential: PublicKeyCredential
): RegistrationCredentialJSON {
  const response = credential.response as AuthenticatorAttestationResponse;
  const transports = typeof response.getTransports === 'function'
    ? response.getTransports()
    : [];
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      attestationObject: bufferToBase64Url(response.attestationObject),
      transports,
    },
  };
}

function serializeLoginCredential(
  credential: PublicKeyCredential
): AuthenticationCredentialJSON {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle
        ? bufferToBase64Url(response.userHandle)
        : undefined,
    },
  };
}

export async function registerWithPasskey(
  serverUrl: string,
  username: string
): Promise<AuthResult> {
  if (!username.trim()) {
    throw new Error('Username is required');
  }

  const credentials = navigator.credentials as CredentialsContainer | undefined;
  if (credentials === undefined) {
    throw new Error(
      'WebAuthn is not supported in this browser. Please use a modern browser with passkey support.'
    );
  }

  const client = new ServerApiClient(serverUrl, '');

  // Step 1: Get registration options from server
  let sessionId: string;
  let registrationOptions: PublicKeyCredentialCreationOptionsJSON;
  try {
    const response = await client.getRegisterOptions(username.trim());
    sessionId = response.sessionId;
    registrationOptions = response.options;
  } catch (error) {
    if (error instanceof ServerApiError) {
      if (error.isConflict()) {
        throw new Error(
          'Username already exists. Please choose a different username or login instead.'
        );
      }
      throw new Error(`Failed to start registration: ${error.message}`);
    }
    throw new Error(`Failed to start registration: ${getErrorMessage(error)}`);
  }

  // Step 2: Create credential using WebAuthn API
  let credential: Credential | null;
  try {
    const publicKeyOptions = prepareRegistrationOptions(registrationOptions);
    credential = await navigator.credentials.create({
      publicKey: publicKeyOptions,
    });
  } catch (error) {
    if (error instanceof DOMException) {
      switch (error.name) {
        case 'NotAllowedError':
          throw new Error(
            'Registration was cancelled or timed out. Please try again.'
          );
        case 'InvalidStateError':
          throw new Error(
            'A passkey already exists for this account on this device.'
          );
        case 'NotSupportedError':
          throw new Error(
            'Your device does not support the required authenticator type.'
          );
        default:
          throw new Error(`Passkey creation failed: ${error.message}`);
      }
    }
    throw new Error(`Passkey creation failed: ${getErrorMessage(error)}`);
  }

  if (!credential) {
    throw new Error('No credential was created. Please try again.');
  }

  // Step 3: Send attestation to server for verification
  try {
    const serializedCredential = serializeRegistrationCredential(
      credential as PublicKeyCredential
    );
    const verifyResponse = await client.verifyRegistration(
      sessionId,
      serializedCredential
    );

    return {
      sessionToken: verifyResponse.sessionToken,
      sessionExpiry: verifyResponse.sessionExpiry,
      username: verifyResponse.username,
    };
  } catch (error) {
    if (error instanceof ServerApiError) {
      throw new Error(`Registration verification failed: ${error.message}`);
    }
    throw new Error(
      `Registration verification failed: ${getErrorMessage(error)}`
    );
  }
}

export async function loginWithPasskey(
  serverUrl: string,
  username?: string
): Promise<AuthResult> {
  const credentials = navigator.credentials as CredentialsContainer | undefined;
  if (credentials === undefined) {
    throw new Error(
      'WebAuthn is not supported in this browser. Please use a modern browser with passkey support.'
    );
  }

  const client = new ServerApiClient(serverUrl, '');

  // Step 1: Get login options from server
  let sessionId: string;
  let loginOptions: PublicKeyCredentialRequestOptionsJSON;
  try {
    const response = await client.getLoginOptions(username?.trim());
    sessionId = response.sessionId;
    loginOptions = response.options;
  } catch (error) {
    if (error instanceof ServerApiError) {
      if (error.isNotFound()) {
        throw new Error(
          'No passkey found for this account. Please register first.'
        );
      }
      throw new Error(`Failed to start login: ${error.message}`);
    }
    throw new Error(`Failed to start login: ${getErrorMessage(error)}`);
  }

  // Step 2: Get credential using WebAuthn API
  let credential: Credential | null;
  try {
    const publicKeyOptions = prepareLoginOptions(loginOptions);
    credential = await navigator.credentials.get({
      publicKey: publicKeyOptions,
    });
  } catch (error) {
    if (error instanceof DOMException) {
      switch (error.name) {
        case 'NotAllowedError':
          throw new Error(
            'Login was cancelled or timed out. Please try again.'
          );
        case 'SecurityError':
          throw new Error(
            'Security error during login. Please ensure you are using HTTPS.'
          );
        default:
          throw new Error(`Passkey authentication failed: ${error.message}`);
      }
    }
    throw new Error(
      `Passkey authentication failed: ${getErrorMessage(error)}`
    );
  }

  if (!credential) {
    throw new Error('No credential was provided. Please try again.');
  }

  // Step 3: Send assertion to server for verification
  try {
    const serializedCredential = serializeLoginCredential(
      credential as PublicKeyCredential
    );
    const verifyResponse = await client.verifyLogin(
      sessionId,
      serializedCredential
    );

    return {
      sessionToken: verifyResponse.sessionToken,
      sessionExpiry: verifyResponse.sessionExpiry,
      username: verifyResponse.username,
    };
  } catch (error) {
    if (error instanceof ServerApiError) {
      if (error.isUnauthorized()) {
        throw new Error(
          'Invalid passkey. Please try again or register a new passkey.'
        );
      }
      throw new Error(`Login verification failed: ${error.message}`);
    }
    throw new Error(`Login verification failed: ${getErrorMessage(error)}`);
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
    // Log but don't throw - logout should succeed locally even if server call fails
    console.warn('Server logout failed:', getErrorMessage(error));
  }
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

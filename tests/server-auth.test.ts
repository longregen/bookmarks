import { describe, it, expect, beforeEach, vi } from 'vitest';

const savedSettings: Record<string, unknown> = {};
const mockClientLogout = vi.fn();

function MockServerApiClient(this: { logout: typeof mockClientLogout }) {
  this.logout = mockClientLogout;
}

vi.mock('../src/lib/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
  saveSetting: (key: string, value: unknown) => {
    savedSettings[key] = value;
    return Promise.resolve();
  },
}));

vi.mock('../src/lib/server-api', () => ({
  ServerApiClient: MockServerApiClient,
}));

import { logout } from '../src/lib/server-auth';

describe('server-auth logout', () => {
  beforeEach(() => {
    for (const k of Object.keys(savedSettings)) delete savedSettings[k];
    mockClientLogout.mockReset();
  });

  it('clears local session after successful server logout', async () => {
    mockClientLogout.mockResolvedValue(undefined);

    await logout('https://server.test', 'session-xyz');

    expect(mockClientLogout).toHaveBeenCalledOnce();
    expect(savedSettings.serverSessionToken).toBe('');
    expect(savedSettings.serverSessionExpiry).toBe('');
    expect(savedSettings.serverAuthToken).toBe('');
    expect(savedSettings.serverEnabled).toBe(false);
    expect(savedSettings.serverLastSyncError).toBe('');
  });

  it('clears local session even when server call fails (server down)', async () => {
    mockClientLogout.mockRejectedValue(new Error('Network error: connection refused'));

    await logout('https://server.test', 'session-xyz');

    expect(mockClientLogout).toHaveBeenCalledOnce();
    expect(savedSettings.serverSessionToken).toBe('');
    expect(savedSettings.serverSessionExpiry).toBe('');
    expect(savedSettings.serverAuthToken).toBe('');
    expect(savedSettings.serverEnabled).toBe(false);
  });

  it('clears local session when server call hangs (times out)', async () => {
    mockClientLogout.mockImplementation(() => new Promise(() => {
      /* never resolves - simulates hung server */
    }));

    vi.useFakeTimers();
    const logoutPromise = logout('https://server.test', 'session-xyz');
    await vi.advanceTimersByTimeAsync(6000);
    await logoutPromise;
    vi.useRealTimers();

    expect(savedSettings.serverSessionToken).toBe('');
    expect(savedSettings.serverEnabled).toBe(false);
  });

  it('clears local session without calling server when no session token', async () => {
    await logout('https://server.test', '');

    expect(mockClientLogout).not.toHaveBeenCalled();
    expect(savedSettings.serverSessionToken).toBe('');
    expect(savedSettings.serverEnabled).toBe(false);
  });
});

# WebDAV Sync Settings Implementation Plan

This document provides step-by-step instructions for adding a WebDAV configuration section to the extension settings, enabling users to connect to a remote WebDAV server for bookmark synchronization.

## Overview

**Goal**: Add a new settings section where users can configure WebDAV connection details:
- Server URL
- Username
- Password
- Sync path (optional)

**Branch**: `claude/streamline-redesign-code-6lYId`

---

## Architecture Summary

The extension uses:
- **Dexie.js** (IndexedDB wrapper) for client-side storage
- **Key-value settings store** with timestamps
- **Sidebar navigation** with collapsible sections
- **Form-based settings** with validation and status feedback

---

## Implementation Steps

### Step 1: Extend Settings Interface

**File**: `src/lib/settings.ts`

Add WebDAV fields to the `ApiSettings` interface and defaults:

```typescript
export interface ApiSettings {
  apiBaseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  // New WebDAV fields
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  webdavPath: string;
  webdavEnabled: boolean;
}

const DEFAULTS: ApiSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  chatModel: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
  // WebDAV defaults
  webdavUrl: '',
  webdavUsername: '',
  webdavPassword: '',
  webdavPath: '/bookmarks',
  webdavEnabled: false,
};
```

Update `getSettings()` to include new fields:

```typescript
export async function getSettings(): Promise<ApiSettings> {
  const rows = await db.settings.toArray();
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

  return {
    apiBaseUrl: map.apiBaseUrl ?? DEFAULTS.apiBaseUrl,
    apiKey: map.apiKey ?? DEFAULTS.apiKey,
    chatModel: map.chatModel ?? DEFAULTS.chatModel,
    embeddingModel: map.embeddingModel ?? DEFAULTS.embeddingModel,
    // WebDAV fields
    webdavUrl: map.webdavUrl ?? DEFAULTS.webdavUrl,
    webdavUsername: map.webdavUsername ?? DEFAULTS.webdavUsername,
    webdavPassword: map.webdavPassword ?? DEFAULTS.webdavPassword,
    webdavPath: map.webdavPath ?? DEFAULTS.webdavPath,
    webdavEnabled: map.webdavEnabled ?? DEFAULTS.webdavEnabled,
  };
}
```

---

### Step 2: Add Navigation Item

**File**: `src/options/options.html`

Add WebDAV sync navigation item in the sidebar (after existing nav items):

```html
<a href="#webdav-sync" class="nav-item" data-section="webdav-sync">
  <span class="nav-icon">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>
    </svg>
  </span>
  <span class="nav-label">WebDAV Sync</span>
</a>
```

---

### Step 3: Add WebDAV Settings Section

**File**: `src/options/options.html`

Add the WebDAV configuration section (after existing sections, before the closing `</main>` tag):

```html
<!-- WebDAV Sync Section -->
<section id="webdav-sync" class="settings-section">
  <div class="section-header">
    <h2>WebDAV Sync</h2>
    <p class="section-description">
      Sync your bookmarks across devices using a WebDAV server (Nextcloud, ownCloud, Synology, etc.)
    </p>
  </div>

  <form id="webdavForm">
    <!-- Enable/Disable Toggle -->
    <div class="form-group">
      <label class="toggle-label">
        <input type="checkbox" id="webdavEnabled" name="webdavEnabled" />
        <span class="toggle-text">Enable WebDAV Sync</span>
      </label>
      <small class="help-text">
        When enabled, bookmarks will sync automatically with your WebDAV server
      </small>
    </div>

    <div id="webdavFields" class="conditional-fields">
      <!-- Server URL -->
      <div class="form-group">
        <label for="webdavUrl">Server URL</label>
        <input
          type="url"
          id="webdavUrl"
          name="webdavUrl"
          placeholder="https://cloud.example.com/remote.php/dav/files/username"
        />
        <small class="help-text">
          Full WebDAV endpoint URL. For Nextcloud: <code>https://your-server/remote.php/dav/files/USERNAME</code>
        </small>
      </div>

      <!-- Username -->
      <div class="form-group">
        <label for="webdavUsername">Username</label>
        <input
          type="text"
          id="webdavUsername"
          name="webdavUsername"
          placeholder="your-username"
          autocomplete="username"
        />
        <small class="help-text">
          Your WebDAV server username
        </small>
      </div>

      <!-- Password -->
      <div class="form-group">
        <label for="webdavPassword">Password</label>
        <input
          type="password"
          id="webdavPassword"
          name="webdavPassword"
          placeholder="••••••••"
          autocomplete="current-password"
        />
        <small class="help-text">
          Your WebDAV server password or app-specific password. Stored locally only.
        </small>
      </div>

      <!-- Sync Path -->
      <div class="form-group">
        <label for="webdavPath">Sync Folder Path</label>
        <input
          type="text"
          id="webdavPath"
          name="webdavPath"
          placeholder="/bookmarks"
        />
        <small class="help-text">
          Folder path on the server where bookmark data will be stored (will be created if it doesn't exist)
        </small>
      </div>

      <!-- Connection Status -->
      <div id="webdavConnectionStatus" class="connection-status hidden">
        <span class="status-indicator"></span>
        <span class="status-text"></span>
      </div>

      <!-- Action Buttons -->
      <div class="button-group">
        <button type="submit" class="btn btn-primary">
          Save Settings
        </button>
        <button type="button" id="testWebdavBtn" class="btn btn-secondary">
          Test Connection
        </button>
      </div>
    </div>
  </form>
</section>
```

---

### Step 4: Add CSS Styles

**File**: `src/options/options.css`

Add styles for the WebDAV section (at end of file):

```css
/* WebDAV Sync Section */

/* Toggle switch styling */
.toggle-label {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  cursor: pointer;
}

.toggle-label input[type="checkbox"] {
  width: 44px;
  height: 24px;
  appearance: none;
  background: var(--bg-tertiary);
  border-radius: 12px;
  position: relative;
  cursor: pointer;
  transition: background var(--transition-base);
}

.toggle-label input[type="checkbox"]::before {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  top: 2px;
  left: 2px;
  background: var(--bg-primary);
  box-shadow: var(--shadow-sm);
  transition: transform var(--transition-base);
}

.toggle-label input[type="checkbox"]:checked {
  background: var(--btn-primary-bg);
}

.toggle-label input[type="checkbox"]:checked::before {
  transform: translateX(20px);
}

.toggle-label input[type="checkbox"]:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.toggle-text {
  font-weight: var(--font-medium);
  color: var(--text-primary);
}

/* Conditional fields (shown/hidden based on toggle) */
.conditional-fields {
  margin-top: var(--space-6);
  padding-top: var(--space-6);
  border-top: 1px solid var(--border-primary);
}

.conditional-fields.hidden {
  display: none;
}

/* Code snippets in help text */
.help-text code {
  background: var(--bg-tertiary);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

/* Connection status indicator */
.connection-status {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-6);
  font-size: var(--text-base);
}

.connection-status.hidden {
  display: none;
}

.connection-status .status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.connection-status.success {
  background: var(--success-bg);
  color: var(--success-text);
  border: 1px solid var(--success-border);
}

.connection-status.success .status-indicator {
  background: var(--success-text);
}

.connection-status.error {
  background: var(--error-bg);
  color: var(--error-text);
  border: 1px solid var(--error-border);
}

.connection-status.error .status-indicator {
  background: var(--error-text);
}

.connection-status.testing {
  background: var(--warning-bg);
  color: var(--warning-text);
  border: 1px solid var(--warning-border);
}

.connection-status.testing .status-indicator {
  background: var(--warning-text);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

---

### Step 5: Add TypeScript Handler

**File**: `src/options/options.ts`

Add WebDAV form handling logic. Add these imports at top:

```typescript
import { getSettings, saveSetting } from '../lib/settings';
import { showStatusMessage } from '../lib/dom';
```

Add DOM element references after existing ones:

```typescript
// WebDAV form elements
const webdavForm = document.getElementById('webdavForm') as HTMLFormElement;
const webdavEnabledInput = document.getElementById('webdavEnabled') as HTMLInputElement;
const webdavFieldsDiv = document.getElementById('webdavFields') as HTMLDivElement;
const webdavUrlInput = document.getElementById('webdavUrl') as HTMLInputElement;
const webdavUsernameInput = document.getElementById('webdavUsername') as HTMLInputElement;
const webdavPasswordInput = document.getElementById('webdavPassword') as HTMLInputElement;
const webdavPathInput = document.getElementById('webdavPath') as HTMLInputElement;
const testWebdavBtn = document.getElementById('testWebdavBtn') as HTMLButtonElement;
const webdavConnectionStatus = document.getElementById('webdavConnectionStatus') as HTMLDivElement;
```

Add WebDAV settings loading (call from existing `loadSettings` or create separate):

```typescript
async function loadWebDAVSettings() {
  try {
    const settings = await getSettings();

    webdavEnabledInput.checked = settings.webdavEnabled;
    webdavUrlInput.value = settings.webdavUrl;
    webdavUsernameInput.value = settings.webdavUsername;
    webdavPasswordInput.value = settings.webdavPassword;
    webdavPathInput.value = settings.webdavPath;

    // Show/hide fields based on enabled state
    updateWebDAVFieldsVisibility();
  } catch (error) {
    console.error('Error loading WebDAV settings:', error);
  }
}

function updateWebDAVFieldsVisibility() {
  if (webdavEnabledInput.checked) {
    webdavFieldsDiv.classList.remove('hidden');
  } else {
    webdavFieldsDiv.classList.add('hidden');
  }
}
```

Add event listeners:

```typescript
// Toggle visibility when enabled checkbox changes
webdavEnabledInput.addEventListener('change', updateWebDAVFieldsVisibility);

// Form submission
webdavForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = webdavForm.querySelector('[type="submit"]') as HTMLButtonElement;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    await saveSetting('webdavEnabled', webdavEnabledInput.checked);
    await saveSetting('webdavUrl', webdavUrlInput.value.trim());
    await saveSetting('webdavUsername', webdavUsernameInput.value.trim());
    await saveSetting('webdavPassword', webdavPasswordInput.value);
    await saveSetting('webdavPath', webdavPathInput.value.trim() || '/bookmarks');

    showStatusMessage(statusDiv, 'WebDAV settings saved successfully!', 'success', 5000);
  } catch (error) {
    console.error('Error saving WebDAV settings:', error);
    showStatusMessage(statusDiv, 'Failed to save WebDAV settings', 'error', 5000);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Settings';
  }
});

// Test connection button
testWebdavBtn.addEventListener('click', async () => {
  const url = webdavUrlInput.value.trim();
  const username = webdavUsernameInput.value.trim();
  const password = webdavPasswordInput.value;

  if (!url || !username || !password) {
    showConnectionStatus('error', 'Please fill in URL, username, and password');
    return;
  }

  showConnectionStatus('testing', 'Testing connection...');
  testWebdavBtn.disabled = true;

  try {
    const result = await testWebDAVConnection(url, username, password);

    if (result.success) {
      showConnectionStatus('success', 'Connection successful!');
    } else {
      showConnectionStatus('error', result.error || 'Connection failed');
    }
  } catch (error) {
    showConnectionStatus('error', `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    testWebdavBtn.disabled = false;
  }
});

function showConnectionStatus(type: 'success' | 'error' | 'testing', message: string) {
  webdavConnectionStatus.className = `connection-status ${type}`;
  const statusText = webdavConnectionStatus.querySelector('.status-text');
  if (statusText) {
    statusText.textContent = message;
  }
}
```

Add the connection test function:

```typescript
interface WebDAVTestResult {
  success: boolean;
  error?: string;
}

async function testWebDAVConnection(
  url: string,
  username: string,
  password: string
): Promise<WebDAVTestResult> {
  try {
    // Use PROPFIND to test WebDAV connection
    const response = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        'Depth': '0',
        'Authorization': 'Basic ' + btoa(`${username}:${password}`),
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`,
    });

    // WebDAV returns 207 Multi-Status for successful PROPFIND
    if (response.status === 207 || response.ok) {
      return { success: true };
    }

    if (response.status === 401) {
      return { success: false, error: 'Authentication failed. Check username and password.' };
    }

    if (response.status === 404) {
      return { success: false, error: 'Path not found. Check the server URL.' };
    }

    return { success: false, error: `Server returned status ${response.status}` };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return { success: false, error: 'Network error. Check the URL and your connection.' };
    }
    throw error;
  }
}
```

Initialize on page load (add to existing init):

```typescript
// Call in DOMContentLoaded or init function
loadWebDAVSettings();
```

---

### Step 6: Update saveSetting Function Type

**File**: `src/lib/settings.ts`

Update the `saveSetting` function to accept the new keys:

```typescript
type SettingKey = keyof ApiSettings;

export async function saveSetting(key: SettingKey, value: string | boolean): Promise<void> {
  const now = new Date();
  const existing = await db.settings.get(key);

  if (existing) {
    await db.settings.update(key, { value, updatedAt: now });
  } else {
    await db.settings.add({ key, value, createdAt: now, updatedAt: now });
  }
}
```

---

## File Summary

| File | Changes |
|------|---------|
| `src/lib/settings.ts` | Add WebDAV fields to interface, defaults, and getSettings |
| `src/options/options.html` | Add nav item + WebDAV settings section |
| `src/options/options.css` | Add toggle, conditional fields, connection status styles |
| `src/options/options.ts` | Add WebDAV form handling, validation, connection test |

---

## Security Considerations

1. **Password Storage**: Passwords are stored in IndexedDB (local only, not synced to browser sync). This is the same pattern used for API keys.

2. **Transmission**: Credentials are sent via HTTP Basic Auth over HTTPS. Users should always use HTTPS WebDAV URLs.

3. **CORS**: WebDAV servers must have appropriate CORS headers configured to allow requests from browser extensions. Most self-hosted solutions (Nextcloud, ownCloud) support this.

4. **App Passwords**: Recommend users create app-specific passwords rather than using their main account password.

---

## Testing Checklist

- [ ] Settings load correctly on page open
- [ ] Toggle shows/hides configuration fields
- [ ] Form validates required fields
- [ ] Settings persist after save
- [ ] Test connection works with valid credentials
- [ ] Test connection shows appropriate errors for:
  - [ ] Invalid URL
  - [ ] Wrong credentials (401)
  - [ ] Path not found (404)
  - [ ] Network errors
- [ ] Works on Firefox Desktop
- [ ] Works on Firefox Android
- [ ] Works on Chrome (if applicable)

---

## Future Enhancements (Out of Scope)

These are not part of this implementation but noted for future work:

1. **Actual sync functionality** - Upload/download bookmark data
2. **Conflict resolution** - Handle simultaneous edits
3. **Auto-sync** - Periodic background synchronization
4. **Sync status indicator** - Show last sync time in UI
5. **Selective sync** - Choose which bookmarks to sync

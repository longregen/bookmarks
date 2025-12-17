/**
 * Shared manifest configuration for Chrome and Firefox builds.
 * Browser-specific fields are added in the respective vite configs.
 */

export const manifestBase = {
  manifest_version: 3,
  name: 'Bookmark RAG',
  version: '4.0.3',
  description: 'Capture and semantically search your bookmarks',

  host_permissions: ['<all_urls>'],

  action: {
    default_popup: 'src/popup/popup.html',
    default_icon: {
      '16': 'public/icons/icon-16.png',
      '48': 'public/icons/icon-48.png',
      '128': 'public/icons/icon-128.png',
    },
  },

  options_ui: {
    page: 'src/options/options.html',
    open_in_tab: true,
  },

  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/capture.ts'],
      run_at: 'document_idle',
    },
  ],

  commands: {
    'save-bookmark': {
      suggested_key: {
        default: 'Ctrl+Shift+B',
        mac: 'Command+Shift+B',
      },
      description: 'Save current page as bookmark',
    },
  },

  icons: {
    '16': 'public/icons/icon-16.png',
    '48': 'public/icons/icon-48.png',
    '128': 'public/icons/icon-128.png',
  },
} as const;

/** Shared permissions for all browser builds */
export const basePermissions = ['storage', 'activeTab', 'scripting', 'alarms'] as const;

/** Chrome-specific manifest configuration */
export const chromeManifest = {
  ...manifestBase,
  permissions: [...basePermissions, 'tabs', 'offscreen'],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module' as const,
  },
};

/** Firefox-specific manifest configuration */
export const firefoxManifest = {
  ...manifestBase,
  permissions: [...basePermissions, 'tabs'],
  background: {
    scripts: ['src/background/service-worker.ts'],
    type: 'module' as const,
  },
  browser_specific_settings: {
    gecko: {
      id: 'bookmarks@localforge.org',
      strict_min_version: '140.0',
      data_collection_permissions: {
        required: ['none'],
      },
    },
    gecko_android: {
      strict_min_version: '142.0',
    },
  },
};

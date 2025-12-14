import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Prepares a Firefox profile with the extension pre-installed
 * This is a workaround for Puppeteer's limited Firefox extension support
 * Returns the extension ID for use in tests
 */
export async function setupFirefoxProfile(profileDir: string, extensionPath: string): Promise<string> {
  // Create extensions directory in profile
  const extensionsDir = path.join(profileDir, 'extensions');

  if (!fs.existsSync(extensionsDir)) {
    fs.mkdirSync(extensionsDir, { recursive: true });
  }

  // Read the extension manifest to get the extension ID
  const manifestPath = path.join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // Firefox uses the extension ID from manifest (gecko.id or computed from manifest)
  let extensionId: string;
  if (manifest.browser_specific_settings?.gecko?.id) {
    extensionId = manifest.browser_specific_settings.gecko.id;
  } else if (manifest.applications?.gecko?.id) {
    extensionId = manifest.applications.gecko.id;
  } else {
    // For testing, we can use a generated ID
    extensionId = 'bookmark-rag-test@example.com';
    console.warn('No gecko ID found in manifest, using default:', extensionId);
  }

  // Return the extension ID for use in tests
  console.log(`Found Firefox extension ID: ${extensionId}`);

  // Copy extension files to profile extensions directory
  const targetExtensionDir = path.join(extensionsDir, extensionId);

  if (fs.existsSync(targetExtensionDir)) {
    fs.rmSync(targetExtensionDir, { recursive: true, force: true });
  }

  // Copy the entire extension directory
  copyDirectory(extensionPath, targetExtensionDir);

  // Write user.js with preferences to enable unsigned extensions
  const userPrefs = `
// Enable unsigned extensions
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);

// Disable extension updates and recommendations
user_pref("extensions.update.enabled", false);
user_pref("extensions.getAddons.showPane", false);
user_pref("extensions.htmlaboutaddons.recommendations.enabled", false);

// Enable remote debugging
user_pref("remote.enabled", true);
user_pref("remote.force-local", true);
user_pref("devtools.chrome.enabled", true);
user_pref("devtools.debugger.remote-enabled", true);
user_pref("devtools.debugger.prompt-connection", false);

// Disable first-run and updates
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("app.update.enabled", false);
user_pref("app.update.auto", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("browser.rights.3.shown", true);
`;

  fs.writeFileSync(path.join(profileDir, 'user.js'), userPrefs);

  console.log(`Firefox extension installed to profile: ${targetExtensionDir}`);
  console.log(`Extension ID: ${extensionId}`);

  return extensionId;
}

function copyDirectory(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

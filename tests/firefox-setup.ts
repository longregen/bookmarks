import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Prepares a Firefox profile with the extension pre-installed
 * This is a workaround for Puppeteer's limited Firefox extension support
 */
export async function setupFirefoxProfile(profileDir: string, extensionPath: string): Promise<void> {
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

  console.log(`Firefox extension installed to profile: ${targetExtensionDir}`);
  console.log(`Extension ID: ${extensionId}`);
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

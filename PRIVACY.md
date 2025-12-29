# Privacy Policy

**Bookmark RAG by Localforge**

*Last updated: December 2024*

---

## Our Philosophy

This extension is built on the principles of the [Open Garden Manifesto](https://opengarden.tech): technology should serve human flourishing, not corporate extraction. Privacy is not a feature—it's a fundamental right. We treat privacy as dignity, safety, and consent.

**We do not collect, store, transmit, or monetize your data. Period.**

---

## What We Don't Do

- **No telemetry** — We don't track how you use the extension
- **No analytics** — We don't measure engagement, retention, or behavior
- **No data collection** — We don't collect any information about you or your browsing
- **No third-party sharing** — We have no data to share because we collect none
- **No advertising** — We don't serve ads or sell attention
- **No user accounts** — We don't require registration or authentication
- **No cloud storage** — We don't store your bookmarks on our servers
- **No tracking pixels** — We don't embed trackers of any kind
- **No fingerprinting** — We don't identify your browser or device

---

## What Stays On Your Device

**All your data remains entirely on your device:**

| Data Type | Storage Location | Transmitted? |
|-----------|------------------|--------------|
| Bookmarks (URLs, titles) | Your browser's IndexedDB | Never |
| Captured page content | Your browser's IndexedDB | Never |
| Extracted markdown | Your browser's IndexedDB | To your LLM API only* |
| Generated Q&A pairs | Your browser's IndexedDB | Never |
| Embedding vectors | Your browser's IndexedDB | Never |
| Tags and organization | Your browser's IndexedDB | Never |
| Search history | Your browser's IndexedDB | Never |
| Extension settings | Your browser's storage | Never |

*\*Only when you explicitly configure an API and trigger processing*

---

## External Communications

The extension only communicates externally when **you explicitly configure and initiate** the following:

### LLM API (User-Configured)

When you save a bookmark, the extracted markdown content is sent to **your configured API endpoint** (e.g., OpenAI, local LLM server) for:
- Generating question-answer pairs about the content
- Creating embedding vectors for semantic search

**You control:**
- Which API provider to use (including self-hosted options)
- Your own API credentials
- Whether to process bookmarks at all

**We never see:** Your API keys, the content you process, or any API responses.

### WebDAV Sync (Optional)

If you enable WebDAV sync, your bookmarks are synced to **your own WebDAV server**. We provide the feature; you provide and control the infrastructure.

**We never see:** Your WebDAV credentials, server URL, or synced data.

### Page Fetching

When you import a URL or save a bookmark, the extension fetches that page's content directly from the website to your browser. This is a standard browser request—no proxy, no intermediary, no logging.

---

## Permissions Explained

We request only the permissions necessary for core functionality:

| Permission | Why We Need It |
|------------|----------------|
| `storage` | Store your bookmarks locally in IndexedDB |
| `activeTab` | Capture page content when you click "Save" |
| `scripting` | Inject content script to extract page HTML |
| `alarms` | Schedule background processing jobs |
| `tabs` | Open library/settings in new tabs |
| `offscreen` | Process content in Chrome (DOM parsing) |
| `host_permissions` | Fetch pages you want to bookmark |

**Every permission serves a specific user-initiated function.** We don't request permissions for tracking, analytics, or data collection because we don't do those things.

---

## Data Portability

True to Open Garden principles, your data is yours:

- **Export anytime** — Download all bookmarks as JSON with one click
- **Import freely** — Restore from backups or migrate from other tools
- **No lock-in** — Standard formats, no proprietary encoding
- **Self-host option** — Use local LLM models for complete independence

---

## Open Source Transparency

This extension is open source. You can:
- **Audit the code** — Verify our privacy claims yourself
- **Build from source** — Compile your own trusted version
- **Contribute** — Help improve privacy and security
- **Fork** — Create your own version if our direction changes

Repository: [github.com/nicholasgriffintn/bookmarks](https://github.com/nicholasgriffintn/bookmarks)

---

## Children's Privacy

This extension does not knowingly collect any information from anyone, including children under 13. Since we collect no data, there is no children's data to protect—but we mention this for regulatory completeness.

---

## Changes to This Policy

If we ever change this policy, we will:
1. Update this document with a new date
2. Describe what changed and why
3. Never retroactively weaken privacy protections

Given our philosophy, changes would only strengthen privacy, not diminish it.

---

## Contact

Questions about privacy? Open an issue on GitHub or email us at the domain localforge.org.

---

## The Bottom Line

**We built this extension for ourselves and people who value privacy.** We're not a company trying to monetize your attention or data. We're developers who wanted a bookmark tool that respects user autonomy.

In the spirit of Open Garden:
- **Protocols over platforms** — Your data, your storage, your control
- **Privacy as dignity** — We refuse to treat your behavior as an extractable resource
- **Right to repair** — Open source, auditable, forkable
- **Built for humans** — Not for advertisers, not for metrics, not for growth

*Your bookmarks are yours. That's not a feature—it's the whole point.*

# Bookmarks by Localforge

A browser extension for Chrome and Firefox that captures web pages as bookmarks, extracts readable content, and enables semantic search using RAG (Retrieval-Augmented Generation). All data is stored locally in your browser.

Download for **[Firefox](https://addons.mozilla.org/en-US/firefox/addon/bookmarks-localforge/)** or **[Chrome](https://chromewebstore.google.com/detail/bookmark-rag/ookiidhdklbobjnobjocokffmmlphjpi)**

## Screenshots

| Popup | Library | Search |
|-------|---------|--------|
| ![Popup](landing/screenshot-popup.png) | ![Library](landing/screenshot-explore.png) | ![Search](landing/screenshot-search.png) |

## Features

- **One-click capture** — Save URL, title, and full DOM HTML with a click or keyboard shortcut
- **Content extraction** — Converts HTML to Markdown using Mozilla's Readability
- **Q&A generation** — LLM generates question-answer pairs for each bookmark
- **Semantic search** — Search bookmarks by meaning using embeddings
- **Tag organization** — Flat organization with tags; click to filter, type to create
- **Stumble mode** — Randomly surface bookmarks you may have forgotten
- **Health indicator** — Visual status shows processing state; click for diagnostics
- **Jobs dashboard** — Monitor processing jobs with status and progress
- **Bulk URL import** — Import multiple bookmarks at once with validation
- **Import/Export** — Backup and restore bookmarks as JSON files
- **WebDAV sync** — Sync bookmarks across devices using your own WebDAV server
- **Configurable API** — Use OpenAI or any compatible endpoint (local models included)

## Installation

### Prerequisites

- Node.js 18+ and npm
- Chrome or Firefox browser
- OpenAI API key (or compatible API endpoint)

### Build Steps

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Build the extension**:
   ```bash
   npm run build
   ```

   This creates a `dist/` folder with the built extension.

### Load in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the `dist` folder

### Load in Firefox

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Navigate to the `dist` folder and select `manifest.json`

### Web Version

A standalone web version is available for testing without installing the extension:

```bash
npm run dev:web
```

Or try the hosted demo at [bookmarks.localforge.org](https://bookmarks.localforge.org).

## Configuration

1. Click the extension icon and select "Settings"
2. Configure your API settings:
   - **API Base URL**: Default is `https://api.openai.com/v1`
   - **API Key**: Your OpenAI API key
   - **Chat Model**: Model for Q&A generation (e.g., `gpt-4o-mini`)
   - **Embedding Model**: Model for embeddings (e.g., `text-embedding-3-small`)
3. Click "Test Connection" to verify your settings
4. Click "Save Settings"

### Using Local Models

The extension works with any OpenAI-compatible API server (vLLM, llama.cpp, etc.):

1. Set **API Base URL** to your local endpoint (e.g., `http://localhost:1234/v1`)
2. Set **API Key** to any non-empty string (many local servers don't require a key)
3. Set model names that your local server supports

## Usage

### Saving Bookmarks

**Method 1: Extension Icon**
1. Navigate to any web page
2. Click the extension icon
3. Click "Save This Page"

**Method 2: Keyboard Shortcut**
- Windows/Linux: `Ctrl+Shift+B`
- Mac: `Cmd+Shift+B`

### Browsing Bookmarks

1. Click the extension icon
2. Click "Explore Bookmarks"
3. View bookmarks with their processing status:
   - **Pending**: Waiting to be processed
   - **Processing**: Currently being processed
   - **Complete**: Ready to search
   - **Error**: Processing failed (can retry)

### Searching Bookmarks

1. Open the Search view
2. Enter a search query
3. Results are ranked by semantic similarity
4. Click any result to view the full bookmark details

### Using Tags

- Click any tag pill to filter bookmarks by that tag
- In bookmark details, type in the tag input to add new tags
- Tags are flat (no hierarchy) and use lowercase with hyphens

### Stumble Mode

1. Open the Stumble view
2. See 10 random bookmarks with a Q&A preview
3. Click "Shuffle" for a new random selection
4. Filter by tags to stumble within a topic

### Bulk Importing URLs

1. Open Settings
2. Scroll to "Bulk Import URLs"
3. Paste a list of URLs (one per line)
4. Click "Import URLs"
5. Monitor progress in the Jobs dashboard

### WebDAV Sync

1. Open Settings
2. Enable WebDAV sync
3. Enter your WebDAV server URL, username, and password
4. Set a sync path (default: `/bookmarks`)
5. Sync happens automatically when bookmarks change

### Import/Export Bookmarks

**Export:**
1. Open Settings
2. Click "Export All Bookmarks"
3. A JSON file will be downloaded

**Import:**
1. Open Settings
2. Click "Choose File to Import"
3. Select a previously exported JSON file
4. Duplicate URLs are skipped automatically

## How It Works

### Processing Pipeline

When you save a bookmark:

1. **Capture**: Full page HTML is captured and saved locally
2. **Extract**: Readability extracts the main content and converts to Markdown
3. **Generate Q&A**: LLM generates 5-10 question-answer pairs about the content
4. **Embed**: Each Q&A pair is converted to embeddings (question, answer, and combined)
5. **Index**: Everything is stored in IndexedDB

### Search Algorithm

When you search:

1. Your query is converted to an embedding
2. Cosine similarity is computed against all stored Q&A embeddings
3. Results are ranked by similarity score
4. Top results are grouped by bookmark and displayed

## Data Storage

- All bookmarks are stored locally in your browser's IndexedDB
- Only the extracted Markdown content is sent to your configured API for processing
- No data is sent to any third-party servers (except your configured LLM API)
- WebDAV sync sends bookmark data to your own server
- Export your data anytime as JSON files

## Development

```bash
# Development mode (Chrome)
npm run dev:chrome

# Development mode (Firefox)
npm run dev:firefox

# Development mode (Web)
npm run dev:web

# Run unit tests
npm run test:unit

# Run all tests
npm run test:all
```

## Security

Send us an email with the title of this section at localforge.org. We don't have a GPG key configured, but will monitor and answer fast (as of late 2025).

Here are some attack vectors we considered from web content pages:

- XSS via bookmark title: use textContent always when displaying `title`
- XSS via bookmark content: use lib DOMPurify to sanitize
- URL injection: only allow http/https protocols
- Content script injection: captured HTML goes through Readability + DOMPurify
- Stored XSS via IndexedDB: unlikely, but avoid innerHTML at all cost and always try to use DOM libs, even for already stored contend, and never display captured HTML

## License

MIT

## Credits

Built using:
- [Dexie.js](https://dexie.org/) for IndexedDB
- [@mozilla/readability](https://github.com/mozilla/readability) for content extraction
- [Turndown](https://github.com/mixmark-io/turndown) for HTML to Markdown conversion
- [Vite](https://vitejs.dev/) and [@crxjs/vite-plugin](https://crxjs.dev/vite-plugin) for building

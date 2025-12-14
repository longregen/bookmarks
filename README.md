# Bookmark RAG Browser Extension

A browser extension for Chrome and Firefox that captures web pages as bookmarks, extracts readable content, and enables semantic search across your bookmark collection using RAG (Retrieval-Augmented Generation).

## Features

- **One-click bookmark capture** — Save URL, title, and full DOM HTML
- **Automatic content extraction** — Converts HTML to Markdown using Mozilla's Readability
- **Q&A generation** — LLM generates question-answer pairs for each bookmark
- **Embedding-based search** — Semantically search your bookmarks
- **Configurable API** — Use your own OpenAI-compatible endpoint

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

   This will create a `dist/` folder with the built extension.

### Load in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the `dist` folder

### Load in Firefox

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Navigate to the `dist` folder and select `manifest.json`

## Configuration

1. Click the extension icon and select "Settings" (or right-click > Options)
2. Configure your API settings:
   - **API Base URL**: Default is `https://api.openai.com/v1`
   - **API Key**: Your OpenAI API key (starts with `sk-`)
   - **Chat Model**: Model for Q&A generation (e.g., `gpt-4o-mini`)
   - **Embedding Model**: Model for embeddings (e.g., `text-embedding-3-small`)
3. Click "Test Connection" to verify your settings
4. Click "Save Settings"

### Using Local Models

You can use local LLM servers that are OpenAI-compatible (like LM Studio, Ollama with OpenAI compatibility, etc.):

1. Set **API Base URL** to your local endpoint (e.g., `http://localhost:1234/v1`)
2. Set **API Key** to any non-empty string (many local servers don't require a real key)
3. Set appropriate model names that your local server supports

## Usage

### Saving Bookmarks

**Method 1: Extension Icon**
1. Navigate to any web page
2. Click the Bookmark RAG extension icon
3. Click "Save This Page"
4. You'll see a confirmation message

**Method 2: Keyboard Shortcut**
- Windows/Linux: `Ctrl+Shift+B`
- Mac: `Cmd+Shift+B`

### Browsing Bookmarks

1. Click the extension icon
2. Click "Explore Bookmarks"
3. View your bookmarks with their processing status:
   - **Pending**: Waiting to be processed
   - **Processing**: Currently being processed
   - **Complete**: Ready to search
   - **Error**: Processing failed (can retry)

### Searching Bookmarks

1. Open the Explore view
2. Enter a search query in the search box
3. Click "Search"
4. Results are ranked by semantic similarity
5. Click any result to view the full bookmark details

## How It Works

### Processing Pipeline

When you save a bookmark, the following happens automatically:

1. **Capture**: The full page HTML is captured and saved locally
2. **Extract**: Readability extracts the main content and converts to Markdown
3. **Generate Q&A**: An LLM generates 5-10 question-answer pairs about the content
4. **Embed**: Each Q&A pair is converted to three embeddings:
   - Question only
   - Answer only
   - Question + Answer combined
5. **Index**: Everything is stored in IndexedDB for fast local access

### Search Algorithm

When you search:

1. Your query is converted to an embedding using the same model
2. Cosine similarity is computed against all stored Q&A embeddings
3. Results are ranked by similarity score
4. Top results are grouped by bookmark and displayed

## Development

### Project Structure

```
bookmark-rag-extension/
├── manifest.json           # Extension manifest
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
├── vite.config.ts         # Vite build config
├── src/
│   ├── db/
│   │   └── schema.ts      # Dexie database schema
│   ├── lib/
│   │   ├── api.ts         # API client
│   │   ├── extract.ts     # Content extraction
│   │   ├── settings.ts    # Settings management
│   │   └── similarity.ts  # Similarity search
│   ├── background/
│   │   ├── service-worker.ts
│   │   ├── queue.ts       # Processing queue
│   │   └── processor.ts   # Bookmark processor
│   ├── content/
│   │   └── capture.ts     # Page capture
│   ├── popup/             # Extension popup
│   ├── options/           # Settings page
│   └── explore/           # Bookmark browser
└── public/
    └── icons/             # Extension icons
```

### Development Mode

Run in development mode with auto-reload:

```bash
npm run dev
```

Then load the `dist` folder in your browser as described above.

### Building for Production

```bash
npm run build
```

## Privacy & Data Storage

- All bookmarks are stored **locally** in your browser's IndexedDB
- Only the extracted Markdown content is sent to your configured API
- No data is sent to any third-party servers (except your configured LLM API)
- You control which API endpoint is used

## Troubleshooting

### Extension doesn't load
- Make sure you ran `npm run build`
- Check that the `dist` folder exists
- Verify you're loading the correct folder

### Bookmarks stuck in "Pending"
- Check your API settings in Options
- Click "Test Connection" to verify
- Check the browser console for errors

### Search returns no results
- Wait for bookmarks to finish processing (status: "Complete")
- Try different search terms
- Check that embeddings were generated (view bookmark details)

### API errors
- Verify your API key is correct
- Check API base URL format (should end with `/v1`)
- Ensure you have API credits available
- Check rate limits on your API

## License

MIT

## Credits

Built using:
- [Dexie.js](https://dexie.org/) for IndexedDB
- [@mozilla/readability](https://github.com/mozilla/readability) for content extraction
- [Turndown](https://github.com/mixmark-io/turndown) for HTML to Markdown conversion
- [Vite](https://vitejs.dev/) and [@crxjs/vite-plugin](https://crxjs.dev/vite-plugin) for building

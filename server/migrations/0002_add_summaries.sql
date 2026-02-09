-- Summaries for bookmarks
CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY,
  bookmark_id TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding BLOB,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_summaries_bookmark_id ON summaries(bookmark_id);

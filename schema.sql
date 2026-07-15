CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  page_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comments_page_created
ON comments (page_slug, created_at DESC);

-- 评论限流：bucket = SHA-256("tinyneed-rl:"+IP) 前 16 字节 hex；expires_at = unixepoch() 窗口过期时间。
CREATE TABLE IF NOT EXISTS comment_rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

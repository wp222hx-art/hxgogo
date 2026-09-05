-- 开奖来源标记：qkltj 官方 / chain 链上补齐；补齐日志
ALTER TABLE draws ADD COLUMN src TEXT NOT NULL DEFAULT 'qkltj';
CREATE TABLE IF NOT EXISTS gap_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, expect TEXT NOT NULL, method TEXT NOT NULL, block INTEGER, ok INTEGER NOT NULL, detail TEXT, created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gap_log_src ON gap_log(source, created_ms DESC);

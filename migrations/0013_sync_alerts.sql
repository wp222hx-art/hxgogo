-- 拉取断流告警：连续失败/漏期记录
CREATE TABLE IF NOT EXISTS sync_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL, kind TEXT NOT NULL,   -- fetch_fail | stale | recovered
  detail TEXT, created_ms INTEGER NOT NULL, resolved_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sync_alerts_src ON sync_alerts(source, created_ms DESC);
ALTER TABLE sync_meta ADD COLUMN fail_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_meta ADD COLUMN last_fail_ms INTEGER;

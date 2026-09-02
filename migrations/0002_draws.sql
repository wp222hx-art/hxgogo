-- 外部开奖数据（qkltj 等）+ 本地 5 位数厅归档，统一格式便于分析
CREATE TABLE IF NOT EXISTS draws (
  source TEXT NOT NULL,         -- qkltj:6001 / qkltj:6002 / ... / local:ffc
  expect TEXT NOT NULL,         -- 期号
  block INTEGER,
  hash TEXT NOT NULL,
  n1 INTEGER NOT NULL, n2 INTEGER NOT NULL, n3 INTEGER NOT NULL, n4 INTEGER NOT NULL, n5 INTEGER NOT NULL,
  open_ms INTEGER NOT NULL,
  PRIMARY KEY (source, expect)
);
CREATE INDEX IF NOT EXISTS idx_draws_src_time ON draws(source, open_ms DESC);

-- 同步元数据
CREATE TABLE IF NOT EXISTS sync_meta (
  source TEXT PRIMARY KEY,
  last_sync_ms INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

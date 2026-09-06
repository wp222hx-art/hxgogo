-- AI 多组独立生成：每档注数 5 组（A 融合 / B 定位 / C 量化 / D 聚焦 / E 互补），号码存 arena_rounds(strategy='ai-set-{N}-{id}')，此表存元数据
CREATE TABLE IF NOT EXISTS ai_sets (
  source TEXT NOT NULL,
  expect TEXT NOT NULL,
  n INTEGER NOT NULL,
  set_id TEXT NOT NULL,
  overlap_a INTEGER,            -- 与 A 组（主推）重叠的号码数
  created_ms INTEGER NOT NULL,
  PRIMARY KEY (source, expect, n, set_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_sets_src_exp ON ai_sets(source, expect DESC);

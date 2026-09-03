-- 量化选号器战绩追踪：每期 Top-N 快照（开奖前锁定）+ 开奖后自动评分
CREATE TABLE IF NOT EXISTS pick_log (
  source TEXT NOT NULL,
  expect TEXT NOT NULL,             -- 目标期号（预选给哪一期）
  count INTEGER NOT NULL,           -- N
  temp REAL NOT NULL,               -- 分散度
  based_on TEXT NOT NULL,           -- 生成时依据的最新期号
  numbers TEXT NOT NULL,            -- 空格分隔的三位号，按排名
  coverage REAL NOT NULL,           -- 生成时的量化覆盖率
  created_ms INTEGER NOT NULL,
  actual TEXT,                      -- 开奖前三位
  hit INTEGER,                      -- 1/0
  rank INTEGER,                     -- 榜内排名（未命中 NULL）
  scored_ms INTEGER,
  PRIMARY KEY (source, expect, count, temp)
);
CREATE INDEX IF NOT EXISTS idx_pick_log_src ON pick_log(source, expect DESC);
CREATE INDEX IF NOT EXISTS idx_pick_log_pending ON pick_log(source, scored_ms);

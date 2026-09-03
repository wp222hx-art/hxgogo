-- 策略竞技场：多策略每期自动生成 500 组三位号 → 开奖自动结算 → 滚动评分 → 自适应组合
CREATE TABLE IF NOT EXISTS arena_rounds (
  source TEXT NOT NULL,
  expect TEXT NOT NULL,             -- 目标期号
  strategy TEXT NOT NULL,           -- 策略 key
  mode TEXT NOT NULL DEFAULT 'live', -- live=开奖前实时锁定 / replay=历史回放（仅用目标期之前数据）
  based_on TEXT NOT NULL,           -- 依据的最新期号
  numbers TEXT NOT NULL,            -- 空格分隔 500 组三位号（按排名）
  count INTEGER NOT NULL,
  coverage REAL NOT NULL,           -- 生成时自评覆盖率（对随机策略即 N/1000）
  weight REAL NOT NULL DEFAULT 0,   -- 生成时该策略在组合中的权重（用于组合结算）
  created_ms INTEGER NOT NULL,
  actual TEXT,                      -- 实开前三位
  hit INTEGER,
  rank INTEGER,
  pnl REAL,                         -- 每注 1 单位、赔率 ODDS 的净收益：hit ? ODDS - N : -N
  scored_ms INTEGER,
  PRIMARY KEY (source, expect, strategy)
);
CREATE INDEX IF NOT EXISTS idx_arena_src_exp ON arena_rounds(source, expect DESC);
CREATE INDEX IF NOT EXISTS idx_arena_pending ON arena_rounds(source, scored_ms);

-- 战绩榜优质策略推荐：每期锁定滚动战绩前三名及其融合权重（号码本身存 arena_rounds strategy='top3'）
CREATE TABLE IF NOT EXISTS top3_picks (
  source TEXT NOT NULL, expect TEXT NOT NULL, based_on TEXT NOT NULL,
  members TEXT NOT NULL,        -- JSON [{key, z, rate, n, w}]
  created_ms INTEGER NOT NULL,
  PRIMARY KEY (source, expect)
);

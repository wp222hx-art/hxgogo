-- AI 分析官提出的投资规则（结构化 DSL），由竞技场自动 walk-forward 回测并区分样本内 / 样本外
CREATE TABLE IF NOT EXISTS ai_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  report_expect TEXT NOT NULL,        -- 提出该规则的报告所基于的最新结算期（之后的期即为样本外）
  name TEXT NOT NULL,
  rule TEXT NOT NULL,                 -- PlanRule JSON
  rationale TEXT,
  created_ms INTEGER NOT NULL,
  retired_ms INTEGER,
  retire_reason TEXT,
  model TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_plans_source ON ai_plans(source, retired_ms);

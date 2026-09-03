-- AI 预测官：每期结构化预测 + 推理 + 复盘；分析报告
CREATE TABLE IF NOT EXISTS ai_forecasts (
  source TEXT NOT NULL, expect TEXT NOT NULL,
  model TEXT NOT NULL, based_on TEXT NOT NULL,
  output TEXT NOT NULL,            -- 结构化 JSON（pos_weights/blend/boost/avoid/confidence/regime/reasoning）
  reasoning TEXT, regime TEXT, confidence REAL,
  prompt_tokens INTEGER, completion_tokens INTEGER, latency_ms INTEGER,
  created_ms INTEGER NOT NULL, error TEXT,
  PRIMARY KEY (source, expect)
);
CREATE TABLE IF NOT EXISTS ai_reports (
  source TEXT NOT NULL, expect TEXT NOT NULL, model TEXT NOT NULL,
  report TEXT NOT NULL, prompt_tokens INTEGER, completion_tokens INTEGER, latency_ms INTEGER, created_ms INTEGER NOT NULL,
  PRIMARY KEY (source, expect)
);

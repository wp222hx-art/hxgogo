-- 运行时配置（AI 供应商 key / 模型 / 报单窗口等），覆盖环境变量；由 /settings 页面维护
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_ms INTEGER NOT NULL
);

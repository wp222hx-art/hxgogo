-- 报单同步审计：每期 AI 锁定时刻相对上期开奖 / 本期开奖的位置
ALTER TABLE ai_forecasts ADD COLUMN lock_by_ms INTEGER;      -- 本期报单截止（目标开奖 − AI_LEAD_MS）
ALTER TABLE ai_forecasts ADD COLUMN started_ms INTEGER;      -- 开始推理时刻
ALTER TABLE ai_forecasts ADD COLUMN trigger TEXT;            -- 触发来源：page | heartbeat | pick

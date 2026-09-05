-- DeepSeek 思考模式返回的思维链（reasoning_content），与面向用户的 reasoning 分开存
ALTER TABLE ai_forecasts ADD COLUMN cot TEXT;
ALTER TABLE ai_forecasts ADD COLUMN reasoning_tokens INTEGER;

-- 严格保存 qkltj 接口原始字段，保证与官方一致
ALTER TABLE draws ADD COLUMN opennumber TEXT;      -- 官方运算结果原文，如 "7,2,6,0,3"
ALTER TABLE draws ADD COLUMN lotto_type TEXT;      -- lottoType 原文，如 trxbhffc
ALTER TABLE draws ADD COLUMN lotto_type_cn TEXT;   -- lottoTypeCn 原文
ALTER TABLE draws ADD COLUMN open_time TEXT;       -- openTime 原文（UTC+8 字串）
ALTER TABLE draws ADD COLUMN src_id INTEGER;       -- 接口 id
ALTER TABLE draws ADD COLUMN mismatch INTEGER NOT NULL DEFAULT 0; -- 官方 opennumber 与哈希推算不一致时=1

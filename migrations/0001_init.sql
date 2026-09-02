-- 虚拟积分用户
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  nickname TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 10000,
  total_bet INTEGER NOT NULL DEFAULT 0,
  total_win INTEGER NOT NULL DEFAULT 0,
  bet_count INTEGER NOT NULL DEFAULT 0,
  last_claim_ms INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL
);

-- 每一局（room: tron=真实TRON区块哈希厅, seed=服务端种子哈希厅）
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  close_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',       -- open | settling | settled | void
  server_seed TEXT,                           -- seed 厅：开奖后公开
  commitment TEXT,                            -- seed 厅：sha256(server_seed)，开局即公开
  bets_hash TEXT,                             -- 本局所有注单ID的 sha256（客户端种子）
  block_number INTEGER,                       -- tron 厅：开奖区块高度
  block_ts INTEGER,                           -- tron 厅：区块时间戳
  result_hash TEXT,                           -- 最终开奖哈希
  digit1 INTEGER,                             -- 尾数（从右数第1个数字）= 闲
  digit2 INTEGER,                             -- 从右数第2个数字 = 庄
  outcomes TEXT,                              -- JSON: {parity,size,bp,chartype,lucky}
  bet_total INTEGER NOT NULL DEFAULT 0,
  payout_total INTEGER NOT NULL DEFAULT 0,
  settling_ms INTEGER,
  settled_ms INTEGER,
  UNIQUE(room, round_no)
);
CREATE INDEX IF NOT EXISTS idx_rounds_room_status ON rounds(room, status, end_ms);
CREATE INDEX IF NOT EXISTS idx_rounds_room_no ON rounds(room, round_no DESC);

-- 注单
CREATE TABLE IF NOT EXISTS bets (
  id TEXT PRIMARY KEY,
  round_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  room TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  bet_type TEXT NOT NULL,      -- parity | size | bp | chartype | lucky
  selection TEXT NOT NULL,     -- odd/even, big/small, banker/player/tie, digit/letter, 0-9
  amount INTEGER NOT NULL,
  odds REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | win | lose | refund
  payout INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL,
  FOREIGN KEY (round_id) REFERENCES rounds(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_bets_round ON bets(round_id);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id, created_ms DESC);

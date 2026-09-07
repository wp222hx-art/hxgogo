CREATE TABLE paper_bots (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,source TEXT NOT NULL,origin TEXT NOT NULL,strategy TEXT NOT NULL,version TEXT NOT NULL,count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 1000),
 config_json TEXT NOT NULL CHECK(json_valid(config_json)),created_ms INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('running','paused','stopped')),
 reason TEXT,control_revision INTEGER NOT NULL DEFAULT 1,reset_ms INTEGER NOT NULL DEFAULT 0,last_tick_ms INTEGER
);
CREATE INDEX paper_bots_source_active ON paper_bots(source,status);
CREATE TABLE paper_orders (
 id TEXT PRIMARY KEY,bot_id TEXT NOT NULL REFERENCES paper_bots(id),sequence INTEGER NOT NULL,expect TEXT NOT NULL,numbers TEXT NOT NULL CHECK(json_valid(numbers)),
 unit_cents INTEGER NOT NULL CHECK(unit_cents>0),stake_cents INTEGER NOT NULL CHECK(stake_cents>0),level INTEGER NOT NULL,branch TEXT NOT NULL,cutoff_ms INTEGER NOT NULL,created_ms INTEGER NOT NULL,
 source_revision TEXT NOT NULL,bot_revision INTEGER NOT NULL,UNIQUE(bot_id,expect),UNIQUE(bot_id,sequence)
);
CREATE TABLE paper_settlements (order_id TEXT PRIMARY KEY REFERENCES paper_orders(id),actual TEXT,payout_cents INTEGER,settled_ms INTEGER NOT NULL);
CREATE TABLE paper_events(id INTEGER PRIMARY KEY AUTOINCREMENT,bot_id TEXT NOT NULL REFERENCES paper_bots(id),kind TEXT NOT NULL,message TEXT NOT NULL,created_ms INTEGER NOT NULL);
CREATE TRIGGER paper_bot_identity BEFORE UPDATE ON paper_bots
WHEN OLD.source IS NOT NEW.source OR OLD.origin IS NOT NEW.origin OR OLD.strategy IS NOT NEW.strategy OR OLD.version IS NOT NEW.version OR OLD.count IS NOT NEW.count OR OLD.config_json IS NOT NEW.config_json OR OLD.created_ms IS NOT NEW.created_ms
BEGIN SELECT RAISE(ABORT,'PAPER_CONFIG_IMMUTABLE'); END;
CREATE TRIGGER paper_order_insert_guard BEFORE INSERT ON paper_orders BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM paper_bots WHERE id=NEW.bot_id AND status='running' AND control_revision=NEW.bot_revision) THEN RAISE(ABORT,'PAPER_STATE_CHANGED') END;
 SELECT CASE WHEN NEW.sequence<>(SELECT COUNT(*)+1 FROM paper_orders WHERE bot_id=NEW.bot_id) THEN RAISE(ABORT,'PAPER_LEDGER_CHANGED') END;
 SELECT CASE WHEN NEW.created_ms>=NEW.cutoff_ms OR CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)>=NEW.cutoff_ms OR EXISTS(SELECT 1 FROM draws d JOIN paper_bots b ON b.source=d.source WHERE b.id=NEW.bot_id AND d.expect=NEW.expect) THEN RAISE(ABORT,'PAPER_CUTOFF') END;
 SELECT CASE WHEN NEW.source_revision IS NOT (SELECT r.source_id||':'||r.revision FROM atlas_source_revisions r JOIN paper_bots b ON b.source=r.source_id WHERE b.id=NEW.bot_id) THEN RAISE(ABORT,'PAPER_DATA_CHANGED') END;
 SELECT CASE WHEN json_array_length(NEW.numbers)<>(SELECT count FROM paper_bots WHERE id=NEW.bot_id) OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.numbers))<>json_array_length(NEW.numbers) OR EXISTS(SELECT 1 FROM json_each(NEW.numbers) WHERE type<>'text' OR length(value)<>3 OR value GLOB '*[^0-9]*') THEN RAISE(ABORT,'PAPER_NUMBERS') END;
 SELECT CASE WHEN NEW.stake_cents<>NEW.unit_cents*(SELECT count FROM paper_bots WHERE id=NEW.bot_id) THEN RAISE(ABORT,'PAPER_STAKE') END;
END;
CREATE TRIGGER paper_order_update BEFORE UPDATE ON paper_orders BEGIN SELECT RAISE(ABORT,'PAPER_ORDER_IMMUTABLE'); END;
CREATE TRIGGER paper_order_delete BEFORE DELETE ON paper_orders BEGIN SELECT RAISE(ABORT,'PAPER_ORDER_IMMUTABLE'); END;

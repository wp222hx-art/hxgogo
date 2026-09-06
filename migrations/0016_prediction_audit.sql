-- Prediction provenance starts here. Existing rows remain readable but unverified.
ALTER TABLE arena_rounds ADD COLUMN prediction_version TEXT NOT NULL DEFAULT 'legacy-unverified';
ALTER TABLE arena_rounds ADD COLUMN cutoff_ms INTEGER;
ALTER TABLE arena_rounds ADD COLUMN prediction_status TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE pick_log ADD COLUMN prediction_version TEXT NOT NULL DEFAULT 'legacy-unverified';
ALTER TABLE pick_log ADD COLUMN cutoff_ms INTEGER;
ALTER TABLE pick_log ADD COLUMN prediction_status TEXT NOT NULL DEFAULT 'legacy';
CREATE INDEX IF NOT EXISTS idx_arena_audit ON arena_rounds(source,prediction_status,expect);
CREATE INDEX IF NOT EXISTS idx_pick_audit ON pick_log(source,prediction_status,expect);

-- Predictions are immutable; result corrections may update settlement columns only.
CREATE TRIGGER IF NOT EXISTS arena_prediction_immutable_update
BEFORE UPDATE OF source,expect,strategy,mode,based_on,numbers,count,coverage,weight,created_ms,prediction_version,cutoff_ms,prediction_status ON arena_rounds
BEGIN SELECT RAISE(ABORT,'Prediction snapshots are immutable'); END;
CREATE TRIGGER IF NOT EXISTS arena_prediction_immutable_delete
BEFORE DELETE ON arena_rounds
BEGIN SELECT RAISE(ABORT,'Prediction snapshots are immutable'); END;
CREATE TRIGGER IF NOT EXISTS pick_prediction_immutable_update
BEFORE UPDATE OF source,expect,count,temp,based_on,numbers,coverage,created_ms,prediction_version,cutoff_ms,prediction_status ON pick_log
BEGIN SELECT RAISE(ABORT,'Prediction snapshots are immutable'); END;
CREATE TRIGGER IF NOT EXISTS pick_prediction_immutable_delete
BEFORE DELETE ON pick_log
BEGIN SELECT RAISE(ABORT,'Prediction snapshots are immutable'); END;

-- Reject records claiming live provenance after the scheduled cutoff or known draw.
CREATE TRIGGER IF NOT EXISTS arena_prediction_live_insert
BEFORE INSERT ON arena_rounds
WHEN NEW.prediction_status='live' AND (
  NEW.mode<>'live' OR NEW.prediction_version='legacy-unverified' OR NEW.cutoff_ms IS NULL OR NEW.created_ms>=NEW.cutoff_ms
  OR EXISTS(SELECT 1 FROM draws WHERE source=NEW.source AND expect=NEW.expect))
BEGIN SELECT RAISE(ABORT,'Live prediction must precede its draw'); END;
CREATE TRIGGER IF NOT EXISTS pick_prediction_live_insert
BEFORE INSERT ON pick_log
WHEN NEW.prediction_status='live' AND (
  NEW.prediction_version='legacy-unverified' OR NEW.cutoff_ms IS NULL OR NEW.created_ms>=NEW.cutoff_ms
  OR EXISTS(SELECT 1 FROM draws WHERE source=NEW.source AND expect=NEW.expect))
BEGIN SELECT RAISE(ABORT,'Live prediction must precede its draw'); END;

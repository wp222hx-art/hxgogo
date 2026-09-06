-- Durable change tokens only: official records remain in the existing canonical draws table.
CREATE TABLE IF NOT EXISTS atlas_source_revisions (
  source_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  updated_at INTEGER NOT NULL
);
INSERT INTO atlas_source_revisions(source_id,revision,updated_at)
  SELECT source,COUNT(*),CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) FROM draws GROUP BY source;
INSERT INTO atlas_source_revisions(source_id,revision,updated_at)
  SELECT source_id,COUNT(*),CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) FROM atlas_records GROUP BY source_id
  ON CONFLICT(source_id) DO UPDATE SET revision=revision+excluded.revision;

CREATE TRIGGER atlas_draws_revision_insert AFTER INSERT ON draws
BEGIN
  INSERT INTO atlas_source_revisions(source_id,revision,updated_at) VALUES(NEW.source,1,CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(source_id) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER atlas_draws_revision_delete AFTER DELETE ON draws
BEGIN
  INSERT INTO atlas_source_revisions(source_id,revision,updated_at) VALUES(OLD.source,1,CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(source_id) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER atlas_draws_revision_update AFTER UPDATE ON draws
WHEN OLD.source IS NOT NEW.source OR
  OLD.expect IS NOT NEW.expect OR
  OLD.block IS NOT NEW.block OR
  OLD.hash IS NOT NEW.hash OR
  OLD.n1 IS NOT NEW.n1 OR
  OLD.n2 IS NOT NEW.n2 OR
  OLD.n3 IS NOT NEW.n3 OR
  OLD.n4 IS NOT NEW.n4 OR
  OLD.n5 IS NOT NEW.n5 OR
  OLD.open_ms IS NOT NEW.open_ms OR
  OLD.opennumber IS NOT NEW.opennumber OR
  OLD.lotto_type IS NOT NEW.lotto_type OR
  OLD.lotto_type_cn IS NOT NEW.lotto_type_cn OR
  OLD.open_time IS NOT NEW.open_time OR
  OLD.src_id IS NOT NEW.src_id OR
  OLD.mismatch IS NOT NEW.mismatch OR
  OLD.src IS NOT NEW.src
BEGIN
  INSERT INTO atlas_source_revisions(source_id,revision,updated_at) VALUES(OLD.source,1,CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(source_id) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
  INSERT INTO atlas_source_revisions(source_id,revision,updated_at)
    SELECT NEW.source,1,CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE NEW.source IS NOT OLD.source
    ON CONFLICT(source_id) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;

CREATE TRIGGER atlas_atlas_records_revision_insert AFTER INSERT ON atlas_records
BEGIN
  INSERT INTO atlas_source_revisions(source_id,revision,updated_at) VALUES(NEW.source_id,1,CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(source_id) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER atlas_atlas_records_revision_delete AFTER DELETE ON atlas_records
BEGIN
  INSERT INTO atlas_source_revisions(source_id,revision,updated_at) VALUES(OLD.source_id,1,CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(source_id) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER atlas_atlas_records_revision_update AFTER UPDATE ON atlas_records
WHEN OLD.source_id IS NOT NEW.source_id OR
  OLD.record_key IS NOT NEW.record_key OR
  OLD.schema_id IS NOT NEW.schema_id OR
  OLD.kind IS NOT NEW.kind OR
  OLD.record_json IS NOT NEW.record_json OR
  OLD.draw_at IS NOT NEW.draw_at OR
  OLD.observed_at IS NOT NEW.observed_at
BEGIN
  INSERT INTO atlas_source_revisions(source_id,revision,updated_at) VALUES(OLD.source_id,1,CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(source_id) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
  INSERT INTO atlas_source_revisions(source_id,revision,updated_at)
    SELECT NEW.source_id,1,CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE NEW.source_id IS NOT OLD.source_id
    ON CONFLICT(source_id) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;

-- Independent atlas imports and UI workspace. Existing draw/prediction tables are untouched.
CREATE TABLE IF NOT EXISTS atlas_records (
  source_id TEXT NOT NULL CHECK(source_id LIKE 'local:%'),
  record_key TEXT NOT NULL,
  schema_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('draw','event')),
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  draw_at INTEGER,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY(source_id,record_key)
);
CREATE INDEX IF NOT EXISTS idx_atlas_records_time ON atlas_records(source_id,draw_at DESC,observed_at DESC);
CREATE TABLE IF NOT EXISTS atlas_workspace (
  id TEXT PRIMARY KEY CHECK(id='default'),
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  updated_at INTEGER NOT NULL
);

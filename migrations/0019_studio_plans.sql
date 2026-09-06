CREATE TABLE studio_plans (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, expect TEXT NOT NULL,
 recipe TEXT NOT NULL, version TEXT NOT NULL, count INTEGER NOT NULL CHECK(count IN (100,150,300,500)),
 numbers TEXT NOT NULL CHECK(json_valid(numbers)), based_on TEXT NOT NULL,
 input_revision TEXT NOT NULL, input_count INTEGER NOT NULL, created_ms INTEGER NOT NULL,
 cutoff_ms INTEGER NOT NULL, score_mass REAL,
 UNIQUE(source,expect,recipe,version,count)
);
CREATE INDEX studio_plans_source_period ON studio_plans(source,expect DESC);
CREATE TABLE studio_annotations (
 plan_id TEXT PRIMARY KEY REFERENCES studio_plans(id), note TEXT NOT NULL DEFAULT '',
 pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)), updated_ms INTEGER NOT NULL
);
CREATE TRIGGER studio_plans_insert_guard BEFORE INSERT ON studio_plans
BEGIN
 SELECT CASE WHEN NEW.created_ms>=NEW.cutoff_ms OR
 CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)>=NEW.cutoff_ms OR
 NEW.created_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+1000 OR
 EXISTS(SELECT 1 FROM draws WHERE source=NEW.source AND expect=NEW.expect)
 THEN RAISE(ABORT,'STUDIO_CUTOFF') END;
 SELECT CASE WHEN NEW.input_revision IS NOT (SELECT source_id||':'||revision FROM atlas_source_revisions WHERE source_id=NEW.source)
 THEN RAISE(ABORT,'STUDIO_REVISION') END;
 SELECT CASE WHEN json_array_length(NEW.numbers)<>NEW.count OR
 (SELECT COUNT(DISTINCT value) FROM json_each(NEW.numbers))<>NEW.count OR
 EXISTS(SELECT 1 FROM json_each(NEW.numbers) WHERE type<>'text' OR length(value)<>3 OR value GLOB '*[^0-9]*')
 THEN RAISE(ABORT,'STUDIO_NUMBERS') END;
END;
CREATE TRIGGER studio_plans_immutable_update BEFORE UPDATE ON studio_plans
BEGIN SELECT RAISE(ABORT,'STUDIO_IMMUTABLE'); END;
CREATE TRIGGER studio_plans_immutable_delete BEFORE DELETE ON studio_plans
BEGIN SELECT RAISE(ABORT,'STUDIO_IMMUTABLE'); END;

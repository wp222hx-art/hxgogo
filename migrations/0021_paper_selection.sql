-- New robots keep the selected research tier fixed. Existing robots retain their legacy selection.
ALTER TABLE paper_bots ADD COLUMN base_count INTEGER CHECK(base_count IS NULL OR base_count BETWEEN count AND 1000);
CREATE TRIGGER paper_bot_selection_identity BEFORE UPDATE OF base_count ON paper_bots
WHEN OLD.base_count IS NOT NEW.base_count
BEGIN SELECT RAISE(ABORT,'PAPER_CONFIG_IMMUTABLE'); END;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE,
  name TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 16),
  name_key TEXT UNIQUE,
  stats TEXT NOT NULL DEFAULT '{}',
  achievements TEXT NOT NULL DEFAULT '[]',
  last_score INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scores (
  player_id TEXT NOT NULL REFERENCES players(id),
  map TEXT NOT NULL CHECK (map IN ('home','windermere','sherwood','burger','beachclub','noodle','snowvalley','refinery')),
  car TEXT NOT NULL CHECK (length(car) BETWEEN 1 AND 20),
  time_ms INTEGER NOT NULL CHECK (time_ms BETWEEN 5000 AND 3600000),
  crashes INTEGER NOT NULL CHECK (crashes BETWEEN 0 AND 999),
  PRIMARY KEY (player_id, map)
);
CREATE INDEX IF NOT EXISTS scores_map_time ON scores(map, time_ms, player_id);

CREATE TRIGGER IF NOT EXISTS score_guard BEFORE INSERT ON scores BEGIN
  SELECT RAISE(ABORT, 'name_required') WHERE (SELECT name FROM players WHERE id = NEW.player_id) IS NULL;
  SELECT RAISE(ABORT, 'score_rate_limit') WHERE (SELECT last_score FROM players WHERE id = NEW.player_id) > unixepoch() - 10;
  UPDATE players SET last_score = unixepoch() WHERE id = NEW.player_id;
END;

CREATE TRIGGER IF NOT EXISTS fixed_name BEFORE UPDATE OF name ON players
WHEN OLD.name IS NOT NULL AND NEW.name IS NOT OLD.name BEGIN
  SELECT RAISE(ABORT, 'name_locked');
END;

CREATE TABLE IF NOT EXISTS request_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS request_limits_expiry ON request_limits(expires);

-- SQLite schema for the hall HVAC app. Recreated from scratch by `npm run seed`.
PRAGMA foreign_keys = ON;

CREATE TABLE sites (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  city      TEXT NOT NULL,
  timezone  TEXT NOT NULL
);

-- One row per hall. The physical model (checker `Instance` keys) is stored as JSON
-- objects; the per-step arrays live in hall_steps and schedule_steps.
CREATE TABLE halls (
  id                  TEXT PRIMARY KEY,
  site_id             TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  notes               TEXT,
  timezone            TEXT NOT NULL,
  start_utc           TEXT NOT NULL,             -- ISO instant of step 0
  dt_minutes          INTEGER NOT NULL,
  steps               INTEGER NOT NULL,          -- horizon.steps (N)
  dt_hours            REAL NOT NULL,             -- horizon.dt_hours
  constants_json      TEXT NOT NULL CHECK (json_valid(constants_json)),
  room_json           TEXT NOT NULL CHECK (json_valid(room_json)),
  hvac_json           TEXT NOT NULL CHECK (json_valid(hvac_json)),
  initial_state_json  TEXT NOT NULL CHECK (json_valid(initial_state_json)),
  comfort_json        TEXT CHECK (comfort_json IS NULL OR json_valid(comfort_json)),
  shifts_json         TEXT CHECK (shifts_json IS NULL OR json_valid(shifts_json))
);
CREATE INDEX halls_site ON halls(site_id);

-- Steps 0 … N of a hall. Row k holds the inputs of step k (series, NULL at k = N) and the
-- state-point values at the start of step k (bounds, measured), which have N+1 entries.
CREATE TABLE hall_steps (
  hall_id                  TEXT NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  step                     INTEGER NOT NULL,
  ts_utc                   TEXT NOT NULL,       -- ISO instant at the start of the step
  local_date               TEXT NOT NULL,       -- YYYY-MM-DD in the hall's timezone
  local_time               TEXT NOT NULL,       -- HH:MM in the hall's timezone
  utc_offset_min           INTEGER NOT NULL,
  price_eur_per_mwh        REAL,
  outdoor_temp_c           REAL,
  internal_heat_kw         REAL,
  co2_generation_m3_per_h  REAL,
  occupancy_persons        REAL,
  temp_min_c               REAL NOT NULL,
  temp_max_c               REAL NOT NULL,
  co2_max_ppm              REAL NOT NULL,
  measured_temperature_c   REAL,
  measured_co2_ppm         REAL,
  PRIMARY KEY (hall_id, step)
) WITHOUT ROWID;
CREATE INDEX hall_steps_date ON hall_steps(hall_id, local_date);

CREATE TABLE schedules (
  hall_id  TEXT NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,                       -- 'baseline', 'optimized', …
  PRIMARY KEY (hall_id, name)
);

CREATE TABLE schedule_steps (
  hall_id             TEXT NOT NULL,
  schedule_name       TEXT NOT NULL,
  step                INTEGER NOT NULL,
  mass_flow_kg_per_s  REAL NOT NULL,
  recirculation       REAL NOT NULL,
  heating_kw          REAL NOT NULL,
  cooling_kw          REAL NOT NULL,
  PRIMARY KEY (hall_id, schedule_name, step),
  FOREIGN KEY (hall_id, schedule_name) REFERENCES schedules(hall_id, name) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,                 -- scrypt$<salt hex>$<hash hex>
  role           TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer'))
);

CREATE TABLE user_sites (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id  TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, site_id)
);

-- Login sessions. The cookie carries a random token; only its SHA-256 is stored.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,                    -- ISO instant
  expires_at  TEXT NOT NULL                     -- ISO instant
);
CREATE INDEX sessions_user ON sessions(user_id);

-- One row per intervention of any type, with one details row in the table of its type.
-- Interventions are the history: they are never deleted, and only the revoke columns can change,
-- once. hall_id and created_by have no foreign keys and the name is a copy, so that removing a
-- hall or a user cannot erase or blank the record. Instants are ISO strings.
CREATE TABLE interventions (
  id               INTEGER PRIMARY KEY,
  hall_id          TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('maintenance')),
  reason           TEXT NOT NULL CHECK (length(trim(reason, ' ' || char(9, 10, 13))) > 0),
  created_by       TEXT NOT NULL,
  created_by_name  TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  revoked_at       TEXT,
  revoked_by       TEXT,
  revoked_by_name  TEXT,
  revoke_reason    TEXT,
  -- IS NOT NULL is spelled out because a CHECK that evaluates to NULL passes.
  CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revoked_by_name IS NULL AND revoke_reason IS NULL)
    OR (
      revoked_at IS NOT NULL AND revoked_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'
      AND revoked_by IS NOT NULL AND length(trim(revoked_by)) > 0
      AND revoked_by_name IS NOT NULL AND length(trim(revoked_by_name)) > 0
      AND revoke_reason IS NOT NULL AND length(trim(revoke_reason, ' ' || char(9, 10, 13))) > 0
    )
  )
);
CREATE INDEX interventions_hall ON interventions(hall_id, created_at);

-- INSERT OR REPLACE fires no delete or update trigger, so an existing id is refused here.
CREATE TRIGGER interventions_insert_new BEFORE INSERT ON interventions
WHEN NEW.revoked_at IS NOT NULL OR EXISTS (SELECT 1 FROM interventions WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'interventions start active and cannot be replaced');
END;

CREATE TRIGGER interventions_no_delete BEFORE DELETE ON interventions
BEGIN
  SELECT RAISE(ABORT, 'interventions cannot be deleted');
END;

CREATE TRIGGER interventions_revoke_only BEFORE UPDATE ON interventions
WHEN OLD.revoked_at IS NOT NULL
  OR NEW.id IS NOT OLD.id
  OR NEW.hall_id IS NOT OLD.hall_id
  OR NEW.type IS NOT OLD.type
  OR NEW.reason IS NOT OLD.reason
  OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_by_name IS NOT OLD.created_by_name
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'interventions can only be revoked, once');
END;

-- Every read of what is in force goes through this view, so a revoked intervention cannot leak in.
CREATE VIEW active_interventions AS SELECT * FROM interventions WHERE revoked_at IS NULL;

-- An asset of a hall is unavailable from start_utc (inclusive) to end_utc (exclusive).
-- Instants are stored as ISO strings in UTC (YYYY-MM-DDTHH:MM:SS.sssZ), so text order is time order.
CREATE TABLE maintenance_windows (
  intervention_id  INTEGER PRIMARY KEY REFERENCES interventions(id),
  asset            TEXT NOT NULL CHECK (asset IN ('fan', 'boiler', 'chiller')),
  start_utc        TEXT NOT NULL,
  end_utc          TEXT NOT NULL,
  CHECK (end_utc > start_utc)
);

CREATE TRIGGER maintenance_windows_insert_new BEFORE INSERT ON maintenance_windows
WHEN EXISTS (SELECT 1 FROM maintenance_windows WHERE intervention_id = NEW.intervention_id)
BEGIN
  SELECT RAISE(ABORT, 'maintenance windows cannot be replaced');
END;

CREATE TRIGGER maintenance_windows_no_delete BEFORE DELETE ON maintenance_windows
BEGIN
  SELECT RAISE(ABORT, 'maintenance windows cannot be deleted');
END;

CREATE TRIGGER maintenance_windows_no_update BEFORE UPDATE ON maintenance_windows
BEGIN
  SELECT RAISE(ABORT, 'maintenance windows cannot be changed');
END;

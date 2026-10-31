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

-- An asset of a hall is unavailable from start_utc (inclusive) to end_utc (exclusive).
-- Instants are stored as ISO strings in UTC (YYYY-MM-DDTHH:MM:SS.sssZ), so text order is time order.
CREATE TABLE maintenance_windows (
  id          INTEGER PRIMARY KEY,
  hall_id     TEXT NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  asset       TEXT NOT NULL CHECK (asset IN ('fan', 'boiler', 'chiller')),
  start_utc   TEXT NOT NULL,
  end_utc     TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,                    -- ISO instant
  CHECK (end_utc > start_utc)
);
CREATE INDEX maintenance_windows_hall ON maintenance_windows(hall_id, start_utc);

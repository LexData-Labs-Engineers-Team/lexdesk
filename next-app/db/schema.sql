-- TeamOS / Attendance Pro — Neon Postgres schema (data layer migrated off Firestore).
-- Firebase Auth + Storage stay. Apply once per database (idempotent: IF NOT EXISTS).
--
-- Conventions:
--   * camelCaseField -> snake_case_column (mechanical).
--   * Firestore doc id -> `id text` PK (default gen_random_uuid()::text), except
--     users (PK firebase_uid = Firebase Auth uid), policy (PK org_id), org (PK id).
--   * Every table carries org_id (single-org today; keeps (orgId, ...) signatures).
--   * No FK constraints (the app tolerates dangling refs; migration stays order-free).
--   * Timestamps -> timestamptz (serverTimestamp() -> now()).
--   * Day/time strings stay text (compared lexicographically in the reader layer).
--   * jsonb for arrays-of-objects / arbitrary maps; text[] for flat string arrays.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ============================== users ==============================
CREATE TABLE IF NOT EXISTS users (
  firebase_uid text PRIMARY KEY,                  -- Firebase Auth uid
  org_id text NOT NULL DEFAULT 'default',
  email text, name text, role text,               -- role UPPERCASE: ADMIN|EMPLOYEE|SUPER_ADMIN|IT_TEAM|DEV
  team_id text, team_name text, employee_id text,
  designation text, department text, contact_number text,
  birth_date text, joining_date text,
  must_change_password boolean NOT NULL DEFAULT false,
  face_embedding_b64 text, face_embedding_model text, face_enrolled_at timestamptz,
  photo_storage_path text, photo_updated_at timestamptz,
  last_location_ping_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  login_devices jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{deviceId,name,platform,firstSeenAt,lastSeenAt}] cap 2
  login_ip_allowlist text[] NOT NULL DEFAULT '{}'       -- empty = unrestricted
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users (org_id);
CREATE INDEX IF NOT EXISTS idx_users_team ON users (team_id);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);
-- userIndex intentionally NOT created (dropped; mobile role fallback reads users.role)

-- ============================== teams ==============================
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  name text NOT NULL, leader_uid text, leader_name text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text
);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams (org_id, name);
CREATE INDEX IF NOT EXISTS idx_teams_name_lower ON teams (org_id, lower(name));

-- ========================= attendance_events =======================
CREATE TABLE IF NOT EXISTS attendance_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  uid text, user_email text, user_name text, office_id text,
  type text,                                       -- CHECK_IN | CHECK_OUT
  timestamp timestamptz NOT NULL DEFAULT now(),
  lat double precision, lng double precision, accuracy_meters double precision,
  ssid text, bssid text, client_ip text, face_match_score double precision,
  all_checks_passed boolean,
  raw_check_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_late boolean, is_early boolean,
  scheduled_start text, scheduled_end text,
  client_mode text, web_device text, api_key_id text,
  device_id text, device_name text, manual_by text, manual_note text
);
CREATE INDEX IF NOT EXISTS idx_events_uid_ts ON attendance_events (uid, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_ts ON attendance_events (timestamp DESC);

-- ========================== qr_token_uses ==========================
CREATE TABLE IF NOT EXISTS qr_token_uses (
  id text PRIMARY KEY,                             -- `${uid}_${sha256(org:token)[:32]}`
  org_id text NOT NULL DEFAULT 'default',
  uid text NOT NULL, token text, token_key text NOT NULL,
  valid_from timestamptz, valid_until timestamptz,
  used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (uid, token_key)                          -- replaces .create() replay-prevention
);

-- ============================= devices =============================
CREATE TABLE IF NOT EXISTS devices (
  device_id text PRIMARY KEY,
  org_id text NOT NULL DEFAULT 'default',
  uid text NOT NULL, email text, device_name text, device_mac text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_devices_uid ON devices (uid);

-- ============================ audit_logs ===========================
CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  actor_uid text, action text, target_id text, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (org_id, created_at DESC);

-- ========================== leave_requests =========================
CREATE TABLE IF NOT EXISTS leave_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  uid text, user_email text, user_name text,
  from_day text, to_day text, total_days numeric,
  leave_type text, half_day_period text, department text, line_manager text,
  approved_by text, subject text, details text, reason text,   -- reason = legacy
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz, decided_by text, decision_note text
);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests (org_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_uid ON leave_requests (org_id, uid);

-- ========================== asset_requests =========================
CREATE TABLE IF NOT EXISTS asset_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  uid text, user_email text, user_name text,
  asset_name text, asset_type text, description text,
  from_day text, to_day text, total_days numeric,
  requires_lead boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  admin_status text NOT NULL DEFAULT 'pending', lead_status text NOT NULL DEFAULT 'pending',
  admin_decided_by text, admin_decided_at timestamptz, admin_note text,
  lead_decided_by text, lead_decided_at timestamptz, lead_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_status ON asset_requests (org_id, status);
CREATE INDEX IF NOT EXISTS idx_asset_uid ON asset_requests (org_id, uid);

-- ========================== recon_requests =========================
CREATE TABLE IF NOT EXISTS recon_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  uid text, user_email text, user_name text,
  day text, proposed_in_iso text, proposed_out_iso text, reason text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz, decided_by text, decision_note text
);
CREATE INDEX IF NOT EXISTS idx_recon_status ON recon_requests (org_id, status);
CREATE INDEX IF NOT EXISTS idx_recon_uid ON recon_requests (org_id, uid);

-- ========================= remote_requests =========================
CREATE TABLE IF NOT EXISTS remote_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  uid text, user_email text, user_name text,
  day text, reason text, place text, lat double precision, lng double precision,
  status text NOT NULL DEFAULT 'pending',          -- working|pending|approved|rejected|cancelled
  started_at timestamptz, ended_at timestamptz, duration_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz, decided_by text, decision_note text
);
CREATE INDEX IF NOT EXISTS idx_remote_status ON remote_requests (org_id, status);
CREATE INDEX IF NOT EXISTS idx_remote_uid ON remote_requests (org_id, uid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_remote_one_working
  ON remote_requests (org_id, uid) WHERE status = 'working';   -- one active session/user

-- ============================= holidays ============================
CREATE TABLE IF NOT EXISTS holidays (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  from_day text, to_day text, name text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text
);
CREATE INDEX IF NOT EXISTS idx_holidays_from ON holidays (org_id, from_day);

-- ========================== accessory_items ========================
CREATE TABLE IF NOT EXISTS accessory_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  name text, quantity integer NOT NULL DEFAULT 0, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text
);
CREATE INDEX IF NOT EXISTS idx_accessory_created ON accessory_items (org_id, created_at DESC);

-- ========================== tracking_items =========================
CREATE TABLE IF NOT EXISTS tracking_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  name text, ip_address text, assigned_to text, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text
);
CREATE INDEX IF NOT EXISTS idx_tracking_created ON tracking_items (org_id, created_at DESC);

-- ============================= notices =============================
CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  title text, body text, pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text
);
CREATE INDEX IF NOT EXISTS idx_notices_created ON notices (org_id, created_at DESC);

-- ============================ break_events =========================
CREATE TABLE IF NOT EXISTS break_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  uid text, type text,                             -- BREAK_START | BREAK_END
  timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_breaks_uid_ts ON break_events (org_id, uid, timestamp DESC);

-- =========================== location_pings ========================
CREATE TABLE IF NOT EXISTS location_pings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  uid text, email text, lat double precision, lng double precision, accuracy double precision,
  captured_at timestamptz, server_received_at timestamptz NOT NULL DEFAULT now(),
  source text, is_mock_location boolean
);
CREATE INDEX IF NOT EXISTS idx_pings_uid ON location_pings (org_id, uid, server_received_at DESC);

-- ============================== policy =============================
CREATE TABLE IF NOT EXISTS policy (
  org_id text PRIMARY KEY DEFAULT 'default',
  require_wifi boolean, require_ip boolean, require_geo boolean, require_qr boolean, require_face boolean,
  face_threshold double precision, gps_accuracy_max_meters double precision,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================== offices ============================
CREATE TABLE IF NOT EXISTS offices (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL DEFAULT 'default',
  name text, lat double precision, lng double precision, radius_meters double precision,
  allowed_ssids text[] NOT NULL DEFAULT '{}',
  allowed_bssids text[] NOT NULL DEFAULT '{}',    -- lowercased
  allowed_ips text[] NOT NULL DEFAULT '{}',
  start_time text, end_time text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_offices_org ON offices (org_id, created_at);

-- =============================== org ===============================
CREATE TABLE IF NOT EXISTS org (
  id text PRIMARY KEY, name text, source text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz
);

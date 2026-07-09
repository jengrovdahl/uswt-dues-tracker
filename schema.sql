-- USWT Membership Dues Tracker — Turso/libSQL schema
-- Run this once against a fresh database:
--   turso db shell uswt-dues-tracker < schema.sql

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chapter_num TEXT,
  district TEXT,
  state TEXT,
  president TEXT,
  president_phone TEXT,
  president_email TEXT,
  meeting_night TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id),
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  home_phone TEXT,
  email TEXT,
  birthdate TEXT,
  join_date TEXT,
  ssn TEXT DEFAULT '0',              -- contract allows an assigned "0" in place of a real SSN; left as '0' by default
  status TEXT DEFAULT 'active',      -- active | dropped
  trans_code TEXT,                   -- new | rnew | drop | transfer | late
  uspp INTEGER DEFAULT 0,            -- Past National President flag; National dues not paid for these
  transferred_from_state TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS member_events (
  id TEXT PRIMARY KEY,
  member_id TEXT REFERENCES members(id),
  chapter_id TEXT REFERENCES chapters(id),
  event_type TEXT,                   -- new | renew | drop | transfer | late_renew | edit
  event_date TEXT DEFAULT (datetime('now')),
  note TEXT
);

CREATE TABLE IF NOT EXISTS intake_queue (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  phone TEXT,
  email TEXT,
  birthdate TEXT,
  submitted_date TEXT,
  source TEXT,
  status TEXT DEFAULT 'pending'      -- pending | approved | dismissed
);

CREATE TABLE IF NOT EXISTS trimesters (
  id TEXT PRIMARY KEY,
  name TEXT,
  start_date TEXT,          -- first day of the trimester period
  end_date TEXT,             -- last day of the trimester period (no gap between trimesters)
  due_date TEXT               -- National's mailing/billing deadline, which falls inside the period, not at its edge
);

INSERT OR IGNORE INTO trimesters (id, name, start_date, end_date, due_date) VALUES
  ('tri1-2026', '1st Trimester', '2026-05-01', '2026-08-31', '2026-08-15'),
  ('tri2-2026', '2nd Trimester', '2026-09-01', '2026-12-31', '2026-12-15'),
  ('tri3-2027', '3rd Trimester', '2027-01-01', '2027-04-30', '2027-04-15');

CREATE INDEX IF NOT EXISTS idx_members_chapter ON members(chapter_id);
CREATE INDEX IF NOT EXISTS idx_events_member ON member_events(member_id);

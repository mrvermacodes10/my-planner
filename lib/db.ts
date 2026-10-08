import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// The whole database is one file. It is created automatically the first time the app runs.
const file = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "planner.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,                       -- one-off: the date; recurring: first possible date
  startTime TEXT NOT NULL,
  endTime TEXT NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'none',  -- none | daily | weekly
  recurrenceDays TEXT NOT NULL DEFAULT '',  -- weekly: "1,3" (0 = Sunday)
  recurrenceEnd TEXT,
  excludedDates TEXT NOT NULL DEFAULT '',   -- cancelled dates of a series
  category TEXT,
  emoji TEXT,
  notes TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  dueDate TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',  -- low | medium | high
  estimatedMinutes INTEGER,
  completed INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  notes TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS daily_plans (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS daily_plan_blocks (
  id TEXT PRIMARY KEY,
  dailyPlanId TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  startTime TEXT NOT NULL,
  endTime TEXT,                              -- empty only for the final Sleep block
  category TEXT,
  emoji TEXT,
  source TEXT NOT NULL DEFAULT 'custom',     -- event | task | break | meal | routine | travel | free | custom
  notes TEXT,
  taskId TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  eventId TEXT REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS blocks_by_plan ON daily_plan_blocks(dailyPlanId);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  wakeTime TEXT NOT NULL DEFAULT '07:00',
  sleepTime TEXT NOT NULL DEFAULT '22:30',
  breakMinutes INTEGER NOT NULL DEFAULT 15,
  includeMeals INTEGER NOT NULL DEFAULT 1,
  includeTravel INTEGER NOT NULL DEFAULT 0,
  travelMinutes INTEGER NOT NULL DEFAULT 15
);
INSERT OR IGNORE INTO settings (id) VALUES (1);
`;

function open() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(SCHEMA);
  return d;
}

// Reuse one connection while the dev server reloads code.
const g = globalThis as unknown as { __plannerDb?: Database.Database };
export const db = g.__plannerDb ?? open();
g.__plannerDb = db;

export const newId = () => randomUUID().replace(/-/g, "").slice(0, 12);

/** UPDATE helper. Column names always come from our own code, never from user input. */
export function updateRow(table: string, id: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`;
  const params: Record<string, unknown> = { id };
  for (const k of keys) params[k] = typeof fields[k] === "boolean" ? Number(fields[k]) : fields[k];
  db.prepare(sql).run(params);
}

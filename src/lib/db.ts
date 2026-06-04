import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "observer.db");

// Cache across HMR reloads so we don't keep opening new handles in dev.
const globalForDb = globalThis as unknown as { __observerDb?: Database.Database };

function init(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS life_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      mood TEXT,
      occurred_at INTEGER NOT NULL,
      source_message_id INTEGER REFERENCES messages(id),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('observation', 'suggestion', 'question')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      related_event_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_occurred ON life_events(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at);
  `);

  // Additive migration: feedback columns on observations.
  const obsCols = db
    .prepare("PRAGMA table_info(observations)")
    .all() as Array<{ name: string }>;
  const haveFeedback = obsCols.some((c) => c.name === "feedback");
  if (!haveFeedback) {
    db.exec(`
      ALTER TABLE observations ADD COLUMN feedback TEXT CHECK (feedback IN ('agreed','inaccurate'));
      ALTER TABLE observations ADD COLUMN feedback_at INTEGER;
    `);
  }
  const haveReply = obsCols.some((c) => c.name === "user_reply");
  if (!haveReply) {
    db.exec(`
      ALTER TABLE observations ADD COLUMN user_reply TEXT;
      ALTER TABLE observations ADD COLUMN user_reply_at INTEGER;
    `);
  }
}

export function getProfile(db: Database.Database): UserProfileRow | null {
  return (db
    .prepare(
      "SELECT id, display_name, created_at, updated_at FROM user_profile WHERE id = 1",
    )
    .get() as UserProfileRow | undefined) ?? null;
}

export function setUserName(db: Database.Database, name: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO user_profile (id, display_name, created_at, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
  ).run(name, now, now);
}

export function setObservationFeedback(
  db: Database.Database,
  id: number,
  feedback: "agreed" | "inaccurate" | null,
): void {
  db.prepare(
    "UPDATE observations SET feedback = ?, feedback_at = ? WHERE id = ?",
  ).run(feedback, feedback ? Date.now() : null, id);
}

export function setObservationReply(
  db: Database.Database,
  id: number,
  reply: string | null,
): void {
  db.prepare(
    "UPDATE observations SET user_reply = ?, user_reply_at = ? WHERE id = ?",
  ).run(reply, reply ? Date.now() : null, id);
}

export function getDb(): Database.Database {
  if (!globalForDb.__observerDb) {
    const db = new Database(dbPath);
    init(db);
    globalForDb.__observerDb = db;
  }
  return globalForDb.__observerDb;
}

export type MessageRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: number;
};

export type LifeEventRow = {
  id: number;
  category: string;
  content: string;
  mood: string | null;
  occurred_at: number;
  source_message_id: number | null;
  created_at: number;
};

export type ObservationRow = {
  id: number;
  kind: "observation" | "suggestion" | "question";
  title: string;
  body: string;
  related_event_ids: string;
  created_at: number;
  feedback: "agreed" | "inaccurate" | null;
  feedback_at: number | null;
  user_reply: string | null;
  user_reply_at: number | null;
};

export type UserProfileRow = {
  id: number;
  display_name: string | null;
  created_at: number;
  updated_at: number;
};

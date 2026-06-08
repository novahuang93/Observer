import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "observer.db");
export const DEMO_VISITOR_ID = "demo";
const LEGACY_VISITOR_ID = "legacy";
const SEED_MESSAGE_COUNT = 29;
const SEED_EVENT_COUNT = 17;
const SEED_OBSERVATION_COUNT = 5;
const SEED_GREETING_TEXT =
  "嗨，我们刚认识。\n\n我会在这儿安静地陪你记录日常——开心的、烦的、随手一想的——都行，不用整理。\n\n先问一下，我怎么称呼你？";

// Cache across HMR reloads so we don't keep opening new handles in dev.
const globalForDb = globalThis as unknown as { __observerDb?: Database.Database };

function init(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL DEFAULT '${DEMO_VISITOR_ID}',
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS life_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL DEFAULT '${DEMO_VISITOR_ID}',
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      mood TEXT,
      occurred_at INTEGER NOT NULL,
      source_message_id INTEGER REFERENCES messages(id),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL DEFAULT '${DEMO_VISITOR_ID}',
      kind TEXT NOT NULL CHECK (kind IN ('observation', 'suggestion', 'question')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      related_event_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visitor_profiles (
      visitor_id TEXT PRIMARY KEY,
      display_name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS observation_interactions (
      visitor_id TEXT NOT NULL,
      observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
      feedback TEXT CHECK (feedback IN ('agreed','inaccurate')),
      feedback_at INTEGER,
      user_reply TEXT,
      user_reply_at INTEGER,
      PRIMARY KEY (visitor_id, observation_id)
    );

    CREATE INDEX IF NOT EXISTS idx_interactions_observation ON observation_interactions(observation_id);
  `);

  const addedMessageVisitorColumn = ensureColumn(db, "messages", "visitor_id", "TEXT");
  const addedEventVisitorColumn = ensureColumn(db, "life_events", "visitor_id", "TEXT");
  const addedObservationVisitorColumn = ensureColumn(db, "observations", "visitor_id", "TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_visitor_created ON messages(visitor_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_visitor_occurred ON life_events(visitor_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_observations_visitor_created ON observations(visitor_id, created_at);
  `);
  const addedVisitorColumn =
    addedMessageVisitorColumn || addedEventVisitorColumn || addedObservationVisitorColumn;
  backfillVisitorIds(db, addedVisitorColumn);

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

  // Track per-visitor onboarding completion so we know not to show the
  // onboarding flow again. NULL means "never onboarded" (new visitor or
  // visitor who has never finished the intro).
  ensureColumn(db, "visitor_profiles", "onboarded_at", "INTEGER");

  ensureSeed(db);
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function backfillVisitorIds(db: Database.Database, addedVisitorColumn: boolean) {
  if (!addedVisitorColumn) {
    db.prepare("UPDATE messages SET visitor_id = ? WHERE visitor_id IS NULL").run(LEGACY_VISITOR_ID);
    db.prepare("UPDATE life_events SET visitor_id = ? WHERE visitor_id IS NULL").run(LEGACY_VISITOR_ID);
    db.prepare("UPDATE observations SET visitor_id = ? WHERE visitor_id IS NULL").run(LEGACY_VISITOR_ID);
    return;
  }

  const first = db.prepare("SELECT content FROM messages WHERE id = 1").get() as
    | { content: string }
    | undefined;
  const hasOriginalSeed = first?.content === SEED_GREETING_TEXT;

  if (hasOriginalSeed) {
    db.prepare("UPDATE messages SET visitor_id = ? WHERE visitor_id IS NULL AND id <= ?").run(
      DEMO_VISITOR_ID,
      SEED_MESSAGE_COUNT,
    );
    db.prepare("UPDATE life_events SET visitor_id = ? WHERE visitor_id IS NULL AND id <= ?").run(
      DEMO_VISITOR_ID,
      SEED_EVENT_COUNT,
    );
    db.prepare("UPDATE observations SET visitor_id = ? WHERE visitor_id IS NULL AND id <= ?").run(
      DEMO_VISITOR_ID,
      SEED_OBSERVATION_COUNT,
    );
  }

  db.prepare("UPDATE messages SET visitor_id = ? WHERE visitor_id IS NULL").run(LEGACY_VISITOR_ID);
  db.prepare("UPDATE life_events SET visitor_id = ? WHERE visitor_id IS NULL").run(LEGACY_VISITOR_ID);
  db.prepare("UPDATE observations SET visitor_id = ? WHERE visitor_id IS NULL").run(LEGACY_VISITOR_ID);

  // Pre-isolation rows from anonymous visitors no longer belong to anyone.
  // Hard-delete them so they can't linger in backups or surprise us later.
  // life_events references messages(id), so delete events first.
  db.prepare("DELETE FROM life_events WHERE visitor_id = ?").run(LEGACY_VISITOR_ID);
  db.prepare("DELETE FROM observations WHERE visitor_id = ?").run(LEGACY_VISITOR_ID);
  db.prepare("DELETE FROM messages WHERE visitor_id = ?").run(LEGACY_VISITOR_ID);
}

/**
 * On first run (no messages yet), populate the demo with a coherent
 * 7-day slice of fake life: chat history, extracted life events, and
 * 5 observations the Observer Agent has "already written". This lets
 * new visitors land on a populated app instead of an empty shell.
 * Real visitor activity (their messages, new events, new observations)
 * appends after the seed and is never wiped.
 */
function ensureSeed(db: Database.Database) {
  const count = (
    db.prepare("SELECT COUNT(*) as c FROM messages WHERE visitor_id = ?").get(DEMO_VISITOR_ID) as {
      c: number;
    }
  ).c;
  if (count > 0) return;

  const D = 86_400_000;
  const H = 3_600_000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const base = startOfToday.getTime();
  const t = (daysAgo: number, hour: number) => base - daysAgo * D + hour * H;

  const insertMsg = db.prepare(
    "INSERT INTO messages (visitor_id, role, content, created_at) VALUES (?, ?, ?, ?)",
  );
  const insertEvt = db.prepare(
    "INSERT INTO life_events (visitor_id, category, content, mood, occurred_at, source_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertObs = db.prepare(
    "INSERT INTO observations (visitor_id, kind, title, body, related_event_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const seedTx = db.transaction(() => {
    const msg = (role: "user" | "assistant", content: string, daysAgo: number, hour: number): number =>
      Number(insertMsg.run(DEMO_VISITOR_ID, role, content, t(daysAgo, hour)).lastInsertRowid);
    const evt = (category: string, content: string, mood: string, daysAgo: number, hour: number, srcId: number) =>
      insertEvt.run(DEMO_VISITOR_ID, category, content, mood, t(daysAgo, hour), srcId, t(daysAgo, hour));
    const obs = (kind: string, title: string, body: string, ids: number[], daysAgo: number, hour: number) =>
      insertObs.run(DEMO_VISITOR_ID, kind, title, body, JSON.stringify(ids), t(daysAgo, hour));

    // Greeting (7 days ago)
    msg("assistant", SEED_GREETING_TEXT, 7, 9);

    // 6 days ago
    const m1 = msg("user", "今天开了一整天的需求评审，最后产品说所有方案要重新来过。感觉挺崩的，白干了。", 6, 18);
    msg("assistant", "全推翻？那确实很耗。你自己对原方案有没有觉得哪里可以更好的？", 6, 18);
    const m2 = msg("user", "我觉得原方案没问题，主要是产品改了方向但没提前说清楚。晚上出去吃了火锅，好多了。", 6, 19);
    msg("assistant", "火锅续命。吃完好多了就好。", 6, 19);
    evt("work",   "需求评审结果全部推翻，被要求重新来过，问题出在产品方向没提前对齐", "frustrated", 6, 18, m1);
    evt("social", "下班后和朋友吃火锅，放松了不少",                                     "relaxed",    6, 19, m2);

    // 5 days ago
    const m3 = msg("user", "review 同事代码，发现一个我觉得比较严重的架构问题，说了但没人接受，还是用了原方案。下午头疼了一下午，买了杯咖啡撑过去。", 5, 17);
    msg("assistant", "说了没人听，比不说还憋屈。头疼是纯粹气的，还是最近睡眠不好？", 5, 17);
    const m4 = msg("user", "可能都有吧。睡眠最近确实不规律，经常过了十二点还没睡。", 5, 18);
    msg("assistant", "深夜睡不着是在刷手机还是脑子停不下来？", 5, 18);
    evt("work",   "code review 时提出架构隐患，未被采纳，有些憋屈",           "frustrated", 5, 15, m3);
    evt("health", "下午头疼大半天，靠咖啡撑过去",                             "low",        5, 15, m3);
    evt("health", "最近睡眠不规律，经常深夜十二点后才入睡",                   "tired",      5, 18, m4);

    // 4 days ago
    const m5 = msg("user", "今天 WFH，全天没有会，专注写代码，进度快了很多。写完还去跑步了。", 4, 20);
    msg("assistant", "这种整块时间真的难得。跑步几公里？", 4, 20);
    const m6 = msg("user", "5公里，戴着耳机跑完的，全程没停。最近好像只有跑步的时候才算是真的放松。", 4, 21);
    msg("assistant", "跑步成了你现在唯一能彻底关掉脑子的事了？", 4, 21);
    evt("work",   "WFH 整天无会，专注写代码，效率高，心情好", "focused",    4, 14, m5);
    evt("health", "独自跑步5公里，全程没停，感觉真正放松了",  "energized",  4, 19, m6);

    // 3 days ago
    const m7 = msg("user", "妈妈打电话来，聊了将近一个小时。她问工作怎样、有没有对象，我基本随便说说。睡前刷手机到凌晨两点。", 3, 22);
    msg("assistant", "和妈妈聊天通常是什么感觉？", 3, 22);
    const m8 = msg("user", "要回答一堆问题的那种感觉，不是很轻松，但也不想不接。凌晨两点可能是下午喝了咖啡，睡不着。", 3, 23);
    msg("assistant", "这种\"不想不接、但也接得很累\"的状态，你平时跟她聊完之后心情怎么样？", 3, 23);
    evt("social", "妈妈来电近1小时，话题围绕工作和感情，以应付性回答收场", "neutral", 3, 20, m7);
    evt("health", "睡前刷手机到凌晨两点，可能与下午咖啡因叠加有关",         "tired",   3, 23, m8);

    // 2 days ago
    const m9 = msg("user", "参加了个行业分享活动，遇到一个做独立产品的人，聊了挺久。回来路上突然觉得自己现在的工作好像没那么有意思了。", 2, 20);
    msg("assistant", "他说了什么让你有这种感觉？", 2, 20);
    const m10 = msg("user", "他说每天自己决定做什么，失败了也是自己负责。我就想到我现在其实大部分时间在执行别人的决定，感觉越想越空。", 2, 21);
    msg("assistant", "这种\"执行别人决定\"的感觉，是最近才有的，还是一直都这样？", 2, 21);
    evt("social",  "在行业活动遇到独立产品开发者，交流甚欢，对方状态令人向往", "inspired", 2, 18, m9);
    evt("emotion", "回程途中反思，意识到工作里缺乏自主权，感觉越来越空",       "low",      2, 20, m10);

    // yesterday
    const m11 = msg("user", "在咖啡店写了一下午副业的 PRD，写到一半觉得太难落地了，关掉了。晚上做饭步骤搞错了，勉强吃下去。", 1, 21);
    msg("assistant", "副业 PRD 卡在哪里了？", 1, 21);
    const m12 = msg("user", "主要是目标用户想不清楚，感觉越写越模糊，就没动力了。做饭是想犒劳自己，结果搞砸了，有点好笑。", 1, 22);
    msg("assistant", "目标用户模糊是不知道谁在用，还是你自己也不确定想解决什么问题？", 1, 22);
    evt("hobby", "在咖啡店尝试写副业 PRD，进行到一半因目标用户定义模糊放弃", "frustrated", 1, 15, m11);
    evt("daily", "晚上做饭，步骤搞错，勉强入口，啼笑皆非",                    "neutral",    1, 20, m12);

    // today
    const m13 = msg("user", "早会被点名说进度落后了，在组里挺尴尬的。", 0, 9);
    msg("assistant", "是真的落后了，还是排期本来就定得偏紧？", 0, 9);
    const m14 = msg("user", "应该是真的落后了，但也有部分是需求临时变了导致的。", 0, 10);
    msg("assistant", "需求变了之后有没有跟上面同步过？还是默默自己扛着重新做？", 0, 10);
    evt("work",    "周会被点名进度落后，当着组员的面有些尴尬",                "embarrassed", 0, 9,  m13);
    evt("emotion", "承认进度落后，但也意识到部分原因是需求临时变更，心情复杂", "mixed",       0, 10, m14);

    // 5 pre-written observations
    obs("observation", "放松有时候靠的是距离",
      "和朋友吃火锅让 ta 真的松了口气，但和妈妈近一小时的电话却以应付收场。同样是社交，能量方向完全相反。这不是好坏的判断——只是 ta 在这两种关系里扮演的角色，大概差得很远。",
      [10, 4], 0, 11);
    obs("question", "无人打扰的时候，ta 是什么感觉",
      "WFH 专注写代码心情好、独自跑完五公里真正放松——这两件事都发生在\"只有自己\"的状态里。而 ta 在回程途中意识到工作里缺乏自主权、感觉越来越空。ta 有没有想过，那个\"空\"是什么时候开始盖过那种专注的感觉的？",
      [8, 9, 13], 0, 11);
    obs("observation", "那个向往的状态，卡在了\"谁在用\"这里",
      "遇到独立开发者之后，ta 当天就去咖啡店动手写 PRD，这个反应速度说明触动是真实的。但卡住的地方——目标用户定义模糊——其实不是执行力的问题。也许那个\"向往的状态\"背后，ta 还没想清楚自己真正想解决谁的问题，或者说，还没想清楚那个人是不是自己。",
      [12, 13, 14], 0, 11);
    obs("observation", "身体在用它自己的方式说话",
      "头疼、深夜难眠、刷手机到两点——这几件事挤在同一个窗口里发生。咖啡续命又反过来压缩睡眠，形成了一个小循环。ta 未必没意识到，只是这周能量缺口太多，身体的信号可能排到了很后面。",
      [6, 7, 11], 0, 11);
    obs("suggestion", "憋屈在积累，出口却很窄",
      "这周 ta 连续遇到三次\"说了没用\"的时刻——方向没对齐被推翻、架构意见未被采纳、周会上又被点名。每次 ta 都有自己的判断，但结果都是消化在肚子里。今天 ta 主动承认了落后，也看到了外部原因，这个清醒是有的——只是说出来的空间，好像一直不够。",
      [3, 5, 16, 17], 0, 11);
  });

  seedTx();
  console.log("[db] seeded sample data (7 days of chat + 15 events + 5 observations)");
}

export function getProfile(db: Database.Database, visitorId: string): UserProfileRow | null {
  return (db
    .prepare(
      "SELECT visitor_id, display_name, onboarded_at, created_at, updated_at FROM visitor_profiles WHERE visitor_id = ?",
    )
    .get(visitorId) as UserProfileRow | undefined) ?? null;
}

export function setUserName(db: Database.Database, visitorId: string, name: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO visitor_profiles (visitor_id, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(visitor_id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
  ).run(visitorId, name, now, now);
}

export function setObservationFeedback(
  db: Database.Database,
  visitorId: string,
  id: number,
  feedback: "agreed" | "inaccurate" | null,
): void {
  db.prepare(
    `INSERT INTO observation_interactions (visitor_id, observation_id, feedback, feedback_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(visitor_id, observation_id)
     DO UPDATE SET feedback = excluded.feedback, feedback_at = excluded.feedback_at`,
  ).run(visitorId, id, feedback, feedback ? Date.now() : null);
}

export function setObservationReply(
  db: Database.Database,
  visitorId: string,
  id: number,
  reply: string | null,
): void {
  db.prepare(
    `INSERT INTO observation_interactions (visitor_id, observation_id, user_reply, user_reply_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(visitor_id, observation_id)
     DO UPDATE SET user_reply = excluded.user_reply, user_reply_at = excluded.user_reply_at`,
  ).run(visitorId, id, reply, reply ? Date.now() : null);
}

export function observationVisibleToVisitor(
  db: Database.Database,
  id: number,
  visitorId: string,
): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM observations WHERE id = ? AND visitor_id IN (?, ?) LIMIT 1",
    )
    .get(id, DEMO_VISITOR_ID, visitorId);
  return Boolean(row);
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
  visitor_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
};

export type LifeEventRow = {
  id: number;
  visitor_id: string;
  category: string;
  content: string;
  mood: string | null;
  occurred_at: number;
  source_message_id: number | null;
  created_at: number;
};

export type ObservationRow = {
  id: number;
  visitor_id: string;
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
  visitor_id: string;
  display_name: string | null;
  onboarded_at: number | null;
  created_at: number;
  updated_at: number;
};

export function isOnboarded(db: Database.Database, visitorId: string): boolean {
  const row = db
    .prepare(
      "SELECT onboarded_at FROM visitor_profiles WHERE visitor_id = ?",
    )
    .get(visitorId) as { onboarded_at: number | null } | undefined;
  return Boolean(row && row.onboarded_at);
}

export function markOnboarded(db: Database.Database, visitorId: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO visitor_profiles (visitor_id, display_name, onboarded_at, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?)
     ON CONFLICT(visitor_id) DO UPDATE SET onboarded_at = excluded.onboarded_at, updated_at = excluded.updated_at`,
  ).run(visitorId, now, now, now);
}

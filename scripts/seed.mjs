/**
 * Seed test data: 7 days of messages + life events.
 * Usage: node scripts/seed.mjs
 */
import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, "../data/observer.db"));

const D = 86_400_000;
const H = 3_600_000;
const DEMO_VISITOR_ID = "demo";

function t(daysAgo, hour) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() - daysAgo * D + hour * H;
}

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn("messages", "visitor_id", "TEXT");
ensureColumn("life_events", "visitor_id", "TEXT");
ensureColumn("observations", "visitor_id", "TEXT");
db.exec(`
  CREATE TABLE IF NOT EXISTS observation_interactions (
    visitor_id TEXT NOT NULL,
    observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
    feedback TEXT CHECK (feedback IN ('agreed','inaccurate')),
    feedback_at INTEGER,
    user_reply TEXT,
    user_reply_at INTEGER,
    PRIMARY KEY (visitor_id, observation_id)
  );
`);

db.exec("DELETE FROM observation_interactions; DELETE FROM life_events; DELETE FROM observations; DELETE FROM messages;");

const insertMsg = db.prepare("INSERT INTO messages (visitor_id, role, content, created_at) VALUES (?, ?, ?, ?)");
const insertEvt = db.prepare(
  "INSERT INTO life_events (visitor_id, category, content, mood, occurred_at, source_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
);

function msg(role, content, daysAgo, hour) {
  return Number(insertMsg.run(DEMO_VISITOR_ID, role, content, t(daysAgo, hour)).lastInsertRowid);
}
function evt(category, content, mood, daysAgo, hour, srcId) {
  insertEvt.run(DEMO_VISITOR_ID, category, content, mood, t(daysAgo, hour), srcId, t(daysAgo, hour));
}

// greeting
msg("assistant", "嗨，我们刚认识。\n\n我会在这儿安静地陪你记录日常——开心的、烦的、随手一想的——都行，不用整理。\n\n先问一下，我怎么称呼你？", 7, 9);

// ── 6 days ago ──────────────────────────────────────────────────────────────
const a = msg("user", "今天开了一整天的需求评审，最后产品说所有方案要重新来过。感觉挺崩的，白干了。", 6, 18);
msg("assistant", "全推翻？那确实很耗。你自己对原方案有没有觉得哪里可以更好的？", 6, 18);
const b = msg("user", "我觉得原方案没问题，主要是产品改了方向但没提前说清楚。晚上出去吃了火锅，好多了。", 6, 19);
msg("assistant", "火锅续命。吃完好多了就好。", 6, 19);
evt("work",   "需求评审结果全部推翻，被要求重新来过，问题出在产品方向没提前对齐", "frustrated", 6, 18, a);
evt("social", "下班后和朋友吃火锅，放松了不少",                                     "relaxed",    6, 19, b);

// ── 5 days ago ──────────────────────────────────────────────────────────────
const c = msg("user", "review 同事代码，发现一个我觉得比较严重的架构问题，说了但没人接受，还是用了原方案。下午头疼了一下午，买了杯咖啡撑过去。", 5, 17);
msg("assistant", "说了没人听，比不说还憋屈。头疼是纯粹气的，还是最近睡眠不好？", 5, 17);
const d = msg("user", "可能都有吧。睡眠最近确实不规律，经常过了十二点还没睡。", 5, 18);
msg("assistant", "深夜睡不着是在刷手机还是脑子停不下来？", 5, 18);
evt("work",   "code review 时提出架构隐患，未被采纳，有些憋屈",           "frustrated", 5, 15, c);
evt("health", "下午头疼大半天，靠咖啡撑过去",                             "low",        5, 15, c);
evt("health", "最近睡眠不规律，经常深夜十二点后才入睡",                   "tired",      5, 18, d);

// ── 4 days ago ──────────────────────────────────────────────────────────────
const e = msg("user", "今天 WFH，全天没有会，专注写代码，进度快了很多。写完还去跑步了。", 4, 20);
msg("assistant", "这种整块时间真的难得。跑步几公里？", 4, 20);
const f = msg("user", "5公里，戴着耳机跑完的，全程没停。最近好像只有跑步的时候才算是真的放松。", 4, 21);
msg("assistant", "跑步成了你现在唯一能彻底关掉脑子的事了？", 4, 21);
evt("work",   "WFH 整天无会，专注写代码，效率高，心情好", "focused",    4, 14, e);
evt("health", "独自跑步5公里，全程没停，感觉真正放松了",  "energized",  4, 19, f);

// ── 3 days ago ──────────────────────────────────────────────────────────────
const g = msg("user", "妈妈打电话来，聊了将近一个小时。她问工作怎样、有没有对象，我基本随便说说。睡前刷手机到凌晨两点。", 3, 22);
msg("assistant", "和妈妈聊天通常是什么感觉？", 3, 22);
const h = msg("user", "要回答一堆问题的那种感觉，不是很轻松，但也不想不接。凌晨两点可能是下午喝了咖啡，睡不着。", 3, 23);
msg("assistant", "这种\"不想不接、但也接得很累\"的状态，你平时跟她聊完之后心情怎么样？", 3, 23);
evt("social", "妈妈来电近1小时，话题围绕工作和感情，以应付性回答收场", "neutral", 3, 20, g);
evt("health", "睡前刷手机到凌晨两点，可能与下午咖啡因叠加有关",         "tired",   3, 23, h);

// ── 2 days ago ──────────────────────────────────────────────────────────────
const i = msg("user", "参加了个行业分享活动，遇到一个做独立产品的人，聊了挺久。回来路上突然觉得自己现在的工作好像没那么有意思了。", 2, 20);
msg("assistant", "他说了什么让你有这种感觉？", 2, 20);
const j = msg("user", "他说每天自己决定做什么，失败了也是自己负责。我就想到我现在其实大部分时间在执行别人的决定，感觉越想越空。", 2, 21);
msg("assistant", "这种\"执行别人决定\"的感觉，是最近才有的，还是一直都这样？", 2, 21);
evt("social",  "在行业活动遇到独立产品开发者，交流甚欢，对方状态令人向往",    "inspired", 2, 18, i);
evt("emotion", "回程途中反思，意识到工作里缺乏自主权，感觉越来越空",          "low",      2, 20, j);

// ── yesterday ────────────────────────────────────────────────────────────────
const k = msg("user", "在咖啡店写了一下午副业的 PRD，写到一半觉得太难落地了，关掉了。晚上做饭步骤搞错了，勉强吃下去。", 1, 21);
msg("assistant", "副业 PRD 卡在哪里了？", 1, 21);
const l = msg("user", "主要是目标用户想不清楚，感觉越写越模糊，就没动力了。做饭是想犒劳自己，结果搞砸了，有点好笑。", 1, 22);
msg("assistant", "目标用户模糊是不知道谁在用，还是你自己也不确定想解决什么问题？", 1, 22);
evt("hobby", "在咖啡店尝试写副业 PRD，进行到一半因目标用户定义模糊放弃", "frustrated", 1, 15, k);
evt("daily", "晚上做饭，步骤搞错，勉强入口，啼笑皆非",                    "neutral",    1, 20, l);

// ── today ────────────────────────────────────────────────────────────────────
const m = msg("user", "早会被点名说进度落后了，在组里挺尴尬的。", 0, 9);
msg("assistant", "是真的落后了，还是排期本来就定得偏紧？", 0, 9);
const n = msg("user", "应该是真的落后了，但也有部分是需求临时变了导致的。", 0, 10);
msg("assistant", "需求变了之后有没有跟上面同步过？还是默默自己扛着重新做？", 0, 10);
evt("work",    "周会被点名进度落后，当着组员的面有些尴尬",              "embarrassed", 0, 9,  m);
evt("emotion", "承认进度落后，但也意识到部分原因是需求临时变更，心情复杂", "mixed",      0, 10, n);

const msgCount = db.prepare("SELECT COUNT(*) as c FROM messages").get().c;
const evtCount = db.prepare("SELECT COUNT(*) as c FROM life_events").get().c;
console.log(`Seed done. messages=${msgCount}, life_events=${evtCount}`);

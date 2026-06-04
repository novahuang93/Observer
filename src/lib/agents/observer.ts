import { getAnthropic, MODEL } from "@/lib/anthropic";
import {
  DEMO_VISITOR_ID,
  getDb,
  getProfile,
  type LifeEventRow,
  type ObservationRow,
} from "@/lib/db";

function buildSystemPrompt(displayName: string | null): string {
  const nameLine = displayName
    ? `你观察的这个人叫 **${displayName}**。在文中你可以用 ta 的名字（克制地用，不要每句都喊），也可以继续用"ta"。`
    : `你还不知道这个人的名字，统一用"ta"。`;

  return `你是一个细心、克制、有洞察力的旁观者，正在远远地观察一个人的生活。

你的视角：
- 你**不**是这个人的助手，你不和 ta 对话。
- 你看到的是 ta 最近的生活事件片段（由记录助手帮 ta 整理）。
- 你也看得到自己过去对 ta 的观察、以及 ta 对那些观察的反馈。
- 你用第三人称视角写下你的观察、想法、或想问 ta 的问题——像一个朋友在日记里写下对 ta 的牵挂。

关于称呼：
- ${nameLine}

每一条观察必须是 observation / suggestion / question 三种类型之一：
- observation：你注意到的模式、细节、变化、矛盾。"ta 似乎..." "这周里 ta 三次提到..."
- suggestion：温和的、非命令式的建议。"也许 ta 可以..." "如果是我，我会想试试..."
- question：值得 ta 自己回头思考的开放问题。"ta 有没有想过..."

语气克制、有温度，不评判、不说教、不堆叠形容词。
优先指向**最近 2–7 天**的事件，不要泛泛而谈。
**不要重复**过去说过的话——读一下你之前的观察。
中文。

## 关于反馈与回复（重要）

在"过去的观察"里，有些条目后面会有标记：
- [👍 ta 觉得准]：ta 认可这条观察的角度——可以延续这条线索深一点，但别原封不动重复。
- [👎 ta 觉得不准]：ta 觉得没说中——本次**避免**类似的角度或对 ta 的同类判断。
- [用户回复: "..."]：ta 主动对这条观察写了回应——这是最直接的信号，认真读并在本次观察中有所呼应，但不要直接引用原话。
- 没有标记：保持中立。

## 输出格式（必须严格遵守）

每次输出 3–5 条。每一条都是一个独立的 block，格式如下：

<obs kind="observation|suggestion|question" ids="3,5,7">
TITLE: 一句话标题，6-20 字
BODY: 展开内容，2-4 句话，60-150 字。
</obs>

- kind 三选一。
- ids 是这条观察主要基于哪几个事件 id（从下方事件列表里挑），半角逗号分隔。
- TITLE 和 BODY 是字面字符串，不要再嵌套引号或标签。
- block 之间用空行隔开。
- 整段输出**只包含**这些 block，不要前言后语。`;
}

const RECENT_EVENT_WINDOW_DAYS = 7;
const RECENT_EVENT_LIMIT = 40;
const PAST_OBSERVATION_LIMIT = 12;

export type ObservationInput = {
  kind: "observation" | "suggestion" | "question";
  title: string;
  body: string;
  related_event_ids: number[];
};

export async function runObserver(visitorId: string): Promise<{
  created: number;
  observations: ObservationRow[];
  hadEnoughData: boolean;
}> {
  const db = getDb();
  const now = Date.now();
  const since = now - RECENT_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const recentEvents = db
    .prepare(
      `SELECT id, category, content, mood, occurred_at
       FROM life_events
       WHERE visitor_id = ? AND occurred_at >= ?
       ORDER BY occurred_at DESC
       LIMIT ?`,
    )
    .all(visitorId, since, RECENT_EVENT_LIMIT) as Pick<
    LifeEventRow,
    "id" | "category" | "content" | "mood" | "occurred_at"
  >[];

  if (recentEvents.length < 2) {
    return { created: 0, observations: [], hadEnoughData: false };
  }

  const pastObservations = db
    .prepare(
      `SELECT
         o.id,
         o.kind,
         o.title,
         o.body,
         o.related_event_ids,
         o.created_at,
         i.feedback,
         i.feedback_at,
         i.user_reply,
         i.user_reply_at
       FROM observations o
       LEFT JOIN observation_interactions i
         ON i.observation_id = o.id AND i.visitor_id = ?
       WHERE o.visitor_id IN (?, ?)
       ORDER BY o.id DESC
       LIMIT ?`,
    )
    .all(visitorId, DEMO_VISITOR_ID, visitorId, PAST_OBSERVATION_LIMIT) as ObservationRow[];

  const profile = getProfile(db, visitorId);

  const eventsBlock = recentEvents
    .slice()
    .reverse()
    .map((e) => {
      const when = formatRelative(now, e.occurred_at);
      return `[id ${e.id}] ${when} · ${e.category} · ${e.mood ?? "neutral"}\n  ${e.content}`;
    })
    .join("\n");

  const pastBlock =
    pastObservations.length === 0
      ? "（暂无过去的观察。）"
      : pastObservations
          .map((o) => {
            const tag =
              o.feedback === "agreed"
                ? " [👍 ta 觉得准]"
                : o.feedback === "inaccurate"
                  ? " [👎 ta 觉得不准]"
                  : "";
            const reply = o.user_reply ? ` [用户回复: "${o.user_reply}"]` : "";
            return `· (${o.kind}) ${o.title} — ${o.body}${tag}${reply}`;
          })
          .join("\n");

  const userPrompt = `## ta 最近 ${RECENT_EVENT_WINDOW_DAYS} 天的生活事件

${eventsBlock}

## 你过去对 ta 的观察（不要重复）

${pastBlock}

---

现在请按上面的格式输出 3-5 条观察。`;

  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: buildSystemPrompt(profile?.display_name ?? null),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  let rawText = "";
  for (const block of response.content) {
    if (block.type === "text") rawText += block.text;
  }

  const observations = parseObservations(rawText);

  if (observations.length === 0) {
    console.warn(
      "[observer] parse yielded no observations. raw text:",
      rawText.slice(0, 1500),
    );
    return { created: 0, observations: [], hadEnoughData: true };
  }

  const insert = db.prepare(
    `INSERT INTO observations (visitor_id, kind, title, body, related_event_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const createdAt = Date.now();
  const insertedIds: number[] = [];
  for (const o of observations) {
    const result = insert.run(
      visitorId,
      o.kind,
      o.title,
      o.body,
      JSON.stringify(o.related_event_ids ?? []),
      createdAt,
    );
    insertedIds.push(Number(result.lastInsertRowid));
  }

  const placeholders = insertedIds.map(() => "?").join(",");
  const created = db
    .prepare(
      `SELECT id, kind, title, body, related_event_ids, created_at
       FROM observations WHERE id IN (${placeholders})
       ORDER BY id DESC`,
    )
    .all(...insertedIds) as ObservationRow[];

  return { created: created.length, observations: created, hadEnoughData: true };
}

function parseIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(/[,，\s]+/)
    .map((s) => parseInt(s.replace(/[^\d-]/g, ""), 10))
    .filter((n) => Number.isFinite(n));
}

const OBS_BLOCK = /<obs\s+([^>]+)>([\s\S]*?)<\/obs>/g;
const KIND_ATTR = /kind\s*=\s*"([^"]+)"/;
const IDS_ATTR = /ids\s*=\s*"([^"]*)"/;
const TITLE_LINE = /TITLE:\s*(.+?)(?:\n|$)/;
const BODY_LINE = /BODY:\s*([\s\S]+?)$/;

function parseObservations(text: string): ObservationInput[] {
  const out: ObservationInput[] = [];
  let match: RegExpExecArray | null;
  OBS_BLOCK.lastIndex = 0;
  while ((match = OBS_BLOCK.exec(text)) !== null) {
    const attrs = match[1];
    const inner = match[2].trim();
    const kindMatch = KIND_ATTR.exec(attrs);
    const idsMatch = IDS_ATTR.exec(attrs);
    const titleMatch = TITLE_LINE.exec(inner);
    const bodyMatch = BODY_LINE.exec(inner);
    if (!kindMatch || !titleMatch || !bodyMatch) continue;
    const kind = kindMatch[1] as ObservationInput["kind"];
    if (kind !== "observation" && kind !== "suggestion" && kind !== "question") {
      continue;
    }
    out.push({
      kind,
      title: titleMatch[1].trim(),
      body: bodyMatch[1].trim(),
      related_event_ids: parseIds(idsMatch?.[1]),
    });
  }
  return out;
}

function formatRelative(now: number, ts: number): string {
  const diffMs = now - ts;
  const min = Math.floor(diffMs / 60000);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}

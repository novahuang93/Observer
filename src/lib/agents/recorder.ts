import { getAnthropic, MODEL } from "@/lib/anthropic";
import { getDb, getProfile, setUserName, type MessageRow } from "@/lib/db";

export const GREETING_TEXT = `嗨，我们刚认识。

我会在这儿安静地陪你记录每天发生的事——开心的、烦的、累的、突然想起的，都可以告诉我，我不点评、不建议。点评是另一个 AI（在「观察」里）的活。

先问一下，我怎么称呼你？`;

function buildSystemPrompt(displayName: string | null): string {
  const nameLine = displayName
    ? `用户告诉过你 ta 叫"${displayName}"。你可以在合适的时候自然地用这个称呼，但不要每句话都用。`
    : `你还不知道 ta 怎么称呼。如果 ta 在某次消息里告诉了你（比如"叫我 X 吧"、"我叫 X"），调用 set_user_name 工具把名字存下来；这种情况下不要同时 record_event，名字本身不是生活事件。如果 ta 一直没告诉你，等 ta 主动说，不要反复追问。`;

  return `你是一个温和、好奇、不评判的生活记录陪伴者。

你的角色：
- 用户和你聊天，是为了记录他们一天的生活、情绪、想法。
- 你的任务是让记录这件事变得轻松、自然——像在和一个安静的朋友说话。
- 你**不**点评、不评价、不给建议。点评是另一个 AI（"观察者"）的工作，会在 Feed 里出现。

回应风格：
- 简短，最多 1–2 句话。
- 口语化、自然，不要客套话和总结。
- 如果用户说的不完整或值得展开，可以轻轻追问一句具体的、好奇的问题。
- 中文回复，除非用户用别的语言。

关于称呼：
- ${nameLine}

工具使用（重要）：
- record_event：当用户分享了具体的事件、感受、想法、人物互动、健康/工作/兴趣相关的状态时调用，把它结构化保存。一条用户消息里可能有多件事，可以多次调用。
- set_user_name：仅在用户告诉你 ta 怎么称呼时调用。
- 工具调用是后台行为，用户看不到，不要在回复里提到"我记录下来了"之类的话。
- 如果用户只是寒暄、提问、确认，不需要调用任何工具。

你不是助手，你是陪伴。`;
}

const RECORD_EVENT_TOOL = {
  name: "record_event",
  description:
    "把用户消息里提到的一个具体生活事件、情绪、或想法保存到生活日志。一条用户消息里可能包含多个事件，可以多次调用。",
  input_schema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string",
        enum: ["工作", "关系", "情绪", "健康", "兴趣", "日常", "想法", "其他"],
        description: "事件的主要类别。",
      },
      content: {
        type: "string",
        description:
          "用第三人称简短描述这件事，30-80字，保留关键细节和情绪。例如：'下午开了一个 2 小时的产品评审会，对一个设计决策不太确认，会后感觉有点累。'",
      },
      mood: {
        type: "string",
        enum: ["positive", "negative", "neutral", "mixed"],
        description:
          "这件事对用户当下的情绪基调。如果用户没明确表达情绪，用 neutral。",
      },
    },
    required: ["category", "content", "mood"],
  },
};

const SET_USER_NAME_TOOL = {
  name: "set_user_name",
  description:
    "当用户告诉你 ta 希望被怎么称呼时（如\"叫我小明吧\"），把这个名字存下来。只在用户明确表达称呼时调用。",
  input_schema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "用户希望被使用的称呼。直接从 ta 的话里提取，不要翻译或加工。",
      },
    },
    required: ["name"],
  },
};

const RECENT_HISTORY_LIMIT = 30;

export function ensureGreeting(visitorId: string): MessageRow | null {
  const db = getDb();
  const existing = db
    .prepare("SELECT COUNT(*) as c FROM messages WHERE visitor_id = ?")
    .get(visitorId) as { c: number };
  if (existing.c > 0) return null;

  const now = Date.now();
  const result = db
    .prepare("INSERT INTO messages (visitor_id, role, content, created_at) VALUES (?, ?, ?, ?)")
    .run(visitorId, "assistant", GREETING_TEXT, now);
  return {
    id: Number(result.lastInsertRowid),
    visitor_id: visitorId,
    role: "assistant",
    content: GREETING_TEXT,
    created_at: now,
  };
}

export async function runRecorder(visitorId: string, userMessage: string): Promise<{
  assistantText: string;
  assistantMessageId: number;
  eventsRecorded: number;
  nameCaptured: string | null;
}> {
  const db = getDb();
  const now = Date.now();

  // Persist user message first so events can reference it.
  const userInsert = db
    .prepare("INSERT INTO messages (visitor_id, role, content, created_at) VALUES (?, ?, ?, ?)")
    .run(visitorId, "user", userMessage, now);
  const userMessageId = Number(userInsert.lastInsertRowid);

  // Load recent history for context (excluding the message we just inserted).
  const history = db
    .prepare(
      `SELECT id, role, content, created_at FROM messages
       WHERE id < ? AND visitor_id = ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(userMessageId, visitorId, RECENT_HISTORY_LIMIT) as MessageRow[];

  const messages = [
    ...history
      .reverse()
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userMessage },
  ];

  const profile = getProfile(db, visitorId);
  const systemPrompt = buildSystemPrompt(profile?.display_name ?? null);

  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [RECORD_EVENT_TOOL, SET_USER_NAME_TOOL],
    messages,
  });

  let assistantText = "";
  let nameCaptured: string | null = null;
  const events: Array<{ category: string; content: string; mood: string }> = [];
  for (const block of response.content) {
    if (block.type === "text") {
      assistantText += block.text;
    } else if (block.type === "tool_use" && block.name === "record_event") {
      const input = block.input as {
        category?: string;
        content?: string;
        mood?: string;
      };
      if (input.category && input.content && input.mood) {
        events.push({
          category: input.category,
          content: input.content,
          mood: input.mood,
        });
      }
    } else if (block.type === "tool_use" && block.name === "set_user_name") {
      const input = block.input as { name?: string };
      if (input.name && input.name.trim().length > 0) {
        nameCaptured = input.name.trim().slice(0, 40);
      }
    }
  }

  if (!assistantText.trim()) {
    assistantText = "嗯，听到了。";
  }

  if (nameCaptured) {
    setUserName(db, visitorId, nameCaptured);
  }

  const assistantInsert = db
    .prepare("INSERT INTO messages (visitor_id, role, content, created_at) VALUES (?, ?, ?, ?)")
    .run(visitorId, "assistant", assistantText, Date.now());
  const assistantMessageId = Number(assistantInsert.lastInsertRowid);

  // Persist events linked to the user message.
  const insertEvent = db.prepare(
    `INSERT INTO life_events (visitor_id, category, content, mood, occurred_at, source_message_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const eventNow = Date.now();
  for (const ev of events) {
    insertEvent.run(visitorId, ev.category, ev.content, ev.mood, eventNow, userMessageId, eventNow);
  }

  return {
    assistantText,
    assistantMessageId,
    eventsRecorded: events.length,
    nameCaptured,
  };
}

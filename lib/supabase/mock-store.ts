import type { Task, DiaryEntry, Review, TaskInsert, TaskUpdate, ReviewInsert, ReviewUpdate, DiaryEntryInsert, FocusSession, FocusSessionInsert, Goal, GoalInsert, GoalStep, GoalStepInsert, Achievement, AchievementInsert, AIGoalStep, ChatMessageRow, ChatMessageInsert } from "./types";
import { EBBINGHAUS_SCHEDULE } from "./types";

/**
 * ================================================================
 * 🎭 离线 Mock 数据层（兜底方案）
 *
 * 当 Supabase 密钥未完整配置（或用户还没拿到正确 JWT）时，
 * 所有 API Route 自动降级到这里的内存 Map + JSON 文件持久化，
 * 让前端能看到完整交互，不阻塞后续开发。
 *
 * ⚠️ 仅用于开发期本地验证。生产必须配置 Supabase。
 * ================================================================
 */

export type MockRow<T> = T & { id: string };

/** 生成一个随机 UUID（作为行 ID）。注意：函数名叫 newid()，避免和函数内部的「uid = 某个用户ID字符串」变量重名。 */
const newid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "mf_" + Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ----------------------------------------------------------------
 * 持久化：写入项目根目录 .mindflow-mock.json（进程重启数据仍在）
 * -------------------------------------------------------------- */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_FILE = resolve(__dirname, "..", "..", ".mindflow-mock.json");

interface MockStore {
  tasks: MockRow<Task>[];
  reviews: MockRow<Review>[];
  diaryEntries: MockRow<DiaryEntry>[];
  focusSessions: MockRow<FocusSession>[];
  goals: MockRow<Goal>[];
  goalSteps: MockRow<GoalStep>[];
  achievements: MockRow<Achievement>[];
  chatMessages: MockRow<ChatMessageRow>[];
}

const EMPTY_STORE: MockStore = {
  tasks: [],
  reviews: [],
  diaryEntries: [],
  focusSessions: [],
  goals: [],
  goalSteps: [],
  achievements: [],
  chatMessages: [],
};

/** 今日 ISO（开发期本地 UTC+8 友好） */
function todayISO(): string {
  const d = new Date();
  const tzOffMs = d.getTimezoneOffset() * 60_000;
  const local = new Date(d.getTime() - tzOffMs);
  return local.toISOString().slice(0, 10);
}

/** 在 ISO 日期上 ± N 天 */
function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 首次启动：若 store 完全空 → 注入和 SQL 迁移一致的 demo 数据。
 * 这样用户无论用真 Supabase（SQL Editor 跑了迁移）还是 Mock 兜底，
 * 首次打开都能看到完整的热力图、任务、复习卡示例，不会看到"全空页面"。
 */
function ensureSeed(store: MockStore): MockStore {
  if (
    store.tasks.length > 0 ||
    store.reviews.length > 0 ||
    store.diaryEntries.length > 0 ||
    store.goals.length > 0
  ) {
    return store;
  }
  const demoUid = "demo_seed_user";
  const today = todayISO();
  const now = new Date().toISOString();

  store.tasks = [
    {
      id: newid(),
      user_id: demoUid,
      content: "吃早餐",
      is_done: true,
      due_date: today,
      source: "manual",
      focus_minutes: 15,
      created_at: now,
    },
    {
      id: newid(),
      user_id: demoUid,
      content: "每日 walk 30 分钟",
      is_done: false,
      due_date: today,
      source: "ai",
      focus_minutes: 0,
      created_at: now,
    },
    {
      id: newid(),
      user_id: demoUid,
      content: "背单词 20 个",
      is_done: false,
      due_date: today,
      source: "manual",
      focus_minutes: 0,
      created_at: now,
    },
  ];

  store.reviews = [
    {
      id: newid(),
      user_id: demoUid,
      title: "艾宾浩斯曲线记忆法：1→2→4→7→15→30 天节奏",
      content:
        "记忆不是「一次记住」，而是「在遗忘临界点前主动复习」。\n\n" +
        "六个阶段：第 1 轮学（间隔 1 天）→ 第 2 轮（间隔 2 天）→ 第 3 轮（4 天）→ 第 4 轮（7 天）→ 第 5 轮（15 天）→ 第 6 轮（30 天）。\n" +
        "「记住了」就推进一轮，「有点模糊」本轮间隔减半，「重头学」回到第 1 轮（间隔 1 天）。",
      images: [],
      source: "ai",
      review_round: 1,
      interval_days: 1,
      next_review_date: today,
      status: "pending",
      created_at: now,
    },
    {
      id: newid(),
      user_id: demoUid,
      title: "React useEffect 第二个参数依赖数组的作用",
      content:
        "useEffect(fn, dependencies)\n\n" +
        "· 不传依赖数组：每次 render 都执行（等同于 componentDidUpdate 每次）\n" +
        "· 传 []：只在组件挂载时执行一次（componentDidMount）\n" +
        "· 传 [a, b]：当 a 或 b 引用变化时执行（浅比较，对象/数组要特别注意）\n\n" +
        "陷阱：在 effect 内用到的变量都必须放进依赖数组里，否则就是闭包老值。",
      images: [],
      source: "manual",
      review_round: 3, // 正在进行第 3 轮（已完成两轮）
      interval_days: 4,
      next_review_date: today,
      status: "pending",
      created_at: now,
    },
    {
      id: newid(),
      user_id: demoUid,
      title: "CSS Grid 简写 grid-template-columns: repeat(12, 1fr)",
      content:
        "repeat(重复次数, 尺寸) 是 Grid 里最常用的简写。\n\n" +
        "1fr = 把剩余空间平均分成 N 份。\n" +
        "repeat(12, 1fr) 就是 12 栏栅格布局（Bootstrap 风格）。\n\n" +
        "进阶：repeat(auto-fit, minmax(240px, 1fr)) — 经典响应式，不用媒体查询。",
      images: [],
      source: "manual",
      review_round: 5, // 正在第 5 轮
      interval_days: 15,
      next_review_date: shiftDate(today, 1), // 明天到期
      status: "pending",
      created_at: now,
    },
    {
      id: newid(),
      user_id: demoUid,
      title: "SRS 间隔重复的「记忆阈值」理论",
      content:
        "间隔重复（Spaced Repetition）核心思想：\n\n" +
        "「你越是艰难地回忆起某件事，这次复习对记忆的强化就越大。」\n" +
        "所以不要一上来就看答案，先「尝试回想」再对照；" +
        "难度选择决定下一次什么时候再把你推到「刚好忘又没完全忘」的阈值。",
      images: [],
      source: "ai",
      review_round: 7, // 6 轮全通过 → 已毕业
      interval_days: 30,
      next_review_date: shiftDate(today, -1), // 昨天结束的最后一次
      status: "graduated",
      created_at: now,
    },
  ];

  store.diaryEntries = [
    {
      id: newid(),
      user_id: demoUid,
      raw_text: "今天写项目很有成就感，连续三个小时不被打扰地专注，颜色终于调对了。",
      emotion_analysis: {
        emotion: "心流带来的充实感",
        advice: "保持当前的专注节奏，晚上可以花 10 分钟复盘今天的心得。",
        action_steps: ["写一段 100 字以内的复盘", "奖励自己一顿喜欢的晚餐"],
      },
      created_at: now,
    },
  ];

  try {
    mkdirSync(dirname(MOCK_FILE), { recursive: true });
    writeFileSync(MOCK_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch {
    /* ignore */
  }
  return store;
}

export function loadStore(): MockStore {
  try {
    if (!existsSync(MOCK_FILE)) {
      return ensureSeed(structuredClone(EMPTY_STORE));
    }
    const raw = readFileSync(MOCK_FILE, "utf-8");
    const json = JSON.parse(raw) as Partial<MockStore>;
    const store: MockStore = {
      tasks: Array.isArray(json.tasks) ? json.tasks : [],
      reviews: Array.isArray(json.reviews) ? json.reviews : [],
      diaryEntries: Array.isArray(json.diaryEntries) ? json.diaryEntries : [],
      focusSessions: Array.isArray((json as any).focusSessions) ? (json as any).focusSessions : [],
      goals: Array.isArray((json as any).goals) ? (json as any).goals : [],
      goalSteps: Array.isArray((json as any).goalSteps) ? (json as any).goalSteps : [],
      achievements: Array.isArray((json as any).achievements) ? (json as any).achievements : [],
      chatMessages: Array.isArray((json as any).chatMessages) ? (json as any).chatMessages : [],
    };
    return ensureSeed(store);
  } catch {
    return ensureSeed(structuredClone(EMPTY_STORE));
  }
}

function saveStore(store: MockStore) {
  try {
    mkdirSync(dirname(MOCK_FILE), { recursive: true });
    writeFileSync(MOCK_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch {
    /* ignore */
  }
}

/* ================================================================
 *  1) tasks
 * ================================================================ */

/**
 * 开发期 Mock 宽松策略：
 *   本地 dev 匿名用户 ID 容易因为清缓存/无痕窗口而变化，但数据其实都是同一个人写的。
 *   所以查询/写入时：
 *     1) 如果当前 uid 在 store 里没有任何任务，且 store 已有非空任务集合，就自动把
 *        该 uid 映射到「store 里第一个有任务的 uid」，保证热图/概览能命中。
 *     2) 写入新任务优先使用原 uid，避免多 uid 分裂。
 */
function _resolveMockedUid(userId: string, store: MockStore): string {
  // 找第一个有任何表数据的 uid（优先 tasks，其次 reviews）
  const firstActive =
    store.tasks[0]?.user_id ||
    store.reviews[0]?.user_id ||
    store.diaryEntries[0]?.user_id;
  if (!firstActive) return userId;
  const mine = store.tasks.some((t) => t.user_id === userId) ||
    store.reviews.some((r) => r.user_id === userId);
  return mine ? userId : firstActive;
}

export function mockListTasks(userId: string, dateISO: string): MockRow<Task>[] {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  return s.tasks
    .filter((t) => t.user_id === uid && t.due_date === dateISO)
    .sort((a, b) => Number(a.is_done) - Number(b.is_done) || a.created_at.localeCompare(b.created_at));
}

export function mockCreateTasks(userId: string, rows: TaskInsert[]): MockRow<Task>[] {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  const now = new Date().toISOString();
  const created: MockRow<Task>[] = rows.map((r) => {
    const t: MockRow<Task> = {
      id: newid(),
      user_id: uid,
      content: r.content,
      is_done: r.is_done ?? false,
      due_date: r.due_date || now.slice(0, 10),
      source: r.source || "manual",
      focus_minutes: r.focus_minutes ?? 0,
      goal_step_id: r.goal_step_id ?? null,
      created_at: now,
    };
    s.tasks.push(t);
    return t;
  });
  saveStore(s);
  return created;
}

export function mockUpdateTask(userId: string, id: string, patch: TaskUpdate): MockRow<Task> | null {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  const idx = s.tasks.findIndex((t) => t.id === id && t.user_id === uid);
  if (idx === -1) {
    // 兜底：用 id 全局找（可能是切换 uid 后的老任务）
    const looseIdx = s.tasks.findIndex((t) => t.id === id);
    if (looseIdx === -1) return null;
    const updated = { ...s.tasks[looseIdx], ...patch };
    s.tasks[looseIdx] = updated;
    saveStore(s);
    return updated;
  }
  const updated = { ...s.tasks[idx], ...patch };
  s.tasks[idx] = updated;
  saveStore(s);
  return updated;
}

export function mockDeleteTask(userId: string, id: string): boolean {
  const s = loadStore();
  const before = s.tasks.length;
  s.tasks = s.tasks.filter((t) => t.id !== id); // 按 id 全局删除（开发期友好，uid 变化也能删）
  const changed = s.tasks.length !== before;
  if (changed) saveStore(s);
  return changed;
}

/** 按 id 全局找某条任务（供计时器累加 focus_minutes 兜底） */
export function mockFindTaskById(id: string): MockRow<Task> | null {
  const s = loadStore();
  return s.tasks.find((t) => t.id === id) || null;
}

/** 按日期范围取完成度统计（热力图用） */
export function mockTaskCompletionByDay(
  userId: string,
  dateFromISO: string,
  dateToISO: string
): Record<string, { total: number; done: number; focus_minutes: number }> {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  const out: Record<string, { total: number; done: number; focus_minutes: number }> = {};
  for (const t of s.tasks) {
    if (t.user_id !== uid) continue;
    if (t.due_date < dateFromISO || t.due_date > dateToISO) continue;
    if (!out[t.due_date]) out[t.due_date] = { total: 0, done: 0, focus_minutes: 0 };
    out[t.due_date].total += 1;
    if (t.is_done) out[t.due_date].done += 1;
    out[t.due_date].focus_minutes += t.focus_minutes || 0;
  }
  return out;
}

/* ================================================================
 *  2) reviews
 * ================================================================ */

export function mockListReviewsByDate(userId: string, dateISO: string): MockRow<Review>[] {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  return s.reviews
    .filter((r) => r.user_id === uid && r.next_review_date <= dateISO && r.status === "pending")
    .sort((a, b) => a.next_review_date.localeCompare(b.next_review_date));
}

export function mockCreateReview(userId: string, row: ReviewInsert): MockRow<Review> {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  const now = new Date().toISOString();
  // review_round：字段显式给了就用；否则默认 1；毕业上限 7
  const rrRaw = typeof row.review_round === "number" ? row.review_round : 1;
  const review_round = Math.max(1, Math.min(7, rrRaw));
  // 自动决定 interval_days：1~6 内按间隔表映射；毕业的留 interval_days=30
  const interval_days =
    typeof row.interval_days === "number" && row.interval_days > 0
      ? row.interval_days
      : review_round <= 6
      ? EBBINGHAUS_SCHEDULE[review_round - 1]
      : 30;
  const r: MockRow<Review> = {
    id: newid(),
    user_id: uid,
    title: row.title,
    content: typeof row.content === "string" ? row.content : null,
    images: Array.isArray(row.images)
      ? (row.images as any[]).filter((x) => typeof x === "string" && x.length > 0)
      : typeof row.images === "string" && row.images.length > 0
      ? [row.images]
      : [],
    source: row.source || "manual",
    review_round,
    interval_days,
    next_review_date: row.next_review_date || now.slice(0, 10),
    status: row.status || (review_round > 6 ? "graduated" : "pending"),
    created_at: now,
  };
  s.reviews.push(r);
  saveStore(s);
  return r;
}

export function mockUpdateReview(userId: string, id: string, patch: ReviewUpdate): MockRow<Review> | null {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  let idx = s.reviews.findIndex((r) => r.id === id && r.user_id === uid);
  if (idx === -1) idx = s.reviews.findIndex((r) => r.id === id); // 宽松兜底
  if (idx === -1) return null;
  s.reviews[idx] = { ...s.reviews[idx], ...patch };
  saveStore(s);
  return s.reviews[idx];
}

/* ================================================================
 *  2.5) 艾宾浩斯调度 —— 三种按钮强度
 *       序列 [1, 2, 4, 7, 15, 30]
 * ================================================================ */

/**
 * ✅ 根据「复习强度」推进 review_round 状态机（唯一真源驱动）
 * - 记住了：完成当前第 k 轮 → 进入第 k+1 轮；当 k+1>6（即 review_round=7）→ 毕业
 * - 有点模糊：保持在第 k 轮不推进，间隔减半（提前再来，最少 1 天）
 * - 重头学：退回第 1 轮，间隔 = EBBINGHAUS_SCHEDULE[0] = 1 天
 * 同时继续维护 interval_days（向后兼容快速字段 + 旧 API 调用方）。
 */
export function scheduleRecall(
  currentIntervalDays: number,
  todayISO: string,
  strength: "remember" | "fuzzy" | "reset",
  roundInProgress = 1
): Pick<Review, "interval_days" | "next_review_date" | "status" | "review_round"> {
  const seq = EBBINGHAUS_SCHEDULE as unknown as number[];
  const MAX = seq.length;

  if (strength === "remember") {
    const nextRound = roundInProgress + 1;
    // roundInProgress 是"正在做的这一轮"，完成后 k+1；若 k 已经 > MAX 直接保持毕业
    if (roundInProgress > MAX || nextRound > MAX) {
      return {
        review_round: Math.max(MAX + 1, nextRound), // 7+
        interval_days: seq[MAX - 1],
        next_review_date: shiftDate(todayISO, seq[MAX - 1]),
        status: "graduated",
      };
    }
    // 第 1..6 轮通过 → 下一轮的间隔 = seq[nextRound-1]
    const nextInterval = seq[nextRound - 1];
    return {
      review_round: nextRound,
      interval_days: nextInterval,
      next_review_date: shiftDate(todayISO, nextInterval),
      status: "pending",
    };
  }

  if (strength === "fuzzy") {
    // 保持轮次不变，今天再来（间隔 0 天）或提前 1 天，防止和用户体验冲突
    const keepRound = Math.max(1, Math.min(MAX, roundInProgress));
    const curr = seq[keepRound - 1];
    const nextInterval = Math.max(1, Math.floor(curr / 2));
    return {
      review_round: keepRound,
      interval_days: nextInterval,
      next_review_date: shiftDate(todayISO, 1), // 明天就再来一次（更早重考）
      status: "pending",
    };
  }

  // reset → 重头学：回到第 1 轮，1 天后开始
  return {
    review_round: 1,
    interval_days: seq[0],
    next_review_date: shiftDate(todayISO, seq[0]),
    status: "pending",
  };
}

export interface ReviewStats {
  today_due: number;      // 今日待复习（≤今天、pending）
  mastered: number;       // 兼容：旧接口「已掌握」= 已毕业 reviewed + graduated 合并
  tomorrow_due: number;   // 明日到期
  in_progress: number;    // 进行中（1 ≤ round ≤ 6）
  graduated: number;      // 已毕业（round > 6 或 status == graduated）
  total: number;          // 总卡片数
}

export function mockReviewStats(userId: string, todayISO: string): ReviewStats {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  const tomorrow = shiftDate(todayISO, 1);

  let today_due = 0;
  let mastered = 0;
  let tomorrow_due = 0;
  let in_progress = 0;
  let graduated = 0;
  let total = 0;

  for (const r of s.reviews) {
    if (r.user_id !== uid) continue;
    total += 1;
    const rr = typeof r.review_round === "number" ? r.review_round : 1;
    const isGrad =
      r.status === "graduated" || rr > 6 || r.status === "reviewed";
    if (isGrad) {
      graduated += 1;
      mastered += 1; // 兼容旧字段
      continue;
    }
    if (rr >= 1 && rr <= 6) in_progress += 1;
    if (r.status === "pending" && r.next_review_date <= todayISO) today_due += 1;
    if (r.next_review_date === tomorrow) tomorrow_due += 1;
  }

  return { today_due, mastered, tomorrow_due, in_progress, graduated, total };
}

/** 按 id 找某张复习卡片（宽松全局匹配 —— 开发期 uid 变化后仍可操作） */
export function mockFindReviewById(id: string): MockRow<Review> | null {
  const s = loadStore();
  return s.reviews.find((r) => r.id === id) || null;
}

/** 列出全部「今日待复习」（含 overdue 的），过期的排前面优先 */
export function mockListTodayReviews(userId: string, todayISO: string): MockRow<Review>[] {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  return s.reviews
    .filter((r) => r.user_id === uid && r.status === "pending" && r.next_review_date <= todayISO)
    .sort((a, b) => a.next_review_date.localeCompare(b.next_review_date) || a.created_at.localeCompare(b.created_at));
}

/* ================================================================
 *  3) diary_entries
 * ================================================================ */

/** 列出某用户全部日记（新→旧），供 chat 上下文联动使用 */
export function mockListDiaryEntries(userId: string): MockRow<DiaryEntry>[] {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  return s.diaryEntries
    .filter((d) => d.user_id === uid)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function mockCreateDiaryEntry(userId: string, row: DiaryEntryInsert): MockRow<DiaryEntry> {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  const now = new Date().toISOString();
  const d: MockRow<DiaryEntry> = {
    id: newid(),
    user_id: uid,
    raw_text: row.raw_text,
    emotion_analysis: row.emotion_analysis ?? null,
    created_at: now,
  };
  s.diaryEntries.push(d);
  saveStore(s);
  return d;
}

/* ================================================================
 * 🎯 专注计时会话（Focus Sessions）
 * ================================================================ */

/** 列出某用户全部专注会话，供 chat 上下文联动使用 */
export function mockListFocusSessions(userId: string): MockRow<FocusSession>[] {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  return s.focusSessions.filter((fs) => fs.user_id === uid);
}

/** 创建一条专注会话记录 */
export function mockCreateFocusSession(
  userId: string,
  session: FocusSessionInsert
): MockRow<FocusSession> {
  const s = loadStore();
  const row: MockRow<FocusSession> = {
    id: newid(),
    user_id: userId,
    task_id: session.task_id ?? null,
    duration_minutes: session.duration_minutes,
    session_type: session.session_type,
    phase: session.phase ?? "focus",
    intent: session.intent ?? null,
    challenge_rounds: session.challenge_rounds ?? 0,
    started_at: session.started_at,
    ended_at: session.ended_at,
    created_at: new Date().toISOString(),
  };
  s.focusSessions.push(row);
  saveStore(s);
  return row;
}

/** 查询某用户今日的专注总分钟数 */
export function mockTodayFocusMinutes(userId: string): number {
  const s = loadStore();
  const today = todayISO();
  return s.focusSessions
    .filter(
      (fs) =>
        fs.user_id === userId &&
        fs.phase === "focus" &&
        fs.started_at.slice(0, 10) === today
    )
    .reduce((sum, fs) => sum + fs.duration_minutes, 0);
}

/* ================================================================
 *  判定：当前应该走 Supabase 还是 Mock
 * ================================================================ */
export function shouldUseMock(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !sk) return true;
  if (url.includes("placeholder")) return true;
  if (sk.startsWith("请") || sk.length < 40) return true;
  return false;
}

/* ================================================================
 *  4) goals（长期目标）
 * ================================================================ */

export function mockListGoals(userId: string, status?: string): MockRow<Goal>[] {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  let rows = s.goals.filter((g) => g.user_id === uid);
  if (status) rows = rows.filter((g) => g.status === status);
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function mockGetGoal(id: string): MockRow<Goal> | null {
  const s = loadStore();
  return s.goals.find((g) => g.id === id) || null;
}

export function mockCreateGoal(userId: string, row: GoalInsert): MockRow<Goal> {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  const now = new Date().toISOString();
  const g: MockRow<Goal> = {
    id: newid(),
    user_id: uid,
    title: row.title,
    description: row.description ?? null,
    target_date: row.target_date ?? null,
    starting_point: row.starting_point ?? null,
    success_criteria: row.success_criteria ?? null,
    weekly_time: row.weekly_time ?? null,
    status: row.status ?? "active",
    created_at: now,
  };
  s.goals.push(g);
  saveStore(s);
  return g;
}

export function mockUpdateGoal(id: string, patch: Partial<Goal>): MockRow<Goal> | null {
  const s = loadStore();
  const idx = s.goals.findIndex((g) => g.id === id);
  if (idx === -1) return null;
  s.goals[idx] = { ...s.goals[idx], ...patch };
  saveStore(s);
  return s.goals[idx];
}

export function mockDeleteGoal(id: string): boolean {
  const s = loadStore();
  const before = s.goals.length;
  s.goals = s.goals.filter((g) => g.id !== id);
  // 级联删除 steps
  s.goalSteps = s.goalSteps.filter((st) => st.goal_id !== id);
  const changed = s.goals.length !== before;
  if (changed) saveStore(s);
  return changed;
}

/* ================================================================
 *  5) goal_steps（目标子步骤）
 * ================================================================ */

export function mockListGoalSteps(goalId: string): MockRow<GoalStep>[] {
  const s = loadStore();
  return s.goalSteps
    .filter((st) => st.goal_id === goalId)
    .sort((a, b) => a.step_order - b.step_order);
}

export function mockCreateGoalStep(userId: string, row: GoalStepInsert): MockRow<GoalStep> {
  const s = loadStore();
  const now = new Date().toISOString();
  const st: MockRow<GoalStep> = {
    id: newid(),
    goal_id: row.goal_id,
    content: row.content,
    step_order: row.step_order ?? 0,
    is_done: row.is_done ?? false,
    scheduled_date: row.scheduled_date ?? null,
    added_to_tasks: false,
    notes: row.notes ?? null,
    created_at: now,
  };
  s.goalSteps.push(st);
  saveStore(s);
  return st;
}

/** 兼容两种入参：AI 拆解结果（AIGoalStep）或 goals POST 的序列化步骤 */
export function mockBatchCreateGoalSteps(
  userId: string,
  goalId: string,
  steps: (AIGoalStep | { content: string; step_order: number; scheduled_date?: string | null; notes?: string | null })[]
): MockRow<GoalStep>[] {
  const s = loadStore();
  const now = new Date().toISOString();
  const created: MockRow<GoalStep>[] = steps.map((st, i) => ({
    id: newid(),
    goal_id: goalId,
    content: st.content,
    step_order: "step_order" in st && typeof st.step_order === "number" ? st.step_order : i + 1,
    is_done: false,
    scheduled_date: st.scheduled_date ?? null,
    added_to_tasks: false,
    notes: st.notes ?? null,
    created_at: now,
  }));
  s.goalSteps.push(...created);
  saveStore(s);
  return created;
}

export function mockUpdateGoalStep(id: string, patch: Partial<GoalStep>): MockRow<GoalStep> | null {
  const s = loadStore();
  const idx = s.goalSteps.findIndex((st) => st.id === id);
  if (idx === -1) return null;
  s.goalSteps[idx] = { ...s.goalSteps[idx], ...patch };
  saveStore(s);
  return s.goalSteps[idx];
}

/** 标记子步骤已加入今日待办 */
export function mockMarkStepAdded(id: string): MockRow<GoalStep> | null {
  return mockUpdateGoalStep(id, { added_to_tasks: true });
}

/* ================================================================
 *  6) achievements（成就徽章）
 * ================================================================ */

export function mockListAchievements(userId: string): MockRow<Achievement>[] {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  return s.achievements
    .filter((a) => a.user_id === uid)
    .sort((a, b) => b.unlocked_at.localeCompare(a.unlocked_at));
}

export function mockUnlockAchievement(
  userId: string,
  row: AchievementInsert
): MockRow<Achievement> {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  // 防重复：同一 badge_code 只解锁一次
  const existing = s.achievements.find(
    (a) => a.user_id === uid && a.badge_code === row.badge_code
  );
  if (existing) return existing;
  const a: MockRow<Achievement> = {
    id: newid(),
    user_id: uid,
    badge_code: row.badge_code,
    badge_name: row.badge_name,
    description: row.description ?? null,
    unlocked_at: new Date().toISOString(),
    progress_value: row.progress_value ?? 0,
    metadata: row.metadata ?? null,
  };
  s.achievements.push(a);
  saveStore(s);
  return a;
}

export function mockHasAchievement(userId: string, badgeCode: string): boolean {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  return s.achievements.some((a) => a.user_id === uid && a.badge_code === badgeCode);
}

/** 获取某个徽章的进度（0~1 浮点数或整数进度） */
export function mockAchievementProgress(userId: string, badgeCode: string): number {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  const a = s.achievements.find((a) => a.user_id === uid && a.badge_code === badgeCode);
  return a ? a.progress_value : 0;
}

/* ================================================================
 *  7) focus stats（专注统计）
 * ================================================================ */

export interface FocusDayStat {
  date: string;       // YYYY-MM-DD
  minutes: number;    // 当天专注总分钟
}

export interface IntentStat {
  intent: string;
  minutes: number;
}

export interface DailyIntentStat {
  date: string;
  intents: IntentStat[];
}

export interface FocusStatsResult {
  todayMinutes: number;
  targetMinutes: number;
  todayIntents: IntentStat[];
  weeklyData: FocusDayStat[];
  weeklyIntents: DailyIntentStat[];
  weekTotal: number;
  weekAvg: number;
  bestDay: { date: string; minutes: number } | null;
}

/** 将 intent 为空的统一归类为「未命名专注」 */
function normalizeIntent(intent: string | null | undefined): string {
  const trimmed = (intent || "").trim();
  return trimmed.length > 0 ? trimmed : "未命名专注";
}

/** 按日期分组统计 intent 分布 */
function buildIntentStats(
  sessions: { duration_minutes: number; intent?: string | null; started_at: string }[],
  dateStr: string
): IntentStat[] {
  const daySessions = sessions.filter(
    (fs) => fs.started_at.slice(0, 10) === dateStr
  );
  const map: Record<string, number> = {};
  for (const fs of daySessions) {
    const key = normalizeIntent(fs.intent);
    map[key] = (map[key] || 0) + fs.duration_minutes;
  }
  return Object.entries(map)
    .map(([intent, minutes]) => ({ intent, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

/** 获取近 7 天专注统计 */
export function mockFocusStats(userId: string): FocusStatsResult {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  const today = todayISO();
  const targetMinutes = 120;

  // 构建近 7 天日期数组
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    days.push(shiftDate(today, -i));
  }

  // 筛选当前用户近 7 天的专注会话
  const recentSessions = s.focusSessions.filter(
    (fs) =>
      fs.user_id === uid &&
      fs.phase === "focus" &&
      days.includes(fs.started_at.slice(0, 10))
  );

  // 统计每天的专注分钟
  const weeklyData: FocusDayStat[] = days.map((date) => {
    const minutes = recentSessions
      .filter((fs) => fs.started_at.slice(0, 10) === date)
      .reduce((sum, fs) => sum + fs.duration_minutes, 0);
    return { date, minutes };
  });

  // 每天的 intent 分布
  const weeklyIntents: DailyIntentStat[] = days.map((date) => ({
    date,
    intents: buildIntentStats(recentSessions, date),
  }));

  // 今日 intent 分布
  const todayIntents = weeklyIntents[6]?.intents || [];

  const todayMinutes = weeklyData[6]?.minutes || 0;
  const weekTotal = weeklyData.reduce((sum, d) => sum + d.minutes, 0);
  const weekAvg = Math.round(weekTotal / 7);
  const bestDay = weeklyData.reduce(
    (best, d) => (d.minutes > (best?.minutes || 0) ? d : best),
    null as { date: string; minutes: number } | null
  );

  return {
    todayMinutes,
    targetMinutes,
    todayIntents,
    weeklyData,
    weeklyIntents,
    weekTotal,
    weekAvg,
    bestDay: bestDay && bestDay.minutes > 0 ? bestDay : null,
  };
}

/* ================================================================
 *  8) chat_messages（对话教练历史）
 * ================================================================ */

export function mockListChatMessages(userId: string): MockRow<ChatMessageRow>[] {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  return s.chatMessages
    .filter((m) => m.user_id === uid)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function mockCreateChatMessages(
  userId: string,
  rows: ChatMessageInsert[]
): MockRow<ChatMessageRow>[] {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  const now = new Date().toISOString();
  const created: MockRow<ChatMessageRow>[] = rows.map((r) => {
    const m: MockRow<ChatMessageRow> = {
      id: newid(),
      user_id: uid,
      role: r.role,
      content: r.content,
      citations: r.citations ?? null,
      meta: r.meta ?? null,
      created_at: now,
    };
    s.chatMessages.push(m);
    return m;
  });
  saveStore(s);
  return created;
}

export function mockClearChatMessages(userId: string): void {
  const s = loadStore();
  const uid = _resolveMockedUid(userId, s);
  const before = s.chatMessages.length;
  s.chatMessages = s.chatMessages.filter((m) => m.user_id !== uid);
  if (s.chatMessages.length !== before) saveStore(s);
}

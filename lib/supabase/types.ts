/**
 * ================================================================
 * MindFlow 数据库类型定义
 * 对应 Supabase 中的三张表：tasks / diary_entries / reviews
 * 若后续使用 supabase-cli 生成类型，可替换此文件。
 * ================================================================
 */

export type TaskSource = "ai" | "manual";
export type ReviewSource = "ai" | "manual";
export type ReviewStatus = "pending" | "reviewed" | "graduated"; // pending=待复习；reviewed=当日已复习（非今日不再显示）；graduated=6轮全通过（已毕业）

/** 艾宾浩斯 6 个节点对应的间隔天数（第 k 轮完成后，下一轮 = SCHEDULE_DAYS_AFTER_ROUND[k]） */
export const EBBINGHAUS_SCHEDULE = [1, 2, 4, 7, 15, 30] as const;
/** 最大 SRS 轮次数（review_round==1 表示正在第 1 轮；==6 表示正在第 6 轮；>6 即毕业） */
export const EBBINGHAUS_MAX_ROUNDS = 6;
/** 根据当前进行中的轮次(1..6) → 到下一次间隔天数；若>6即毕业 */
export function intervalForInProgressRound(roundInProgress: number): number {
  const i = Math.max(1, Math.min(EBBINGHAUS_MAX_ROUNDS, Math.round(roundInProgress || 1))) - 1;
  return EBBINGHAUS_SCHEDULE[i];
}
/** 已完成的复习轮次 = max(进行中轮次 - 1, 0) */
export function completedRounds(roundInProgress: number): number {
  return Math.max(0, Math.round(roundInProgress || 1) - 1);
}
/** 是否已毕业（review_round > 6 或 status == graduated 任一成立即视为毕业） */
export function isGraduated(review: { review_round?: number | null; status?: ReviewStatus | null }): boolean {
  if (review.status === "graduated") return true;
  return typeof review.review_round === "number" && review.review_round > EBBINGHAUS_MAX_ROUNDS;
}

/** 待办任务 */
export interface Task {
  id: string;
  user_id: string;
  content: string;
  is_done: boolean;
  due_date: string;           // YYYY-MM-DD
  source: TaskSource;         // AI 生成 / 手动添加
  focus_minutes?: number | null; // 累计专注分钟数（计时器累计）
  goal_step_id?: string | null;  // 若来自长期目标拆解，关联 goal_step_id
  created_at: string;         // ISO timestamp
}

export interface TaskInsert extends Omit<Task, "id" | "created_at" | "is_done"> {
  id?: string;
  is_done?: boolean;
  focus_minutes?: number | null;
  created_at?: string;
}

export interface TaskUpdate extends Partial<Omit<Task, "id" | "user_id">> {}

/** 日记条目（用户倾诉 + AI 情绪分析） */
export interface DiaryEntry {
  id: string;
  user_id: string;
  raw_text: string;
  emotion_analysis: EmotionAnalysisResult | null;
  created_at: string;
}

export interface EmotionAnalysisResult {
  emotion: string;                 // 情绪标签，如 "未被认可的委屈"
  advice: string;                  // 调节建议
  action_steps: string[];          // 最小行动单元清单
  raw_reply?: string;              // 原始回复文本（供展示）
}

export interface DiaryEntryInsert
  extends Omit<DiaryEntry, "id" | "created_at"> {
  id?: string;
  created_at?: string;
}

/** 艾宾浩斯复习卡片 */
export interface Review {
  id: string;
  user_id: string;
  title: string;
  content?: string | null;                // 可选：卡片内容（记忆时能回看）
  images?: (string | null)[] | string | null; // 可选：图片 dataURL 数组（MVP 本地直存 base64，无后端存储依赖）
  source: ReviewSource;
  review_round: number;           // 正在进行的复习轮次 1..6；>6 表示已毕业
  interval_days: number;          // 当前间隔天数（与 round 对应，方便后向兼容/快速排序）
  next_review_date: string;       // YYYY-MM-DD
  status: ReviewStatus;           // pending / reviewed / graduated
  created_at: string;
}

export interface ReviewInsert
  extends Omit<Review, "id" | "created_at" | "status" | "interval_days" | "review_round"> {
  id?: string;
  status?: ReviewStatus;
  interval_days?: number;
  review_round?: number;
  created_at?: string;
}

export interface ReviewUpdate extends Partial<Omit<Review, "id" | "user_id">> {}

/** 艾宾浩斯间隔序列（按用户要求：1→2→4→7→15→30 天） */
export const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30] as const;
export type EbbinghausInterval = (typeof EBBINGHAUS_INTERVALS)[number];

/* ----------------------------------------------------------------
 * 专注计时会话
 * ---------------------------------------------------------------- */

/** 计时器模式 */
export type FocusSessionType = "pomodoro" | "stopwatch" | "countdown";

/** 专注会话记录 */
export interface FocusSession {
  id: string;
  user_id: string;
  task_id: string | null;          // 关联待办任务（独立启动时为 null）
  duration_minutes: number;        // 本次会话时长（分钟）
  session_type: FocusSessionType | "challenge";
  phase: "focus" | "break";        // 番茄钟专用：专注 / 休息
  intent?: string | null;          // 本次专注想完成什么（用户输入）
  challenge_rounds?: number;      // 连续专注挑战中完成的番茄钟数
  started_at: string;              // ISO timestamp
  ended_at: string;                // ISO timestamp
  created_at: string;
}

export interface FocusSessionInsert
  extends Omit<FocusSession, "id" | "created_at"> {
  id?: string;
  created_at?: string;
}

/* ----------------------------------------------------------------
 * 长期目标
 * ---------------------------------------------------------------- */

export type GoalStatus = "active" | "completed" | "archived";

/** 长期目标 */
export interface Goal {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  target_date?: string | null;   // YYYY-MM-DD
  starting_point?: string | null;   // 当前起点 / 水平（帮助 AI 判断第一步从哪里开始）
  success_criteria?: string | null; // 想要的具体成果 / 验收标准（帮助 AI 明确方向）
  weekly_time?: string | null;      // 每周可投入时间节奏（帮助 AI 控制任务量）
  status: GoalStatus;
  created_at: string;
}

export interface GoalInsert extends Omit<Goal, "id" | "created_at" | "status"> {
  id?: string;
  status?: GoalStatus;
  created_at?: string;
}

export interface GoalUpdate extends Partial<Omit<Goal, "id" | "user_id">> {}

/** 目标子步骤 */
export interface GoalStep {
  id: string;
  goal_id: string;
  content: string;
  step_order: number;
  is_done: boolean;
  scheduled_date?: string | null;  // YYYY-MM-DD
  added_to_tasks: boolean;
  notes?: string | null;           // 步骤补充说明（AI 生成的原因/提示，可选）
  created_at: string;
}

export interface GoalStepInsert extends Omit<GoalStep, "id" | "created_at" | "added_to_tasks"> {
  id?: string;
  added_to_tasks?: boolean;
  created_at?: string;
}

/** AI 拆解结果中的一条步骤（客户端编辑态 / breakdown 接口返回） */
export interface AIGoalStep {
  content: string;
  day_offset: number;          // 从今天起的自然日偏移（0 = 今天）
  scheduled_date: string | null; // YYYY-MM-DD（本地时区）
  notes?: string | null;       // 步骤补充说明（可选）
}

/* ----------------------------------------------------------------
 * 成就徽章
 * ---------------------------------------------------------------- */

export type AchievementBadgeCode =
  | "focus_rookie"       // 专注新秀（4 番茄）
  | "deep_focused"      // 深度专注者（8 番茄）
  | "flow_master"       // 心流大师（12 番茄）
  | "review_rookie"     // 复习新秀（毕业 3 卡）
  | "review_master";    // 复习达人（毕业 10 卡）

export interface Achievement {
  id: string;
  user_id: string;
  badge_code: AchievementBadgeCode | string;
  badge_name: string;
  description?: string | null;
  unlocked_at: string;
  progress_value: number;
  metadata?: Record<string, unknown> | null;
}

export interface AchievementInsert extends Omit<Achievement, "id" | "unlocked_at"> {
  id?: string;
  unlocked_at?: string;
}

/* ----------------------------------------------------------------
 * 对话教练聊天历史（会话记忆）
 * ---------------------------------------------------------------- */

/** 单条聊天消息（持久化到 chat_messages 表） */
export interface ChatMessageRow {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  citations?: { url: string; title?: string; snippet?: string }[] | null;
  meta?: {
    mock?: boolean;
    knowledge_hit?: { id: string; title: string; emoji: string } | null;
    web_searched?: boolean;
    action_hint?: boolean;
  } | null;
  created_at: string;
}

export interface ChatMessageInsert extends Omit<ChatMessageRow, "id" | "created_at"> {
  id?: string;
  created_at?: string;
}

/** Supabase Database 整体类型（与 supabase-js 泛型兼容） */
export interface MindFlowDatabase {
  public: {
    Tables: {
      tasks: {
        Row: Task;
        Insert: TaskInsert;
        Update: TaskUpdate;
      };
      diary_entries: {
        Row: DiaryEntry;
        Insert: DiaryEntryInsert;
        Update: Partial<DiaryEntryInsert>;
      };
      reviews: {
        Row: Review;
        Insert: ReviewInsert;
        Update: Partial<ReviewInsert>;
      };
      focus_sessions: {
        Row: FocusSession;
        Insert: FocusSessionInsert;
        Update: Partial<FocusSessionInsert>;
      };
      goals: {
        Row: Goal;
        Insert: GoalInsert;
        Update: GoalUpdate;
      };
      goal_steps: {
        Row: GoalStep;
        Insert: GoalStepInsert;
        Update: Partial<GoalStepInsert>;
      };
      achievements: {
        Row: Achievement;
        Insert: AchievementInsert;
        Update: Partial<AchievementInsert>;
      };
      chat_messages: {
        Row: ChatMessageRow;
        Insert: ChatMessageInsert;
        Update: Partial<ChatMessageInsert>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

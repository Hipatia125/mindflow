import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromHeaders } from "@/lib/supabase/client";
import {
  shouldUseMock,
  mockListTasks,
  mockListFocusSessions,
  mockListDiaryEntries,
  mockListGoals,
  mockListGoalSteps,
  mockFocusStats,
  mockReviewStats,
} from "@/lib/supabase/mock-store";
import { toDateISO, shiftDateISO } from "@/lib/utils";

// DeepSeek Responses API 端点（支持 web_search 联网搜索工具）
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/responses";
const DEEPSEEK_MODEL = "deepseek-chat";

/* ================================================================
 * 心理知识库（CBT 认知重构 + 正念 + 情绪调节 + 呼吸练习）
 * 当 AI 回复涉及对应场景时，可直接用这些专业模板推荐
 * ================================================================ */
export const PSYCHOLOGY_KNOWLEDGE = [
  {
    id: "cbt_three_cols",
    title: "CBT 三栏法·认知重构练习",
    category: "CBT 认知行为",
    emoji: "🧠",
    time: "5~8 分钟",
    scenario: ["情绪低落", "自我批评", "想不开某件事"],
    content: [
      "第 1 栏「自动想法」：把脑海里反复出现的那句负面声音原封不动写下来（例：我又搞砸了，真没用）",
      "第 2 栏「认知歪曲类型」：判断它属于哪一种（全或无 / 过度概括 / 心理过滤 / 否定正面 / 妄下结论 / 放大缩小 / 情绪化推理 / 应该陈述 / 贴标签 / 个人化）",
      "第 3 栏「合理回应」：写一个更温和、更符合事实的替代想法（例：这次没做好，但不代表我没用，下次有经验了）",
      "✨ 小技巧：做完后给自己一个 0~100 的情绪强度评分，通常会从 80+ 降到 40 以下",
    ],
  },
  {
    id: "mindful_body_scan",
    title: "正念身体扫描引导",
    category: "正念冥想",
    emoji: "🧘",
    time: "3 分钟",
    scenario: ["焦虑", "紧张", "身体酸痛", "睡不着"],
    content: [
      "坐直或躺下，闭上眼睛，做 3 次缓慢的深呼吸（4 秒吸 · 6 秒呼）",
      "注意力从头顶开始：感受头皮的温度，有没有紧绷？不用改变它，只是觉察。",
      "慢慢下移：额头 → 眉毛 → 眼睛 → 脸颊 → 下巴 → 脖子",
      "肩膀：很多压力都积聚在这里，想象把它们像衣服一样轻轻卸下",
      "胸口 → 肚子 → 手臂 → 手掌 → 大腿 → 小腿 → 脚掌",
      "最后花 30 秒，全身扫描一次，说一句：「我看见你了，谢谢你陪我到今天」",
    ],
  },
  {
    id: "breathing_478",
    title: "4-7-8 呼吸放松法",
    category: "呼吸练习",
    emoji: "🌬️",
    time: "1~2 分钟",
    scenario: ["焦虑发作", "想发火", "睡前平静"],
    content: [
      "用鼻子【吸气 4 秒】（1-2-3-4），感受腹部隆起",
      "【屏息 7 秒】（1-2-3-4-5-6-7），不用用力，只是停留",
      "用嘴巴【慢慢呼气 8 秒】（1-2-3-4-5-6-7-8），嘴唇微闭像吹蜡烛",
      "重复 3~4 轮。副交感神经会在 3 轮后激活，心率明显下降",
      "⚠️ 头晕请立刻停下，改成自然呼吸",
    ],
  },
  {
    id: "emotion_name",
    title: "情绪命名法（情绪粒度）",
    category: "情绪觉察",
    emoji: "🎭",
    time: "1 分钟",
    scenario: ["心里很乱说不清", "无名火", "情绪卡住"],
    content: [
      "情绪粒度越高，调节能力越强。试试不要只说「我不好」，而是：",
      "🔴 高激活情绪：愤怒 · 焦虑 · 兴奋 · 挫败 · 烦躁 · 害怕 · 妒忌 · 委屈",
      "🟡 中激活情绪：紧张 · 尴尬 · 期待 · 失望 · 惊讶 · 怀念 · 无聊",
      "🔵 低激活情绪：疲惫 · 孤独 · 空虚 · 平静 · 放松 · 忧郁 · 感恩 · 满足",
      "🟢 混合情绪：又期待又害怕 · 松了口气又有点遗憾（这些是正常的！）",
      "说出它的名字，它就从「一团黑云」变成「可以被理解的情绪」",
    ],
  },
  {
    id: "gratitude_three",
    title: "三好事·感恩练习",
    category: "积极心理学",
    emoji: "✨",
    time: "2 分钟",
    scenario: ["情绪低谷", "一天结束复盘", "长期坚持抗抑郁"],
    content: [
      "睡前或日记本上写下今天的 3 件小好事：",
      "1️⃣ 一件「人际」的小事（例：同事帮我递了一杯水 / 陌生人对我笑了）",
      "2️⃣ 一件「成就」的小事（例：今天完成了第一个番茄钟 / 读了一页书）",
      "3️⃣ 一件「感官」的小事（例：今天的云真好看 / 奶茶温度刚好 / 风吹得很舒服）",
      "研究表明：坚持 21 天会显著降低抑郁量表得分。别小看「小」的力量 🌱",
    ],
  },
  {
    id: "five_senses_grounding",
    title: "5-4-3-2-1 接地法（焦虑急救）",
    category: "情绪急救",
    emoji: "🌳",
    time: "1~2 分钟",
    scenario: ["惊恐发作前", "突然崩溃", "心慌手抖", "解离感"],
    content: [
      "这是创伤心理学最常用的接地技术，把注意力从「脑中风暴」拉回当下身体：",
      "👀 说出 5 个你看见的东西（桌子 · 杯子 · 绿色植物 …）",
      "🤚 触摸 4 种不同质感（衣服布料 · 桌面凉感 · 头发 · 钥匙）",
      "👂 听见 3 种声音（空调声 · 远处车声 · 呼吸声）",
      "👃 闻到 2 种气味（咖啡香 · 洗衣液 · 空气清新剂）",
      "👅 品尝 1 种味道（嘴里的薄荷味 · 刚喝的水味）",
      "做完就回到「此刻我是安全的」，焦虑评分会立即降 30%+",
    ],
  },
  {
    id: "micro_action",
    title: "5 分钟启动法（对抗拖延）",
    category: "行动力",
    emoji: "⚡",
    time: "5 分钟",
    scenario: ["不想动", "任务大到焦虑", "完美主义卡壳"],
    content: [
      "完美主义的反面不是「随便做」，而是「先做 5 分钟」。",
      "① 告诉自己：我只做 5 分钟就停，5 分钟而已！",
      "② 只做「最小第一步」：写一句话就行 · 打开文档就行 · 查 1 条信息就行",
      "③ 5 分钟后，你拥有「继续」或「停止」的选择权，不用有压力",
      "🧪 实验数据：90% 的人做了 5 分钟后会自然选择继续。启动惯性 > 意志力",
    ],
  },
  {
    id: "sleep_winddown",
    title: "睡前 10 分钟·关机仪式",
    category: "睡眠",
    emoji: "🌙",
    time: "10 分钟",
    scenario: ["睡不着", "脑子停不下来", "睡前刷手机焦虑"],
    content: [
      "「睡前仪式」是给大脑一个「要进入睡眠模式啦」的信号：",
      "📵 放下手机（飞行模式，屏幕朝外）—— 蓝光会抑制褪黑素分泌",
      "✍️  写下「明日三件事」 + 「脑中还挂着的事」，说一句：「它们明天再处理」",
      "🫖 温水泡脚或喝半杯温牛奶（体温先升后降，触发睡意）",
      "🧘 做一次 3 轮 4-7-8 呼吸（同上）",
      "💡 灯光调到最暗，想象自己躺在一片草地上，慢慢的…慢慢的…",
    ],
  },
];

/** 心理成长教练系统提示词（含上下文联动 + 专业知识调用指导） */
const COACH_SYSTEM_PROMPT = `你是 MindFlow 用户的专属「心理成长教练」。

## 你的角色
- 温柔、有耐心、不带评判的倾听者
- 善于共情，能准确识别用户的情绪（焦虑 / 疲惫 / 委屈 / 成就感 / 迷茫等）
- 提供具体、可执行的小建议，而不是空泛的鸡汤
- 拥有联网搜索能力，可以搜索最新的心理学知识、自我成长方法、时间管理技巧等信息
- 当用户上下文数据中已经提供了他的真实生活信息（待办、日记、专注、目标等），请结合他的实际情况给出个性化建议，而不是泛泛而谈

## 对话连贯性（重要）
- 你是连续陪伴的同一个人，要结合本轮对话历史，记住用户前面说过的话和情绪
- 不要每次都重新寒暄、不要重复问同样的问题、不要忘记前面已经聊到哪
- 如果用户在对话里提到过某件事、某个人、某个目标，后续可以自然地接续，而不是当第一次听说

## 倾诉 vs 求助（分轨处理）
- 用户在倾诉情绪 → 先稳稳接住：共情、陪伴、让他感觉被听见，不打断、不急着列建议
- 用户明确求方法 → 才给 1~2 个具体、可执行的建议
- 判断不清时，倾向先共情 + 用一个开放性问题确认他此刻更需要「被听见」还是「要办法」

## 联网搜索要求
- 当用户询问最新信息、研究数据、书籍推荐、具体方法时，请结合联网搜索结果，为用户提供最新、最准确的信息。
- 搜索时使用简洁的关键词，避免过长的查询语句。
- 引用搜索结果时，请注明信息来源。
- 对于情绪倾诉类问题，不需要联网搜索，直接共情回复即可。

## 专业知识库（当匹配到用户场景时，请直接引用对应练习）
你内置了以下专业心理练习模板。当用户的需求匹配某个场景时，请把对应练习推荐给用户，并引导用户完成（使用 Markdown 格式排版，保留原有序号和 emoji）：

### CBT 三栏法·认知重构练习
适用场景：情绪低落、自我批评、想不开某件事
步骤：
1. 第 1 栏「自动想法」：把脑海里反复出现的那句负面声音原封不动写下来
2. 第 2 栏「认知歪曲类型」：判断它属于哪一种（全或无 / 过度概括 / 心理过滤 / 否定正面 / 妄下结论 / 放大缩小 / 情绪化推理 / 应该陈述 / 贴标签 / 个人化）
3. 第 3 栏「合理回应」：写一个更温和、更符合事实的替代想法

### 正念身体扫描引导
适用场景：焦虑、紧张、身体酸痛、睡不着
步骤：坐直或躺下 → 3 次深呼吸 → 从头顶到脚掌逐一觉察 → 最后说「我看见你了，谢谢你陪我到今天」

### 4-7-8 呼吸放松法
适用场景：焦虑发作、想发火、睡前平静
步骤：鼻吸 4 秒 → 屏息 7 秒 → 嘴呼 8 秒 → 重复 3~4 轮

### 情绪命名法
适用场景：心里很乱说不清、无名火、情绪卡住
引导用户不要只说「我不好」，而是从高/中/低激活情绪表里找到具体名称

### 三好事·感恩练习
适用场景：情绪低谷、睡前复盘
写下今天的 3 件小好事：1 件人际 + 1 件成就 + 1 件感官

### 5-4-3-2-1 接地法
适用场景：惊恐发作前、突然崩溃、心慌手抖
5 个视觉 + 4 个触觉 + 3 个听觉 + 2 个嗅觉 + 1 个味觉

### 5 分钟启动法
适用场景：不想动、任务大到焦虑、完美主义卡壳
告诉自己只做 5 分钟就停 → 做最小第一步 → 之后自由选择继续或停止

### 睡前 10 分钟·关机仪式
适用场景：睡不着、脑子停不下来
放下手机 → 写明日三件事 → 泡脚/温牛奶 → 4-7-8 呼吸 → 关灯

## 你的风格
- 使用温暖的中文表达，像一位可靠的朋友
- 回复简洁有力，控制在 200 字以内，但推荐专业练习时可适当扩展结构化步骤
- emoji 收敛：每轮 1~2 个（🌱、💪、✨ 等），别每句都带
- 当用户倾诉压力时，先共情再建议

## 回复原则
1. 先共情：用用户自己的词反馈（如「你说到 XX 的时候…」），少用「听起来你今天真的承受了不少」这类固定句式
2. 结合上下文数据时引用具体数字（「你今天已完成 3 个待办、专注了 40 分钟」），别泛泛说「你很努力」
3. 用户只是倾诉情绪时 → 陪伴共情、不打断、不急着给建议；用户明确求助时才给 1~2 个具体建议（或匹配专业练习）
4. 措辞少用「你应该 / 你要」，改用「或许可以 / 如果你愿意」
5. 结尾只问一个开放性问题，鼓励继续表达
6. 涉及最新信息（研究、方法、书籍）时主动联网搜索后再答，确保准确`;

/* ================================================================
 * Responses API 数据结构 & 解析
 * ================================================================ */

interface OutputMessage {
  type: string;
  role?: string;
  content?: {
    type: string;
    text: string;
    annotations?: Array<{
      type: string;
      start_index?: number;
      end_index?: number;
      url_citation?: { url: string; title?: string; snippet?: string };
    }>;
  }[];
}

interface WebSearchCall {
  type: string;
  id?: string;
  status?: string;
  results?: Array<{
    title: string;
    url: string;
    snippet?: string;
    content?: string;
  }>;
}

interface ResponsesAPIResponse {
  id: string;
  model: string;
  output: (OutputMessage | WebSearchCall)[];
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  web_search_results?: Array<{ title: string; url: string; snippet: string }>;
}

function parseResponseText(data: ResponsesAPIResponse): {
  text: string;
  citations: { url: string; title?: string; snippet?: string }[];
} {
  let text = "";
  const citations: { url: string; title?: string; snippet?: string }[] = [];
  const seenUrls = new Set<string>();

  for (const msg of data.output || []) {
    if (msg.type === "message" && "content" in msg && msg.content) {
      for (const block of msg.content) {
        if (block.type === "output_text") {
          text += block.text || "";
          if (block.annotations) {
            for (const ann of block.annotations) {
              if (ann.type === "url_citation" && ann.url_citation && ann.url_citation.url) {
                if (!seenUrls.has(ann.url_citation.url)) {
                  seenUrls.add(ann.url_citation.url);
                  citations.push(ann.url_citation);
                }
              }
            }
          }
        }
      }
    }
    if (msg.type === "web_search_call" && "results" in msg && msg.results) {
      for (const r of msg.results) {
        if (r.url && !seenUrls.has(r.url)) {
          seenUrls.add(r.url);
          citations.push({ url: r.url, title: r.title, snippet: r.snippet || r.content });
        }
      }
    }
  }

  if (data.web_search_results) {
    for (const r of data.web_search_results) {
      if (r.url && !seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        citations.push({ url: r.url, title: r.title, snippet: r.snippet });
      }
    }
  }

  return { text, citations };
}

/* ================================================================
 * 上下文联动：从 MindFlow 拉取用户当前状态（今日数据）
 * ================================================================ */

interface UserContext {
  today: string;
  tasks: { pending: number; completed: number; ai_gen_count: number };
  focus: { todayMinutes: number; sessionsCount: number; targetMinutes: number };
  diary: { todayMood: string | null; lastMoodNote: string | null };
  goals: { activeGoals: string[]; totalSteps: number; doneSteps: number };
}

async function buildUserContext(uid: string): Promise<UserContext> {
  const today = toDateISO(new Date());
  const empty: UserContext = {
    today,
    tasks: { pending: 0, completed: 0, ai_gen_count: 0 },
    focus: { todayMinutes: 0, sessionsCount: 0, targetMinutes: 120 },
    diary: { todayMood: null, lastMoodNote: null },
    goals: { activeGoals: [], totalSteps: 0, doneSteps: 0 },
  };

  try {
    if (shouldUseMock()) {
      const tasks = mockListTasks(uid, today);
      const stats = mockFocusStats(uid);
      const diaries = mockListDiaryEntries(uid);
      const goals = mockListGoals(uid, "active");

      let totalSteps = 0, doneSteps = 0;
      for (const g of goals) {
        const steps = mockListGoalSteps(g.id);
        totalSteps += steps.length;
        doneSteps += steps.filter((s) => s.is_done).length;
      }

      const todayDiaries = diaries.filter((d) => (d.created_at || "").slice(0, 10) === today);
      const lastDiary = todayDiaries[todayDiaries.length - 1];
      const todayMood = lastDiary?.emotion_analysis?.emotion || null;
      const todayNote = lastDiary?.raw_text
        ? String(lastDiary.raw_text).slice(0, 120)
        : null;

      return {
        today,
        tasks: {
          pending: tasks.filter((t) => !t.is_done).length,
          completed: tasks.filter((t) => t.is_done).length,
          ai_gen_count: tasks.filter((t) => t.source === "ai").length,
        },
        focus: {
          todayMinutes: stats.todayMinutes,
          sessionsCount:
            mockListFocusSessions(uid).filter(
              (f) => f.phase === "focus" && f.started_at.slice(0, 10) === today
            ).length,
          targetMinutes: stats.targetMinutes,
        },
        diary: { todayMood, lastMoodNote: todayNote },
        goals: {
          activeGoals: goals.slice(0, 3).map((g) => g.title),
          totalSteps,
          doneSteps,
        },
      };
    }

    const sb = getSupabaseAdmin();
    const result: UserContext = { ...empty };

    try {
      // 并行查询各模块（任一失败不影响其他）
      const [taskRes, focusRes, diaryRes, goalRes] = await Promise.allSettled([
        sb.from("tasks").select("is_done, source").eq("user_id", uid),
        sb.from("focus_sessions").select("duration_minutes, phase, started_at, intent")
          .eq("user_id", uid).eq("phase", "focus")
          .gte("started_at", `${today}T00:00:00`).lte("started_at", `${today}T23:59:59`),
        sb.from("diary_entries").select("raw_text, emotion_analysis, created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(3),
        sb.from("goals").select("id, title").eq("user_id", uid).eq("status", "active"),
      ]);

      if (taskRes.status === "fulfilled" && !taskRes.value.error) {
        const rows = (taskRes.value.data || []) as any[];
        result.tasks = {
          pending: rows.filter((t) => !t.is_done).length,
          completed: rows.filter((t) => t.is_done).length,
          ai_gen_count: rows.filter((t) => t.source === "ai").length,
        };
      }

      if (focusRes.status === "fulfilled" && !focusRes.value.error) {
        const rows = (focusRes.value.data || []) as any[];
        result.focus = {
          todayMinutes: rows.reduce((s, r) => s + (r.duration_minutes || 0), 0),
          sessionsCount: rows.length,
          targetMinutes: 120,
        };
      }

      if (diaryRes.status === "fulfilled" && !diaryRes.value.error) {
        const rows = (diaryRes.value.data || []) as any[];
        const todays = rows.filter((d) => (d.created_at || "").slice(0, 10) === today);
        const last = todays[0];
        if (last) {
          result.diary.todayMood = last.emotion_analysis?.emotion || null;
          result.diary.lastMoodNote = last.raw_text ? String(last.raw_text).slice(0, 120) : null;
        }
      }

      if (goalRes.status === "fulfilled" && !goalRes.value.error) {
        const goals = (goalRes.value.data || []) as any[];
        result.goals.activeGoals = goals.slice(0, 3).map((g) => g.title);
        // 统计子步骤完成情况
        try {
          const ids = goals.map((g) => g.id);
          if (ids.length > 0) {
            const { data: steps } = await sb.from("goal_steps").select("is_done").in("goal_id", ids);
            const arr = (steps || []) as any[];
            result.goals.totalSteps = arr.length;
            result.goals.doneSteps = arr.filter((s) => s.is_done).length;
          }
        } catch { /* 忽略 */ }
      }
    } catch { /* 任一步骤失败，返回已经拿到的部分数据 */ }

    return result;
  } catch {
    return empty;
  }
}

/** 把 UserContext 拼成自然语言注入的摘要 */
function formatContextSummary(ctx: UserContext): string {
  const lines: string[] = [`【用户今日 MindFlow 数据摘要（${ctx.today}）】`];
  lines.push(`待办：进行中 ${ctx.tasks.pending} 项，已完成 ${ctx.tasks.completed} 项${ctx.tasks.ai_gen_count > 0 ? `（其中 ${ctx.tasks.ai_gen_count} 项来自 AI 智能排序）` : ""}`);
  lines.push(`专注：今日累计 ${ctx.focus.todayMinutes} 分钟（目标 ${ctx.focus.targetMinutes} 分钟），共完成 ${ctx.focus.sessionsCount} 次专注会话`);
  if (ctx.diary.todayMood) {
    lines.push(`日记：今日记录了心情「${ctx.diary.todayMood}」${ctx.diary.lastMoodNote ? `，备注：${ctx.diary.lastMoodNote}` : ""}`);
  } else {
    lines.push(`日记：今日尚未写日记`);
  }
  if (ctx.goals.activeGoals.length > 0) {
    lines.push(`长期目标：正在进行的目标 ${ctx.goals.activeGoals.length} 个${ctx.goals.activeGoals.length ? "（" + ctx.goals.activeGoals.join("、") + "）" : ""}，子步骤进度 ${ctx.goals.doneSteps}/${ctx.goals.totalSteps || "-"}`);
  } else {
    lines.push(`长期目标：尚未设置长期目标`);
  }
  lines.push("（请根据这些真实数据给出个性化、有温度的回应）");
  return lines.join("\n");
}

/* ================================================================
 * 快捷功能处理器（special_action）
 * ================================================================ */

type SpecialAction =
  | "analyze_today_diary"
  | "breakdown_goal"
  | "weekly_focus_plan"
  | "emotion_review"
  | "quick_mood_check"
  | "recommend_exercise"
  | "none";

function resolveSpecialAction(action?: string | null): SpecialAction {
  const valid: SpecialAction[] = [
    "analyze_today_diary",
    "breakdown_goal",
    "weekly_focus_plan",
    "emotion_review",
    "quick_mood_check",
    "recommend_exercise",
  ];
  return (valid.includes(action as any) ? action : "none") as SpecialAction;
}

/** 快捷功能提示词（覆盖用户最后一条消息，或者追加指令） */
function buildActionPrompt(action: SpecialAction, ctx: UserContext, userLastText: string): string | null {
  switch (action) {
    case "analyze_today_diary": {
      if (!ctx.diary.todayMood && !ctx.diary.lastMoodNote) {
        return null; // 没数据 → 后端返回特殊提示
      }
      return [
        "【任务：分析今日日记情绪与成长点】",
        `今日心情记录：${ctx.diary.todayMood || "无"}`,
        ctx.diary.lastMoodNote ? `日记内容片段：${ctx.diary.lastMoodNote}` : "",
        `今日专注：${ctx.focus.todayMinutes} 分钟，完成待办 ${ctx.tasks.completed} 项`,
        "请：① 用 1 句话共情用户今天的情绪；② 从日记中提炼 1 个正向成长点；③ 如果有值得担忧的情绪信号，给出温和的建议（1~2 条，结合专业知识库中合适的练习）；④ 最后问一个开放性问题引导用户更深入的自我觉察。",
      ].filter(Boolean).join("\n");
    }
    case "breakdown_goal": {
      if (ctx.goals.activeGoals.length === 0) return null;
      const goal = ctx.goals.activeGoals[0];
      return [
        "【任务：把正在进行的第一个长期目标拆解成本周可执行的 3~5 个最小行动】",
        `当前目标：${goal}`,
        `进度：${ctx.goals.doneSteps}/${ctx.goals.totalSteps}`,
        `用户今天待办已有 ${ctx.tasks.pending} 项在进行，避免安排过多。请：① 先肯定他已经在推进的努力；② 本周 3~5 个每天 ≤ 30 分钟的最小行动；③ 用温柔的语气收尾。`,
      ].join("\n");
    }
    case "weekly_focus_plan": {
      return [
        "【任务：生成本周专注计划】",
        `本周已专注情况：本周到今天为止日均 ${Math.round(ctx.focus.todayMinutes / 1)} 分钟，目标每日 120 分钟。`,
        `当前进行中待办 ${ctx.tasks.pending} 项。`,
        "请为用户规划本周剩下的专注节奏：① 给出本周剩余天数的推荐专注时长；② 推荐 1~2 个专注工作法（如番茄钟 25+5 / 90+20 / 52+17 并解释适用场景）；③ 提醒劳逸结合的自我关怀事项。",
      ].join("\n");
    }
    case "emotion_review": {
      return [
        "【任务：情绪复盘引导】",
        "请一步步引导用户做一次结构化情绪复盘。按以下 4 步，每步只问一个问题，等用户回答后再继续：",
        "Step 1（觉察）：先问——「如果要用一种颜色或天气形容此刻的心情，你会选什么？」",
        "Step 2（定位）：用户回答后，再问——「这份感受主要是在身体的哪个部位？比如胸口、肩膀、胃…」",
        "Step 3（命名）：再问——「如果给这种感受起个具体名字（比如：委屈、烦躁、孤独、平静、期待），你觉得最接近哪个？」",
        "Step 4（行动）：最后推荐一个适合他当前状态的专业心理练习（从内置知识库中选），并说「要不要我们现在花 3 分钟做做看？」",
        `注意：本次对话中，你只需要先问 Step 1 的问题，不要直接问全部四步。用户之前说的最后一句话是：「${userLastText}」（若为空则直接开启 Step 1）`,
      ].join("\n");
    }
    case "quick_mood_check": {
      return [
        "【任务：快速心情签到】",
        "请用温暖、鼓励的语气回应，并补充：",
        "① 先简单回应他刚才说的话/感受",
        "② 如果他说的是负面感受 → 匹配推荐 5-4-3-2-1 接地法 或 4-7-8 呼吸法（二选一，根据场景）",
        "③ 如果他说的是正面感受 → 推荐 三好事·感恩练习",
        "④ 如果他还没有说任何感受 → 给 5 个心情选项（😊 平静满足 / 😔 低落 / 😤 烦躁 / 😰 焦虑 / 😶 麻木）让他点选一个",
        `用户说的最后一句话：「${userLastText}」`,
      ].join("\n");
    }
    case "recommend_exercise": {
      return [
        "【任务：推荐最适合当前状态的 2~3 个专业心理练习】",
        "请结合用户当前状态（从以下 MindFlow 数据判断）：",
        `今日专注：${ctx.focus.todayMinutes} 分钟 · 待办 ${ctx.tasks.pending} 项（忙不忙？）`,
        `今日日记心情：${ctx.diary.todayMood || "未记录"}`,
        `正在进行目标：${ctx.goals.activeGoals.length ? ctx.goals.activeGoals.join("、") : "无"}`,
        `用户最后说：「${userLastText}」`,
        "请：① 简短共情/肯定；② 从知识库中选出 2~3 个匹配他状态的练习，每个练习用 1 句说明为什么适合他 + 时长 + 适用场景，结构化列出；③ 最后问「要不要我们立刻开始其中一个？」",
      ].join("\n");
    }
    default:
      return null;
  }
}

/* ================================================================
 * Mock 回复（未配置 API Key 时的兜底）
 * ================================================================ */
function getMockReply(messages: { role: string; content: string }[]): string {
  const last = messages[messages.length - 1]?.content || "";
  const hasStress = /累|压力|焦虑|烦|难过|不开心|哭|崩溃|撑/.test(last);
  const hasHappy = /开心|好棒|完成|开心|感谢|顺利/.test(last);
  if (hasStress) {
    return "听你说到这些，我挺心疼你的 🤗 现在肩膀是不是也绷得紧紧的？\n\n我们先花 1 分钟让身体缓一缓好不好？做一个 4-7-8 呼吸：\n· 鼻吸气 4 秒\n· 屏息 7 秒\n· 嘴呼气 8 秒（像吹蜡烛）\n\n3 轮之后，再告诉我身体的感觉有没有好一点 🌱";
  }
  if (hasHappy) {
    return "哇，太好了呀 ✨ 听到你说顺利，我都跟着开心起来！\n\n你觉得今天这份好心情，最大的功劳是哪件小事？有时候回顾一下它，这份满足会留更久～";
  }
  const samples = [
    "嗯～我在认真听。你愿意多说一点吗？比如这种感觉是从什么时候开始的？🤗",
    "收到啦～先问你一个小问题：如果要给此刻的情绪起一个具体名字（委屈 / 烦躁 / 疲惫 / 平静 / 期待 / 孤独…），你觉得最像哪一个？",
    "我看到你啦～ 我们不急着解决问题。先花 10 秒，做一个缓慢的深呼吸好不好？ 🌱",
    "谢谢你愿意和我说这些 💛 你觉得，现在最需要的是「有人听你说」还是「一起想几个小办法」？",
  ];
  return samples[Math.floor(Math.random() * samples.length)];
}

/* ================================================================
 * POST 主逻辑
 * ================================================================ */
export async function POST(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const body = (await req.json()) as {
      messages: { role: "user" | "assistant" | "system"; content: string }[];
      special_action?: string;
      emotion?: string;       // 前端选择的情绪标签
    };

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { ok: false, error: "消息内容不能为空" },
        { status: 400 }
      );
    }

    const action = resolveSpecialAction(body.special_action);
    const userLastText =
      [...body.messages].reverse().find((m) => m.role === "user")?.content || "";

    // —— 上下文联动：取 MindFlow 真实数据摘要 ——
    const ctx = await buildUserContext(uid);
    const ctxText = formatContextSummary(ctx);

    // —— 快捷功能：处理特殊 prompt / 空数据提示 ——
    const actionPrompt = buildActionPrompt(action, ctx, userLastText);
    const actionEmptyHint: string | null = (() => {
      if (action === "analyze_today_diary" && !ctx.diary.todayMood && !ctx.diary.lastMoodNote) {
        return "你今天还没写日记哦～ 去工作台的「情绪日记」写一条，再来我帮你分析呀 ✍️";
      }
      if (action === "breakdown_goal" && ctx.goals.activeGoals.length === 0) {
        return "你还没有设置长期目标呢～ 去工作台的「长期目标」里新建一个，我再帮你拆成本周行动哦 🎯";
      }
      return null;
    })();

    if (actionEmptyHint) {
      return NextResponse.json({
        ok: true,
        reply: actionEmptyHint,
        citations: [],
        mock: !!process.env.DEEPSEEK_API_KEY ? false : true,
        action_hint: true,
      });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || apiKey.startsWith("your_")) {
      // 快捷功能未配置密钥时，返回对应定制模拟回复
      const fallback =
        actionPrompt
          ? "（模拟回复）" + (() => {
              if (action === "emotion_review") return "好呀～我们来做一次情绪复盘 🎭\n\n如果要用一种颜色或天气形容此刻的心情，你会选什么？";
              if (action === "recommend_exercise") return "给你推荐 3 个专业练习哦 ✨\n\n① 🧘 正念身体扫描（3 分钟）- 焦虑/紧张时最佳\n② 🌬️ 4-7-8 呼吸法（1 分钟）- 立刻能做的放松\n③ 🎭 情绪命名法（1 分钟）- 帮你把感受说清楚\n\n要不要我们立刻开始 4-7-8？";
              if (action === "weekly_focus_plan") return `（模拟）本周专注计划 🌱\n\n· 日均目标：${ctx.focus.targetMinutes} 分钟（6+ 个番茄钟）\n· 节奏建议：周一/三/五冲 4 番茄，周二/周四轻松 2 番茄，周末随缘\n· 工作法推荐：番茄钟 25+5（最通用入门）\n\n记得每专注 2 个番茄钟站起来喝口水哦～`;
              if (action === "quick_mood_check") return "选一下现在的心情吧 👇\n\n😊 平静满足   😔 低落   😤 烦躁   😰 焦虑   😶 麻木";
              if (action === "analyze_today_diary") return "（模拟）我看了你的日记呀 💛\n\n今天整体状态不错，写了「" + (ctx.diary.lastMoodNote || "") + "」，能感受到你在认真生活。继续保持哦～";
              if (action === "breakdown_goal") return "（模拟）好的，帮你拆「" + ctx.goals.activeGoals[0] + "」本周行动：\n① 每天 25 分钟投入（1 个番茄钟）\n② 周三前完成前 2 个子步骤\n③ 周日复盘";
              return "好的，我来帮你！";
            })()
          : getMockReply(body.messages);
      return NextResponse.json({
        ok: true,
        reply: fallback,
        citations: [],
        mock: true,
        message: "AI 密钥未配置，返回模拟回复。请在 .env.local 中设置 DEEPSEEK_API_KEY",
      });
    }

    // —— 构建 Responses API 请求体 ——
    // 消息顺序：系统提示 → MindFlow 上下文摘要 → [可选] 快捷功能提示 → 原始对话
    const finalInput: {
      role: "system" | "user" | "assistant";
      content: { type: "input_text"; text: string }[];
    }[] = [
      {
        role: "system",
        content: [{ type: "input_text", text: COACH_SYSTEM_PROMPT }],
      },
      {
        role: "system",
        content: [{ type: "input_text", text: ctxText }],
      },
    ];

    if (actionPrompt) {
      finalInput.push({
        role: "system",
        content: [{ type: "input_text", text: actionPrompt }],
      });
    }

    // 历史对话 + 用户情绪标签（若有）
    for (const msg of body.messages) {
      let text = msg.content;
      if (msg.role === "user" && body.emotion && msg === body.messages[body.messages.length - 1]) {
        text = `（我此刻的情绪标签：${body.emotion}）${text ? "\n" + text : ""}`;
      }
      finalInput.push({
        role: msg.role as "user" | "assistant",
        content: [{ type: "input_text", text }],
      });
    }

    const responseBody = {
      model: DEEPSEEK_MODEL,
      input: finalInput,
      tools: [{ type: "web_search" as const }],
      tool_choice: "auto" as const,
      max_output_tokens: 2048,
    };

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[chat/route] 请求 DeepSeek${action !== "none" ? ` action=${action}` : ""}，web_search 已启用, messages=${body.messages.length}`,
      );
    }

    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(responseBody),
      cache: "no-store",
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[chat/route] DeepSeek API error:", response.status, errText);
      return NextResponse.json(
        { ok: false, error: `AI 服务请求失败 (HTTP ${response.status})` },
        { status: 502 }
      );
    }

    const data = (await response.json()) as ResponsesAPIResponse;
    const { text, citations } = parseResponseText(data);

    if (process.env.NODE_ENV !== "production") {
      console.log("[chat/route] 响应解析:", {
        hasText: !!text,
        textLen: text.length,
        citationsCount: citations.length,
        outputTypes: (data.output || []).map((o) => o.type),
      });
    }

    return NextResponse.json({
      ok: true,
      reply: text,
      citations,
      web_searched: citations.length > 0,
      knowledge_hit: detectKnowledgeHit(text),
      special_action_resolved: action !== "none" ? action : undefined,
      usage: data.usage,
      model: data.model,
      id: data.id,
    });
  } catch (e: any) {
    console.error("[chat/route]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "对话请求失败" },
      { status: 500 }
    );
  }
}

/** 根据关键词判断 AI 是否命中了某个专业练习 */
function detectKnowledgeHit(text: string): { id: string; title: string; emoji: string } | null {
  for (const k of PSYCHOLOGY_KNOWLEDGE) {
    // 标题关键词 或 内容关键词
    const keywords = [k.title, ...(k.scenario || []), ...k.content.slice(0, 2).map((s) => s.slice(0, 8))];
    if (keywords.some((kw) => kw && text.includes(kw.slice(0, 4)))) {
      return { id: k.id, title: k.title, emoji: k.emoji };
    }
  }
  return null;
}

/** 方便前端拉取知识库列表（GET） */
export async function GET() {
  return NextResponse.json({
    ok: true,
    knowledge: PSYCHOLOGY_KNOWLEDGE.map(({ id, title, category, emoji, time, scenario }) => ({
      id,
      title,
      category,
      emoji,
      time,
      scenario,
    })),
  });
}

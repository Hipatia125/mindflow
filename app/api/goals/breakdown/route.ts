export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromHeaders } from "@/lib/supabase/client";
import { todayISO, shiftDateISO } from "@/lib/utils";
import type { AIGoalStep } from "@/lib/supabase/types";

// DeepSeek Responses API（与 chat/route.ts 同款端点）
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/responses";
const DEEPSEEK_MODEL = "deepseek-chat";

/**
 * ================================================================
 * POST /api/goals/breakdown
 * AI 拆解长期目标为子步骤
 * Body: { title, description?, target_date?, starting_point?, success_criteria?, weekly_time?, clarifications? }
 * Returns（二选一）：
 *   - 信息足够：{ steps: AIGoalStep[], ai_generated: boolean }
 *   - 信息不足：{ needs_clarification: true, questions: string[], ai_generated: true }
 *
 * 双层生成 + 追问：
 *  1) 配置了 DEEPSEEK_API_KEY → 调用 DeepSeek，信息不足先追问（最多 1 轮），否则直接给步骤
 *  2) 无密钥 / 解析失败 / 网络错误 → 降级为本地分类模板（ai_generated: false）
 * scheduled_date 一律用本地时区（shiftDateISO）计算，避免 UTC 偏移。
 * ================================================================ */
export async function POST(req: NextRequest) {
  try {
    // 校验 user 身份（与其它 API 一致，即使拆解本身不查库）
    getUserIdFromHeaders(req.headers);

    const body = (await req.json()) as {
      title: string;
      description?: string;
      target_date?: string;
      starting_point?: string;
      success_criteria?: string;
      weekly_time?: string;
      clarifications?: { question: string; answer: string }[];
    };

    if (!body.title || body.title.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: "目标标题不能为空" },
        { status: 400 }
      );
    }

    const title = body.title.trim();
    const description = body.description?.trim() || undefined;
    const targetDate = body.target_date || undefined;
    const clarifications = Array.isArray(body.clarifications)
      ? body.clarifications.filter(
          (c) => c && typeof c.question === "string" && typeof c.answer === "string"
        )
      : [];

    const aiResult = await generateWithAI({
      title,
      description,
      targetDate,
      startingPoint: body.starting_point?.trim() || undefined,
      successCriteria: body.success_criteria?.trim() || undefined,
      weeklyTime: body.weekly_time?.trim() || undefined,
      clarifications,
    });

    // 只有第一轮（尚无追问历史）才允许返回追问；用户已回答后必须给步骤（防死循环）
    const shouldAsk =
      aiResult.needsClarification &&
      aiResult.questions.length > 0 &&
      clarifications.length === 0;

    if (shouldAsk) {
      return NextResponse.json({
        ok: true,
        needs_clarification: true,
        questions: aiResult.questions,
        ai_generated: true,
      });
    }

    const steps = aiResult.steps.length > 0
      ? aiResult.steps
      : generateLocalBreakdown(title, description, targetDate);

    return NextResponse.json({
      ok: true,
      steps,
      ai_generated: aiResult.steps.length > 0,
    });
  } catch (e: any) {
    console.error("[goals/breakdown]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "AI 拆解失败" },
      { status: 500 }
    );
  }
}

/* ================================================================
 * 1) DeepSeek AI 拆解
 * ================================================================ */

/** AI 返回的原始步骤结构（content 必填，day_offset 可缺省） */
interface RawAIStep {
  content: string;
  day_offset?: number | null;
  notes?: string | null;
}

/** 追问回答（把 AI 之前提的问题与用户答案一起回传） */
interface ClarificationAnswer {
  question: string;
  answer: string;
}

interface BreakdownInput {
  title: string;
  description?: string;
  targetDate?: string;
  startingPoint?: string;
  successCriteria?: string;
  weeklyTime?: string;
  clarifications: ClarificationAnswer[];
}

async function generateWithAI(
  input: BreakdownInput
): Promise<{ steps: AIGoalStep[]; questions: string[]; needsClarification: boolean }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey.startsWith("your_")) {
    return { steps: [], questions: [], needsClarification: false };
  }

  const { title, description, targetDate, startingPoint, successCriteria, weeklyTime, clarifications } = input;
  const today = todayISO();
  // 剩余天数（含今天；无截止日则用 null 让模型自由安排）
  const daysLeft =
    targetDate && targetDate >= today
      ? Math.round(
          (new Date(`${targetDate}T00:00:00`).getTime() -
            new Date(`${today}T00:00:00`).getTime()) /
            86400000
        )
      : null;

  const systemPrompt = [
    "你是一位擅长把长期目标拆解成可执行计划的教练。",
    "你的任务分两步：先判断信息是否足够，再决定「直接拆解」还是「追问澄清」。",
    "",
    "## 联网搜索（重要）",
    "你已接入联网搜索工具。当目标涉及具体领域（技能/考试/运动/营养/理财/健康/职业/外语等）时，请先联网搜索该领域公认的最佳实践、权威方法或常见误区，据此拆解，让每一步科学合理、有据可依。",
    "例如：目标「减脂」→ 搜索科学减脂的饮食与训练原则；目标「通过某考试」→ 搜索该考试大纲与备考方法；目标「学 React」→ 搜索官方推荐的进阶学习路径。",
    "搜索结果只用来指导你产出更专业的 steps/notes，不要在输出里贴原文或链接。",
    "",
    "## 判断信息是否足够",
    "只有当你能据此拆出「具体到能直接照做」的步骤时才直接拆。关键信息包括：",
    "- 目标里具体要做什么（技能 / 科目 / 工具 / 场景 / 考点等具体对象）；",
    "- 用户的当前起点 / 水平（决定第一步从哪开始）；",
    "- 想要达成的具体成果 / 验收标准（决定每一步朝哪走）；",
    "- 每周可投入的时间节奏（决定每天任务量）。",
    "若以上任一关键信息缺失、导致步骤只能泛泛而谈，就返回追问（needs_clarification=true）。",
    "",
    "## 拆解要求（needs_clarification=false 时给 steps）",
    "- 5~12 条具体、与目标强相关、可直接执行的步骤；",
    "- 先提取目标里的具体对象，每一步必须显式包含该对象，禁止「学习」「练习」「查资料」这类通用动作；",
    "- 每条用「具体动词 + 具体对象 + 可验证产出」句式，带数量/产物/结果；",
    "- 结合起点（第一步难度）、成果（方向）、时间节奏（单步量）定制；",
    "- 每条当天 ≤ 1 小时、30 字以内；由浅入深、有先后逻辑。",
    '反面：「学习 React」「做一次练习」。正面（目标「学会 React Hooks 高级用法」）：「用 useCallback 优化你正在写的列表组件，写出前后对比 demo」。',
    daysLeft !== null
      ? `- 截止日期剩余 ${daysLeft} 天，day_offset 全部在 0~${daysLeft} 之间且均匀覆盖整个跨度。`
      : "- 没有截止日期，按每周 2~4 步的自然节奏安排。",
    "",
    "## 追问要求（needs_clarification=true 时）",
    "- 只问 1~3 个最关键、能显著提升步骤具体度的问题；",
    "- 优先问缺失的信息：当前起点/水平、想要的具体成果、每周可投入时间；",
    "- 不要问标题/描述/起点/成果/时间里已经写明的内容；",
    "- 若 clarifications 里已有用户回答，说明信息已补全，必须直接给步骤（needs_clarification=false）。",
    "",
    "输出格式：只输出一个 JSON 对象，不要输出任何解释或代码块标记：",
    '{"needs_clarification": false, "steps": [{"content":"步骤内容","day_offset":0,"notes":"为什么这么安排的一句话"}], "questions": []}',
    "- needs_clarification=true 时 steps 为空数组、questions 为 1~3 个问题；",
    "- needs_clarification=false 时 steps 为 5~12 条、questions 为空数组；",
    "- content 用中文 30 字以内；notes 一句话 30 字以内，可为空。",
  ].join("\n");

  const userPromptLines = [
    `目标标题：${title}`,
    description ? `详细描述：${description}` : "",
    startingPoint ? `当前起点 / 水平：${startingPoint}` : "",
    successCriteria ? `想要的具体成果：${successCriteria}` : "",
    weeklyTime ? `每周可投入时间：${weeklyTime}` : "",
    targetDate ? `截止日期：${targetDate}` : "",
  ];
  if (clarifications.length > 0) {
    userPromptLines.push("（你之前追问、用户回答如下，请据此直接拆解，不要再追问）");
    for (const c of clarifications) {
      userPromptLines.push(`问：${c.question}\n答：${c.answer}`);
    }
  }
  userPromptLines.push(
    `请务必让每一步都紧扣「${title}」里的具体内容，不要输出通用的、与目标无关的步骤。`,
    "请开始。"
  );
  const userPrompt = userPromptLines.filter(Boolean).join("\n");

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userPrompt }],
          },
        ],
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
        max_output_tokens: 2048,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(
        "[goals/breakdown] DeepSeek API error:",
        response.status,
        await response.text()
      );
      return { steps: [], questions: [], needsClarification: false };
    }

    const data = await response.json();
    const text = extractResponseText(data);
    const parsed = parseAIResponse(text);

    // 追问分支：信息不足且模型给了问题 → 回传问题，让前端收集答案
    if (parsed.needsClarification && parsed.questions.length > 0) {
      return { steps: [], questions: parsed.questions, needsClarification: true };
    }

    if (parsed.steps.length === 0) {
      return { steps: [], questions: [], needsClarification: false };
    }

    const steps: AIGoalStep[] = parsed.steps.map((s, i) => {
      const dayOffset = clampDayOffset(
        typeof s.day_offset === "number" ? s.day_offset : i,
        daysLeft
      );
      return {
        content: sanitizeStep(s.content),
        day_offset: dayOffset,
        scheduled_date: shiftDateISO(today, dayOffset),
        notes: typeof s.notes === "string" && s.notes.trim() ? s.notes.trim() : null,
      };
    });

    return { steps, questions: [], needsClarification: false };
  } catch (e: any) {
    console.warn("[goals/breakdown] AI 调用失败 → 降级本地:", e?.message || e);
    return { steps: [], questions: [], needsClarification: false };
  }
}

/** 从 Responses API 响应里抽取输出文本（与 chat/route.ts 的 output 结构一致） */
function extractResponseText(data: any): string {
  try {
    const output = Array.isArray(data?.output) ? data.output : [];
    let text = "";
    for (const msg of output) {
      if (msg?.type === "message" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block?.type === "output_text" && typeof block.text === "string") {
            text += block.text;
          }
        }
      }
    }
    return text.trim();
  } catch {
    return "";
  }
}

/** 从任意数组里过滤出合法的步骤项 */
function parseRawSteps(arr: unknown): RawAIStep[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (item): item is RawAIStep =>
      item &&
      typeof item === "object" &&
      typeof (item as any).content === "string" &&
      (item as any).content.trim().length > 0
  );
}

/** 容忍 markdown 代码块围栏 / 前后噪声，解析 JSON 数组（旧协议，兼容保留） */
function parseStepsFromAI(text: string): RawAIStep[] {
  if (!text) return [];
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    return parseRawSteps(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return [];
  }
}

/** 解析 AI 响应：优先对象协议 {needs_clarification, steps, questions}，兼容旧数组协议 */
function parseAIResponse(text: string): {
  steps: RawAIStep[];
  questions: string[];
  needsClarification: boolean;
} {
  if (!text) return { steps: [], questions: [], needsClarification: false };
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const objIdx = cleaned.indexOf("{");
  const arrIdx = cleaned.indexOf("[");
  // 对象协议：以 { 开头（且 { 出现在 [ 之前）
  if (objIdx !== -1 && (arrIdx === -1 || objIdx < arrIdx)) {
    const end = cleaned.lastIndexOf("}");
    if (end > objIdx) {
      try {
        const obj = JSON.parse(cleaned.slice(objIdx, end + 1));
        const steps = parseRawSteps(obj?.steps);
        const questions = Array.isArray(obj?.questions)
          ? (obj.questions as any[])
              .filter((q) => typeof q === "string" && q.trim().length > 0)
              .map((q) => q.trim())
              .slice(0, 3)
          : [];
        return {
          steps,
          questions,
          needsClarification:
            obj?.needs_clarification === true && questions.length > 0,
        };
      } catch {
        // 对象解析失败 → 回落到数组协议
      }
    }
  }
  return { steps: parseStepsFromAI(cleaned), questions: [], needsClarification: false };
}

/** 把 day_offset 钳制到 0..daysLeft（无截止日时钳制到 0..60 防止乱跳） */
function clampDayOffset(offset: number, daysLeft: number | null): number {
  if (!Number.isFinite(offset)) return 0;
  const clamped = Math.max(0, Math.round(offset));
  return daysLeft !== null ? Math.min(clamped, Math.max(0, daysLeft)) : Math.min(clamped, 60);
}

/** 去掉多余空白与换行，限制长度 */
function sanitizeStep(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 60);
}

/* ================================================================
 * 2) 本地分类模板兜底
 * ================================================================ */

type CategoryKey =
  | "learning"
  | "fitness"
  | "finance"
  | "habit"
  | "project"
  | "travel"
  | "default";

interface Category {
  keywords: RegExp;
  templates: string[];
  notes: string[];
}

/** 按标题/描述关键词识别目标类型，每类有专属动作模板 */
const CATEGORIES: Record<CategoryKey, Category> = {
  learning: {
    keywords: /学习|学会|掌握|精通|通过|考试|考研|考证|英语|单词|读书|阅读|编程|写作|画画|乐器|吉他|钢琴|瑜伽课|课程|教程|研究/,
    templates: [
      "调研「{goal}」的基础概念，列出 3 个关键点",
      "搜索「{goal}」相关的优质资源（书/课程/文章），收藏 2~3 份",
      "搭建「{goal}」的学习环境或工具链",
      "完成「{goal}」的入门教程 / 第一个 Demo",
      "记录「{goal}」学习笔记：核心术语 + 遇到的第一个问题",
      "动手实践「{goal}」的一个完整案例",
      "总结「{goal}」的常见陷阱与最佳实践",
      "完成「{goal}」的一个小练习或作业",
      "向他人用自己的话讲解「{goal}」的核心内容",
      "复盘「{goal}」学习过程，更新知识笔记",
    ],
    notes: [
      "先建立整体认知，避免一头扎进细节",
      "好资源能少走弯路，先备料再动手",
      "环境就绪后练习才不被杂事打断",
      "跑通最小成果，建立起步信心",
      "用自己的话整理，记忆更牢固",
      "边做边学，把知识真正变成技能",
      "提前避坑，能省下大量试错时间",
      "刻意练习巩固，检验掌握程度",
      "费曼技巧：讲得清才算真懂了",
      "复盘沉淀，形成自己的方法论",
    ],
  },
  fitness: {
    keywords: /减肥|减脂|增肌|健身|跑步|跳绳|深蹲|俯卧撑|马甲线|体脂|瘦|塑形|锻炼|训练|运动|练背|练腿/,
    templates: [
      "安排一次 30 分钟的有氧运动（跑步/快走/跳绳）",
      "完成 3 组力量训练（俯卧撑/深蹲/平板支撑）",
      "记录今天的体重与围度，对比上周",
      "准备一顿高蛋白减脂餐，避开高油高糖",
      "晨起做 10 分钟拉伸，唤醒身体",
      "完成一次 45 分钟的专项训练（上肢/下肢/核心）",
      "保证 8 小时睡眠，为恢复留足时间",
      "复盘本周训练量，微调下周计划",
    ],
    notes: [
      "有氧燃脂，心率保持在舒适区间",
      "力量训练提升代谢、塑造线条",
      "用数据反馈判断方向对不对",
      "饮食占减脂七成，管住嘴更关键",
      "唤醒身体，降低受伤风险",
      "分部位训练，给肌肉留恢复时间",
      "恢复也是训练的一部分",
      "渐进加量，避开平台期",
    ],
  },
  finance: {
    keywords: /攒钱|存钱|理财|基金|股票|存到|攒够|收入|存款|省钱|记账|预算|赚钱|副业/,
    templates: [
      "盘点当前收支，做一次月度预算表",
      "给「{goal}」开一个专用储蓄账户/账本",
      "砍掉一项不必要的开支，把省下的钱转入储蓄",
      "阅读一篇理财入门文章，记录 1 个可执行技巧",
      "统计本周收入与支出，核对预算偏差",
      "研究 1 个低风险理财选项（货基/国债），了解风险",
      "复盘本月储蓄进度，调整下月预算",
      "把「{goal}」的进度可视化，贴在显眼处提醒自己",
    ],
    notes: [
      "先摸清钱去哪了，才能谈存钱",
      "专款专用，减少冲动消费",
      "小钱积少成多，是关键增量",
      "先懂风险再动手，别盲目跟风",
      "每周核对，及时纠偏",
      "从低风险起步，稳步积累",
      "看到增长，才有持续动力",
      "贴出来提醒自己，对抗惰性",
    ],
  },
  habit: {
    keywords: /习惯|坚持|每天|早起|早睡|戒掉|戒|养成|自律|按时|规律|按时|打卡/,
    templates: [
      "设定一个具体、可衡量的每日目标（如：几点起床）",
      "把新习惯绑定到现有习惯上（习惯叠加）",
      "今天完成一次目标行为，并在打卡表上记录",
      "准备一个降低启动难度的环境（把工具放显眼处）",
      "连续第 2 天执行，记录执行感受",
      "连续第 3 天执行，给自己一个小奖励",
      "盘点本周执行天数，找出中断原因并调整",
      "连续 7 天执行成功，庆祝并进入下一阶段",
    ],
    notes: [
      "目标越具体，越容易执行",
      "绑定现有习惯，降低启动难度",
      "先完成一次，获得正反馈",
      "环境设计决定行为能否发生",
      "连续性比单次强度更重要",
      "及时奖励，强化行为回路",
      "找出中断原因，调整策略",
      "完成一个周期，进入稳定期",
    ],
  },
  project: {
    keywords: /开发|搭建|做出|上线|完成|作品|网站|应用|项目|小程序|发布|做完|写完|拍完|设计|制作/,
    templates: [
      "明确「{goal}」的核心功能与验收标准",
      "拆出任务清单，标注优先级（MVP 优先）",
      "完成「{goal}」的核心模块原型/Demo",
      "完成「{goal}」的一个关键功能并自测",
      "邀请 1 位朋友试用并收集反馈",
      "根据反馈修复问题，打磨关键细节",
      "完成「{goal}」的整体验收与收尾",
      "整理复盘：记录遇到的问题与心得",
    ],
    notes: [
      "先定义清楚「做完」长什么样",
      "MVP 优先，先跑通最小闭环",
      "快速验证核心想法是否可行",
      "每一步都要可运行、可验证",
      "真实反馈比自我感觉更可靠",
      "根据反馈迭代，逼近成品",
      "对照标准检查，不留尾巴",
      "沉淀经验，下次更高效",
    ],
  },
  travel: {
    keywords: /旅行|旅游|出行|自驾|徒步|露营|出国|去.*玩|环游/,
    templates: [
      "确定目的地与大致日期，查签证/证件要求",
      "制定行程框架：天数、城市、交通衔接",
      "预订往返交通（机票/高铁/车票）",
      "预订住宿，选在交通便利的区域",
      "列出必去景点与美食清单，标注开放时间",
      "准备行李清单，按行程打包",
      "出发前确认天气、支付方式与通讯保障",
      "到达后完成第一天行程，记录旅途心情",
    ],
    notes: [
      "证件是第一道门槛，先确认",
      "先搭骨架，再填行程细节",
      "交通定下来，行程就稳了",
      "选交通便利处，省时省力",
      "提前做功课，避免踩雷",
      "按清单打包，不遗漏",
      "最后核对，有备无患",
      "开启旅程，记录沿途心情",
    ],
  },
  default: {
    keywords: /.*/,
    templates: [
      "明确「{goal}」的具体成果与衡量标准",
      "把「{goal}」拆成 3 个关键阶段",
      "为第一阶段安排本周的第一个行动",
      "完成第一阶段的一次完整执行",
      "收集反馈，调整执行细节",
      "完成第二阶段的行动",
      "复盘整体进展，安排下一阶段",
    ],
    notes: [
      "先想清楚终点，才知道方向",
      "大目标拆小，才可执行",
      "从最小行动开始，降低阻力",
      "跑通一次完整的执行闭环",
      "根据实际反馈调整，别硬扛",
      "稳步推进，保持节奏",
      "回顾调整，滚动前进",
    ],
  },
};

/** 识别目标类型（标题优先，描述补充） */
function detectCategory(title: string, description?: string): Category {
  const haystack = `${title} ${description || ""}`;
  for (const key of Object.keys(CATEGORIES) as CategoryKey[]) {
    if (key === "default") continue;
    if (CATEGORIES[key].keywords.test(haystack)) return CATEGORIES[key];
  }
  return CATEGORIES.default;
}

/**
 * 本地兜底拆解（无 AI 密钥 / AI 失败时）
 * 按目标类型取模板 + 按剩余天数自适应条数与分布。
 */
function generateLocalBreakdown(
  title: string,
  description?: string,
  targetDate?: string
): AIGoalStep[] {
  const today = todayISO();
  const daysLeft =
    targetDate && targetDate >= today
      ? Math.round(
          (new Date(`${targetDate}T00:00:00`).getTime() -
            new Date(`${today}T00:00:00`).getTime()) /
            86400000
        )
      : null;

  // 按剩余天数决定条数
  let count = 7;
  if (daysLeft !== null) {
    if (daysLeft >= 14) count = Math.min(12, 8 + Math.floor(daysLeft / 14));
    else if (daysLeft >= 7) count = 7 + Math.floor(daysLeft / 3) - 2;
    else count = Math.max(3, Math.min(6, daysLeft + 1));
  }

  const category = detectCategory(title, description);
  const templates = category.templates;

  const steps: AIGoalStep[] = [];
  for (let i = 0; i < count; i++) {
    // 模板可重复循环；条数超过模板数时追加通用步骤
    const isGeneric = i >= templates.length;
    const template = templates[i % templates.length];
    const genericExtra = isGeneric
      ? `围绕「${title}」推进一个具体的子任务`
      : template.replace(/\{goal\}/g, title.length > 12 ? title.slice(0, 12) + "…" : title);
    // 附一句「为什么这么安排 / 怎么做」的提示；超出模板数的通用步骤用通用提示
    const note = isGeneric
      ? "围绕核心目标持续推进，保持节奏"
      : category.notes[i % category.notes.length] ?? null;

    // 日期分布：有截止日 → 均匀铺开；无 → 每周 2~4 步的自然节奏（首步今天）
    let dayOffset: number;
    if (daysLeft !== null) {
      dayOffset = Math.round((i / Math.max(1, count - 1)) * daysLeft);
    } else {
      dayOffset = i === 0 ? 0 : 1 + Math.floor((i - 1) / 3) * 3 + (i - 1) % 3;
    }

    steps.push({
      content: genericExtra,
      day_offset: dayOffset,
      scheduled_date: shiftDateISO(today, dayOffset),
      notes: note,
    });
  }

  return steps;
}

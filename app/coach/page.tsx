"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Sparkles,
  Loader2,
  RefreshCw,
  BookOpenCheck,
  BrainCircuit,
  TrendingUp,
  Smile,
  Target,
  Heart,
  ScrollText,
  BookMarked,
  X,
  ChevronRight,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchApi } from "@/lib/fetch-api";
import { renderMarkdown } from "@/components/coach/Markdown";

/* ----------------------------------------------------------------
 * 类型
 * ---------------------------------------------------------------- */
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: { url: string; title?: string; snippet?: string }[];
  isMock?: boolean;
  knowledgeHit?: { id: string; title: string; emoji: string } | null;
  webSearched?: boolean;
  actionHint?: boolean;
  streaming?: boolean;
}

type SpecialAction =
  | "analyze_today_diary"
  | "breakdown_goal"
  | "weekly_focus_plan"
  | "emotion_review"
  | "quick_mood_check"
  | "recommend_exercise";

interface KnowledgeItem {
  id: string;
  title: string;
  category: string;
  emoji: string;
  time: string;
  scenario: string[];
  content?: string[];
}

interface Shortcut {
  id: SpecialAction;
  icon: React.ReactNode;
  label: string;
  sub: string;
  tone: "primary" | "secondary" | "warning" | "success" | "rose";
}

const SHORTCUTS: Shortcut[] = [
  {
    id: "analyze_today_diary",
    icon: <BookOpenCheck size={14} />,
    label: "分析今日日记",
    sub: "从日记里找成长点",
    tone: "primary",
  },
  {
    id: "breakdown_goal",
    icon: <Target size={14} />,
    label: "拆解本周目标",
    sub: "大目标 → 每天 30 分钟",
    tone: "success",
  },
  {
    id: "weekly_focus_plan",
    icon: <TrendingUp size={14} />,
    label: "生成专注计划",
    sub: "本周节奏 + 工作法",
    tone: "secondary",
  },
  {
    id: "emotion_review",
    icon: <BrainCircuit size={14} />,
    label: "情绪复盘",
    sub: "4 步结构化梳理",
    tone: "rose",
  },
  {
    id: "quick_mood_check",
    icon: <Smile size={14} />,
    label: "心情签到",
    sub: "5 秒快速记录",
    tone: "warning",
  },
  {
    id: "recommend_exercise",
    icon: <Heart size={14} />,
    label: "推荐适合的练习",
    sub: "2~3 个即刻能做",
    tone: "primary",
  },
];

const EMOTION_TAGS: { emoji: string; label: string; tone: string }[] = [
  { emoji: "😊", label: "平静满足", tone: "from-success-100 to-success-50 text-success-700 border-success-200" },
  { emoji: "😌", label: "放松舒展", tone: "from-primary-100 to-primary-50 text-primary-700 border-primary-200" },
  { emoji: "😔", label: "低落疲惫", tone: "from-secondary-100 to-secondary-50 text-secondary-700 border-secondary-200" },
  { emoji: "😤", label: "烦躁生气", tone: "from-rose-100 to-rose-50 text-rose-700 border-rose-200" },
  { emoji: "😰", label: "焦虑担心", tone: "from-warning-100 to-warning-50 text-warning-700 border-warning-200" },
  { emoji: "😶", label: "麻木无感", tone: "from-foreground/10 to-foreground/5 text-foreground/70 border-foreground/10" },
];

const toneCls: Record<Shortcut["tone"], string> = {
  primary:
    "bg-gradient-to-br from-primary-100/80 to-primary-50 text-primary-700 border border-primary-200 hover:shadow-md hover:shadow-primary-100",
  secondary:
    "bg-gradient-to-br from-secondary-100/80 to-secondary-50 text-secondary-700 border border-secondary-200 hover:shadow-md hover:shadow-secondary-100",
  warning:
    "bg-gradient-to-br from-warning-100/80 to-warning-50 text-warning-700 border border-warning-200 hover:shadow-md hover:shadow-warning-100",
  success:
    "bg-gradient-to-br from-success-100/80 to-success-50 text-success-700 border border-success-200 hover:shadow-md hover:shadow-success-100",
  rose:
    "bg-gradient-to-br from-rose-100/80 to-rose-50 text-rose-700 border border-rose-200 hover:shadow-md hover:shadow-rose-100",
};

const INITIAL_GREETING: ChatMessage = {
  role: "assistant",
  content:
    "你好呀 👋 我是你的心理成长教练。\n\n是想和我聊聊此刻的感受，还是今天遇到了什么？点击下面的快捷按钮也可以哦～",
};

/** 把后端存储的聊天行转成前端 ChatMessage */
function rowToMessage(row: any): ChatMessage {
  return {
    role: row.role,
    content: row.content,
    citations: row.citations ?? undefined,
    isMock: !!row.meta?.mock,
    knowledgeHit: row.meta?.knowledge_hit ?? null,
    webSearched: !!row.meta?.web_searched,
    actionHint: !!row.meta?.action_hint,
  };
}

/** 把前端 ChatMessage 转成后端存储行（不含 id/created_at，由后端生成） */
function messageToRow(m: ChatMessage) {
  return {
    role: m.role,
    content: m.content,
    citations: m.citations ?? null,
    meta: {
      mock: !!m.isMock,
      knowledge_hit: m.knowledgeHit ?? null,
      web_searched: !!m.webSearched,
      action_hint: !!m.actionHint,
    },
  };
}

/* =================================================================
 * 主组件
 * ================================================================= */
export default function CoachPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedEmotion, setSelectedEmotion] = useState<string | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [activeKnowledge, setActiveKnowledge] = useState<KnowledgeItem | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 拉取知识库元数据
  useEffect(() => {
    fetchApi<{ knowledge: KnowledgeItem[] }>("/api/chat", { showErrorToast: false }).then(
      (res) => {
        if (res.ok && res.knowledge) setKnowledge(res.knowledge);
      }
    );
  }, []);

  // 挂载时加载历史消息（有历史则恢复，否则用默认问候）
  useEffect(() => {
    fetchApi<{ messages: any[] }>("/api/chat/history", { showErrorToast: false }).then(
      (res) => {
        if (res.ok && Array.isArray(res.messages) && res.messages.length > 0) {
          setMessages(res.messages.map(rowToMessage));
        }
      }
    );
  }, []);

  // 自动滚动
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const sendMessage = useCallback(
    async (text?: string, opts?: { action?: SpecialAction; emotion?: string }) => {
      const userText = (text ?? input).trim();
      if (!userText && !opts?.action) return;
      if (loading) return;

      const userMsg: ChatMessage = { role: "user", content: userText || "（使用快捷功能）" };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      setInput("");
      setLoading(true);

      try {
        const res = await fetchApi<{
          reply: string;
          citations?: { url: string; title?: string; snippet?: string }[];
          mock?: boolean;
          knowledge_hit?: { id: string; title: string; emoji: string } | null;
          web_searched?: boolean;
          action_hint?: boolean;
        }>("/api/chat", {
          method: "POST",
          body: JSON.stringify({
            messages: newMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            special_action: opts?.action,
            emotion: opts?.emotion || selectedEmotion || undefined,
          }),
          showErrorToast: false,
        });

        const reply = (res as any).reply as string | undefined;
        if (res.ok && reply) {
          const assistantMsg: ChatMessage = {
            role: "assistant",
            content: reply,
            citations: (res as any).citations,
            isMock: (res as any).mock,
            knowledgeHit: (res as any).knowledge_hit || null,
            webSearched: !!(res as any).web_searched,
            actionHint: !!(res as any).action_hint,
          };
          // 打字动画：先插入空文本，再逐字填充
          const placeholderIdx = newMessages.length; // 这是 assistant 消息要插入的 index
          setMessages((prev) => [
            ...prev,
            { ...assistantMsg, content: "", streaming: true },
          ]);
          await typewriteText(reply, (typed) => {
            setMessages((prev) => {
              const copy = [...prev];
              if (copy[placeholderIdx]) {
                copy[placeholderIdx] = { ...copy[placeholderIdx], content: typed };
              }
              return copy;
            });
          });
          // 打字结束：取消 streaming
          setMessages((prev) => {
            const copy = [...prev];
            if (copy[placeholderIdx]) {
              copy[placeholderIdx] = { ...copy[placeholderIdx], streaming: false };
            }
            return copy;
          });
          // 持久化本轮对话（用户消息 + AI 回复）
          fetchApi("/api/chat/history", {
            method: "POST",
            body: JSON.stringify({
              messages: [userMsg, assistantMsg].map(messageToRow),
            }),
            showErrorToast: false,
          }).catch(() => {});
        } else {
          throw new Error((res as any).error || "AI 回复失败");
        }
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `抱歉，刚才出了点问题 😅 ${err.message || "请稍后再试"}`,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [messages, input, loading, selectedEmotion],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const resetChat = () => {
    setMessages([INITIAL_GREETING]);
    setSelectedEmotion(null);
    // 同时清空服务端历史
    fetchApi("/api/chat/history", {
      method: "DELETE",
      showErrorToast: false,
    }).catch(() => {});
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  return (
    <div className="relative flex h-[calc(100vh-5rem)] flex-col gap-3 md:flex-row md:gap-4">
      {/* ===== 左侧：对话主区域 ===== */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Header */}
        <header className="glass-card flex items-center justify-between p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-200 via-secondary-200 to-rose-200 shadow-glow">
              <span className="text-2xl">💭</span>
              <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full border-2 border-white bg-success-500 shadow-sm">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-success-400" />
              </span>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold gradient-text">
                AI 心理成长教练
              </h2>
              <p className="text-[11px] text-muted-foreground">
                温柔倾听 · 专业方法 · 懂你 MindFlow 的全部数据
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setKnowledgeOpen((o) => !o)}
              className="hidden items-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:inline-flex"
              title="专业心理练习库"
            >
              <BookMarked size={14} /> 练习库
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetChat}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw size={13} className="mr-1" /> 重新开始
            </Button>
          </div>
        </header>

        {/* Chat area */}
        <div
          ref={scrollRef}
          className="glass-card flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 scrollbar-pretty"
        >
          {messages.map((msg, idx) => (
            <ChatBubble
              key={idx}
              msg={msg}
              onHit={(knowledgeId) => {
                // 点击命中的知识库卡片 → 展开侧边详情
                const fullItem = findFullKnowledge(knowledge, knowledgeId);
                if (fullItem) {
                  setActiveKnowledge(fullItem);
                  setKnowledgeOpen(true);
                }
              }}
              onCopy={() => copyToClipboard(msg.content)}
            />
          ))}

          {loading && <TypingIndicator />}
        </div>

        {/* 情绪选择器 + 输入框 */}
        <div className="glass-card p-2.5 sm:p-3">
          {!selectedEmotion ? (
            <div className="mb-2">
              <p className="mb-1.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
                <Smile size={11} /> 可选：点选一个此刻最贴近的情绪
              </p>
              <div className="flex flex-wrap gap-1.5">
                {EMOTION_TAGS.map((e) => (
                  <button
                    key={e.label}
                    onClick={() => setSelectedEmotion(e.label)}
                    className={`rounded-full border bg-gradient-to-r px-2.5 py-1 text-[11px] transition-all active:scale-95 ${e.tone}`}
                  >
                    <span className="mr-0.5">{e.emoji}</span>
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mb-2 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary-100/80 px-2.5 py-1 text-[11px] font-medium text-primary-700 ring-1 ring-primary-200">
                {EMOTION_TAGS.find((e) => e.label === selectedEmotion)?.emoji} {selectedEmotion}
              </span>
              <button
                onClick={() => setSelectedEmotion(null)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                取消
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="和教练聊聊你的感受…"
              disabled={loading}
              className="flex-1"
            />
            <Button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="shrink-0"
            >
              <Send size={16} />
            </Button>
          </div>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            💡 教练会自动参考你今天的待办、日记、专注、目标数据，也可以联网搜索最新信息
          </p>
        </div>
      </div>

      {/* ===== 右侧：专业知识库抽屉（大屏常驻/移动端滑入） ===== */}
      <aside
        className={`glass-card flex min-h-0 flex-col overflow-hidden transition-all duration-300 ${
          knowledgeOpen
            ? "h-[40vh] w-full md:h-auto md:w-[320px] md:max-w-[340px]"
            : "h-0 w-0 md:w-[64px]"
        }`}
      >
        {knowledgeOpen ? (
          <KnowledgePanel
            items={knowledge}
            activeId={activeKnowledge?.id}
            onPick={(k) => setActiveKnowledge(k)}
            onClose={() => setKnowledgeOpen(false)}
            onApply={(k) => {
              sendMessage(`请引导我做「${k.emoji} ${k.title}」练习`, {
                action: "recommend_exercise",
              });
            }}
            onShortcut={(action) => sendMessage("", { action })}
          />
        ) : (
          // 折叠态：只有一个图标按钮
          <div className="hidden h-full w-full items-center justify-center md:flex">
            <Button
              variant="ghost"
              onClick={() => setKnowledgeOpen(true)}
              className="flex h-16 w-14 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground hover:text-primary-600"
              title="专业心理练习库"
            >
              <BookMarked size={18} />
              <span className="text-[9px]">练习库</span>
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}

/* ================================================================
 * ChatBubble：单条消息气泡（含知识库命中卡片）
 * ================================================================ */
function ChatBubble({
  msg,
  onHit,
  onCopy,
}: {
  msg: ChatMessage;
  onHit: (knowledgeId: string) => void;
  onCopy: () => void;
}) {
  const isUser = msg.role === "user";
  const [showActions, setShowActions] = useState(false);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`group relative max-w-[90%] sm:max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[13px] sm:text-sm leading-relaxed whitespace-pre-wrap ${
          isUser ? "bubble-user" : "bubble-ai"
        }`}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        {/* Meta 条（Mock / 联网搜索 / 命中） */}
        {!isUser && (
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {msg.isMock && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-warning-100 px-1.5 py-0.5 text-[10px] text-warning-700">
                <Sparkles size={9} /> 模拟回复
              </span>
            )}
            {msg.webSearched && !msg.isMock && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] text-primary-700">
                <ScrollText size={9} /> 已联网搜索
              </span>
            )}
            {msg.actionHint && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-secondary-100 px-1.5 py-0.5 text-[10px] text-secondary-700">
                💡 引导提示
              </span>
            )}
            {msg.streaming && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Loader2 size={9} className="animate-spin" /> 正在回复…
              </span>
            )}
          </div>
        )}

        {/* 内容 */}
        <div className="break-words">{renderMarkdown(msg.content)}</div>

        {/* 知识库命中卡片 */}
        {!isUser && msg.knowledgeHit && (
          <button
            onClick={() => onHit(msg.knowledgeHit!.id)}
            className="mt-2 flex w-full items-center gap-2 rounded-xl border border-primary-200/70 bg-gradient-to-r from-primary-50 to-secondary-50 p-2 text-left transition-all hover:shadow-md hover:shadow-primary-100"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-lg shadow-sm">
              {msg.knowledgeHit.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium text-primary-800">
                🎓 推荐练习：{msg.knowledgeHit.title}
              </p>
              <p className="text-[10px] text-muted-foreground">
                点击查看完整步骤
                <ChevronRight
                  size={10}
                  className="ml-0.5 inline align-middle"
                />
              </p>
            </div>
          </button>
        )}

        {/* 联网搜索引用 */}
        {!isUser && msg.citations && msg.citations.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-white/20 pt-2">
            <div className="text-[10px] font-medium text-muted-foreground">
              🔍 搜索来源：
            </div>
            {msg.citations.slice(0, 3).map((cite, i) => (
              <a
                key={i}
                href={cite.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[11px] text-primary-600 hover:underline truncate"
                title={cite.snippet}
              >
                {cite.title || cite.url}
              </a>
            ))}
          </div>
        )}

        {/* 鼠标悬浮的操作条 */}
        {!isUser && !msg.streaming && msg.content && showActions && (
          <div className="absolute -top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={onCopy}
              className="rounded-full border border-white/40 bg-white/80 p-1 text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
              title="复制文本"
            >
              <Copy size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
 * TypingIndicator：AI 正在思考
 * ================================================================ */
function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bubble-ai flex items-center gap-2 rounded-2xl px-4 py-3">
        <Loader2 size={14} className="animate-spin text-primary-500" />
        <span className="text-sm text-muted-foreground">
          教练正在思考中<span className="dots-animation" />
        </span>
      </div>
    </div>
  );
}

/* ================================================================
 * KnowledgePanel：右侧专业知识库抽屉
 * ================================================================ */
function KnowledgePanel({
  items,
  activeId,
  onPick,
  onClose,
  onApply,
  onShortcut,
}: {
  items: KnowledgeItem[];
  activeId?: string;
  onPick: (k: KnowledgeItem) => void;
  onClose: () => void;
  onApply: (k: KnowledgeItem) => void;
  onShortcut: (action: SpecialAction) => void;
}) {
  const list = items.length > 0 ? items : FALLBACK_KNOWLEDGE;
  const active =
    (activeId && list.find((i) => i.id === activeId)) || null;
  const content = (active || list[0])!;

  return (
    <div className="flex h-full flex-col">
      {/* 抽屉头部 */}
      <div className="flex items-center justify-between border-b border-white/40 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <BookMarked size={15} className="text-primary-500" />
          <h3 className="text-sm font-bold gradient-text">教练工具箱</h3>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-1 text-muted-foreground hover:bg-white/50 hover:text-foreground"
          title="收起"
        >
          <X size={14} />
        </button>
      </div>

      {/* 快捷功能（点击即问） */}
      <div className="border-b border-white/40 px-3 py-2.5">
        <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Sparkles size={12} className="text-primary-500" />
          快捷功能
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {SHORTCUTS.map((sc) => (
            <button
              key={sc.id}
              onClick={() => onShortcut(sc.id)}
              className={`group rounded-lg p-2 text-left transition-all active:scale-95 ${toneCls[sc.tone]}`}
            >
              <div className="mb-0.5 flex items-center gap-1 text-[11px] font-bold">
                {sc.icon} {sc.label}
              </div>
              <div className="text-[9.5px] opacity-80">{sc.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 上半部分：列表 */}
      <div className="grid grid-cols-2 gap-1.5 p-2.5 md:block md:space-y-1.5">
        {list.map((k) => {
          const on = content?.id === k.id;
          return (
            <button
              key={k.id}
              onClick={() => onPick(k)}
              className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-all ${
                on
                  ? "border-primary-300 bg-gradient-to-r from-primary-50 to-secondary-50 shadow-md shadow-primary-100"
                  : "border-white/40 bg-white/20 hover:bg-white/40"
              }`}
            >
              <span className="text-xl">{k.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold text-foreground">
                  {k.title}
                </p>
                <p className="truncate text-[9.5px] text-muted-foreground">
                  {k.category} · {k.time}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* 下半部分：详情 */}
      {content && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-white/40 bg-white/30 p-3">
          <div className="mb-2 flex items-start gap-2">
            <span className="text-2xl">{content.emoji}</span>
            <div className="min-w-0 flex-1">
              <h4 className="text-[13px] font-bold text-foreground">{content.title}</h4>
              <p className="text-[10px] text-muted-foreground">
                {content.category} · 耗时 {content.time}
              </p>
            </div>
          </div>

          {/* 适用场景标签 */}
          {content.scenario?.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {content.scenario.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-warning-100/80 px-2 py-0.5 text-[9.5px] text-warning-700"
                >
                  # {s}
                </span>
              ))}
            </div>
          )}

          {/* 步骤 */}
          <div className="scrollbar-pretty min-h-0 flex-1 overflow-y-auto rounded-xl bg-white/40 p-2.5 text-[12px] leading-relaxed text-foreground/90">
            {(content.content || ["（步骤已发送到 AI 系统提示词里，引导教练一步步带你做）"]).map(
              (line, i) => (
                <p key={i} className="mb-1.5 whitespace-pre-wrap break-words">
                  {line}
                </p>
              )
            )}
          </div>

          {/* 立即开始按钮 */}
          <Button
            size="sm"
            className="mt-2.5 w-full justify-center"
            onClick={() => onApply(content)}
          >
            <Heart size={13} className="mr-1" /> 和教练一起做这个练习
          </Button>
        </div>
      )}
    </div>
  );
}

/* ================================================================
 * 工具函数
 * ================================================================ */
const FALLBACK_KNOWLEDGE: KnowledgeItem[] = [
  { id: "breathing_478", title: "4-7-8 呼吸放松法", category: "呼吸练习", emoji: "🌬️", time: "1~2 分钟", scenario: ["焦虑", "睡前平静"], content: ["鼻吸 4 秒", "屏息 7 秒", "嘴呼 8 秒（像吹蜡烛）", "重复 3~4 轮"] },
  { id: "five_senses_grounding", title: "5-4-3-2-1 接地法", category: "情绪急救", emoji: "🌳", time: "1~2 分钟", scenario: ["惊恐发作前", "心慌手抖"], content: ["👀 5 个你看见的东西", "🤚 4 种触摸的质感", "👂 3 种声音", "👃 2 种气味", "👅 1 种味道"] },
];

function findFullKnowledge(
  list: KnowledgeItem[],
  id: string
): KnowledgeItem | null {
  return list.find((k) => k.id === id) || null;
}

/** 打字动画：逐字写入 */
async function typewriteText(
  fullText: string,
  onChunk: (partial: string) => void
) {
  const len = fullText.length;
  if (len === 0) return;

  // 估算间隔：让 100 字在 ~0.8s 内完成
  const totalDuration = Math.min(1400, Math.max(380, len * 7));
  const steps = Math.min(len, 26);
  const stepLen = Math.max(1, Math.ceil(len / steps));
  const stepMs = totalDuration / steps;

  let cursor = 0;
  for (let i = 0; i < steps; i++) {
    cursor = Math.min(len, cursor + stepLen);
    onChunk(fullText.slice(0, cursor));
    await new Promise((r) => setTimeout(r, stepMs));
  }
  onChunk(fullText);
}

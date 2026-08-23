"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Target,
  Plus,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Calendar,
  CheckCircle2,
  Circle,
  ListChecks,
  Trash2,
  X,
  Loader2,
  Edit3,
  Wand2,
  Bot,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/fetch-api";
import { toast } from "@/components/ui/use-toast";
import { generateId, todayISO } from "@/lib/utils";
import type { Goal, GoalStep, AIGoalStep } from "@/lib/supabase/types";

/* ================================================================
 * 类型
 * ================================================================ */

interface GoalWithSteps extends Goal {
  steps: GoalStep[];
}

interface GoalsManagerProps {
  /** 当某个步骤加入待办后回调，让父组件刷新 TodoList */
  onStepAdded?: () => void;
  /** 外部刷新 key 变化时重新拉取 */
  refreshKey?: number;
}

/* ================================================================
 * 主组件
 * ================================================================ */

export default function GoalsManager({ onStepAdded, refreshKey }: GoalsManagerProps) {
  const [goals, setGoals] = React.useState<GoalWithSteps[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [showForm, setShowForm] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const loadGoals = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApi<{ goals: GoalWithSteps[] }>("/api/goals", {
        method: "GET",
      });
      if (res.ok && res.goals) {
        setGoals(res.goals);
      }
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadGoals();
  }, [loadGoals, refreshKey]);

  // 完成度统计
  const totalSteps = goals.reduce((sum, g) => sum + g.steps.length, 0);
  const doneSteps = goals.reduce(
    (sum, g) => sum + g.steps.filter((s) => s.is_done).length,
    0
  );

  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      {/* 光晕 */}
      <div className="pointer-events-none absolute -top-16 -left-16 h-40 w-40 rounded-full bg-primary-200/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -right-16 h-40 w-40 rounded-full bg-secondary-200/30 blur-3xl" />

      {/* 头部 */}
      <div className="relative mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary-400 to-secondary-500 text-white shadow-md">
            <Target className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-base font-bold leading-tight">长期目标</h3>
            <p className="text-xs text-muted-foreground">
              AI 拆解为每日可执行的小步骤
              {totalSteps > 0 && (
                <span className="ml-2">
                  进度 {doneSteps}/{totalSteps}
                </span>
              )}
            </p>
          </div>
        </div>
        <Button
          variant="gradient"
          size="sm"
          onClick={() => setShowForm(true)}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          新建目标
        </Button>
      </div>

      {/* 目标列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          加载中...
        </div>
      ) : goals.length === 0 ? (
        <EmptyState onCreate={() => setShowForm(true)} />
      ) : (
        <div className="relative flex flex-col gap-3">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              expanded={expandedId === goal.id}
              onToggleExpand={() =>
                setExpandedId(expandedId === goal.id ? null : goal.id)
              }
              onGoalUpdated={loadGoals}
              onStepAdded={() => {
                onStepAdded?.();
                loadGoals();
              }}
            />
          ))}
        </div>
      )}

      {/* 新建弹窗 */}
      {showForm && (
        <GoalFormModal
          onClose={() => setShowForm(false)}
          onCreated={(goal) => {
            setShowForm(false);
            setExpandedId(goal.id);
            loadGoals();
          }}
        />
      )}
    </Card>
  );
}

/* ================================================================
 * 空状态
 * ================================================================ */
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="relative flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-white/30 px-6 py-8 text-center backdrop-blur-sm">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-secondary-100">
        <Target className="h-6 w-6 text-primary-500" />
      </div>
      <p className="mb-1 font-medium">还没有长期目标</p>
      <p className="mb-4 text-sm text-muted-foreground">
        设定一个目标，让 AI 帮你拆解为可执行的每日小步骤
      </p>
      <Button variant="gradient" onClick={onCreate} className="gap-1.5">
        <Plus className="h-4 w-4" />
        新建第一个目标
      </Button>
    </div>
  );
}

/* ================================================================
 * 单个目标卡片
 * ================================================================ */
function GoalCard({
  goal,
  expanded,
  onToggleExpand,
  onGoalUpdated,
  onStepAdded,
}: {
  goal: GoalWithSteps;
  expanded: boolean;
  onToggleExpand: () => void;
  onGoalUpdated: () => void;
  onStepAdded: () => void;
}) {
  const [loadingStepId, setLoadingStepId] = React.useState<string | null>(null);
  const completed = goal.status === "completed";
  const doneCount = goal.steps.filter((s) => s.is_done).length;
  const total = goal.steps.length;
  const progress = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  async function handleDelete() {
    if (!confirm(`确定删除目标「${goal.title}」？`)) return;
    try {
      await fetchApi(`/api/goals?id=${goal.id}`, { method: "DELETE" });
      toast({ title: "目标已删除" });
      onGoalUpdated();
    } catch {
      // fetchApi 已处理
    }
  }

  async function handleMarkStepAdded(step: GoalStep) {
    setLoadingStepId(step.id);
    try {
      // 1. 创建任务
      await fetchApi("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          content: step.content,
          due_date: step.scheduled_date || new Date().toISOString().slice(0, 10),
          source: "manual",
          goal_step_id: step.id,
        }),
      });
      // 2. 标记步骤已加入
      await fetchApi(`/api/goals/steps?id=${step.id}`, {
        method: "PATCH",
        body: JSON.stringify({ added_to_tasks: true }),
      });
      toast({
        variant: "success",
        title: "已加入待办 ✅",
        description: step.content,
        duration: 2500,
      });
      onStepAdded();
    } catch {
      // 已由 fetchApi 处理
    } finally {
      setLoadingStepId(null);
    }
  }

  async function handleToggleStepDone(step: GoalStep) {
    try {
      await fetchApi(`/api/goals/steps?id=${step.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_done: !step.is_done }),
      });
      onGoalUpdated();
    } catch {
      // 静默
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-white/40 backdrop-blur-sm">
      {/* 头部行 */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/50"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`truncate font-medium ${completed ? "text-muted-foreground line-through" : ""}`}
          >
            {goal.title}
          </span>
          {goal.target_date && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-600">
              <Calendar className="h-3 w-3" />
              {goal.target_date.slice(5)}
            </span>
          )}
          {total > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-secondary-50 px-2 py-0.5 text-xs text-secondary-600">
              <ListChecks className="h-3 w-3" />
              {doneCount}/{total}
            </span>
          )}
        </div>
        {/* 进度条 */}
        {total > 0 && (
          <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-muted sm:block">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary-400 to-secondary-400 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        <span className="ml-2 shrink-0 text-xs font-medium text-muted-foreground">
          {progress}%
        </span>
        {/* 删除 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
          className="ml-1 shrink-0 rounded-full p-1.5 text-muted-foreground transition hover:bg-destructive-50 hover:text-destructive-600"
          title="删除目标"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </button>

      {/* 展开的步骤列表 */}
      {expanded && goal.steps.length > 0 && (
        <div className="border-t border-border/40 bg-white/20 px-4 py-3">
          <ul className="flex flex-col gap-2">
            {goal.steps.map((step) => (
              <li
                key={step.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-white/40"
              >
                <button
                  type="button"
                  onClick={() => handleToggleStepDone(step)}
                  className="shrink-0"
                  title={step.is_done ? "标记未完成" : "标记已完成"}
                >
                  {step.is_done ? (
                    <CheckCircle2 className="h-4 w-4 text-success-500" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                <span
                  className={`flex-1 text-sm ${step.is_done ? "text-muted-foreground line-through" : ""}`}
                >
                  <span className="mr-1 text-xs text-muted-foreground">
                    {step.step_order}.
                  </span>
                  {step.content}
                  {step.notes && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground/80">
                      💡 {step.notes}
                    </span>
                  )}
                </span>
                {step.scheduled_date && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {step.scheduled_date.slice(5)}
                  </span>
                )}
                {step.added_to_tasks ? (
                  <span className="shrink-0 rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-600">
                    ✓ 已加入
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={loadingStepId === step.id}
                    onClick={() => handleMarkStepAdded(step)}
                    className="shrink-0 rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-600 transition hover:bg-primary-100 disabled:opacity-50"
                  >
                    {loadingStepId === step.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>➕ 加入待办</>
                    )}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 无步骤 */}
      {expanded && goal.steps.length === 0 && (
        <div className="border-t border-border/40 bg-white/20 px-4 py-3 text-sm text-muted-foreground">
          暂无子步骤
        </div>
      )}
    </div>
  );
}

/* ================================================================
 * 新建目标表单弹窗
 * ================================================================ */

/** 弹窗内可编辑的拆解步骤（AI 结果带上本地唯一 id 后进入编辑态） */
interface EditableStep extends AIGoalStep {
  id: string;
}

function GoalFormModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (goal: GoalWithSteps) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [targetDate, setTargetDate] = React.useState("");
  const [startingPoint, setStartingPoint] = React.useState("");
  const [successCriteria, setSuccessCriteria] = React.useState("");
  const [weeklyTime, setWeeklyTime] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [breakdownSteps, setBreakdownSteps] = React.useState<EditableStep[]>([]);
  const [aiGenerated, setAiGenerated] = React.useState(true);
  // 追问态：AI 信息不足时返回的问题 + 用户逐步作答
  const [clarifyQuestions, setClarifyQuestions] = React.useState<string[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = React.useState<string[]>([]);
  const [clarificationHistory, setClarificationHistory] = React.useState<
    { question: string; answer: string }[]
  >([]);

  async function doBreakdown(clarifications: { question: string; answer: string }[]) {
    if (!title.trim()) return;
    setLoading(true);
    try {
      const res = await fetchApi<{
        steps?: AIGoalStep[];
        ai_generated?: boolean;
        needs_clarification?: boolean;
        questions?: string[];
      }>("/api/goals/breakdown", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          target_date: targetDate || undefined,
          starting_point: startingPoint.trim() || undefined,
          success_criteria: successCriteria.trim() || undefined,
          weekly_time: weeklyTime.trim() || undefined,
          clarifications,
        }),
      });
      // 信息不足 → 进入追问态
      if (
        res.ok &&
        res.needs_clarification &&
        Array.isArray(res.questions) &&
        res.questions.length > 0
      ) {
        setClarifyQuestions(res.questions);
        setClarifyAnswers(res.questions.map(() => ""));
        return;
      }
      if (res.ok && Array.isArray(res.steps) && res.steps.length > 0) {
        setClarifyQuestions([]);
        setAiGenerated(res.ai_generated !== false);
        // 后端已按本地时区算好 scheduled_date；补 id 进入编辑态
        setBreakdownSteps(
          res.steps.map((s) => ({
            ...s,
            id: generateId(),
            content: s.content.trim(),
            scheduled_date: s.scheduled_date || null,
          }))
        );
      } else {
        toast({ variant: "error", title: "拆解失败，请稍后重试" });
      }
    } catch {
      // fetchApi 已处理
    } finally {
      setLoading(false);
    }
  }

  function handleBreakdown() {
    doBreakdown(clarificationHistory);
  }

  function handleSubmitClarify() {
    const answers = clarifyQuestions.map((_, i) => (clarifyAnswers[i] ?? "").trim());
    if (answers.some((a) => !a)) {
      toast({ variant: "error", title: "请回答所有问题" });
      return;
    }
    const newHistory = [
      ...clarificationHistory,
      ...clarifyQuestions.map((q, i) => ({ question: q, answer: answers[i] })),
    ];
    setClarificationHistory(newHistory);
    setClarifyQuestions([]);
    doBreakdown(newHistory);
  }

  /** 编辑某一步的文案 */
  function handleStepEdit(id: string, content: string) {
    setBreakdownSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, content } : s))
    );
  }

  /** 编辑某一步的补充说明 */
  function handleNoteEdit(id: string, notes: string) {
    setBreakdownSteps((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, notes: notes.trim() ? notes : null } : s
      )
    );
  }

  /** 删除某一步 */
  function handleStepRemove(id: string) {
    setBreakdownSteps((prev) => prev.filter((s) => s.id !== id));
  }

  async function handleCreate() {
    if (!title.trim()) {
      toast({ variant: "error", title: "请输入目标标题" });
      return;
    }
    if (breakdownSteps.length === 0) {
      toast({
        variant: "error",
        title: "请先生成拆解步骤",
        description: "点击「AI 智能拆解」生成步骤后再保存",
      });
      return;
    }
    setLoading(true);
    try {
      // 序列化：步数可能因删除而变化，重排 step_order；去掉空内容
      const steps = breakdownSteps
        .filter((s) => s.content.trim().length > 0)
        .map((s, i) => ({
          content: s.content.trim(),
          step_order: i + 1,
          scheduled_date: s.scheduled_date,
          notes: s.notes ?? null,
        }));
      if (steps.length === 0) {
        toast({ variant: "error", title: "至少保留一个有效的步骤" });
        setLoading(false);
        return;
      }
      const res = await fetchApi<{ goal: Goal; steps: GoalStep[] }>("/api/goals", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          target_date: targetDate || null,
          starting_point: startingPoint.trim() || null,
          success_criteria: successCriteria.trim() || null,
          weekly_time: weeklyTime.trim() || null,
          steps,
        }),
      });
      if (res.ok && res.goal) {
        toast({
          variant: "success",
          title: "目标已创建 🎯",
          description: `已拆解 ${steps.length} 个步骤`,
          duration: 3000,
        });
        const goalWithSteps: GoalWithSteps = {
          ...res.goal,
          steps: res.steps || [],
        };
        onCreated(goalWithSteps);
      }
    } catch {
      // 已处理
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/60 bg-white/80 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头 */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/40 bg-gradient-to-r from-primary-50 via-white to-secondary-50 px-5 py-3">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary-500" />
            <h3 className="font-bold">新建长期目标</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground transition hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 表单 */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              目标标题 *
            </label>
            <Input
              placeholder="例：学会 React Hooks 高级用法"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              详细描述（可选）
            </label>
            <Textarea
              placeholder="补充背景、动机等其他说明..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              当前起点 / 水平（可选）
            </label>
            <Textarea
              placeholder="例：已会用 useState/useEffect，一上复杂项目就卡在性能优化"
              value={startingPoint}
              onChange={(e) => setStartingPoint(e.target.value)}
              rows={2}
              maxLength={200}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              想要的具体成果（可选）
            </label>
            <Textarea
              placeholder="例：能独立用 useMemo/useCallback/自定义 Hook 重构一个列表页"
              value={successCriteria}
              onChange={(e) => setSuccessCriteria(e.target.value)}
              rows={2}
              maxLength={200}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              每周可投入时间（可选）
            </label>
            <Input
              placeholder="例：工作日晚上 2 小时 × 3 天"
              value={weeklyTime}
              onChange={(e) => setWeeklyTime(e.target.value)}
              maxLength={80}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              截止日期（可选）
            </label>
            <Input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              min={todayISO()}
            />
          </div>

          {/* AI 拆解：追问态 / 按钮 / 结果 三态 */}
          {clarifyQuestions.length > 0 ? (
            <div className="rounded-xl border border-secondary-100 bg-secondary-50/50 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-secondary-700">
                <HelpCircle className="h-4 w-4" />
                为了拆得更贴你，补充几点信息
              </div>
              <div className="flex flex-col gap-2">
                {clarifyQuestions.map((q, i) => (
                  <div key={i}>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {q}
                    </label>
                    <Input
                      value={clarifyAnswers[i] ?? ""}
                      onChange={(e) =>
                        setClarifyAnswers((prev) => {
                          const next = [...prev];
                          next[i] = e.target.value;
                          return next;
                        })
                      }
                      placeholder="你的回答..."
                      maxLength={200}
                    />
                  </div>
                ))}
              </div>
              <Button
                variant="gradient"
                size="sm"
                onClick={handleSubmitClarify}
                disabled={loading}
                className="mt-3 gap-1.5"
              >
                <Sparkles className="h-4 w-4" />
                {loading ? "拆解中..." : "生成具体步骤"}
              </Button>
            </div>
          ) : breakdownSteps.length === 0 ? (
            <Button
              variant="outline"
              onClick={handleBreakdown}
              disabled={!title.trim() || loading}
              className="gap-2 border-dashed"
            >
              <Sparkles className="h-4 w-4" />
              {loading ? "AI 拆解中..." : "✨ AI 智能拆解为每日小步骤"}
            </Button>
          ) : (
            <div className="rounded-xl border border-primary-100 bg-primary-50/50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-medium text-primary-700">
                  {aiGenerated ? (
                    <Bot className="h-4 w-4" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  {aiGenerated ? "AI 拆解结果" : "本地模拟结果"}（
                  {breakdownSteps.length} 步）
                </span>
                <button
                  onClick={handleBreakdown}
                  className="text-xs text-primary-500 hover:underline"
                >
                  🔄 重新生成
                </button>
              </div>
              <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Edit3 className="h-3.5 w-3.5" />
                可直接编辑步骤内容，或点右侧删除不需要的步骤
              </div>
              <ol className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                {breakdownSteps.map((s, i) => (
                  <li
                    key={s.id}
                    className="flex flex-col gap-0.5 rounded-lg bg-white/60 px-2 py-1.5"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-1 shrink-0 text-xs text-muted-foreground">
                        {i + 1}.
                      </span>
                      <Input
                        value={s.content}
                        onChange={(e) => handleStepEdit(s.id, e.target.value)}
                        className="h-8 flex-1 border-transparent bg-transparent px-1 text-sm shadow-none focus-visible:bg-white/70 focus-visible:border-primary-200"
                      />
                      {s.scheduled_date && (
                        <span className="mt-1 shrink-0 text-xs text-muted-foreground">
                          {s.scheduled_date.slice(5)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleStepRemove(s.id)}
                        className="mt-0.5 shrink-0 rounded-full p-1 text-muted-foreground transition hover:bg-destructive-50 hover:text-destructive-600"
                        title="删除该步骤"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1 pl-5">
                      <span className="shrink-0 text-xs text-muted-foreground/60">
                        💡
                      </span>
                      <Input
                        value={s.notes ?? ""}
                        onChange={(e) => handleNoteEdit(s.id, e.target.value)}
                        placeholder="补充说明（可选）：为什么这么安排 / 怎么做"
                        className="h-7 flex-1 border-transparent bg-transparent px-1 text-xs shadow-none placeholder:text-muted-foreground/50 focus-visible:bg-white/70 focus-visible:border-primary-200"
                      />
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/40 bg-white/50 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="gradient"
            onClick={handleCreate}
            disabled={loading || !title.trim()}
            className="gap-1.5"
          >
            <Sparkles className="h-4 w-4" />
            保存并创建
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

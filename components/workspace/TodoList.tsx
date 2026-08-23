"use client";

import * as React from "react";
import { Plus, Trash2, PlayCircle, Sparkles, Wand2, Flame, Hourglass, Timer as TimerIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { fetchApi } from "@/lib/fetch-api";
import { formatMinutes } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import type { Task, FocusSessionType } from "@/lib/supabase/types";

interface Props {
  /** 数据变更后通知父组件（让概览卡片刷新） */
  onChange?: () => void;
  /** 点击「开始计时」按钮时触发，携带选定的计时模式 */
  onStartTimer?: (task: Task, mode: FocusSessionType) => void;
}

/**
 * 今日待办清单
 *  · 显示 due_date = 今天 的所有任务
 *  · 左：复选框 → 切换 is_done
 *  · 右：开始计时按钮 + 删除
 *  · 底部：输入框 + 新建按钮（手动添加）
 */
export default function TodoList({ onChange, onStartTimer }: Props) {
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newContent, setNewContent] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [busyIds, setBusyIds] = React.useState<Set<string>>(new Set());

  const loadTasks = React.useCallback(async () => {
    setLoading(true);
    const res = await fetchApi<Task[]>("/api/tasks", { method: "GET" });
    if (res.ok && Array.isArray(res.data)) {
      setTasks(res.data);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const setBusy = (id: string, b: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (b) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  /* ---------------- 切换完成状态 ---------------- */
  const toggleDone = async (task: Task) => {
    if (busyIds.has(task.id)) return;
    setBusy(task.id, true);
    const nextDone = !task.is_done;

    // 乐观更新 UI
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, is_done: nextDone } : t))
    );

    const res = await fetchApi<Task>(`/api/tasks`, {
      method: "PATCH",
      body: JSON.stringify({ id: task.id, is_done: nextDone }),
    });

    if (!res.ok) {
      // 回滚
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, is_done: task.is_done } : t))
      );
    } else {
      toast({
        variant: "success",
        title: nextDone ? "任务完成 🎉" : "已恢复未完成",
        description: nextDone
          ? "一步一个脚印，你做得很好～"
          : undefined,
        duration: 2400,
      });
      onChange?.();
    }
    setBusy(task.id, false);
  };

  /* ---------------- 删除任务 ---------------- */
  const deleteTask = async (task: Task) => {
    if (busyIds.has(task.id)) return;
    setBusy(task.id, true);

    const before = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== task.id));

    const res = await fetchApi(`/api/tasks?id=${encodeURIComponent(task.id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setTasks(before); // 回滚
    } else {
      toast({
        title: "已删除",
        description: task.content.slice(0, 24),
        duration: 2000,
      });
      onChange?.();
    }
    setBusy(task.id, false);
  };

  /* ---------------- 新增任务 ---------------- */
  const addTask = async () => {
    const content = newContent.trim();
    if (!content) return;
    if (submitting) return;
    setSubmitting(true);

    const res = await fetchApi<Task[]>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ content, source: "manual" }),
    });

    if (res.ok && res.data) {
      setTasks((prev) => [...prev, ...(res.data as unknown as Task[])]);
      setNewContent("");
      toast({
        variant: "success",
        title: "已加入今日计划",
        description: content.slice(0, 24),
        duration: 2200,
      });
      onChange?.();
    }
    setSubmitting(false);
  };

  const undone = tasks.filter((t) => !t.is_done);
  const done = tasks.filter((t) => t.is_done);

  return (
    <section className="glass-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">今日待办</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {loading
              ? "正在加载…"
              : `未完成 ${undone.length} 个 · 已完成 ${done.length} 个`}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-medium text-primary-600">
          <Wand2 size={12} />
          <span>可由对话教练 AI 生成</span>
        </div>
      </div>

      {loading && tasks.length === 0 ? (
        <SkeletonList />
      ) : tasks.length === 0 ? (
        <EmptyState onQuickFill={demoTasks} />
      ) : (
        <ul className="space-y-2">
          {undone.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              busy={busyIds.has(t.id)}
              onToggle={() => toggleDone(t)}
              onDelete={() => deleteTask(t)}
              onStartTimer={onStartTimer}
            />
          ))}
          {done.length > 0 && (
            <>
              <li className="pt-2">
                <Separator className="my-1" />
                <p className="py-1.5 text-[11px] text-muted-foreground flex items-center gap-2">
                  <Sparkles size={12} className="text-success-600" />
                  已完成 ({done.length})
                </p>
              </li>
              {done.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  busy={busyIds.has(t.id)}
                  onToggle={() => toggleDone(t)}
                  onDelete={() => deleteTask(t)}
                  onStartTimer={onStartTimer}
                />
              ))}
            </>
          )}
        </ul>
      )}

      {/* 新增输入框 */}
      <div className="mt-4 flex items-center gap-2">
        <Input
          placeholder="写下今天的一件小事，例如：花 3 分钟整理桌面"
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addTask();
          }}
          className="h-11 text-sm"
        />
        <Button
          variant="gradient"
          onClick={addTask}
          disabled={submitting || !newContent.trim()}
          size="lg"
          className="h-11 shrink-0"
        >
          <Plus size={18} />
          添加
        </Button>
      </div>
    </section>
  );

  /* 一键示例填充（本地空数据时的快捷操作） */
  async function demoTasks() {
    const demo = [
      "花 5 分钟做一次深呼吸",
      "喝一杯温水",
      "整理桌面",
      "出门散步 10 分钟",
    ].map((c) => ({ content: c, source: "manual" as const }));

    const res = await fetchApi<Task[]>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ items: demo }),
    });
    if (res.ok) {
      toast({
        variant: "info",
        title: "已填充示例 ✨",
        description: "可以直接打勾试试效果，或删除重写你自己的",
      });
      loadTasks();
      onChange?.();
    }
  }
}

/* ----------------- 任务单行 ----------------- */
function TaskRow({
  task,
  busy,
  onToggle,
  onDelete,
  onStartTimer,
}: {
  task: Task;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onStartTimer?: (task: Task, mode: FocusSessionType) => void;
}) {
  const focus = task.focus_minutes || 0;
  const hasFocus = focus > 0;
  const isDone = task.is_done;
  const [popoverOpen, setPopoverOpen] = React.useState(false);

  const modes: { mode: FocusSessionType; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
    { mode: "pomodoro", label: "番茄钟", icon: Flame, desc: "25 分钟专注 + 5 分钟休息" },
    { mode: "stopwatch", label: "正计时", icon: Hourglass, desc: "不限时，停止时记录" },
    { mode: "countdown", label: "倒计时", icon: TimerIcon, desc: "自定义时长到点提醒" },
  ];

  return (
    <li className={`task-row group ${isDone ? "opacity-70" : ""}`}>
      <Checkbox
        checked={isDone}
        onCheckedChange={onToggle}
        disabled={busy}
        aria-label={task.content}
      />
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm ${
            isDone ? "text-muted-foreground line-through decoration-muted-foreground/60" : ""
          }`}
        >
          {task.content}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          {task.goal_step_id && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-warning-100 px-1.5 py-0.5 text-warning-700">
              📌 来自目标
            </span>
          )}
          {task.source === "ai" && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-secondary-100 px-1.5 py-0.5 text-secondary-700">
              <Sparkles size={9} /> AI
            </span>
          )}
          {hasFocus && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-primary-100 px-1.5 py-0.5 text-primary-700">
              ⏱ 已专注 {formatMinutes(focus)}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-80 transition-opacity group-hover:opacity-100">
        {!isDone && (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 border-primary-200 text-primary-700 hover:bg-primary-50"
                title="选择计时模式"
              >
                <PlayCircle size={14} />
                <span className="hidden sm:inline">计时</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                选择计时模式
              </div>
              <div className="flex flex-col gap-2">
                {modes.map((m) => (
                  <button
                    key={m.mode}
                    type="button"
                    onClick={() => {
                      setPopoverOpen(false);
                      onStartTimer?.(task, m.mode);
                    }}
                    className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/60 p-2.5 text-left transition hover:bg-accent hover:shadow-sm"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-sm">
                      <m.icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">{m.label}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{m.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive-600 hover:bg-destructive-50"
          onClick={onDelete}
          title="删除"
        >
          <Trash2 size={15} />
        </Button>
      </div>
    </li>
  );
}

/* ----------------- 空状态 ----------------- */
function EmptyState({ onQuickFill }: { onQuickFill: () => void }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-primary-200/80 bg-primary-50/40 p-6 text-center">
      <div className="mx-auto mb-2 text-3xl">🌱</div>
      <p className="text-sm font-medium">今天还没有任务</p>
      <p className="mt-1 text-xs text-muted-foreground">
        可以在下方输入框添加，或先尝试几个示例任务
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-3 border-primary-300 text-primary-700 hover:bg-primary-100/60"
        onClick={onQuickFill}
      >
        ✨ 填充示例任务
      </Button>
    </div>
  );
}

/* ----------------- 加载骨架 ----------------- */
function SkeletonList() {
  return (
    <ul className="space-y-2">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-xl bg-white/40 px-4 py-3 animate-pulse-soft"
        >
          <span className="h-5 w-5 shrink-0 rounded-md bg-primary-100" />
          <span className="h-3.5 flex-1 rounded bg-muted/80" />
          <span className="h-8 w-12 rounded-lg bg-muted/60" />
        </li>
      ))}
    </ul>
  );
}

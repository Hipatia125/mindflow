"use client";

import * as React from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Square,
  Coffee,
  Brain,
  Timer as TimerIcon,
  Hourglass,
  Flame,
  X,
  CheckCircle2,
  Target,
  Trophy,
  Award,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fetchApi } from "@/lib/fetch-api";
import { toast } from "@/components/ui/use-toast";
import type { Task, FocusSessionType } from "@/lib/supabase/types";

/* ================================================================
 * 类型定义
 * ================================================================ */

type TimerMode = "pomodoro" | "stopwatch" | "countdown";
type TimerStatus = "idle" | "running" | "paused" | "completed";

interface FocusTimerProps {
  task?: Task | null;
  externalMode?: TimerMode;
  trigger?: number;
  onSessionEnd?: () => void;
  onClearTask?: () => void;
}

/* ================================================================
 * 成就配置
 * ================================================================ */

const ACHIEVEMENTS = {
  focus_rookie: {
    badge_code: "focus_rookie" as const,
    badge_name: "专注新秀",
    description: "连续完成 4 个番茄钟",
    icon: "🏅",
    threshold: 4,
  },
  deep_focused: {
    badge_code: "deep_focused" as const,
    badge_name: "深度专注者",
    description: "连续完成 8 个番茄钟",
    icon: "🥈",
    threshold: 8,
  },
  flow_master: {
    badge_code: "flow_master" as const,
    badge_name: "心流大师",
    description: "连续完成 12 个番茄钟",
    icon: "🥇",
    threshold: 12,
  },
} as const;

/* ================================================================
 * 工具函数
 * ================================================================ */

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  return `${pad(m)}:${pad(sec)}`;
}

function playBeep(frequency = 880, durationMs = 250, count = 1) {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    for (let i = 0; i < count; i++) {
      const startTime = ctx.currentTime + (i * durationMs) / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.25, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + durationMs / 1000);
      osc.start(startTime);
      osc.stop(startTime + durationMs / 1000);
    }
    setTimeout(() => ctx.close(), (count * durationMs) / 1000 + 200);
  } catch {
    // ignore
  }
}

const QUICK_MINUTES = [5, 10, 15, 30, 45, 60];

/* ================================================================
 * 主组件
 * ================================================================ */

export default function FocusTimer({
  task = null,
  externalMode,
  trigger = 0,
  onSessionEnd,
  onClearTask,
}: FocusTimerProps) {
  // —— 核心状态 ——
  const [mode, setMode] = React.useState<TimerMode>("pomodoro");
  const [status, setStatus] = React.useState<TimerStatus>("idle");

  // 番茄钟
  const [phase, setPhase] = React.useState<"focus" | "break">("focus");
  const [focusMinutes, setFocusMinutes] = React.useState(25);
  const [breakMinutes, setBreakMinutes] = React.useState(5);
  const [pomodoroCount, setPomodoroCount] = React.useState(0);

  // 时间
  const [timeRemaining, setTimeRemaining] = React.useState(25 * 60);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [countdownMinutes, setCountdownMinutes] = React.useState(15);

  // 统计
  const [todayFocusMinutes, setTodayFocusMinutes] = React.useState(0);

  // 专注意图
  const [intent, setIntent] = React.useState("");

  // 连续专注挑战
  const [challengeActive, setChallengeActive] = React.useState(false);
  const [challengeRound, setChallengeRound] = React.useState(0);
  const [challengeStartRef, setChallengeStartRef] = React.useState<string | null>(null);
  const [challengeAchievements, setChallengeAchievements] = React.useState<string[]>([]);

  // refs
  const sessionStartRef = React.useRef<string | null>(null);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const challengeRoundRef = React.useRef(0);
  const challengeActiveRef = React.useRef(false);
  const lastPausedAtRef = React.useRef<number>(0);

  /* —— 同步 refs —— */
  React.useEffect(() => {
    challengeRoundRef.current = challengeRound;
  }, [challengeRound]);
  React.useEffect(() => {
    challengeActiveRef.current = challengeActive;
  }, [challengeActive]);

  /* —— 初始化 —— */
  React.useEffect(() => {
    fetchApi<{ today_focus_minutes?: number }>("/api/focus/record", { method: "GET" })
      .then((res) => {
        const mins = (res as any).today_focus_minutes;
        if (res.ok && mins != null) {
          setTodayFocusMinutes(mins);
        }
      })
      .catch(() => {});
    // 加载已解锁成就
    fetchApi<{ achievements: { badge_code: string }[] }>("/api/achievements", {
      method: "GET",
    })
      .then((res) => {
        if (res.ok && res.achievements) {
          setChallengeAchievements(res.achievements.map((a) => a.badge_code));
        }
      })
      .catch(() => {});
  }, []);

  /* —— 外部触发 —— */
  React.useEffect(() => {
    if (trigger === 0) return;
    if (externalMode) {
      setMode(externalMode);
      if (externalMode === "pomodoro") {
        setPhase("focus");
        setTimeRemaining(focusMinutes * 60);
      } else if (externalMode === "countdown") {
        setTimeRemaining(countdownMinutes * 60);
      } else {
        setElapsedSeconds(0);
      }
      setStatus("running");
      sessionStartRef.current = new Date().toISOString();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  /* —— 计时器核心循环 —— */
  React.useEffect(() => {
    if (status !== "running") {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      // 挑战模式中断检测：暂停超过10分钟自动结束
      if (challengeActiveRef.current && lastPausedAtRef.current > 0) {
        const elapsed = (Date.now() - lastPausedAtRef.current) / 1000;
        if (elapsed > 600) {
          endChallenge("timeout");
          return;
        }
      }

      if (mode === "stopwatch") {
        setElapsedSeconds((s) => s + 1);
      } else {
        setTimeRemaining((prev) => Math.max(0, prev - 1));
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, mode]);

  /* —— 倒计时归零 —— */
  React.useEffect(() => {
    if (status === "running" && mode !== "stopwatch" && timeRemaining === 0) {
      handleTimerComplete();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRemaining, status, mode]);

  /* —— 页面关闭警告 —— */
  React.useEffect(() => {
    if (!challengeActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "挑战进行中，确定离开吗？";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [challengeActive]);

  /* —— 倒计时完成处理 —— */
  function handleTimerComplete() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (mode === "pomodoro") {
      if (phase === "focus") {
        playBeep(880, 250, 2);
        const newCount = pomodoroCount + 1;
        setPomodoroCount(newCount);

        // 挑战模式：累计 round 数，检查成就
        if (challengeActiveRef.current) {
          setChallengeRound(newCount);
          checkAchievements(newCount);
        }

        recordSession(focusMinutes, "pomodoro", "focus");

        setPhase("break");
        setTimeRemaining(breakMinutes * 60);
        toast({
          variant: "success",
          title: "专注完成 🍅",
          description: challengeActiveRef.current
            ? `挑战中第 ${newCount} 个番茄钟！休息 ${breakMinutes} 分钟～`
            : `第 ${newCount} 个番茄钟！休息 ${breakMinutes} 分钟～`,
          duration: 3000,
        });
      } else {
        playBeep(660, 300, 1);
        setPhase("focus");
        setTimeRemaining(focusMinutes * 60);
        toast({
          variant: "info",
          title: "休息结束 💪",
          description: challengeActiveRef.current
            ? `挑战继续！第 ${challengeRoundRef.current + 1} 轮专注`
            : "开始新的一轮专注吧！",
          duration: 3000,
        });
      }
    } else if (mode === "countdown") {
      playBeep(880, 250, 2);
      setStatus("completed");
      const mins = Math.max(1, Math.round(countdownMinutes));
      recordSession(mins, "countdown", "focus");
      toast({
        variant: "success",
        title: "倒计时完成 ⏰",
        description: `本次专注 ${mins} 分钟`,
        duration: 3000,
      });
    }
  }

  /* —— 成就检查 —— */
  async function checkAchievements(rounds: number) {
    for (const key of Object.keys(ACHIEVEMENTS) as (keyof typeof ACHIEVEMENTS)[]) {
      const ach = ACHIEVEMENTS[key];
      if (rounds >= ach.threshold && !challengeAchievements.includes(ach.badge_code)) {
        try {
          await fetchApi("/api/achievements/unlock", {
            method: "POST",
            body: JSON.stringify({
              badge_code: ach.badge_code,
              badge_name: ach.badge_name,
              description: ach.description,
              progress_value: rounds,
            }),
          });
          setChallengeAchievements((prev) => [...prev, ach.badge_code]);
          toast({
            variant: "success",
            title: `${ach.icon} 成就解锁！`,
            description: `${ach.badge_name} — ${ach.description}`,
            duration: 4000,
          });
        } catch {
          // 静默
        }
      }
    }
  }

  /* —— 记录会话 —— */
  async function recordSession(
    durationMinutes: number,
    sessionType: FocusSessionType | "challenge",
    sessionPhase: "focus" | "break"
  ) {
    const now = new Date().toISOString();
    const startedAt = sessionStartRef.current || now;

    try {
      const body: any = {
        task_id: task?.id ?? null,
        duration_minutes: durationMinutes,
        session_type: sessionType,
        phase: sessionPhase,
        intent: intent.trim() || null,
        started_at: startedAt,
        ended_at: now,
      };
      // 挑战中附带 round 数
      if (challengeActiveRef.current) {
        body.challenge_rounds = challengeRoundRef.current;
      }

      const res = await fetchApi<{ today_focus_minutes?: number }>(
        "/api/focus/record",
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );

      if (res.ok && res.today_focus_minutes != null) {
        setTodayFocusMinutes(res.today_focus_minutes);
      }

      if (task?.id && sessionPhase === "focus") {
        await fetchApi(`/api/tasks?id=${encodeURIComponent(task.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ add_focus_minutes: durationMinutes }),
          showErrorToast: false,
        });
      }

      onSessionEnd?.();
    } catch {
      // 静默
    }

    sessionStartRef.current = now;
  }

  /* —— 模式切换（挑战中禁止切换，否则自动结束） —— */
  function onModeChange(newMode: TimerMode) {
    if (challengeActiveRef.current) {
      if (!confirm("切换模式将结束当前挑战，确定吗？")) return;
      endChallenge("mode_switch");
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setMode(newMode);
    setStatus("idle");
    setElapsedSeconds(0);
    sessionStartRef.current = null;

    if (newMode === "pomodoro") {
      setPhase("focus");
      setTimeRemaining(focusMinutes * 60);
    } else if (newMode === "countdown") {
      setTimeRemaining(countdownMinutes * 60);
    }
  }

  /* —— 控制按钮 —— */
  function handleStart() {
    if (mode === "pomodoro") {
      setTimeRemaining(phase === "focus" ? focusMinutes * 60 : breakMinutes * 60);
    } else if (mode === "countdown") {
      setTimeRemaining(countdownMinutes * 60);
    } else {
      setElapsedSeconds(0);
    }
    setStatus("running");
    lastPausedAtRef.current = 0;
    sessionStartRef.current = new Date().toISOString();
  }

  function handlePause() {
    setStatus("paused");
    lastPausedAtRef.current = Date.now();
  }

  function handleResume() {
    // 清除暂停超时计时
    lastPausedAtRef.current = 0;
    setStatus("running");
  }

  function handleStop() {
    if (mode === "stopwatch" && elapsedSeconds > 0) {
      const mins = Math.max(1, Math.round(elapsedSeconds / 60));
      recordSession(mins, "stopwatch", "focus");
      toast({
        variant: "success",
        title: "计时已记录 ✅",
        description: `本次专注 ${formatTime(elapsedSeconds)}`,
        duration: 2500,
      });
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setStatus("idle");
    setElapsedSeconds(0);
    lastPausedAtRef.current = 0;
    sessionStartRef.current = null;
  }

  function handleReset() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setStatus("idle");
    setElapsedSeconds(0);
    lastPausedAtRef.current = 0;
    sessionStartRef.current = null;
    if (mode === "pomodoro") {
      setPhase("focus");
      setTimeRemaining(focusMinutes * 60);
    } else if (mode === "countdown") {
      setTimeRemaining(countdownMinutes * 60);
    }
  }

  /* —— 挑战开始/结束 —— */
  function startChallenge() {
    setChallengeActive(true);
    setChallengeRound(0);
    setChallengeStartRef(new Date().toISOString());
    setMode("pomodoro");
    setPhase("focus");
    setTimeRemaining(focusMinutes * 60);
    setStatus("running");
    setPomodoroCount(0);
    lastPausedAtRef.current = 0;
    sessionStartRef.current = new Date().toISOString();
    toast({
      variant: "success",
      title: "🔥 挑战开始！",
      description: `连续专注挑战已启动，完成 4/8/12 个番茄钟解锁成就！`,
      duration: 4000,
    });
  }

  function endChallenge(reason: "manual" | "timeout" | "mode_switch" = "manual") {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setStatus("idle");
    setPhase("focus");
    setTimeRemaining(focusMinutes * 60);
    lastPausedAtRef.current = 0;

    // 记录挑战总数据
    const totalFocusMins = challengeRound * focusMinutes;
    if (totalFocusMins > 0 && challengeStartRef) {
      // 额外记录一条 challenge 类型会话
      fetchApi("/api/focus/record", {
        method: "POST",
        body: JSON.stringify({
          task_id: null,
          duration_minutes: totalFocusMins,
          session_type: "challenge",
          phase: "focus",
          intent: intent.trim() || null,
          challenge_rounds: challengeRound,
          started_at: challengeStartRef,
          ended_at: new Date().toISOString(),
        }),
      }).catch(() => {});
    }

    const reasonText =
      reason === "timeout"
        ? "暂停超时，挑战自动结束"
        : reason === "mode_switch"
          ? "切换模式，挑战已结束"
          : "已手动结束";

    if (challengeRound > 0) {
      toast({
        variant: "info",
        title: `🔥 挑战结束 — ${reasonText}`,
        description: `共完成 ${challengeRound} 个番茄钟，专注 ${totalFocusMins} 分钟`,
        duration: 4000,
      });
    } else {
      toast({
        variant: "info",
        title: `🔥 挑战结束 — ${reasonText}`,
        duration: 3000,
      });
    }

    setChallengeActive(false);
    setChallengeRound(0);
    setChallengeStartRef(null);
    setPomodoroCount(0);
    sessionStartRef.current = null;
  }

  /* —— 番茄钟自定义时长 —— */
  function applyCustomDurations(newFocus: number, newBreak: number) {
    const f = Math.max(1, Math.min(120, newFocus));
    const b = Math.max(1, Math.min(60, newBreak));
    setFocusMinutes(f);
    setBreakMinutes(b);
    if (status === "idle" && phase === "focus") {
      setTimeRemaining(f * 60);
    }
  }

  /* —— 倒计时快捷选择 —— */
  function applyCountdownMinutes(mins: number) {
    setCountdownMinutes(mins);
    if (status === "idle") {
      setTimeRemaining(mins * 60);
    }
  }

  // —— 派生值 ——
  const displayTime =
    mode === "stopwatch" ? formatTime(elapsedSeconds) : formatTime(timeRemaining);

  const statusText = (() => {
    if (status === "idle") return "准备开始";
    if (status === "paused") return "已暂停";
    if (status === "completed") return "已完成 ✅";
    if (mode === "pomodoro") {
      return challengeActive
        ? phase === "focus"
          ? `🔥 挑战中 · 第 ${challengeRound + 1}/∞ 番茄钟`
          : "休息中 ☕"
        : phase === "focus"
          ? `专注中（第 ${pomodoroCount + 1} 个）`
          : "休息中 ☕";
    }
    if (mode === "stopwatch") return "计时中…";
    return "倒计时中…";
  })();

  const totalForProgress =
    mode === "pomodoro"
      ? (phase === "focus" ? focusMinutes : breakMinutes) * 60
      : mode === "countdown"
        ? countdownMinutes * 60
        : Math.max(elapsedSeconds, 1);
  const progress =
    mode === "stopwatch"
      ? 0
      : totalForProgress > 0
        ? 1 - timeRemaining / totalForProgress
        : 0;
  const ringR = 120;
  const ringC = 2 * Math.PI * ringR;
  const ringDash = progress * ringC;

  const themeColor =
    mode === "pomodoro"
      ? phase === "focus"
        ? { ring: "rgb(249 115 22)", glow: "rgba(249,115,22,0.15)" }
        : { ring: "rgb(34 197 94)", glow: "rgba(34,197,94,0.15)" }
      : mode === "stopwatch"
        ? { ring: "rgb(139 92 246)", glow: "rgba(139,92,246,0.15)" }
        : { ring: "rgb(14 165 233)", glow: "rgba(14,165,233,0.15)" };

  // 挑战状态下主题色：橙红色 + 更强光晕
  const activeTheme = challengeActive
    ? { ring: "rgb(239 68 68)", glow: "rgba(239,68,68,0.25)" }
    : themeColor;

  return (
    <Card
      className={`relative overflow-hidden p-5 sm:p-6 ${
        challengeActive ? "ring-2 ring-warning-300/60 shadow-lg shadow-warning-200/40" : ""
      }`}
    >
      {/* 光晕 */}
      <div
        className="pointer-events-none absolute -top-20 -right-20 h-48 w-48 rounded-full blur-3xl"
        style={{ background: activeTheme.glow }}
      />
      <div
        className="pointer-events-none absolute -bottom-16 -left-16 h-40 w-40 rounded-full blur-3xl"
        style={{ background: activeTheme.glow }}
      />
      {/* 挑战模式附加暖色光晕 */}
      {challengeActive && (
        <>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-warning-500/5 via-transparent to-primary-500/5" />
          <div className="pointer-events-none absolute top-1/4 right-1/4 h-20 w-20 rounded-full bg-warning-300/20 blur-2xl" />
        </>
      )}

      {/* 顶部标题 */}
      <div className="relative mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-md ring-2 ring-white/60">
            <TimerIcon className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="flex items-center gap-1.5 text-base font-bold leading-tight">
              专注计时器
              {challengeActive && (
                <span className="flex items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5 text-xs font-bold text-warning-700">
                  <Flame className="h-3 w-3 animate-pulse" />
                  挑战中
                </span>
              )}
            </h3>
            <p className="text-xs text-muted-foreground">
              番茄钟 · 秒表 · 倒计时
              {challengeActive && " · 连续专注挑战"}
            </p>
          </div>
        </div>

        {/* 关联任务 */}
        {task && (
          <div className="flex items-center gap-2">
            <div className="flex max-w-[160px] items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50/80 px-3 py-1 text-xs">
              <CheckCircle2 className="h-3 w-3 text-primary-500" />
              <span className="truncate font-medium text-primary-700">
                {task.content}
              </span>
            </div>
            {onClearTask && (
              <button
                onClick={onClearTask}
                className="rounded-full p-1 text-muted-foreground transition hover:bg-destructive-50 hover:text-destructive-600"
                title="取消关联"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 专注意图输入框（在开始按钮上方） */}
      <div className="relative mb-3">
        <div className="relative">
          <Target className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="这次专注想完成什么？"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            maxLength={100}
            disabled={status === "running"}
            className="h-10 pl-9 pr-3 text-sm"
          />
        </div>
        {/* 专注进行中显示 */}
        {status !== "idle" && intent.trim() && (
          <div className="mt-1.5 flex items-center gap-1 text-xs text-primary-600">
            <Target className="h-3 w-3" />
            <span className="font-medium">🎯 正在专注：{intent.trim()}</span>
          </div>
        )}
      </div>

      {/* 模式 Tab */}
      <Tabs
        value={mode}
        onValueChange={(v) => onModeChange(v as TimerMode)}
      >
        <TabsList className="w-full">
          <TabsTrigger value="pomodoro" className="flex-1">
            <Flame className="h-3.5 w-3.5" />
            番茄钟
          </TabsTrigger>
          <TabsTrigger value="stopwatch" className="flex-1">
            <Hourglass className="h-3.5 w-3.5" />
            正计时
          </TabsTrigger>
          <TabsTrigger value="countdown" className="flex-1">
            <TimerIcon className="h-3.5 w-3.5" />
            倒计时
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pomodoro">
          <PomodoroPanel
            focusMinutes={focusMinutes}
            breakMinutes={breakMinutes}
            onChange={applyCustomDurations}
          />
        </TabsContent>

        <TabsContent value="stopwatch">
          <StopwatchPanel />
        </TabsContent>

        <TabsContent value="countdown">
          <CountdownPanel
            minutes={countdownMinutes}
            onQuickSelect={applyCountdownMinutes}
            disabled={status === "running"}
          />
        </TabsContent>
      </Tabs>

      {/* 大号时间显示 */}
      <div className="relative mx-auto my-6 flex h-[280px] w-[280px] items-center justify-center">
        <svg viewBox="0 0 280 280" className="absolute inset-0 -rotate-90">
          <circle
            cx="140"
            cy="140"
            r={ringR}
            fill="none"
            stroke="rgba(0,0,0,0.06)"
            strokeWidth="8"
          />
          <circle
            cx="140"
            cy="140"
            r={ringR}
            fill="none"
            stroke={activeTheme.ring}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${ringDash} ${ringC}`}
            style={{ transition: "stroke-dasharray 0.8s ease-out" }}
          />
        </svg>
        <div className="relative z-10 flex flex-col items-center">
          <div
            className="text-5xl font-extrabold tabular-nums tracking-tight sm:text-6xl"
            style={{ color: activeTheme.ring }}
          >
            {displayTime}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            {mode === "pomodoro" && phase === "break" ? (
              <Coffee className="h-4 w-4" />
            ) : (
              <Brain className="h-4 w-4" />
            )}
            <span className="font-medium">{statusText}</span>
          </div>
        </div>
      </div>

      {/* 挑战进度轨道 */}
      {challengeActive && challengeRound > 0 && (
        <div className="relative mb-4 flex items-center justify-center gap-1.5 px-4">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            挑战进度：
          </span>
          {Array.from({ length: Math.max(challengeRound + 1, 4) }, (_, i) => (
            <div
              key={i}
              className={`h-2.5 w-2.5 rounded-full transition-all ${
                i < challengeRound
                  ? "bg-gradient-to-br from-warning-400 to-orange-500 shadow-sm shadow-warning-300"
                  : i === challengeRound && status === "running"
                    ? "animate-pulse bg-warning-300"
                    : "bg-muted-foreground/20"
              }`}
            />
          ))}
          <span className="ml-1 shrink-0 text-xs font-medium text-muted-foreground">
            ({challengeRound} 完成)
          </span>
        </div>
      )}

      {/* 控制按钮 */}
      <div className="flex items-center justify-center gap-3">
        {status === "idle" && (
          <Button
            variant="gradient"
            size="lg"
            onClick={handleStart}
            className="h-12 min-w-[120px] gap-2 text-base"
          >
            <Play className="h-5 w-5" />
            开始
          </Button>
        )}
        {status === "running" && (
          <Button
            variant="outline"
            size="lg"
            onClick={handlePause}
            className="h-12 min-w-[120px] gap-2 border-2 text-base"
          >
            <Pause className="h-5 w-5" />
            暂停
          </Button>
        )}
        {status === "paused" && (
          <>
            <Button
              variant="gradient"
              size="lg"
              onClick={handleResume}
              className="h-12 min-w-[100px] gap-2 text-base"
            >
              <Play className="h-5 w-5" />
              继续
            </Button>
            {mode === "stopwatch" && (
              <Button
                variant="destructive"
                size="lg"
                onClick={handleStop}
                className="h-12 min-w-[100px] gap-2 text-base"
              >
                <Square className="h-5 w-5" />
                停止
              </Button>
            )}
          </>
        )}
        {(status === "running" || status === "paused" || status === "completed") && (
          <Button
            variant="ghost"
            size="lg"
            onClick={handleReset}
            className="h-12 min-w-[80px] gap-2 text-base"
          >
            <RotateCcw className="h-5 w-5" />
            重置
          </Button>
        )}
      </div>

      {/* 统计信息 */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm">
        {mode === "pomodoro" && (
          <div className="flex items-center gap-1.5 rounded-full bg-secondary-50 px-3 py-1.5 text-secondary-700">
            <Flame className="h-4 w-4" />
            <span className="font-semibold">本次番茄 {pomodoroCount} 个</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1.5 text-primary-700">
          <Brain className="h-4 w-4" />
          <span className="font-semibold">今日专注 {todayFocusMinutes} 分钟</span>
        </div>
        {/* 已解锁成就 */}
        {challengeAchievements.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-full bg-warning-50 px-3 py-1.5 text-warning-700">
            <Trophy className="h-4 w-4" />
            <span className="font-semibold">
              {challengeAchievements.length} 个成就
            </span>
          </div>
        )}
      </div>

      {/* 挑战 / 结束挑战 按钮 */}
      <div className="mt-5">
        {challengeActive ? (
          <button
            type="button"
            onClick={() => {
              if (confirm("确定结束当前挑战吗？")) endChallenge("manual");
            }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-destructive-300 bg-gradient-to-r from-destructive-50 to-red-50 px-4 py-3 text-sm font-bold text-destructive-700 shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg"
          >
            <Square className="h-5 w-5" />
            结束挑战（已完成 {challengeRound} 番茄）
          </button>
        ) : (
          <button
            type="button"
            onClick={startChallenge}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-warning-200 bg-gradient-to-r from-warning-100 via-primary-100 to-secondary-100 px-4 py-3 text-sm font-bold text-warning-700 shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg hover:brightness-105"
          >
            <Flame className="h-5 w-5 animate-pulse" />
            🔥 开始连续专注挑战
            <Flame className="h-5 w-5 animate-pulse" />
          </button>
        )}
      </div>
    </Card>
  );
}

/* ================================================================
 * 子面板
 * ================================================================ */
function PomodoroPanel({
  focusMinutes,
  breakMinutes,
  onChange,
}: {
  focusMinutes: number;
  breakMinutes: number;
  onChange: (focus: number, brk: number) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-4 rounded-xl border border-white/50 bg-white/40 p-3 backdrop-blur-sm">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        专注
        <Input
          type="number"
          min={1}
          max={120}
          value={focusMinutes}
          onChange={(e) => onChange(Number(e.target.value) || 25, breakMinutes)}
          className="h-8 w-16 text-center text-sm"
        />
        分钟
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        休息
        <Input
          type="number"
          min={1}
          max={60}
          value={breakMinutes}
          onChange={(e) => onChange(focusMinutes, Number(e.target.value) || 5)}
          className="h-8 w-16 text-center text-sm"
        />
        分钟
      </label>
    </div>
  );
}

function StopwatchPanel() {
  return (
    <div className="mt-3 flex items-center justify-center rounded-xl border border-white/50 bg-white/40 p-3 text-center text-xs text-muted-foreground backdrop-blur-sm">
      <Hourglass className="mr-1.5 h-3.5 w-3.5" />
      点击「开始」后从 00:00 累加，停止时自动记录时长
    </div>
  );
}

function CountdownPanel({
  minutes,
  onQuickSelect,
  disabled,
}: {
  minutes: number;
  onQuickSelect: (m: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-3 flex flex-col items-center gap-3 rounded-xl border border-white/50 bg-white/40 p-3 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {QUICK_MINUTES.map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => onQuickSelect(m)}
            className={`h-9 min-w-[44px] rounded-lg px-2 text-sm font-medium transition-all ${
              minutes === m
                ? "bg-gradient-to-br from-sky-400 to-blue-500 text-white shadow-md ring-1 ring-white/60"
                : "border border-border bg-white/60 text-foreground hover:bg-accent"
            } ${disabled ? "opacity-50" : ""}`}
          >
            {m}分
          </button>
        ))}
      </div>
    </div>
  );
}

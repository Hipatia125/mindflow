"use client";

import * as React from "react";
import { Trophy, Award, Flame, Calendar, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { fetchApi } from "@/lib/fetch-api";
import type { Achievement } from "@/lib/supabase/types";

/* 成就徽章元数据 */
const BADGE_META: Record<string, { icon: string; name: string; color: string }> = {
  focus_rookie: { icon: "🏅", name: "专注新秀", color: "from-amber-200 to-amber-400" },
  deep_focused: { icon: "🥈", name: "深度专注者", color: "from-slate-200 to-slate-400" },
  flow_master: { icon: "🥇", name: "心流大师", color: "from-yellow-200 to-yellow-400" },
  review_rookie: { icon: "📚", name: "复习新秀", color: "from-blue-200 to-blue-400" },
  review_master: { icon: "🎓", name: "复习达人", color: "from-purple-200 to-purple-400" },
};

/* 目标徽章（未解锁状态） */
const BADGE_ORDER = [
  { code: "focus_rookie", icon: "🏅", name: "专注新秀", desc: "连续 4 个番茄钟" },
  { code: "deep_focused", icon: "🥈", name: "深度专注者", desc: "连续 8 个番茄钟" },
  { code: "flow_master", icon: "🥇", name: "心流大师", desc: "连续 12 个番茄钟" },
  { code: "review_rookie", icon: "📚", name: "复习新秀", desc: "毕业 3 张卡片" },
  { code: "review_master", icon: "🎓", name: "复习达人", desc: "毕业 10 张卡片" },
];

interface AchievementsPanelProps {
  /** 外部刷新 key */
  refreshKey?: number;
}

export default function AchievementsPanel({ refreshKey }: AchievementsPanelProps) {
  const [achievements, setAchievements] = React.useState<Achievement[]>([]);
  const [weeklyCount, setWeeklyCount] = React.useState(0);
  const [longestStreak, setLongestStreak] = React.useState(0);
  const [expanded, setExpanded] = React.useState(true);
  const [loading, setLoading] = React.useState(false);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApi<{ achievements: Achievement[] }>("/api/achievements", {
        method: "GET",
        showErrorToast: false,
      });
      const ach = ((res as any).achievements as Achievement[] | undefined) || [];
      if (res.ok) {
        setAchievements(ach);
      }

      // 计算本周挑战次数（简化：解锁的成就数量作为"活跃度"指标）
      setWeeklyCount(Math.min(7, ach.length));

      // 最长连续专注：取所有成就中 progress_value 最大值
      const maxProgress = ach.reduce(
        (max, a) => Math.max(max, a.progress_value || 0),
        0
      );
      setLongestStreak(maxProgress);
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData, refreshKey]);

  const unlockedCodes = new Set(achievements.map((a) => a.badge_code));

  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      {/* 光晕 */}
      <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-warning-200/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-16 h-40 w-40 rounded-full bg-primary-200/20 blur-3xl" />

      {/* 头部 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="relative flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-warning-400 to-amber-500 text-white shadow-md">
            <Trophy className="h-4.5 w-4.5" />
          </div>
          <div className="text-left">
            <h3 className="text-base font-bold leading-tight">专注成就</h3>
            <p className="text-xs text-muted-foreground">
              追踪你的专注里程碑
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* 统计 */}
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-1 rounded-full bg-warning-50 px-2.5 py-1 text-warning-700">
              <Flame className="h-3.5 w-3.5" />
              <span className="font-semibold">最长 {longestStreak}</span>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-primary-700">
              <Calendar className="h-3.5 w-3.5" />
              <span className="font-semibold">本周 {weeklyCount}</span>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-secondary-50 px-2.5 py-1 text-secondary-700">
              <Award className="h-3.5 w-3.5" />
              <span className="font-semibold">
                {achievements.length} 徽章
              </span>
            </div>
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* 徽章网格 */}
      {expanded && (
        <div className="relative mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {BADGE_ORDER.map((b) => {
            const unlocked = unlockedCodes.has(b.code);
            return (
              <div
                key={b.code}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all ${
                  unlocked
                    ? "border-white/60 bg-white/60 shadow-sm backdrop-blur-sm"
                    : "border-dashed border-border/40 bg-white/20 opacity-50"
                }`}
              >
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-full text-2xl ${
                    unlocked
                      ? `bg-gradient-to-br ${BADGE_META[b.code]?.color || "from-gray-200 to-gray-400"} shadow-sm`
                      : "bg-muted"
                  }`}
                >
                  {unlocked ? b.icon : "🔒"}
                </div>
                <span
                  className={`text-xs font-semibold ${unlocked ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {b.name}
                </span>
                <span className="text-[10px] leading-tight text-muted-foreground">
                  {b.desc}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

"use client";

import * as React from "react";
import { Flame, Calendar, Clock, Target, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { formatMinutes } from "@/lib/utils";
import { fetchApi } from "@/lib/fetch-api";

export interface OverviewData {
  today: string;
  today_label: string;
  total_today: number;
  done_today: number;
  completion_pct: number;
  focus_minutes_today: number;
  checkin_days_month: number;
  checkin_goal_month: number;
  streak_days: number;
}

interface Props {
  /** 外部数据变更时用此 prop 触发刷新（如待办完成后 +1） */
  refreshKey?: number;
}

/**
 * 工作台顶部概览卡片：
 *  · 今日日期
 *  · 今日完成度（百分比 + 进度条）
 *  · 本月打卡 X / 目标 Y 天
 *  · 连续坚持天数 🔥 Streak 徽章
 *  · 今日累计专注分钟
 */
export default function OverviewCard({ refreshKey = 0 }: Props) {
  const [data, setData] = React.useState<OverviewData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const dataRef = React.useRef<OverviewData | null>(null);
  dataRef.current = data;

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await fetchApi<OverviewData>("/api/workspace/overview", {
      showErrorToast: false,
    });
    if (res.ok && res.data) {
      setData(res.data);
    } else if (!dataRef.current) {
      // 首次加载无数据时，渲染本地默认值
      const now = new Date();
      const fallback: OverviewData = {
        today: now.toISOString().slice(0, 10),
        today_label: now.toLocaleDateString("zh-CN", {
          month: "long",
          day: "numeric",
          weekday: "long",
        }),
        total_today: 0,
        done_today: 0,
        completion_pct: 0,
        focus_minutes_today: 0,
        checkin_days_month: 0,
        checkin_goal_month: Math.round(
          new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() * 0.8
        ),
        streak_days: 0,
      };
      setData(fallback);
      dataRef.current = fallback;
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const d = data;

  return (
    <section className="glass-card-strong relative overflow-hidden p-5">
      {/* 背景柔光装饰 */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-gradient-to-br from-primary-300/40 to-secondary-300/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-gradient-to-br from-success-200/50 to-primary-200/40 blur-3xl" />

      <div className="relative">
        {/* 日期 + Streak */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar size={13} />
              {d?.today_label || "加载中…"}
            </p>
            <h2 className="mt-1 text-2xl font-bold gradient-text">
              {loading && !d
                ? "早安 ☀️"
                : (d?.completion_pct ?? 0) >= 100
                ? "今天已全部完成！🎉"
                : (d?.done_today ?? 0) > 0
                ? "继续保持，你很棒 ✨"
                : "从一件小事开始吧 🌱"}
            </h2>
          </div>
          {d && d.streak_days > 0 ? (
            <span className="streak-badge !animate-none">
              <Flame size={13} /> 连续 {d.streak_days} 天
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-100/70 px-3 py-1 text-xs font-semibold text-secondary-700 shadow-sm">
              <Sparkles size={13} /> 开启第一天
            </span>
          )}
        </div>

        {/* 完成度进度条 */}
        <div className="mb-5">
          <div className="mb-1.5 flex items-baseline justify-between">
            <p className="text-xs text-muted-foreground">今日完成度</p>
            <p className="text-base font-bold text-primary-600">
              {d?.completion_pct ?? 0}%
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                ({d?.done_today ?? 0}/{d?.total_today ?? 0})
              </span>
            </p>
          </div>
          <Progress value={d?.completion_pct ?? 0} className="h-3" />
        </div>

        {/* 三项关键指标 */}
        <div className="grid grid-cols-3 gap-2">
          <StatCard
            icon={<Calendar size={16} />}
            label="本月打卡"
            value={`${d?.checkin_days_month ?? 0}/${d?.checkin_goal_month ?? 24}`}
            subtext="天"
            accent="primary"
          />
          <StatCard
            icon={<Target size={16} />}
            label="完成任务"
            value={`${d?.done_today ?? 0}/${d?.total_today ?? 0}`}
            subtext="个"
            accent="success"
          />
          <StatCard
            icon={<Clock size={16} />}
            label="专注时长"
            value={formatMinutes(d?.focus_minutes_today ?? 0).replace(
              /分钟|小时|分/g,
              ""
            )}
            subtext={
              (d?.focus_minutes_today ?? 0) >= 60 ? "小时" : "分钟"
            }
            accent="warning"
          />
        </div>
      </div>
    </section>
  );
}

function StatCard({
  icon,
  label,
  value,
  subtext,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext?: string;
  accent: "primary" | "success" | "warning";
}) {
  const colorCls = {
    primary: "bg-primary-100/70 text-primary-600",
    success: "bg-success-100/70 text-success-700",
    warning: "bg-warning-100/70 text-warning-700",
  }[accent];

  return (
    <div className="glass-card-subtle p-3 text-center">
      <div
        className={`mx-auto mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg ${colorCls}`}
      >
        {icon}
      </div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-foreground">
        {value}
        {subtext && (
          <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">
            {subtext}
          </span>
        )}
      </p>
    </div>
  );
}

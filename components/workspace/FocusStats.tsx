"use client";

import * as React from "react";
import { Clock, TrendingUp, Award, Target } from "lucide-react";
import { fetchApi } from "@/lib/fetch-api";
import { formatMinutes, formatDateMD } from "@/lib/utils";

/* ----------------------------------------------------------------
 * 类型定义
 * ---------------------------------------------------------------- */
interface IntentStat {
  intent: string;
  minutes: number;
}

interface DayStat {
  date: string;
  minutes: number;
}

interface DailyIntentStat {
  date: string;
  intents: IntentStat[];
}

interface StatsData {
  todayMinutes: number;
  targetMinutes: number;
  todayIntents: IntentStat[];
  weeklyData: DayStat[];
  weeklyIntents: DailyIntentStat[];
  weekTotal: number;
  weekAvg: number;
  bestDay: { date: string; minutes: number } | null;
}

interface Props {
  refreshKey?: number;
}

const DEFAULT_TARGET = 120;

/** intent 图标前缀映射 */
const INTENT_ICONS = ["🎯", "📖", "💡", "📝", "🔧", "🎨", "📚", "💻", "🧘", "⚡"];

/** 根据索引获取不同深浅的主色 */
function getIntentColor(index: number): string {
  const colors = [
    "hsl(var(--primary))",
    "hsl(var(--secondary))",
    "hsl(var(--primary)/0.7)",
    "hsl(var(--secondary)/0.7)",
    "hsl(var(--primary)/0.5)",
    "hsl(var(--secondary)/0.5)",
  ];
  return colors[index % colors.length];
}

/** 根据 intent 文字生成稳定图标 */
function getIntentIcon(intent: string, index: number): string {
  return INTENT_ICONS[index % INTENT_ICONS.length];
}

export default function FocusStats({ refreshKey = 0 }: Props) {
  const [data, setData] = React.useState<StatsData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selectedDate, setSelectedDate] = React.useState<string>("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApi<StatsData>("/api/focus/stats", {
        showErrorToast: false,
      });
      if (res.ok) {
        const stats: StatsData = {
          todayMinutes: (res as any).todayMinutes ?? 0,
          targetMinutes: (res as any).targetMinutes ?? DEFAULT_TARGET,
          todayIntents: (res as any).todayIntents ?? [],
          weeklyData: (res as any).weeklyData ?? [],
          weeklyIntents: (res as any).weeklyIntents ?? [],
          weekTotal: (res as any).weekTotal ?? 0,
          weekAvg: (res as any).weekAvg ?? 0,
          bestDay: (res as any).bestDay ?? null,
        };
        setData(stats);
        // 默认选中今天（数组最后一个）
        const today = stats.weeklyData[stats.weeklyData.length - 1]?.date || "";
        setSelectedDate(today);
      } else {
        const empty = getEmptyStats();
        setData(empty);
        setSelectedDate(empty.weeklyData[6]?.date || "");
      }
    } catch {
      const empty = getEmptyStats();
      setData(empty);
      setSelectedDate(empty.weeklyData[6]?.date || "");
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (loading && !data) {
    return (
      <section className="glass-card p-5">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-40 rounded-lg bg-white/40" />
          <div className="flex gap-4">
            <div className="h-32 w-32 rounded-full bg-white/40" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-full rounded bg-white/40" />
              <div className="h-4 w-3/4 rounded bg-white/40" />
            </div>
          </div>
        </div>
      </section>
    );
  }

  const d = data || getEmptyStats();
  const progressPct = Math.min(
    100,
    Math.round((d.todayMinutes / d.targetMinutes) * 100)
  );
  const maxMinutes = Math.max(
    ...d.weeklyData.map((w) => w.minutes),
    d.targetMinutes,
    30
  );

  // 选中日期的 intent 分布
  const selectedDayIntents =
    d.weeklyIntents.find((w) => w.date === selectedDate)?.intents || [];
  const selectedDayMinutes =
    d.weeklyData.find((w) => w.date === selectedDate)?.minutes || 0;

  // 今日 TOP3
  const todayTop3 = (d.todayIntents || []).slice(0, 3);

  return (
    <section className="glass-card relative overflow-hidden p-5">
      {/* 背景柔光 */}
      <div className="pointer-events-none absolute -top-12 -right-12 h-36 w-36 rounded-full bg-gradient-to-br from-primary-300/30 to-secondary-300/30 blur-3xl" />

      <div className="relative">
        {/* 标题 */}
        <div className="mb-4 flex items-center gap-2">
          <Clock size={18} className="text-primary-500" />
          <h3 className="text-base font-bold gradient-text">专注可视化</h3>
        </div>

        {/* 今日环形进度 + 今日 TOP3 */}
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center">
          {/* 环形进度条 */}
          <div className="flex shrink-0 items-center justify-center">
            <RingProgress
              value={d.todayMinutes}
              max={d.targetMinutes}
              pct={progressPct}
              top3={todayTop3}
            />
          </div>

          {/* 右侧：柱状图 */}
          <div className="flex-1">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">近 7 天专注趋势</span>
              <span className="text-[10px] text-muted-foreground">点击柱子查看详情</span>
            </div>
            <BarChart
              data={d.weeklyData}
              max={maxMinutes}
              selectedDate={selectedDate}
              onSelect={(date) => setSelectedDate(date)}
            />
          </div>
        </div>

        {/* 联动区域：选中日期的 intent 分布 */}
        <DailyIntentBreakdown
          date={selectedDate}
          minutes={selectedDayMinutes}
          intents={selectedDayIntents}
        />

        {/* 统计摘要 */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <StatItem
            icon={<Clock size={14} />}
            label="本周总专注"
            value={formatMinutes(d.weekTotal)}
            accent="primary"
          />
          <StatItem
            icon={<TrendingUp size={14} />}
            label="日均专注"
            value={formatMinutes(d.weekAvg)}
            accent="warning"
          />
          <StatItem
            icon={<Award size={14} />}
            label="最长单日"
            value={d.bestDay ? `${d.bestDay.minutes}分钟` : "—"}
            subtext={d.bestDay ? formatDateMD(d.bestDay.date) : ""}
            accent="success"
          />
        </div>

        {/* 今日 0 分钟提示 */}
        {d.todayMinutes === 0 && !loading && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            今天还没开始专注，去开始第一个番茄钟吧！
          </p>
        )}
      </div>
    </section>
  );
}

/* ================================================================
 * 环形进度条 + 今日 TOP3
 * ================================================================ */
function RingProgress({
  value,
  max,
  pct,
  top3,
}: {
  value: number;
  max: number;
  pct: number;
  top3: IntentStat[];
}) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;
  const displayValue =
    value >= 60 ? `${Math.floor(value / 60)}h${value % 60}m` : `${value}m`;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-[130px] w-[130px]">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="rgba(0,0,0,0.06)"
            strokeWidth="10"
          />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="url(#ringGradient)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-700 ease-out"
          />
          <defs>
            <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="hsl(var(--primary))" />
              <stop offset="100%" stopColor="hsl(var(--secondary))" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-foreground">{displayValue}</span>
          <span className="text-[10px] text-muted-foreground">/ {max}分钟</span>
          <span className="mt-0.5 text-[10px] font-medium text-primary-500">{pct}%</span>
        </div>
      </div>

      {/* 今日 TOP3 */}
      <div className="w-[140px] space-y-0.5">
        <p className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
          <Target size={10} /> 今日 TOP3
        </p>
        {top3.length > 0 ? (
          top3.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-[10px]"
              title={item.intent}
            >
              <span className="truncate pr-1 text-muted-foreground">
                {getIntentIcon(item.intent, i)} {item.intent}
              </span>
              <span className="shrink-0 font-medium text-foreground">
                {item.minutes}min
              </span>
            </div>
          ))
        ) : (
          <p className="text-[10px] text-muted-foreground">今天还没有专注记录</p>
        )}
      </div>
    </div>
  );
}

/* ================================================================
 * 柱状图（支持点击选中）
 * ================================================================ */
function BarChart({
  data,
  max,
  selectedDate,
  onSelect,
}: {
  data: DayStat[];
  max: number;
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  const [hovered, setHovered] = React.useState<number | null>(null);
  const chartHeight = 100;

  return (
    <div className="flex items-end justify-between gap-1" style={{ height: chartHeight + 20 }}>
      {data.map((day, i) => {
        const barH = max > 0 ? Math.max(2, (day.minutes / max) * chartHeight) : 2;
        const isToday = i === data.length - 1;
        const isSelected = day.date === selectedDate;
        const dateLabel = day.date.slice(5); // MM-DD

        return (
          <div
            key={i}
            className="group relative flex flex-1 cursor-pointer flex-col items-center justify-end"
            style={{ height: chartHeight + 20 }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSelect(day.date)}
          >
            {/* Tooltip */}
            {hovered === i && (
              <div className="absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-lg bg-foreground/90 px-2 py-1 text-[10px] font-medium text-background shadow-lg">
                {day.minutes > 0 ? `${day.minutes} 分钟` : "无专注"}
              </div>
            )}

            {/* 柱子 */}
            <div
              className={`w-full rounded-t-md transition-all duration-300 ease-out ${
                isSelected ? "ring-2 ring-offset-1 ring-primary/40" : ""
              }`}
              style={{
                height: `${barH}px`,
                background: isSelected
                  ? "linear-gradient(to top, hsl(var(--primary)), hsl(var(--secondary)))"
                  : isToday
                  ? "linear-gradient(to top, hsl(var(--primary)/0.7), hsl(var(--secondary)/0.6))"
                  : day.minutes > 0
                  ? "linear-gradient(to top, hsl(var(--primary)/0.4), hsl(var(--secondary)/0.3))"
                  : "rgba(0,0,0,0.04)",
                maxWidth: "32px",
                margin: "0 auto",
              }}
            />

            {/* 日期标签 */}
            <span
              className={`mt-1 text-[9px] ${
                isSelected
                  ? "font-bold text-primary-600"
                  : isToday
                  ? "font-medium text-primary-500"
                  : "text-muted-foreground"
              }`}
            >
              {dateLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================
 * 每日意图分布（联动区域）
 * ================================================================ */
function DailyIntentBreakdown({
  date,
  minutes,
  intents,
}: {
  date: string;
  minutes: number;
  intents: IntentStat[];
}) {
  if (!date) return null;

  if (minutes === 0 || intents.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-white/40 bg-white/30 p-3">
        <p className="text-xs font-medium text-muted-foreground">
          📌 {formatDateMD(date)} 专注目标分布
        </p>
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          这一天还没有专注记录，去专注吧！
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-white/40 bg-white/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          📌 {formatDateMD(date)} 专注目标分布
        </p>
        <span className="text-[10px] text-muted-foreground">
          共 {minutes} 分钟 · {intents.length} 个目标
        </span>
      </div>

      <div className="space-y-1.5">
        {intents.map((item, i) => {
          const pct = minutes > 0 ? Math.round((item.minutes / minutes) * 100) : 0;
          return (
            <div key={i} className="flex items-center gap-2">
              {/* 意图名称 */}
              <span
                className="w-24 shrink-0 truncate text-[11px] text-muted-foreground sm:w-32"
                title={item.intent}
              >
                {getIntentIcon(item.intent, i)} {item.intent}
              </span>

              {/* 进度条 */}
              <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-black/5">
                <div
                  className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: getIntentColor(i),
                  }}
                />
              </div>

              {/* 分钟数 + 百分比 */}
              <span className="w-16 shrink-0 text-right text-[10px] font-medium text-foreground">
                {item.minutes}min
              </span>
              <span className="w-8 shrink-0 text-right text-[10px] text-muted-foreground">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================
 * 小统计卡片
 * ================================================================ */
function StatItem({
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
    <div className="glass-card-subtle p-2.5 text-center">
      <div
        className={`mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-lg ${colorCls}`}
      >
        {icon}
      </div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs font-bold text-foreground">{value}</p>
      {subtext && <p className="text-[9px] text-muted-foreground">{subtext}</p>}
    </div>
  );
}

function getEmptyStats(): StatsData {
  const today = new Date();
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    days.push(`${y}-${m}-${dd}`);
  }
  return {
    todayMinutes: 0,
    targetMinutes: DEFAULT_TARGET,
    todayIntents: [],
    weeklyData: days.map((date) => ({ date, minutes: 0 })),
    weeklyIntents: days.map((date) => ({ date, intents: [] })),
    weekTotal: 0,
    weekAvg: 0,
    bestDay: null,
  };
}

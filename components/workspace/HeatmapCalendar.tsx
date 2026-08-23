"use client";

import * as React from "react";
import { Calendar, Flame, ChevronLeft, ChevronRight, Target } from "lucide-react";
import { fetchApi } from "@/lib/fetch-api";
import { cn, formatMinutes, toDateISO } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import type { DayStat } from "@/app/api/workspace/heatmap/route";
import { Button } from "@/components/ui/button";

interface DayCell {
  dateISO: string;     // YYYY-MM-DD
  inMonth: boolean;    // 非当前月的灰色填充
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Mon
  isToday: boolean;
  stat: DayStat;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** 失败兜底：用 cursor 计算空范围（保证不永远 loading） */
function applyEmptyRange(
  cursor: string,
  setDays: React.Dispatch<React.SetStateAction<Record<string, DayStat>>>,
  setRangeInfo: React.Dispatch<
    React.SetStateAction<{
      monthLabel: string;
      startISO: string;
      endISO: string;
      todayISO: string;
    } | null>
  >
) {
  const [y, m] = cursor.split("-").map(Number);
  const firstOfMonth = new Date(y, m - 1, 1);
  const weekdayOfFirst = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - weekdayOfFirst);
  const end = new Date(y, m, 0);
  setDays({});
  setRangeInfo({
    monthLabel: firstOfMonth.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
    }),
    startISO: toDateISO(start),
    endISO: toDateISO(end),
    todayISO: new Date().toISOString().slice(0, 10),
  });
}

/** 根据完成度 pct 分 5 级（GitHub 热力图风格） */
function heatLevelOf(stat: DayStat): 0 | 1 | 2 | 3 | 4 {
  if (!stat || stat.total === 0) return 0;
  const pct = stat.done / stat.total;
  if (pct <= 0) return 0;
  if (pct < 0.25) return 1;
  if (pct < 0.5) return 2;
  if (pct < 0.75) return 3;
  return 4;
}

export default function HeatmapCalendar({ refreshKey = 0 }: { refreshKey?: number }) {
  const [cursor, setCursor] = React.useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [loading, setLoading] = React.useState(true);
  const [days, setDays] = React.useState<Record<string, DayStat>>({});
  const [rangeInfo, setRangeInfo] = React.useState<{
    monthLabel: string;
    startISO: string;
    endISO: string;
    todayISO: string;
  } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApi<{
        month_label: string;
        range_start: string;
        range_end: string;
        today: string;
        days: Record<string, DayStat>;
      }>(`/api/workspace/heatmap?month=${cursor}`);

      // 兼容两种返回形状：
      //   A) 新版统一 envelope：{ ok, data: { month_label, days, ... } }
      //   B) 老版平铺：{ ok, month_label, days, ... }
      const payload: any = (res.data && typeof (res.data as any).days === "object"
        ? res.data
        : typeof (res as any).days === "object"
        ? res
        : null) as any;

      if (payload) {
        setDays(payload.days || {});
        setRangeInfo({
          monthLabel: payload.month_label,
          startISO: payload.range_start,
          endISO: payload.range_end,
          todayISO: payload.today,
        });
      } else {
        applyEmptyRange(cursor, setDays, setRangeInfo);
      }
    } catch (e) {
      console.error("[heatmap] load failed", e);
      applyEmptyRange(cursor, setDays, setRangeInfo);
    } finally {
      setLoading(false);
    }
  }, [cursor]);

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, refreshKey]);

  // 生成 7 列 × N 行的网格
  const cells: DayCell[] = React.useMemo(() => {
    if (!rangeInfo) return [];
    const out: DayCell[] = [];
    const [cy, cm] = cursor.split("-").map(Number);
    const start = new Date(rangeInfo.startISO);
    const end = new Date(rangeInfo.endISO);
    const c = new Date(start);
    while (c <= end) {
      const iso = toDateISO(c);
      const inMonth = c.getFullYear() === cy && c.getMonth() === cm - 1;
      const weekday = ((c.getDay() + 6) % 7) as DayCell["weekday"];
      const stat = days[iso] || { total: 0, done: 0, focus_minutes: 0 };
      out.push({
        dateISO: iso,
        inMonth,
        weekday,
        isToday: iso === rangeInfo.todayISO,
        stat,
      });
      c.setDate(c.getDate() + 1);
    }
    return out;
  }, [days, rangeInfo, cursor]);

  // 按周分成二维（每 7 个一行）
  const weeks: DayCell[][] = React.useMemo(() => {
    const rows: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7));
    }
    return rows;
  }, [cells]);

  const totalDone = Object.values(days).reduce((s, d) => s + d.done, 0);
  const totalTasks = Object.values(days).reduce((s, d) => s + d.total, 0);
  const totalFocus = Object.values(days).reduce((s, d) => s + d.focus_minutes, 0);
  const checkinDays = Object.values(days).filter((d) => d.done > 0).length;

  function shiftMonth(delta: number) {
    const [y, m] = cursor.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  return (
    <section className="glass-card p-5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold flex items-center gap-1.5">
              <Calendar size={16} className="text-primary-500" />
              打卡月历
            </h3>
            <Badge variant="ghost">GitHub 风格</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            颜色越深 = 完成度越高 &nbsp;·&nbsp; 悬停格子查看当日详情
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft size={15} />
          </Button>
          <div className="px-2.5 py-1 text-xs font-semibold text-primary-700 bg-primary-50 rounded-full whitespace-nowrap">
            {rangeInfo?.monthLabel || "加载中…"}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight size={15} />
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatChip icon={<Target size={12} />} label="任务" value={`${totalDone}/${totalTasks}`} />
        <StatChip icon={<Flame size={12} />} label="打卡天数" value={`${checkinDays} 天`} />
        <StatChip icon={<Calendar size={12} />} label="专注" value={formatMinutes(totalFocus)} />
        <StatChip
          icon={<span className="text-[11px]">📊</span>}
          label="完成度"
          value={
            totalTasks === 0
              ? "0%"
              : `${Math.round((totalDone / totalTasks) * 100)}%`
          }
        />
      </div>

      {/* Grid */}
      {loading && cells.length === 0 ? (
        <HeatmapSkeleton />
      ) : cells.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-primary-200/80 bg-primary-50/40 p-6 text-center">
          <div className="mx-auto mb-2 text-3xl">🗓️</div>
          <p className="text-sm font-medium">还没有打卡记录</p>
          <p className="mt-1 text-xs text-muted-foreground">
            完成一个今日任务，就能点亮今天的格子
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="inline-flex min-w-full flex-col gap-1">
            {/* Weekday header row (shows which week column for sm+) */}
            <div className="flex gap-1 pl-7 text-[10px] text-muted-foreground">
              {weeks[0]?.map((_, i) => {
                // 每个列代表 weekday
                const cell = weeks[0][i];
                if (!cell) return <div key={i} className="h-3 w-[var(--cell-w)]" style={{ ["--cell-w" as any]: "100%" }} />;
                const isStart = cell.dateISO.slice(-2) === "01" || i === 0 || cell.weekday === 0;
                return (
                  <div
                    key={i}
                    className="h-3 w-8 shrink-0"
                    title={isStart ? `第${i + 1}周` : undefined}
                  />
                );
              })}
            </div>

            {/* 7 rows: weekday → 每个单元格代表该周的该 weekday */}
            {WEEKDAYS.map((wdLabel, rowI) => (
              <div key={rowI} className="flex items-center gap-1">
                <div className="w-5 shrink-0 text-right text-[10px] text-muted-foreground pr-1">
                  {wdLabel}
                </div>
                {weeks.map((w, colI) => {
                  const cell = w[rowI];
                  if (!cell) return <div key={colI} className="h-8 w-8 shrink-0" />;
                  return (
                    <DaySquare
                      key={cell.dateISO + "-" + colI}
                      cell={cell}
                      todayISO={rangeInfo?.todayISO || cell.dateISO}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="mt-3 flex items-center justify-end gap-1.5 pr-1 text-[10px] text-muted-foreground">
            <span>少</span>
            {[0, 1, 2, 3, 4].map((lv) => (
              <span
                key={lv}
                className={cn(
                  "h-3.5 w-3.5 rounded-[4px]",
                  "bg-[hsl(var(--heatmap-level-0))]",
                  lv === 1 && "bg-[hsl(var(--heatmap-level-1))]",
                  lv === 2 && "bg-[hsl(var(--heatmap-level-2))]",
                  lv === 3 && "bg-[hsl(var(--heatmap-level-3))]",
                  lv === 4 && "bg-[hsl(var(--heatmap-level-4))]"
                )}
              />
            ))}
            <span>多</span>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------- Stat chips ---------------- */
function StatChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/50 px-3 py-2 ring-1 ring-white/60">
      <div className="text-primary-600">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground leading-none">{label}</div>
        <div className="mt-0.5 text-xs font-semibold truncate">{value}</div>
      </div>
    </div>
  );
}

/* ---------------- Single day square ---------------- */
function DaySquare({ cell, todayISO }: { cell: DayCell; todayISO: string }) {
  const lv = heatLevelOf(cell.stat);
  const isFuture = cell.dateISO > todayISO;
  const hasTask = cell.stat.total > 0;

  // 所有非未来格子都允许悬停探索（即使 total=0 也显示「无任务」）
  const interactive = !isFuture;

  const bgColor = cell.inMonth
    ? `hsl(var(--heatmap-level-${lv}))`
    : `hsl(var(--heatmap-level-0) / 0.35)`;

  const baseStyle = { backgroundColor: bgColor };
  const titleText = hasTask
    ? `${cell.dateISO} · 完成 ${cell.stat.done}/${cell.stat.total}（专注 ${cell.stat.focus_minutes} 分钟）`
    : `${cell.dateISO} · 无任务`;

  const content = (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={squareCls(cell, interactive || hasTask)}
          style={baseStyle}
          aria-label={titleText}
          title={titleText}
        />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-60">
        <div className="text-sm">
          <div className="flex items-center justify-between">
            <div className="font-semibold">{cell.dateISO}</div>
            <div className="flex items-center gap-1">
              {cell.isToday && <Badge variant="warning">今天</Badge>}
              {!hasTask && <Badge variant="outline">无任务</Badge>}
            </div>
          </div>
          {hasTask ? (
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <Row k="任务" v={`${cell.stat.done} / ${cell.stat.total}`} />
              <Row
                k="完成度"
                v={
                  cell.stat.total === 0
                    ? "—"
                    : `${Math.round((cell.stat.done / cell.stat.total) * 100)}%`
                }
              />
              <Row k="专注时长" v={formatMinutes(cell.stat.focus_minutes)} />
            </div>
          ) : (
            <div className="mt-2 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
              这一天还没有安排任务 ✨<br />
              小提示：在「今日待办」里添加任务时，可以把截止日期改到未来任意一天，届时这里的方块就会亮起来哦～
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
  return content;
}

function squareCls(cell: DayCell, interactive: boolean): string {
  const base =
    "block h-8 w-8 shrink-0 rounded-[6px] transition-all ring-1 ring-black/5";
  const clickable = interactive
    ? "hover:scale-105 hover:ring-2 hover:ring-primary-400/60 cursor-pointer"
    : "opacity-40 cursor-not-allowed";
  const todayRing = cell.isToday
    ? "ring-2 ring-[hsl(var(--primary-400))] ring-offset-1 ring-offset-white"
    : "";

  return cn(base, clickable, todayRing);
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{k}</span>
      <span className="font-medium text-foreground">{v}</span>
    </div>
  );
}

/* ---------------- Loading ---------------- */
function HeatmapSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 7 }).map((_, ri) => (
        <div key={ri} className="flex items-center gap-1">
          <div className="w-5" />
          {Array.from({ length: 6 }).map((__, ci) => (
            <div
              key={ci}
              className="h-8 w-8 animate-pulse-soft rounded-[6px] bg-primary-100/60"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

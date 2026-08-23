export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromHeaders } from "@/lib/supabase/client";
import {
  shouldUseMock,
  mockFocusStats,
  type FocusStatsResult,
  type IntentStat,
  type DailyIntentStat,
} from "@/lib/supabase/mock-store";
import { toDateISO, shiftDateISO } from "@/lib/utils";

/**
 * GET /api/focus/stats
 * 返回专注统计数据（含按 intent 分组）：
 *   todayMinutes, targetMinutes, todayIntents, weeklyData, weeklyIntents, weekTotal, weekAvg, bestDay
 */

/** 将 intent 为空的统一归类为「未命名专注」 */
function normalizeIntent(intent: string | null | undefined): string {
  const trimmed = (intent || "").trim();
  return trimmed.length > 0 ? trimmed : "未命名专注";
}

/** 按日期分组统计 intent 分布 */
function buildIntentStats(
  rows: { duration_minutes: number; intent: string | null; started_at: string }[],
  dateStr: string
): IntentStat[] {
  const dayRows = rows.filter((r) => (r.started_at || "").slice(0, 10) === dateStr);
  const map: Record<string, number> = {};
  for (const r of dayRows) {
    const key = normalizeIntent(r.intent);
    map[key] = (map[key] || 0) + (r.duration_minutes || 0);
  }
  return Object.entries(map)
    .map(([intent, minutes]) => ({ intent, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

export async function GET(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const targetMinutes = 120;

    // —— Mock 模式 ——
    if (shouldUseMock()) {
      const stats = mockFocusStats(uid);
      return NextResponse.json({ ok: true, ...stats, mock: true });
    }

    // —— Supabase 模式 ——
    const supabase = getSupabaseAdmin();
    const today = toDateISO(new Date());
    const sevenDaysAgo = shiftDateISO(today, -6);

    // 查询近 7 天所有专注会话（含 intent 字段）
    const { data, error } = await supabase
      .from("focus_sessions")
      .select("duration_minutes, started_at, phase, intent")
      .eq("user_id", uid)
      .eq("phase", "focus")
      .gte("started_at", `${sevenDaysAgo}T00:00:00`)
      .lte("started_at", `${today}T23:59:59`);

    if (error) throw error;

    const rows = (data || []) as {
      duration_minutes: number;
      started_at: string;
      intent: string | null;
    }[];

    // 构建日期数组
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      days.push(shiftDateISO(today, -i));
    }

    // 按日期分组统计总分钟
    const dayMap: Record<string, number> = {};
    for (const row of rows) {
      const dateStr = (row.started_at || "").slice(0, 10);
      dayMap[dateStr] = (dayMap[dateStr] || 0) + (row.duration_minutes || 0);
    }

    const weeklyData = days.map((date) => ({
      date,
      minutes: dayMap[date] || 0,
    }));

    // 每天的 intent 分布
    const weeklyIntents: DailyIntentStat[] = days.map((date) => ({
      date,
      intents: buildIntentStats(rows, date),
    }));

    // 今日 intent 分布
    const todayIntents = weeklyIntents[6]?.intents || [];

    const todayMinutes = weeklyData[6]?.minutes || 0;
    const weekTotal = weeklyData.reduce((sum, d) => sum + d.minutes, 0);
    const weekAvg = Math.round(weekTotal / 7);
    const bestDay = weeklyData.reduce(
      (best, d) => (d.minutes > (best?.minutes || 0) ? d : best),
      null as { date: string; minutes: number } | null
    );

    const stats: FocusStatsResult = {
      todayMinutes,
      targetMinutes,
      todayIntents,
      weeklyData,
      weeklyIntents,
      weekTotal,
      weekAvg,
      bestDay: bestDay && bestDay.minutes > 0 ? bestDay : null,
    };

    return NextResponse.json({ ok: true, ...stats });
  } catch (e: any) {
    console.error("[focus/stats]", e);
    // 降级：返回空数据而非报错
    const today = toDateISO(new Date());
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      days.push(shiftDateISO(today, -i));
    }
    return NextResponse.json({
      ok: true,
      todayMinutes: 0,
      targetMinutes: 120,
      todayIntents: [],
      weeklyData: days.map((date) => ({ date, minutes: 0 })),
      weeklyIntents: days.map((date) => ({ date, intents: [] })),
      weekTotal: 0,
      weekAvg: 0,
      bestDay: null,
      mock: true,
      mock_error: String(e?.message || e),
    });
  }
}

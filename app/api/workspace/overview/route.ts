import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromHeaders } from "@/lib/supabase/client";
import { todayISO, toDateISO } from "@/lib/utils";
import { shouldUseMock, mockTaskCompletionByDay } from "@/lib/supabase/mock-store";

/**
 * GET /api/workspace/overview
 * 顶部概览聚合数据：完成度、专注分钟、本月打卡、Streak
 */
export async function GET(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const now = new Date();
    const today = todayISO();

    const y = now.getFullYear();
    const m = now.getMonth();
    const monthStart = toDateISO(new Date(y, m, 1));
    const monthEnd = toDateISO(new Date(y, m + 1, 0));
    const totalDaysInMonth = new Date(y, m + 1, 0).getDate();
    const checkinGoal = Math.round(totalDaysInMonth * 0.8);
    const ninetyBefore = new Date(now.getTime() - 90 * 86400000);
    const ninetyBeforeISO = toDateISO(ninetyBefore);

    let totalToday = 0;
    let doneToday = 0;
    let focusMinToday = 0;
    let checkinDays = 0;
    let streak = 0;
    let isMock = false;

    // —— Mock 降级：基于内存 store 算全部指标 ——
    if (shouldUseMock()) {
      isMock = true;
      // 今日
      const todayMap = mockTaskCompletionByDay(uid, today, today);
      const td = todayMap[today];
      if (td) {
        totalToday = td.total;
        doneToday = td.done;
        focusMinToday = td.focus_minutes;
      }
      // 本月打卡
      const monthMap = mockTaskCompletionByDay(uid, monthStart, monthEnd);
      checkinDays = Object.values(monthMap).filter((d) => d.done > 0).length;
      // Streak
      const streakMap = mockTaskCompletionByDay(uid, ninetyBeforeISO, monthEnd);
      const doneDates = new Set(
        Object.entries(streakMap)
          .filter(([, v]) => v.done > 0)
          .map(([k]) => k)
      );
      const cursor = new Date(now);
      if (!doneDates.has(today)) cursor.setDate(cursor.getDate() - 1);
      while (doneDates.has(toDateISO(cursor))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
        if (streak > 3650) break;
      }
    } else {
      const supabase = getSupabaseAdmin();

      // 1) 今日任务 + 专注
      const { data: todayTasks, error: err1 } = await supabase
        .from("tasks")
        .select("is_done, focus_minutes")
        .eq("user_id", uid)
        .eq("due_date", today);
      if (err1) throw err1;
      totalToday = todayTasks?.length || 0;
      doneToday = todayTasks?.filter((t) => t.is_done).length || 0;
      focusMinToday =
        todayTasks?.reduce((s, t) => s + ((t as any).focus_minutes || 0), 0) || 0;

      // 2) 本月打卡
      const { data: monthTasks, error: err2 } = await supabase
        .from("tasks")
        .select("due_date, is_done")
        .eq("user_id", uid)
        .gte("due_date", monthStart)
        .lte("due_date", monthEnd);
      if (err2) throw err2;
      const checkedSet = new Set<string>();
      (monthTasks || []).forEach((t) => {
        if (t.is_done) checkedSet.add(t.due_date);
      });
      checkinDays = checkedSet.size;

      // 3) Streak
      const { data: streakTasks, error: err3 } = await supabase
        .from("tasks")
        .select("due_date, is_done")
        .eq("user_id", uid)
        .gte("due_date", ninetyBeforeISO)
        .lte("due_date", monthEnd);
      if (err3) throw err3;
      const allDone = new Set<string>();
      (streakTasks || []).forEach((t) => t.is_done && allDone.add(t.due_date));
      const cursor = new Date(now);
      if (!allDone.has(today)) cursor.setDate(cursor.getDate() - 1);
      while (allDone.has(toDateISO(cursor))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
        if (streak > 3650) break;
      }
    }

    const completionPct = totalToday === 0 ? 0 : Math.round((doneToday / totalToday) * 100);

    return NextResponse.json({
      ok: true,
      mock: isMock,
      data: {
        today,
        today_label: now.toLocaleDateString("zh-CN", {
          month: "long",
          day: "numeric",
          weekday: "long",
        }),
        total_today: totalToday,
        done_today: doneToday,
        completion_pct: completionPct,
        focus_minutes_today: focusMinToday,
        checkin_days_month: checkinDays,
        checkin_goal_month: checkinGoal,
        streak_days: streak,
      },
    });
  } catch (e: any) {
    console.error("[overview/GET]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "获取概览失败" },
      { status: 500 }
    );
  }
}

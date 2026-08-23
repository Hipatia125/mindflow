import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromHeaders } from "@/lib/supabase/client";
import { shouldUseMock, mockCreateFocusSession, mockTodayFocusMinutes } from "@/lib/supabase/mock-store";
import type { FocusSessionInsert } from "@/lib/supabase/types";

/**
 * POST /api/focus/record
 * 记录一次专注会话
 * Body: { task_id?, duration_minutes, session_type, phase?, started_at, ended_at }
 */
export async function POST(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const body = (await req.json()) as FocusSessionInsert;

    if (!body.duration_minutes || body.duration_minutes <= 0) {
      return NextResponse.json(
        { ok: false, error: "duration_minutes 必须大于 0" },
        { status: 400 }
      );
    }
    if (!body.session_type) {
      return NextResponse.json(
        { ok: false, error: "缺少 session_type" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const session: FocusSessionInsert = {
      user_id: uid,
      task_id: body.task_id ?? null,
      duration_minutes: Math.round(body.duration_minutes),
      session_type: body.session_type,
      phase: body.phase ?? "focus",
      intent: body.intent ?? null,
      challenge_rounds: body.challenge_rounds ?? 0,
      started_at: body.started_at || now,
      ended_at: body.ended_at || now,
    };

    if (shouldUseMock()) {
      const row = mockCreateFocusSession(uid, session);
      const todayMinutes = mockTodayFocusMinutes(uid);
      return NextResponse.json(
        { ok: true, data: row, today_focus_minutes: todayMinutes, mock: true },
        { status: 201 }
      );
    }

    try {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("focus_sessions")
        .insert(session)
        .select("*")
        .single();
      if (error) throw error;

      // 查今日总专注分钟
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: todayRows } = await supabase
        .from("focus_sessions")
        .select("duration_minutes")
        .eq("user_id", uid)
        .eq("phase", "focus")
        .gte("started_at", todayStart.toISOString());
      const todayMinutes = (todayRows || []).reduce(
        (sum, r) => sum + (r.duration_minutes || 0),
        0
      );

      return NextResponse.json(
        { ok: true, data, today_focus_minutes: todayMinutes },
        { status: 201 }
      );
    } catch (sbErr: any) {
      console.warn("[focus/record] Supabase 失败 → 降级 Mock:", sbErr?.message);
      const row = mockCreateFocusSession(uid, session);
      const todayMinutes = mockTodayFocusMinutes(uid);
      return NextResponse.json(
        {
          ok: true,
          data: row,
          today_focus_minutes: todayMinutes,
          mock: true,
          mock_reason: "supabase_error",
          mock_error: String(sbErr?.message || sbErr),
        },
        { status: 201 }
      );
    }
  } catch (e: any) {
    console.error("[focus/record]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "记录专注会话失败" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/focus/record
 * 返回今日专注统计
 */
export async function GET(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);

    if (shouldUseMock()) {
      const todayMinutes = mockTodayFocusMinutes(uid);
      return NextResponse.json({ ok: true, today_focus_minutes: todayMinutes, mock: true });
    }

    const supabase = getSupabaseAdmin();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from("focus_sessions")
      .select("duration_minutes, session_type, phase")
      .eq("user_id", uid)
      .gte("started_at", todayStart.toISOString());
    if (error) throw error;

    const rows = data || [];
    const todayMinutes = rows
      .filter((r) => r.phase === "focus")
      .reduce((sum, r) => sum + (r.duration_minutes || 0), 0);
    const pomodoroCount = rows.filter(
      (r) => r.session_type === "pomodoro" && r.phase === "focus"
    ).length;

    return NextResponse.json({
      ok: true,
      today_focus_minutes: todayMinutes,
      today_pomodoro_count: pomodoroCount,
    });
  } catch (e: any) {
    console.error("[focus/record GET]", e);
    const todayMinutes = mockTodayFocusMinutes("unknown");
    return NextResponse.json({
      ok: true,
      today_focus_minutes: todayMinutes,
      mock: true,
      mock_error: String(e?.message || e),
    });
  }
}

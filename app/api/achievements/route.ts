import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromHeaders } from "@/lib/supabase/client";
import { shouldUseMock, mockUnlockAchievement, mockListAchievements, mockHasAchievement } from "@/lib/supabase/mock-store";
import type { AchievementInsert } from "@/lib/supabase/types";

/**
 * POST /api/achievements/unlock
 * 解锁一个成就徽章
 * Body: { badge_code, badge_name, description?, progress_value?, metadata? }
 */
export async function POST(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const body = (await req.json()) as AchievementInsert;

    if (!body.badge_code || !body.badge_name) {
      return NextResponse.json(
        { ok: false, error: "缺少 badge_code 或 badge_name" },
        { status: 400 }
      );
    }

    if (shouldUseMock()) {
      const existing = mockHasAchievement(uid, body.badge_code);
      if (existing) {
        return NextResponse.json({ ok: true, already_unlocked: true, mock: true });
      }
      const achievement = mockUnlockAchievement(uid, {
        badge_code: body.badge_code,
        badge_name: body.badge_name,
        description: body.description ?? null,
        progress_value: body.progress_value ?? 0,
        metadata: body.metadata ?? null,
      });
      return NextResponse.json(
        { ok: true, achievement, already_unlocked: false, mock: true },
        { status: 201 }
      );
    }

    const supabase = getSupabaseAdmin();
    try {
      // 防重复
      const { data: existing } = await supabase
        .from("achievements")
        .select("id")
        .eq("user_id", uid)
        .eq("badge_code", body.badge_code)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ ok: true, already_unlocked: true });
      }

      const { data, error } = await supabase
        .from("achievements")
        .insert({
          user_id: uid,
          badge_code: body.badge_code,
          badge_name: body.badge_name,
          description: body.description ?? null,
          progress_value: body.progress_value ?? 0,
          metadata: body.metadata ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;

      return NextResponse.json(
        { ok: true, achievement: data, already_unlocked: false },
        { status: 201 }
      );
    } catch (sbErr: any) {
      console.warn("[achievements/unlock] Supabase 失败 → 降级 Mock:", sbErr?.message);
      const achievement = mockUnlockAchievement(uid, {
        badge_code: body.badge_code,
        badge_name: body.badge_name,
        description: body.description ?? null,
        progress_value: body.progress_value ?? 0,
        metadata: body.metadata ?? null,
      });
      return NextResponse.json(
        { ok: true, achievement, already_unlocked: false, mock: true },
        { status: 201 }
      );
    }
  } catch (e: any) {
    console.error("[achievements/unlock]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "解锁成就失败" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/achievements
 * 获取所有已解锁成就列表
 */
export async function GET(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);

    if (shouldUseMock()) {
      const achievements = mockListAchievements(uid);
      return NextResponse.json({ ok: true, achievements, mock: true });
    }

    const supabase = getSupabaseAdmin();
    try {
      const { data, error } = await supabase
        .from("achievements")
        .select("*")
        .eq("user_id", uid)
        .order("unlocked_at", { ascending: false });
      if (error) throw error;

      return NextResponse.json({ ok: true, achievements: data || [] });
    } catch (sbErr: any) {
      console.warn("[achievements GET] Supabase 失败 → 返回空数据:", sbErr?.message);
      return NextResponse.json({
        ok: true,
        achievements: [],
        mock: true,
        mock_error: String(sbErr?.message || sbErr),
      });
    }
  } catch (e: any) {
    console.error("[achievements GET]", e);
    return NextResponse.json({
      ok: true,
      achievements: [],
      mock: true,
      mock_error: String(e?.message || e),
    });
  }
}

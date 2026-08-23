export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromHeaders } from "@/lib/supabase/client";
import {
  shouldUseMock,
  mockListGoals,
  mockCreateGoal,
  mockUpdateGoal,
  mockDeleteGoal,
  mockListGoalSteps,
  mockCreateGoalStep,
  mockBatchCreateGoalSteps,
  mockUpdateGoalStep,
  mockMarkStepAdded,
} from "@/lib/supabase/mock-store";
import type { GoalInsert, GoalStepInsert } from "@/lib/supabase/types";

/** GET /api/goals?status=active */
export async function GET(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;

    if (shouldUseMock()) {
      const goals = mockListGoals(uid, status);
      // 附带 steps
      const withSteps = goals.map((g) => ({
        ...g,
        steps: mockListGoalSteps(g.id),
      }));
      return NextResponse.json({ ok: true, goals: withSteps, mock: true });
    }

    const supabase = getSupabaseAdmin();
    try {
      let query = supabase
        .from("goals")
        .select("*")
        .eq("user_id", uid);
      if (status) query = query.eq("status", status);
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;

      // 批量加载 steps
      const goalIds = (data || []).map((g: any) => g.id);
      let stepsMap: Record<string, any[]> = {};
      if (goalIds.length > 0) {
        const { data: stepsData } = await supabase
          .from("goal_steps")
          .select("*")
          .in("goal_id", goalIds)
          .order("step_order", { ascending: true });
        for (const s of (stepsData as any[]) || []) {
          if (!stepsMap[s.goal_id]) stepsMap[s.goal_id] = [];
          stepsMap[s.goal_id].push(s);
        }
      }
      const withSteps = (data || []).map((g: any) => ({
        ...g,
        steps: stepsMap[g.id] || [],
      }));

      return NextResponse.json({ ok: true, goals: withSteps });
    } catch (sbErr: any) {
      console.warn("[goals GET] Supabase 失败 → 降级 Mock:", sbErr?.message);
      const goals = mockListGoals(uid, status);
      const withSteps = goals.map((g) => ({
        ...g,
        steps: mockListGoalSteps(g.id),
      }));
      return NextResponse.json({
        ok: true,
        goals: withSteps,
        mock: true,
        mock_error: String(sbErr?.message || sbErr),
      });
    }
  } catch (e: any) {
    console.error("[goals GET]", e);
    return NextResponse.json(
      { ok: true, goals: [], mock: true, mock_error: String(e?.message || e) }
    );
  }
}

/** POST /api/goals — 创建长期目标 */
export async function POST(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const body = (await req.json()) as GoalInsert & {
      steps?: {
        content: string;
        step_order: number;
        scheduled_date?: string | null;
        notes?: string | null;
      }[];
    };

    if (!body.title || body.title.trim().length === 0) {
      return NextResponse.json({ ok: false, error: "标题不能为空" }, { status: 400 });
    }

    const goalData: Omit<GoalInsert, "user_id"> = {
      title: body.title.trim(),
      description: body.description ?? null,
      target_date: body.target_date ?? null,
      starting_point: body.starting_point ?? null,
      success_criteria: body.success_criteria ?? null,
      weekly_time: body.weekly_time ?? null,
    };

    if (shouldUseMock()) {
      const goal = mockCreateGoal(uid, goalData);
      const steps = body.steps?.length
        ? mockBatchCreateGoalSteps(uid, goal.id, body.steps)
        : [];
      return NextResponse.json(
        { ok: true, goal, steps, mock: true },
        { status: 201 }
      );
    }

    const supabase = getSupabaseAdmin();
    try {
      const { data: goal, error } = await supabase
        .from("goals")
        .insert({ ...goalData, user_id: uid })
        .select("*")
        .single();
      if (error) throw error;

      let steps: any[] = [];
      if (body.steps?.length && goal) {
        const stepRows = body.steps.map((s) => ({
          goal_id: (goal as any).id,
          content: s.content,
          step_order: s.step_order,
          scheduled_date: s.scheduled_date ?? null,
          notes: s.notes ?? null,
        }));
        const { data: insertedSteps } = await supabase
          .from("goal_steps")
          .insert(stepRows)
          .select("*");
        steps = insertedSteps || [];
      }

      return NextResponse.json({ ok: true, goal, steps }, { status: 201 });
    } catch (sbErr: any) {
      console.warn("[goals POST] Supabase 失败 → 降级 Mock:", sbErr?.message);
      const goal = mockCreateGoal(uid, goalData);
      const steps = body.steps?.length
        ? mockBatchCreateGoalSteps(uid, goal.id, body.steps)
        : [];
      return NextResponse.json(
        { ok: true, goal, steps, mock: true, mock_error: String(sbErr?.message || sbErr) },
        { status: 201 }
      );
    }
  } catch (e: any) {
    console.error("[goals POST]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "创建目标失败" },
      { status: 500 }
    );
  }
}

/** PATCH /api/goals?id=xxx — 更新目标状态 */
export async function PATCH(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "缺少 id" }, { status: 400 });

    const body = (await req.json()) as Partial<GoalInsert>;

    if (shouldUseMock()) {
      const goal = mockUpdateGoal(id, body);
      return NextResponse.json({ ok: true, goal, mock: true });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("goals")
      .update(body)
      .eq("id", id)
      .eq("user_id", uid)
      .select("*")
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, goal: data });
  } catch (e: any) {
    console.error("[goals PATCH]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "更新目标失败" },
      { status: 500 }
    );
  }
}

/** DELETE /api/goals?id=xxx */
export async function DELETE(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "缺少 id" }, { status: 400 });

    if (shouldUseMock()) {
      mockDeleteGoal(id);
      return NextResponse.json({ ok: true, mock: true });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("goals")
      .delete()
      .eq("id", id)
      .eq("user_id", uid);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[goals DELETE]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "删除目标失败" },
      { status: 500 }
    );
  }
}

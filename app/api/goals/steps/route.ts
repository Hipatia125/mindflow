import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromHeaders } from "@/lib/supabase/client";
import { shouldUseMock, mockUpdateGoalStep, mockMarkStepAdded } from "@/lib/supabase/mock-store";

/** PATCH /api/goals/steps?id=xxx — 更新子步骤 */
export async function PATCH(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "缺少 id" }, { status: 400 });

    const body = (await req.json()) as {
      is_done?: boolean;
      added_to_tasks?: boolean;
    };

    if (shouldUseMock()) {
      const step = body.added_to_tasks
        ? mockMarkStepAdded(id)
        : mockUpdateGoalStep(id, body);
      return NextResponse.json({ ok: true, step, mock: true });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("goal_steps")
      .update(body)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, step: data });
  } catch (e: any) {
    console.error("[goals/steps PATCH]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "更新子步骤失败" },
      { status: 500 }
    );
  }
}

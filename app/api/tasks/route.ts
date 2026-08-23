export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromHeaders } from "@/lib/supabase/client";
import { todayISO } from "@/lib/utils";
import type { TaskInsert, TaskUpdate } from "@/lib/supabase/types";
import {
  shouldUseMock,
  mockListTasks,
  mockCreateTasks,
  mockUpdateTask,
  mockDeleteTask,
  mockFindTaskById,
} from "@/lib/supabase/mock-store";

/**
 * 通用 fallback 辅助：
 * - shouldUseMock() 返回 true → 执行 mockFn 并返回
 * - 否则执行 supabaseFn，成功返回；失败（表未建 / RLS / 缺列等）→ 自动降级到 mockFn，
 *   同时在服务端打印详细 Supabase 错误供定位。
 */
async function withMockFallback<T>(
  ctx: { module: string; method: string },
  shouldMock: boolean,
  supabaseFn: () => Promise<T>,
  mockFn: () => T
): Promise<{ value: T; mock: boolean; mockReason?: string; mockError?: string }> {
  if (shouldMock) {
    return { value: mockFn(), mock: true };
  }
  try {
    const value = await supabaseFn();
    return { value, mock: false };
  } catch (sbErr: any) {
    const msg = String(sbErr?.message || sbErr);
    console.warn(
      `[${ctx.module}/${ctx.method}] Supabase 失败 → 自动降级 Mock。原因：`,
      msg
    );
    return {
      value: mockFn(),
      mock: true,
      mockReason: "supabase_error",
      mockError: msg,
    };
  }
}

/**
 * ================================================================
 * GET /api/tasks?date=YYYY-MM-DD
 * ================================================================ */
export async function GET(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || todayISO();

    const { value: data, mock, mockReason, mockError } = await withMockFallback(
      { module: "tasks", method: "GET" },
      shouldUseMock(),
      async () => {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("tasks")
          .select("*")
          .eq("user_id", uid)
          .eq("due_date", date)
          .order("is_done", { ascending: true })
          .order("created_at", { ascending: true });
        if (error) throw error;
        return data || [];
      },
      () => mockListTasks(uid, date)
    );
    return NextResponse.json({
      ok: true,
      data,
      date,
      mock: mock || undefined,
      mock_reason: mockReason,
      mock_error: mockError,
    });
  } catch (e: any) {
    console.error("[tasks/GET]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "查询任务失败" },
      { status: 500 }
    );
  }
}

/**
 * ================================================================
 * POST /api/tasks
 * ================================================================ */
export async function POST(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const body = (await req.json()) as
      | (TaskInsert & { items?: undefined })
      | { items: TaskInsert[] };

    const today = todayISO();
    const rows: TaskInsert[] = Array.isArray((body as any).items)
      ? (body as { items: TaskInsert[] }).items.map((it) => ({
          ...it,
          user_id: uid,
          due_date: it.due_date || today,
          source: it.source || "manual",
          is_done: false,
          focus_minutes: it.focus_minutes ?? 0,
        }))
      : [
          {
            user_id: uid,
            content: (body as TaskInsert).content,
            due_date: (body as TaskInsert).due_date || today,
            source: (body as TaskInsert).source || "manual",
            is_done: false,
            focus_minutes: (body as TaskInsert).focus_minutes ?? 0,
            goal_step_id: (body as TaskInsert).goal_step_id ?? null,
          },
        ];

    if (!rows.every((r) => r.content && r.content.trim())) {
      return NextResponse.json(
        { ok: false, error: "任务内容不能为空" },
        { status: 400 }
      );
    }

    const { value: data, mock, mockReason, mockError } = await withMockFallback(
      { module: "tasks", method: "POST" },
      shouldUseMock(),
      async () => {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("tasks")
          .insert(rows)
          .select("*")
          .order("created_at", { ascending: true });
        if (error) throw error;
        return data || [];
      },
      () => mockCreateTasks(uid, rows)
    );
    return NextResponse.json(
      {
        ok: true,
        data,
        count: data.length,
        mock: mock || undefined,
        mock_reason: mockReason,
        mock_error: mockError,
      },
      { status: 201 }
    );
  } catch (e: any) {
    console.error("[tasks/POST]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "新增任务失败" },
      { status: 500 }
    );
  }
}

/**
 * ================================================================
 * PATCH /api/tasks?id=xxx
 * Body: { is_done?, focus_minutes?, add_focus_minutes?, content?, due_date? }
 *   支持 add_focus_minutes（正数累加到原任务）
 * ================================================================ */
export async function PATCH(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const { searchParams } = new URL(req.url);
    const body = (await req.json()) as TaskUpdate & {
      id?: string;
      add_focus_minutes?: number;
    };
    const id = searchParams.get("id") || body.id;
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "缺少任务 id 参数" },
        { status: 400 }
      );
    }

    const taskId: string = id;

    /** Supabase 分支的 patch 计算 */
    const supabasePatch = async (): Promise<TaskUpdate> => {
      const supabase = getSupabaseAdmin();
      const { data: curData, error: curErr } = await supabase
        .from("tasks")
        .select("focus_minutes")
        .eq("id", taskId)
        .eq("user_id", uid)
        .maybeSingle();
      if (curErr) throw curErr;
      const update: TaskUpdate = {};
      if (typeof body.is_done === "boolean") update.is_done = body.is_done;
      if (typeof body.focus_minutes === "number") update.focus_minutes = body.focus_minutes;
      if (typeof body.add_focus_minutes === "number") {
        update.focus_minutes = (curData?.focus_minutes || 0) + body.add_focus_minutes;
      }
      if (typeof body.content === "string") update.content = body.content;
      if (typeof body.due_date === "string") update.due_date = body.due_date;
      return update;
    };

    /** Mock 分支的 patch 计算 */
    const mockPatch = (): TaskUpdate => {
      const { add_focus_minutes, ...rest } = body;
      const patch: TaskUpdate = {};
      if (typeof rest.is_done === "boolean") patch.is_done = rest.is_done;
      if (typeof rest.content === "string") patch.content = rest.content;
      if (typeof rest.due_date === "string") patch.due_date = rest.due_date;
      if (typeof rest.focus_minutes === "number") patch.focus_minutes = rest.focus_minutes;
      if (typeof add_focus_minutes === "number") {
        const cur = mockFindTaskById(taskId);
        patch.focus_minutes = (cur?.focus_minutes || 0) + add_focus_minutes;
      }
      return patch;
    };

    // —— 第一阶段：算 patch（Supabase 分支能先拿 curData；失败则降级用 Mock 分支算 patch）
    let patch: TaskUpdate;
    let fallbackMode = shouldUseMock();
    let supabaseMsg: string | undefined = undefined;
    if (!fallbackMode) {
      try {
        patch = await supabasePatch();
      } catch (sbErr: any) {
        supabaseMsg = String(sbErr?.message || sbErr);
        console.warn(
          `[tasks/PATCH] Supabase 取当前任务失败 → 切换 Mock 算 patch。原因：`,
          supabaseMsg
        );
        fallbackMode = true;
        patch = mockPatch();
      }
    } else {
      patch = mockPatch();
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { ok: false, error: "没有需要更新的字段" },
        { status: 400 }
      );
    }

    // —— 第二阶段：执行 update；Supabase 再失败则再次降级 Mock
    const { value: updated, mock, mockReason, mockError } = await withMockFallback(
      { module: "tasks", method: "PATCH.apply" },
      fallbackMode,
      async () => {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("tasks")
          .update(patch)
          .eq("id", id)
          .eq("user_id", uid)
          .select("*")
          .single();
        if (error) throw error;
        return data as any;
      },
      () => mockUpdateTask(uid, id, patch)
    );
    if (!updated)
      return NextResponse.json(
        { ok: false, error: "任务不存在" },
        { status: 404 }
      );
    return NextResponse.json({
      ok: true,
      data: updated,
      mock: (mock || fallbackMode) || undefined,
      mock_reason: mockReason || (supabaseMsg ? "supabase_error" : undefined),
      mock_error: mockError || supabaseMsg,
    });
  } catch (e: any) {
    console.error("[tasks/PATCH]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "更新任务失败" },
      { status: 500 }
    );
  }
}

/**
 * ================================================================
 * DELETE /api/tasks?id=xxx
 * ================================================================ */
export async function DELETE(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "缺少 id" }, { status: 400 });

    const { value: ok, mock, mockReason, mockError } = await withMockFallback(
      { module: "tasks", method: "DELETE" },
      shouldUseMock(),
      async () => {
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("tasks")
          .delete()
          .eq("id", id)
          .eq("user_id", uid);
        if (error) throw error;
        return true;
      },
      () => mockDeleteTask(uid, id)
    );
    return NextResponse.json({
      ok,
      mock: mock || undefined,
      mock_reason: mockReason,
      mock_error: mockError,
    });
  } catch (e: any) {
    console.error("[tasks/DELETE]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "删除任务失败" },
      { status: 500 }
    );
  }
}

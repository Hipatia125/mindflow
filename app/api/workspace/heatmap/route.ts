import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromHeaders } from "@/lib/supabase/client";
import { toDateISO, todayISO } from "@/lib/utils";
import {
  shouldUseMock,
  mockTaskCompletionByDay,
} from "@/lib/supabase/mock-store";

export interface DayStat {
  total: number;
  done: number;
  focus_minutes: number;
}

/**
 * GET /api/workspace/heatmap?month=YYYY-MM
 * 返回当前（或指定）月份每一天的完成度统计：
 *   { days: { "2026-08-01": { total, done, focus_minutes }, ... }, month_label }
 * 同时向前多取 7 天，保证热力图第一列（周一列）能完整落位
 */
export async function GET(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const { searchParams } = new URL(req.url);
    let target: Date;
    const monthParam = searchParams.get("month");
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split("-").map(Number);
      target = new Date(y, m - 1, 1);
    } else {
      target = new Date();
    }

    const y = target.getFullYear();
    const m = target.getMonth();
    const firstOfMonth = new Date(y, m, 1);
    // 月初的前几天（用于对齐第一周的周一）
    const weekdayOfFirst = (firstOfMonth.getDay() + 6) % 7; // 周一为0
    const rangeStart = new Date(firstOfMonth);
    rangeStart.setDate(rangeStart.getDate() - weekdayOfFirst);
    const rangeEnd = new Date(y, m + 1, 0);

    const startISO = toDateISO(rangeStart);
    const endISO = toDateISO(rangeEnd);

    let days: Record<string, DayStat> = {};
    let isMock = false;
    let mockReason: string | undefined;
    let mockError: string | undefined;

    if (shouldUseMock()) {
      isMock = true;
      days = mockTaskCompletionByDay(uid, startISO, endISO);
    } else {
      try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("tasks")
          .select("due_date, is_done, focus_minutes")
          .eq("user_id", uid)
          .gte("due_date", startISO)
          .lte("due_date", endISO);
        if (error) throw error;
        for (const t of data || []) {
          const key = (t as any).due_date as string;
          if (!days[key]) days[key] = { total: 0, done: 0, focus_minutes: 0 };
          days[key].total += 1;
          if ((t as any).is_done) days[key].done += 1;
          days[key].focus_minutes += (t as any).focus_minutes || 0;
        }
      } catch (sbErr: any) {
        const msg = String(sbErr?.message || sbErr);
        console.warn(
          `[heatmap/GET] Supabase 查询失败 → 自动降级 Mock。原因：`,
          msg
        );
        isMock = true;
        mockReason = "supabase_error";
        mockError = msg;
        days = mockTaskCompletionByDay(uid, startISO, endISO);
      }
    }

    // —— 开发期调试信息（在 VS Code 终端看）——
    if (isMock) {
      const totalDays = Object.keys(days).length;
      const totalCells = Object.values(days).reduce((s, d) => s + d.total, 0);
      console.log(
        `[heatmap mock] 范围 ${startISO} ~ ${endISO}: 命中 ${totalDays} 天 / ${totalCells} 条任务。` +
          (mockError
            ? ` （Supabase 降级：${mockError}）`
            : totalCells === 0
            ? ` 可能原因：(1) mock 里 due_date 不在范围内；(2) 浏览器 localStorage 的 uid 变了 —— 新版已自动宽松匹配`
            : ` 完成任务合计 ${Object.values(days).reduce((s, d) => s + d.done, 0)} 条`)
      );
    }

    const monthLabel = target.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
    });

    const payload = {
      month_label: monthLabel,
      month_iso: `${y}-${String(m + 1).padStart(2, "0")}`,
      range_start: startISO,
      range_end: endISO,
      today: todayISO(),
      days,
    };
    // 与 /api/tasks 保持一致的 envelope：{ ok, data, mock }
    return NextResponse.json({
      ok: true,
      mock: isMock || undefined,
      mock_reason: mockReason,
      mock_error: mockError,
      data: payload,
    });
  } catch (e: any) {
    console.error("[heatmap/GET]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "获取热力图失败" },
      { status: 500 }
    );
  }
}

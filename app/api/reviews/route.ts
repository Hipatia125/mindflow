export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromHeaders } from "@/lib/supabase/client";
import { todayISO, shiftDateISO } from "@/lib/utils";
import type { ReviewInsert, Review } from "@/lib/supabase/types";
import {
  shouldUseMock,
  mockCreateReview,
  mockUpdateReview,
  mockReviewStats,
  mockListTodayReviews,
  scheduleRecall,
  mockFindReviewById,
  loadStore,
} from "@/lib/supabase/mock-store";

/** 复习强度：记住 / 模糊 / 重头学 */
export type RecallStrength = "remember" | "fuzzy" | "reset";

/**
 * ================================================================
 * GET /api/reviews?date=YYYY-MM-DD
 *
 * 返回：
 *   {
 *     ok,
 *     mock?,
 *     date,
 *     data: {
 *       stats: { today_due, mastered, tomorrow_due, in_progress, graduated, total },
 *       due: Review[]           // 今日/逾期待复习卡片（pending 且 next_review_date <= date & 未毕业）
 *       graduated_list: Review[] // 已毕业卡片（归档区用，轻量排序：按 graduated 时间倒序）
 *     }
 *   }
 *
 * 容错策略：
 *   若配置了真实 Supabase 但查询失败（表未建 / RLS 错 / 缺列等），自动降级回 Mock，
 *   并在服务端打印错误，以便定位，同时前端不阻塞。
 * ================================================================ */
export async function GET(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || todayISO();

    // —— Mock 降级 ——
    if (shouldUseMock()) {
      const s = loadStore();
      const internalUid = (s as any).users?.[0]?.id ?? uid; // fallback
      const allUsersReviews = s.reviews.filter(
        (r) => r.user_id === internalUid || String(r.user_id).endsWith(String(uid).slice(-4))
      );
      // 宽松兜底：mock 的 user_id 可能是 UUID，而前端 uid 可能是字面 demo; 当 mock 时直接取 store 里全部 reviews（单用户 Demo 场景）
      const list = allUsersReviews.length ? allUsersReviews : s.reviews;
      const graduated_list = list
        .filter((r) => {
          const rr = typeof (r as any).review_round === "number" ? (r as any).review_round : 1;
          return r.status === "graduated" || r.status === "reviewed" || rr > 6;
        })
        .sort(
          (a, b) =>
            (b as any).created_at?.localeCompare((a as any).created_at) ||
            b.created_at.localeCompare(a.created_at)
        );
      return NextResponse.json({
        ok: true,
        mock: true,
        date,
        data: {
          stats: mockReviewStats(uid, date),
          due: mockListTodayReviews(uid, date),
          graduated_list,
        },
      });
    }

    let supabaseErr: unknown = null;
    try {
      const supabase = getSupabaseAdmin();

      // 查今日 due：pending 且 next_review_date <= date
      const { data: due, error: dueErr } = await supabase
        .from("reviews")
        .select("*")
        .eq("user_id", uid)
        .eq("status", "pending")
        .lte("next_review_date", date)
        .order("next_review_date", { ascending: true })
        .order("created_at", { ascending: true });
      if (dueErr) throw dueErr;

      // 查毕业卡归档（graduated）
      const { data: graduatedRaw, error: gradErr } = await supabase
        .from("reviews")
        .select("*")
        .eq("user_id", uid)
        .in("status", ["graduated", "reviewed"])
        .order("created_at", { ascending: false });
      if (gradErr) throw gradErr;

      // 统计
      const tomorrow = shiftDateISO(date, 1);
      const [
        { count: dueCount },
        { count: reviewedOrGraduated },
        { count: tomorrowDue },
        { count: total },
      ] = await Promise.all([
        supabase
          .from("reviews")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid)
          .eq("status", "pending")
          .lte("next_review_date", date),
        supabase
          .from("reviews")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid)
          .in("status", ["reviewed", "graduated"]),
        supabase
          .from("reviews")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid)
          .eq("status", "pending")
          .eq("next_review_date", tomorrow),
        supabase
          .from("reviews")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid),
      ]);

      // 进行中：1 ≤ review_round ≤ 6 且 非毕业
      // 注意：如果老库没 review_round 列，这里会报错，但已经有 Supabase try 外会 catch → 自动降级 Mock 兜底
      let inProgress = 0;
      try {
        const { count } = await supabase
          .from("reviews")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid)
          .eq("status", "pending")
          .gte("review_round", 1)
          .lte("review_round", 6);
        inProgress = count ?? 0;
      } catch {
        // 列不存在 → fallback 用 today+tomorrow 近似（不会报错影响主流程）
        inProgress = Math.max(0, (total ?? 0) - (reviewedOrGraduated ?? 0));
      }

      return NextResponse.json({
        ok: true,
        date,
        data: {
          stats: {
            today_due: dueCount ?? 0,
            mastered: reviewedOrGraduated ?? 0,
            tomorrow_due: tomorrowDue ?? 0,
            graduated: reviewedOrGraduated ?? 0,
            in_progress: inProgress,
            total: total ?? 0,
          },
          due: (due || []) as Review[],
          graduated_list: (graduatedRaw || []) as Review[],
        },
      });
    } catch (sbErr) {
      supabaseErr = sbErr;
      // 打详细日志给 dev 看
      console.warn(
        `[reviews/GET] Supabase 查询失败，自动降级到 Mock。原因：`,
        sbErr
      );
    }

    // —— Fallback 降级：Mock ——
    const s = loadStore();
    const graduated_list = s.reviews
      .filter((r) => {
        const rr = typeof (r as any).review_round === "number" ? (r as any).review_round : 1;
        return r.status === "graduated" || r.status === "reviewed" || rr > 6;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return NextResponse.json({
      ok: true,
      mock: true,
      mock_reason: "supabase_error",
      mock_error: String((supabaseErr as any)?.message || supabaseErr),
      date,
      data: {
        stats: mockReviewStats(uid, date),
        due: mockListTodayReviews(uid, date),
        graduated_list,
      },
    });
  } catch (e: any) {
    console.error("[reviews/GET]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "查询复习卡片失败" },
      { status: 500 }
    );
  }
}

/**
 * ================================================================
 * POST /api/reviews
 *   Body: { title, content?, images?, source?, next_review_date?, interval_days?, review_round? }
 *   新增一张复习卡片。
 *     · 默认：review_round=1（正在做第 1 轮）、interval_days=1、
 *             next_review_date = 今天 + 1 天（满足「第一次复习提醒设为 1 天后」）
 *     · 显式给了 next_review_date 或 interval_days 或 review_round 就用给的值。
 * ================================================================ */
export async function POST(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const body = (await req.json()) as Partial<ReviewInsert> & { title: string };

    if (!body.title || !String(body.title).trim()) {
      return NextResponse.json(
        { ok: false, error: "复习卡片标题不能为空" },
        { status: 400 }
      );
    }

    const today = todayISO();
    const defaultRound = Math.max(1, Math.min(7, Number(body.review_round) || 1));
    // 当用户没明确给间隔时，按 round 推算
    const inferredIntervalFromRound =
      defaultRound <= 6 ? [1, 2, 4, 7, 15, 30][defaultRound - 1] : 30;
    const interval =
      typeof body.interval_days === "number" && body.interval_days > 0
        ? body.interval_days
        : inferredIntervalFromRound;
    // 默认 next_review_date：没指定就 = 今天 + interval（对第 1 轮 round=1 间隔 1 → 明天提醒）
    const explicitDate = body.next_review_date && String(body.next_review_date).match(/^\d{4}-\d{2}-\d{2}$/);
    const nextDate = explicitDate
      ? String(body.next_review_date)
      : shiftDateISO(today, interval);
    const source = body.source === "ai" ? "ai" : "manual";
    const content = typeof body.content === "string" ? body.content.trim() || null : null;
    // 图片数组：三种输入形态（数组 / 单个字符串 / 空）都要规范化
    const images = Array.isArray(body.images)
      ? (body.images as any[]).filter((x) => typeof x === "string" && x.length > 0)
      : typeof body.images === "string" && body.images.length > 0
      ? [body.images]
      : undefined;

    const status =
      body.status === "graduated" || body.status === "reviewed" || body.status === "pending"
        ? body.status
        : defaultRound > 6
        ? "graduated"
        : "pending";

    const row: ReviewInsert = {
      user_id: uid,
      title: String(body.title).trim(),
      content,
      ...(images !== undefined ? { images } : {}),
      source,
      review_round: defaultRound,
      interval_days: interval,
      next_review_date: nextDate,
      status,
    };

    // —— Mock 降级（显式或 Supabase 失败后 fallback）——
    if (shouldUseMock()) {
      const data = mockCreateReview(uid, row);
      return NextResponse.json({ ok: true, data, mock: true }, { status: 201 });
    }

    try {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("reviews")
        .insert(row)
        .select("*")
        .single();
      if (error) throw error;
      return NextResponse.json({ ok: true, data }, { status: 201 });
    } catch (sbErr: any) {
      console.warn(
        `[reviews/POST] Supabase 插入失败，自动降级到 Mock。原因：`,
        sbErr?.message || sbErr
      );
      const data = mockCreateReview(uid, row);
      return NextResponse.json(
        {
          ok: true,
          mock: true,
          mock_reason: "supabase_error",
          mock_error: String(sbErr?.message || sbErr),
          data,
        },
        { status: 201 }
      );
    }
  } catch (e: any) {
    console.error("[reviews/POST]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "新增复习卡片失败" },
      { status: 500 }
    );
  }
}

/**
 * ================================================================
 * PATCH /api/reviews?id=xxx
 *   Body（二选一）：
 *     1) { strength: "remember" | "fuzzy" | "reset", today?: "YYYY-MM-DD" }
 *        → 按强度调度新的 interval_days / next_review_date / status
 *     2) 普通字段更新 { title?, source?, status?, interval_days?, next_review_date? }
 * ================================================================ */
export async function PATCH(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const { searchParams } = new URL(req.url);
    const body = (await req.json()) as
      | { strength: RecallStrength; today?: string }
      | { title?: string; source?: "ai" | "manual"; status?: Review["status"]; interval_days?: number; next_review_date?: string; id?: string };
    const id = searchParams.get("id") || (body as any).id;
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "缺少复习卡片 id" },
        { status: 400 }
      );
    }

    // —— strength：三档调度 ——
    if ("strength" in body && body.strength) {
      const strength = body.strength;
      if (!["remember", "fuzzy", "reset"].includes(strength)) {
        return NextResponse.json(
          { ok: false, error: "strength 必须是 remember / fuzzy / reset 之一" },
          { status: 400 }
        );
      }
      const today = body.today || todayISO();

      if (shouldUseMock()) {
        const found = mockFindReviewById(id);
        if (!found)
          return NextResponse.json(
            { ok: false, error: "复习卡片不存在" },
            { status: 404 }
          );
        const currentInterval = found.interval_days ?? 1;
        const round = typeof (found as any).review_round === "number" ? (found as any).review_round : 1;
        const patch = scheduleRecall(currentInterval, today, strength, round);
        const updated = mockUpdateReview(uid, id, patch);
        if (!updated)
          return NextResponse.json(
            { ok: false, error: "复习卡片不存在" },
            { status: 404 }
          );
        return NextResponse.json({
          ok: true,
          data: { ...updated, strength_result: { strength, applied: patch } },
          mock: true,
        });
      }

      // Supabase 分支：先拿当前 interval + review_round
      let supabaseErr: any = null;
      try {
        const supabase = getSupabaseAdmin();
        const { data: curRow, error: curErr } = await supabase
          .from("reviews")
          .select("interval_days, review_round, status")
          .eq("id", id)
          .eq("user_id", uid)
          .maybeSingle();
        if (curErr) throw curErr;
        if (!curRow) {
          return NextResponse.json(
            { ok: false, error: "复习卡片不存在" },
            { status: 404 }
          );
        }
        const curInterval = curRow.interval_days || 1;
        const curRound = typeof curRow.review_round === "number" ? curRow.review_round : 1;
        const patch = scheduleRecall(curInterval, today, strength, curRound);
        const { data, error } = await supabase
          .from("reviews")
          .update(patch as any)
          .eq("id", id)
          .eq("user_id", uid)
          .select("*")
          .single();
        if (error) throw error;
        return NextResponse.json({
          ok: true,
          data,
          strength_result: { strength, applied: patch },
        });
      } catch (sbErr: any) {
        supabaseErr = sbErr;
        console.warn(
          `[reviews/PATCH] Supabase strength 更新失败，自动降级到 Mock。原因：`,
          sbErr?.message || sbErr
        );
      }

      // Fallback 降级：Mock
      {
        const found = mockFindReviewById(id);
        if (!found)
          return NextResponse.json(
            { ok: false, error: "复习卡片不存在" },
            { status: 404 }
          );
        const currentInterval = found.interval_days ?? 1;
        const round = typeof (found as any).review_round === "number" ? (found as any).review_round : 1;
        const patch = scheduleRecall(currentInterval, today, strength, round);
        const updated = mockUpdateReview(uid, id, patch);
        if (!updated)
          return NextResponse.json(
            { ok: false, error: "复习卡片不存在" },
            { status: 404 }
          );
        return NextResponse.json({
          ok: true,
          mock: true,
          mock_reason: supabaseErr ? "supabase_error" : undefined,
          mock_error: supabaseErr ? String(supabaseErr?.message || supabaseErr) : undefined,
          data: { ...updated, strength_result: { strength, applied: patch } },
        });
      }
    }

    // —— 普通字段更新 ——
    const patch: any = {};
    if ("title" in body && typeof body.title === "string" && body.title.trim())
      patch.title = body.title.trim();
    if ("source" in body && (body.source === "ai" || body.source === "manual"))
      patch.source = body.source;
    if (
      "status" in body &&
      (body.status === "pending" ||
        body.status === "reviewed" ||
        body.status === "graduated")
    )
      patch.status = body.status;
    if ("interval_days" in body && typeof body.interval_days === "number" && body.interval_days > 0)
      patch.interval_days = body.interval_days;
    if ("next_review_date" in body && typeof body.next_review_date === "string")
      patch.next_review_date = body.next_review_date;
    if ("review_round" in body && typeof body.review_round === "number") {
      const rr = Math.max(1, Math.min(7, Math.round(body.review_round)));
      patch.review_round = rr;
      if (rr > 6 && !("status" in patch)) patch.status = "graduated";
    }
    if ("content" in body)
      patch.content =
        typeof body.content === "string" ? body.content.trim() || null : body.content ?? null;
    if ("images" in body) {
      if (Array.isArray(body.images))
        patch.images = (body.images as any[]).filter(
          (x) => typeof x === "string" && x.length > 0
        );
      else if (typeof body.images === "string" && body.images.length > 0)
        patch.images = [body.images];
      else patch.images = []; // 空 / null / undefined → 清空
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { ok: false, error: "没有需要更新的字段" },
        { status: 400 }
      );
    }

    if (shouldUseMock()) {
      const updated = mockUpdateReview(uid, id, patch);
      if (!updated)
        return NextResponse.json(
          { ok: false, error: "复习卡片不存在" },
          { status: 404 }
        );
      return NextResponse.json({ ok: true, data: updated, mock: true });
    }

    {
      try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("reviews")
          .update(patch)
          .eq("id", id)
          .eq("user_id", uid)
          .select("*")
          .single();
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      } catch (sbErr: any) {
        console.warn(
          `[reviews/PATCH] Supabase 更新失败，自动降级到 Mock。原因：`,
          sbErr?.message || sbErr
        );
        const updated = mockUpdateReview(uid, id, patch);
        if (!updated)
          return NextResponse.json(
            { ok: false, error: "复习卡片不存在" },
            { status: 404 }
          );
        return NextResponse.json({
          ok: true,
          mock: true,
          mock_reason: "supabase_error",
          mock_error: String(sbErr?.message || sbErr),
          data: updated,
        });
      }
    }
  } catch (e: any) {
    console.error("[reviews/PATCH]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "更新复习卡片失败" },
      { status: 500 }
    );
  }
}

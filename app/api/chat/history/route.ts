export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromHeaders } from "@/lib/supabase/client";
import {
  shouldUseMock,
  mockListChatMessages,
  mockCreateChatMessages,
  mockClearChatMessages,
} from "@/lib/supabase/mock-store";
import type { ChatMessageInsert } from "@/lib/supabase/types";

const HISTORY_LIMIT = 100;

/** GET /api/chat/history — 拉取当前用户历史消息（按时间升序，最近 100 条） */
export async function GET(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);

    if (shouldUseMock()) {
      const messages = mockListChatMessages(uid);
      return NextResponse.json({
        ok: true,
        messages: messages.slice(-HISTORY_LIMIT),
        mock: true,
      });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: true })
      .limit(HISTORY_LIMIT);
    if (error) throw error;

    return NextResponse.json({ ok: true, messages: data });
  } catch (e: any) {
    console.error("[chat/history GET]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "加载历史失败" },
      { status: 500 }
    );
  }
}

/** POST /api/chat/history — 批量追加消息（body: { messages: ChatMessageInsert[] }） */
export async function POST(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);
    const body = (await req.json()) as { messages?: ChatMessageInsert[] };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
      return NextResponse.json({ ok: true, count: 0 });
    }

    if (shouldUseMock()) {
      mockCreateChatMessages(uid, messages);
      return NextResponse.json({ ok: true, count: messages.length, mock: true });
    }

    const supabase = getSupabaseAdmin();
    const rows = messages.map((m) => ({
      user_id: uid,
      role: m.role,
      content: m.content,
      citations: m.citations ?? null,
      meta: m.meta ?? null,
    }));
    const { error } = await supabase.from("chat_messages").insert(rows as any);
    if (error) throw error;

    return NextResponse.json({ ok: true, count: rows.length });
  } catch (e: any) {
    console.error("[chat/history POST]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "保存历史失败" },
      { status: 500 }
    );
  }
}

/** DELETE /api/chat/history — 清空当前用户历史 */
export async function DELETE(req: NextRequest) {
  try {
    const uid = getUserIdFromHeaders(req.headers);

    if (shouldUseMock()) {
      mockClearChatMessages(uid);
      return NextResponse.json({ ok: true, mock: true });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("chat_messages").delete().eq("user_id", uid);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[chat/history DELETE]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "清空历史失败" },
      { status: 500 }
    );
  }
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * ================================================================
 * Supabase 客户端工厂函数（两种：Browser & Admin）
 *
 * 1) createSupabaseBrowserClient()
 *    · 用于"客户端组件"（带 "use client" 的 .tsx）
 *    · 读取 NEXT_PUBLIC_* 环境变量（前端安全）
 *    · 走 RLS（行级安全），只有 user_id 匹配的数据能读写
 *
 * 2) getSupabaseAdmin()
 *    · 仅用于"服务端"（API Routes / Server Components / Server Actions）
 *    · 读取 SUPABASE_SERVICE_ROLE_KEY，绕过 RLS，拥有最高权限
 *    · ☠️ 绝对不要在客户端组件中调用这个函数！
 *    · 采用懒加载模式（每次调用获取实例），避免构建期读取 env 失败
 * ================================================================
 */

// 宽松类型：项目用「手写 interface」维护 types.ts，未完全对齐 supabase-js 的
// GenericTable 约束（需 Record<string, unknown> + Relationships 字段），会导致
// .from() 被推断为 never。故这里用无泛型的 SupabaseClient（Row/Insert 均为 any），
// 保留运行时行为、去掉编译期误报。types.ts 的 MindFlowDatabase 仍作为数据模型真源。
export type MindFlowSupabase = SupabaseClient;

/* ----------------------------------------------------------------
 * 🌐 浏览器端客户端（客户端组件 safe）
 * -------------------------------------------------------------- */
let browserClient: MindFlowSupabase | null = null;

/**
 * 获取浏览器端 Supabase 客户端。
 * 要求 .env.local 中配置：
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 */
export function createSupabaseBrowserClient(): MindFlowSupabase {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // 开发期友好提示：环境变量缺失时，返回一个 mock 代理以免页面白屏
    if (typeof window !== "undefined") {
      console.warn(
        "[MindFlow] 缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY 环境变量，数据操作将失败。请配置 .env.local 后重启 dev server。"
      );
    }
    // 返回一个能创建成功但无实际后端的客户端（避免构造阶段抛异常）
    browserClient = createClient(
      "https://placeholder.supabase.co",
      "placeholder-anon-key",
      { auth: { persistSession: false } }
    );
    return browserClient;
  }

  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: false, // MVP 阶段暂不使用 Supabase Auth
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return browserClient;
}

/* ----------------------------------------------------------------
 * 🛡 服务端 Admin 客户端（仅 Server Components / API Routes）
 * -------------------------------------------------------------- */
let adminClient: MindFlowSupabase | null = null;

/**
 * 获取 Supabase Admin 客户端（绕过 RLS，全权读写）。
 * 必须在服务端调用，且必须配置 SUPABASE_SERVICE_ROLE_KEY。
 * 工厂函数模式 —— 避免构建期（next build）读取 env 失败导致初始化死锁。
 */
export function getSupabaseAdmin(): MindFlowSupabase {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "[MindFlow] 缺少 Supabase 服务端配置：NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。请在 .env.local 中配置，并确认此函数只在服务端（API Route / Server Component）被调用。"
    );
  }

  adminClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return adminClient;
}

/* ----------------------------------------------------------------
 * 👤 简易用户 ID（MVP 匿名模式）
 *
 * MVP 阶段暂不接入 Supabase Auth。为了让 user_id 工作：
 *  1) 前端：首次访问时在 localStorage 生成 UUID 并持久化
 *  2) 前端发送请求时带请求头 X-Mindflow-User-Id
 *  3) 后端 API 读取该请求头并作为 user_id 使用
 *
 * 后续接入 Supabase Auth 时，只需把 getCurrentUserId() 改为读取
 * auth session 的 sub 即可，上层调用无需改动。
 * -------------------------------------------------------------- */
const USER_ID_KEY = "mindflow_user_id";

/** 获取当前匿名用户 ID（不存在则生成） */
export function getOrCreateUserId(): string {
  if (typeof window === "undefined") {
    return "server-side-unknown"; // SSR 时无用户上下文
  }
  let uid = window.localStorage.getItem(USER_ID_KEY);
  if (!uid) {
    uid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.localStorage.setItem(USER_ID_KEY, uid);
  }
  return uid;
}

/** 从请求头中提取 user_id（API Route 用） */
export function getUserIdFromHeaders(headers: Headers): string {
  const uid = headers.get("X-Mindflow-User-Id") || headers.get("x-mindflow-user-id");
  if (!uid) {
    throw new Error(
      "[MindFlow] 未在请求头中找到 X-Mindflow-User-Id。请在前端请求时带上此 header。"
    );
  }
  return uid;
}

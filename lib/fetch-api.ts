import { getOrCreateUserId } from "@/lib/supabase/client";

/**
 * 前端统一调用 API 的 fetch 封装：
 *  · 自动注入 X-Mindflow-User-Id 请求头
 *  · 自动 JSON 解析 & 错误处理
 *  · 统一返回 { ok, data, error } 结构
 */

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  [k: string]: any;
}

export interface FetchApiOptions extends RequestInit {
  /** 是否弹出 Toast 显示错误（默认 true） */
  showErrorToast?: boolean;
}

export async function fetchApi<T = unknown>(
  path: string,
  options: FetchApiOptions = {}
): Promise<ApiResult<T>> {
  const { showErrorToast = true, headers, ...rest } = options;

  const uid = getOrCreateUserId();
  // 直接用相对路径，由浏览器自动拼当前 origin，避免 NEXT_PUBLIC_APP_URL 缺失导致 Invalid URL
  const fullUrl = path.startsWith("http") ? path : path;

  try {
    const res = await fetch(fullUrl, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        "X-Mindflow-User-Id": uid,
        ...(headers || {}),
      },
    });

    const json = (await res.json().catch(() => ({}))) as ApiResult<T>;

    if (!res.ok || json.ok === false) {
      const msg =
        json.error ||
        `请求失败：HTTP ${res.status} ${res.statusText}`;
      if (showErrorToast) {
        // 延迟导入避免循环依赖
        import("@/components/ui/use-toast").then(({ toast }) => {
          toast({
            variant: "destructive",
            title: "操作失败",
            description: msg,
            duration: 4000,
          });
        });
      }
      return { ...json, ok: false, error: msg };
    }

    return json as ApiResult<T>;
  } catch (e: any) {
    const msg = e?.message || "网络异常，请稍后重试";
    if (showErrorToast) {
      import("@/components/ui/use-toast").then(({ toast }) => {
        toast({
          variant: "destructive",
          title: "网络异常",
          description: msg,
          duration: 4000,
        });
      });
    }
    return { ok: false, error: msg };
  }
}

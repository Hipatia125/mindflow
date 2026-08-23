"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { fetchApi } from "@/lib/fetch-api";
import { cn, todayISO, shiftDateISO, formatDateMD, daysBetween } from "@/lib/utils";
import type { Review, ReviewSource } from "@/lib/supabase/types";
import {
  EBBINGHAUS_SCHEDULE,
  EBBINGHAUS_INTERVALS,
  EBBINGHAUS_MAX_ROUNDS,
  isGraduated,
  completedRounds,
} from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Brain,
  Plus,
  CheckCircle2,
  HelpCircle,
  RotateCcw,
  Sparkles,
  CalendarCheck2,
  Trophy,
  Clock3,
  Loader2,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Eye,
  X,
  ImagePlus,
  ZoomIn,
  Trash2,
  TrendingDown,
} from "lucide-react";

/** 接口 GET /api/reviews 返回体 */
interface ReviewsPayload {
  date: string;
  stats: {
    today_due: number;
    mastered: number;       // 兼容旧字段 = graduated
    tomorrow_due: number;
    in_progress?: number;   // 1~6 轮进行中
    graduated?: number;     // 毕业卡（6 轮全过）
    total?: number;         // 总卡片数
  };
  due: Review[];
  graduated_list?: Review[]; // 已毕业卡归档
}

/** 统一把后端返回的 images（可能是数组 / 字符串 / null / undefined）处理成字符串数组 */
function normalizeImages(
  raw: Review["images"] | undefined
): string[] {
  if (!raw) return [];
  if (Array.isArray(raw))
    return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
  if (typeof raw === "string") return [raw];
  return [];
}

/** 三档强度按钮元数据 */
const STRENGTH_BTNS: ReadonlyArray<{
  key: "remember" | "fuzzy" | "reset";
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  variant: "success" | "secondary" | "destructive";
  bannerTone: string; // tailwind 色，用于即时反馈条
  bannerRing: string;
  explain: (curr: number) => string;
}> = [
  {
    key: "remember",
    label: "记住了",
    desc: "间隔推到下一级",
    icon: CheckCircle2,
    variant: "success",
    bannerTone: "from-success-50 to-success-100 border-success-300 text-success-800",
    bannerRing: "ring-success-200",
    explain: (curr) => {
      const seq = EBBINGHAUS_INTERVALS as unknown as number[];
      const idx = seq.findIndex((v) => v >= curr);
      if (idx === -1 || idx >= seq.length - 1) return "间隔已到顶（30 天）→ 标记为已掌握 🏆";
      return `间隔 ${curr} 天 → ${seq[idx + 1]} 天后复习`;
    },
  },
  {
    key: "fuzzy",
    label: "有点模糊",
    desc: "间隔减半，明天再来",
    icon: HelpCircle,
    variant: "secondary",
    bannerTone: "from-indigo-50 to-violet-100 border-violet-300 text-violet-800",
    bannerRing: "ring-violet-200",
    explain: (curr) => `间隔 ${curr} 天 → ${Math.max(1, Math.floor(curr / 2))} 天（明天复习）`,
  },
  {
    key: "reset",
    label: "重头学",
    desc: "回到 1 天节奏",
    icon: RotateCcw,
    variant: "destructive",
    bannerTone: "from-rose-50 to-rose-100 border-rose-300 text-rose-800",
    bannerRing: "ring-rose-200",
    explain: () => "间隔重置为 1 天（明天复习）",
  },
];

const sourceBadge = (s: ReviewSource) =>
  s === "ai" ? (
    <Badge variant="ghost" className="gap-1">
      <Sparkles className="h-3 w-3" />
      AI 建议
    </Badge>
  ) : (
    <Badge variant="outline">手动</Badge>
  );

/** 卡片最近一次点的反馈（即时 banner）*/
type FeedbackState =
  | { key: "remember" | "fuzzy" | "reset"; nextMsg: string; applied?: any; hideAt: number }
  | null
  | "loading";

/**
 * ================================================================
 * 艾宾浩斯复习面板（第六步）
 *  1. 顶部统计：今日待复习 / 已掌握 / 明日到期
 *  2. 手动添加：标题 + 内容（可选）+ 来源 + 首次复习日期
 *  3. 复习卡片列表：
 *       · 每张卡片可点标题右侧的「查看内容」展开正文
 *       · 三档强度按钮：点击后 → 立即显示彩色反馈条 1.2s → 再从列表移除
 * ================================================================ */
export default function ReviewBoard({ refreshKey = 0 }: { refreshKey?: number }) {
  const today = todayISO();
  const [loading, setLoading] = React.useState(false);
  const [stats, setStats] = React.useState<ReviewsPayload["stats"]>({
    today_due: 0,
    mastered: 0,
    tomorrow_due: 0,
    in_progress: 0,
    graduated: 0,
    total: 0,
  });
  const [due, setDue] = React.useState<Review[]>([]);
  const [graduatedList, setGraduatedList] = React.useState<Review[]>([]);
  // 详情 Modal 状态：点击卡片标题 → 打开详情（仅 due 里的卡，归档里的卡同样支持）
  const [detailReview, setDetailReview] = React.useState<Review | null>(null);
  // 归档折叠区是否展开
  const [graduatedOpen, setGraduatedOpen] = React.useState(false);

  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [source, setSource] = React.useState<ReviewSource>("manual");
  const [nextDate, setNextDate] = React.useState<string>(today);
  const [saving, setSaving] = React.useState(false);
  // —— 图片上传（MVP：本地 → base64 dataURL → 存到 images 字段）——
  const [pickedImages, setPickedImages] = React.useState<string[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [lightboxSrc, setLightboxSrc] = React.useState<string | null>(null);

  // 详情弹窗图片点击 → 抛事件 → 打开外层 Lightbox
  React.useEffect(() => {
    const handler = (e: Event) => {
      const src = (e as CustomEvent<{ src: string }>).detail?.src;
      if (src) setLightboxSrc(src);
    };
    window.addEventListener("mindflow:review-detail-image", handler);
    return () => window.removeEventListener("mindflow:review-detail-image", handler);
  }, []);

  // 每张卡片的 loading 状态 + 反馈条 + 内容展开
  const [actives, setActives] = React.useState<Record<string, string | null>>({});
  const [feedbacks, setFeedbacks] = React.useState<Record<string, FeedbackState>>({});
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  /** 定时清理反馈条：hideAt 时间到 → 从 due 里移除该卡（视觉：先显示反馈，再移除）*/
  React.useEffect(() => {
    const ids = Object.keys(feedbacks);
    if (ids.length === 0) return;
    const timers: NodeJS.Timeout[] = [];
    for (const id of ids) {
      const fb = feedbacks[id];
      if (!fb || fb === "loading") continue;
      const rest = fb.hideAt - Date.now();
      if (rest <= 0) {
        // 立即移除（兜底）
        setDue((prev) => prev.filter((r) => r.id !== id));
        setFeedbacks((prev) => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
        });
      } else {
        const t = setTimeout(() => {
          setDue((prev) => prev.filter((r) => r.id !== id));
          setFeedbacks((prev) => {
            const copy = { ...prev };
            delete copy[id];
            return copy;
          });
        }, rest + 20);
        timers.push(t);
      }
    }
    return () => timers.forEach((t) => clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbacks]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApi<ReviewsPayload>(`/api/reviews?date=${today}`);
      // 兼容 data 在 body.data 或平铺
      const any = res as any;
      const payload: ReviewsPayload | null =
        (res.data && (res.data as any).stats ? (res.data as ReviewsPayload) : null) ||
        (any.stats ? (any as ReviewsPayload) : null) ||
        // 兼容平铺直接 `{ok, date, stats, due, graduated_list}`
        (any as any)?.ok && (any as any)?.stats ? (any as ReviewsPayload) : null;
      if (payload) {
        setStats({
          today_due: payload.stats.today_due ?? 0,
          mastered: payload.stats.mastered ?? payload.stats.graduated ?? 0,
          tomorrow_due: payload.stats.tomorrow_due ?? 0,
          in_progress: payload.stats.in_progress ?? Math.max(0, (payload.stats.total ?? 0) - (payload.stats.graduated ?? payload.stats.mastered ?? 0)),
          graduated: payload.stats.graduated ?? payload.stats.mastered ?? 0,
          total: payload.stats.total ?? (payload.due?.length || 0) + (payload.stats.graduated ?? payload.stats.mastered ?? 0),
        });
        setDue(payload.due || []);
        setGraduatedList(payload.graduated_list || []);
        // 刷新后清理卡片 UI 状态
        setFeedbacks({});
        setActives({});
      }
    } catch (e) {
      console.error("[ReviewBoard] 刷新失败", e);
    } finally {
      setLoading(false);
    }
  }, [today]);

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, today]);

  // ————————————————————————————————————————————————
  // 图片：File → base64 dataURL（MVP 零后端依赖）
  // ————————————————————————————————————————————————
  const fileToDataURL = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      // 单张图上限 2MB（超过会明显拖慢 localStorage Mock，但可自行调整）
      if (file.size > 2 * 1024 * 1024) {
        reject(new Error(`「${file.name}」超过 2MB，请压缩后再上传`));
        return;
      }
      if (!/^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i.test(file.type)) {
        reject(new Error(`「${file.name}」不是支持的图片格式（PNG/JPG/GIF/WEBP/BMP/SVG）`));
        return;
      }
      const r = new FileReader();
      r.onerror = () => reject(new Error(`「${file.name}」读取失败`));
      r.onload = () => resolve(String(r.result || ""));
      r.readAsDataURL(file);
    });

  const handlePickImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    const next: string[] = [];
    for (const f of arr) {
      try {
        next.push(await fileToDataURL(f));
      } catch (e: any) {
        import("@/components/ui/use-toast").then(({ toast }) =>
          toast({
            variant: "destructive",
            title: "图片添加跳过",
            description: e?.message || "未知错误",
            duration: 2500,
          })
        );
      }
    }
    if (next.length) setPickedImages((prev) => [...prev, ...next]);
    // 清 input value，否则下次选同一张不会触发 change
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemovePicked = (idx: number) =>
    setPickedImages((prev) => prev.filter((_, i) => i !== idx));

  const onAdd = React.useCallback(async () => {
    const t = title.trim();
    if (!t) {
      import("@/components/ui/use-toast").then(({ toast }) =>
        toast({
          variant: "destructive",
          title: "标题不能为空",
          description: "请输入需要复习的知识点标题",
          duration: 2000,
        })
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetchApi<Review>("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          title: t,
          content: content.trim() || undefined,
          source,
          next_review_date: nextDate,
          interval_days: 1,
          status: "pending",
          // 有图片才带；空数组会让后端写 []，没必要
          ...(pickedImages.length > 0 ? { images: pickedImages } : {}),
        }),
      });
      if (res.ok) {
        setTitle("");
        setContent("");
        setNextDate(today);
        setPickedImages([]);
        // 如果新增的卡片 next_review_date == 今天，立刻插入 due 首位让用户能看见"刚加的卡"（避免要等 refresh）
        await refresh();
        import("@/components/ui/use-toast").then(({ toast }) => {
          const textPart = content.trim() ? `· 含内容 ${content.length} 字` : "";
          const imgPart = pickedImages.length > 0 ? `· 含 ${pickedImages.length} 张图` : "";
          toast({
            variant: "success",
            title: "已加入复习计划 ✅",
            description:
              `${t.slice(0, 20)}${t.length > 20 ? "…" : ""} ${textPart}${imgPart}`.trim(),
            duration: 2200,
          });
        });
      }
    } finally {
      setSaving(false);
    }
  }, [title, content, source, nextDate, today, refresh, pickedImages]);

  const onStrength = React.useCallback(
    async (r: Review, key: "remember" | "fuzzy" | "reset") => {
      // 已经有反馈在显示了就忽略点击（反馈条显示 1.2s 内点不到第二次）
      if (feedbacks[r.id] && feedbacks[r.id] !== "loading") return;
      setActives((prev) => ({ ...prev, [r.id]: key }));
      setFeedbacks((prev) => ({ ...prev, [r.id]: "loading" }));
      try {
        const res = await fetchApi<Review>(`/api/reviews?id=${r.id}`, {
          method: "PATCH",
          body: JSON.stringify({ strength: key, today }),
        });
        if (res.ok) {
          const applied = (res as any).strength_result?.applied || null;
          const label = STRENGTH_BTNS.find((b) => b.key === key)?.label || key;
          let nextMsg = "";
          if (applied) {
            if (applied.status === "reviewed") nextMsg = "已通过最高档 · 标记为「已掌握」🏆";
            else
              nextMsg = `间隔 ${r.interval_days} 天 → ${applied.interval_days} 天 · 下次复习：${applied.next_review_date}`;
          } else {
            nextMsg = STRENGTH_BTNS.find((b) => b.key === key)?.explain(r.interval_days) || "";
          }
          // ✅ 即时反馈：立刻在卡片底部展示彩条 1.2 秒，然后才移除
          const HIDE_MS = 1300;
          setFeedbacks((prev) => ({
            ...prev,
            [r.id]: { key, nextMsg, applied, hideAt: Date.now() + HIDE_MS },
          }));
          setActives((prev) => ({ ...prev, [r.id]: null }));
          // 同步后台刷新 stats + 到期情况（但卡片 1.3s 后再从 due 列表移除 → 走 feedbacks 副作用定时器）
          await refresh();
          import("@/components/ui/use-toast").then(({ toast }) =>
            toast({
              variant: key === "remember" ? "success" : key === "reset" ? "destructive" : "info",
              title: `已选择「${label}」`,
              description: nextMsg,
              duration: 2200,
            })
          );
        } else {
          // 失败回滚 UI
          setActives((prev) => ({ ...prev, [r.id]: null }));
          setFeedbacks((prev) => {
            const copy = { ...prev };
            delete copy[r.id];
            return copy;
          });
        }
      } catch (err) {
        console.error("[ReviewBoard] strength update error", err);
        setActives((prev) => ({ ...prev, [r.id]: null }));
        setFeedbacks((prev) => {
          const copy = { ...prev };
          delete copy[r.id];
          return copy;
        });
      }
    },
    [today, refresh, feedbacks]
  );

  const toggleExpand = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // —— 把 due + graduated_list 合并计算「每个节点的用户完成百分比」用于曲线图节点着色
  // 每张卡完成的节点数 = completedRounds(review_round)。节点 0=D1, 1=D2,... 5=D30
  const allReviewsForCurve = React.useMemo(
    () => [...due, ...graduatedList],
    [due, graduatedList]
  );
  const { nodePct, avgCompletedNodes } = React.useMemo(() => {
    const total = Math.max(1, allReviewsForCurve.length);
    const counts = [0, 0, 0, 0, 0, 0];
    let sum = 0;
    for (const r of allReviewsForCurve) {
      const rr = typeof r.review_round === "number" ? r.review_round : 1;
      const done = completedRounds(rr);
      sum += done;
      for (let i = 0; i < done && i < 6; i += 1) counts[i] += 1;
    }
    const nodePct = counts.map((c) => Math.round((c / total) * 100));
    const avgCompletedNodes = Number((sum / total).toFixed(1));
    return { nodePct, avgCompletedNodes };
  }, [allReviewsForCurve]);

  return (
    <>
      <Card className="shadow-soft">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md ring-2 ring-white/60">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="flex items-center gap-2">
              艾宾浩斯复习
              <Badge variant="warning">第六步</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              先看内容再选档位 👀。节奏 1→2→4→7→15→30 天，卡片会自动排到下一次复习日期。
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* ——— 统计条 ——— */}
        <StatsRow stats={stats} />

        {/* ——— 艾宾浩斯遗忘曲线 + 6 个复习节点 ——— */}
        <EbbinghausCurve
          nodePct={nodePct}
          avgCompletedNodes={avgCompletedNodes}
          totalReviewsForCurve={allReviewsForCurve.length}
        />

        {/* ——— 手动添加 ——— */}
        <section className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-white/50 p-4 backdrop-blur-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto] md:items-end">
            <div className="space-y-1.5">
              <Label>知识点标题 <span className="text-destructive">*</span></Label>
              <Input
                placeholder="例：React useMemo vs useCallback 区别"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAdd();
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>来源</Label>
              <Select
                value={source}
                onValueChange={(v) => setSource(v as ReviewSource)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">手动</SelectItem>
                  <SelectItem value="ai">AI 建议</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>首次复习日期</Label>
              <Input
                type="date"
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-end md:pb-0">
              <Button onClick={onAdd} disabled={saving} className="gap-2">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                添加卡片
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2">
              <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
              卡片内容（可选）
              <span className="font-normal text-xs text-muted-foreground">
                建议填「定义/要点/答案」，复习时先想再点「查看内容」对照
              </span>
            </Label>
            <Textarea
              placeholder={`如：\nuseMemo 缓存"计算结果"，useCallback 缓存"函数引用"。\n当计算很昂贵或把值传给 memo() 子组件时使用。`}
              className="min-h-[90px] resize-y whitespace-pre-wrap leading-relaxed"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>

          {/* —— 图片上传（MVP 本地 base64，无需后端 Storage）—— */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="flex items-center gap-2 cursor-pointer select-none">
                <ImagePlus className="h-3.5 w-3.5 text-muted-foreground" />
                配图（可选）
                <span className="font-normal text-xs text-muted-foreground">
                  本地导图 / 公式截图 / 手绘笔记 · 单张 &le; 2MB · PNG/JPG/WEBP/GIF/SVG
                </span>
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => fileInputRef.current?.click()}
                disabled={saving}
              >
                <ImagePlus className="h-3.5 w-3.5" />
                选择图片
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/bmp,image/svg+xml"
              className="hidden"
              onChange={(e) => handlePickImages(e.target.files)}
            />
            {pickedImages.length > 0 && (
              <div className="flex flex-wrap gap-2 rounded-xl border border-dashed bg-muted/30 p-2.5">
                {pickedImages.map((src, i) => (
                  <div
                    key={i}
                    className="group relative h-20 w-20 overflow-hidden rounded-lg border bg-white shadow-sm"
                    title="点击查看大图 · 右上角 × 删除"
                  >
                    <button
                      type="button"
                      aria-label="查看图片"
                      className="block h-full w-full"
                      onClick={() => setLightboxSrc(src)}
                      onKeyDown={(e) => e.key === "Enter" && setLightboxSrc(src)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt={`已选图片 ${i + 1}`}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      />
                    </button>
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
                    <button
                      type="button"
                      aria-label="移除这张图片"
                      className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white opacity-0 shadow transition group-hover:opacity-100 hover:bg-destructive focus:opacity-100"
                      onClick={() => handleRemovePicked(i)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    <div className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm">
                      {i + 1}/{pickedImages.length}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary-50/40"
                >
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-[11px]">再加一张</span>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ——— 复习卡片列表 ——— */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground/90">
              📚 今日 / 逾期待复习
              {loading && (
                <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </h4>
            <div className="text-xs text-muted-foreground">
              共 <b className="text-foreground">{due.length}</b> 张
            </div>
          </div>

          {due.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/70 bg-gradient-to-br from-white/50 to-primary-50/40 p-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success-100 text-success-600 ring-4 ring-white shadow-inner">
                <Trophy className="h-7 w-7" />
              </div>
              <div className="text-base font-semibold text-foreground">
                今日复习清单已清空 🎉
              </div>
              <div className="max-w-sm text-sm text-muted-foreground">
                没有需要今天复习的卡片。想练手的话在上面「添加卡片」里随手加一条，立刻就能试试三个按钮的调度效果～
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {due.map((r) => (
                <ReviewCard
                  key={r.id}
                  review={r}
                  activeKey={actives[r.id] || null}
                  feedback={feedbacks[r.id] || null}
                  expanded={!!expanded[r.id]}
                  onToggleExpand={() => toggleExpand(r.id)}
                  onStrength={(k) => onStrength(r, k)}
                  onOpenLightbox={(src) => setLightboxSrc(src)}
                  onOpenDetail={() => setDetailReview(r)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* ——— 毕业卡片归档区（可折叠）——— */}
        <section className="mt-6">
          <button
            type="button"
            onClick={() => setGraduatedOpen((o) => !o)}
            className="group flex w-full items-center justify-between rounded-2xl border border-border/60 bg-gradient-to-r from-emerald-50/60 via-white/60 to-sky-50/50 px-4 py-3 text-left shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            aria-expanded={graduatedOpen}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm ring-2 ring-white/60">
                <Trophy className="h-4.5 w-4.5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  🎓 已毕业卡片归档
                </div>
                <div className="text-xs text-muted-foreground">
                  完成 6 轮全部节点的长期记忆 · 共 {graduatedList.length} 张
                </div>
              </div>
            </div>
            <ChevronDown
              className={cn(
                "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200",
                graduatedOpen && "rotate-180"
              )}
            />
          </button>
          {graduatedOpen && (
            <div className="mt-3 rounded-2xl border border-border/50 bg-white/40 p-3 backdrop-blur-sm">
              {graduatedList.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl p-6 text-center">
                  <div className="text-base font-semibold text-foreground/80">
                    还没有毕业卡片 🌱
                  </div>
                  <div className="max-w-sm text-xs text-muted-foreground">
                    连续通过 6 轮复习（1→2→4→7→15→30 天）的卡片会自动出现在这里。
                  </div>
                </div>
              ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {graduatedList.map((r) => (
                    <ReviewCard
                      key={r.id}
                      review={r}
                      activeKey={null}
                      feedback={null}
                      expanded={false}
                      onToggleExpand={() => toggleExpand(r.id)}
                      onStrength={() => {
                        /* 毕业卡不可再推进 */
                      }}
                      onOpenLightbox={(src) => setLightboxSrc(src)}
                      archived
                      onOpenDetail={() => setDetailReview(r)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </CardContent>
    </Card>

    {/* —— 复习进度详情弹窗（6 节点时间线 + 环形进度条）—— */}
    {detailReview && (
      <ReviewDetailModal review={detailReview} onClose={() => setDetailReview(null)} />
    )}

    {/* —— 图片放大 Lightbox（ESC / 点背景 / × 关闭）—— */}
    {lightboxSrc && (
      <LightboxModal src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    )}
    </>
  );
}

/* ================== 子组件 ================== */

/**
 * 图片放大 Lightbox（轻量无依赖，不引入 shadcn Dialog）
 *  - ESC 关闭
 *  - 点黑色背景关闭
 *  - 右上角 × 关闭
 */
function LightboxModal({ src, onClose }: { src: string; onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // 打开时禁止 body 滚动（移动端防穿透）
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="图片放大查看"
    >
      {/* 顶部提示栏 */}
      <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white/90 backdrop-blur">
        按 ESC 或点击背景关闭
      </div>
      {/* 关闭按钮 */}
      <button
        type="button"
        aria-label="关闭图片"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white/90 shadow-lg transition hover:bg-white/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/60"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="h-5 w-5" />
      </button>
      {/* 图片（点图片不关闭，方便长按保存） */}
      <button
        type="button"
        className="relative max-h-[92vh] max-w-[96vw] overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="放大查看"
          className="block max-h-[92vh] max-w-[96vw] object-contain"
        />
      </button>
    </div>,
    document.body
  );
}

/**
 * 复习卡片详情弹窗：时间线 6 节点 + 下一轮日期 + SVG 环形进度条
 * 治愈系毛玻璃风格
 */
function ReviewDetailModal({
  review,
  onClose,
}: {
  review: Review;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const rr = typeof review.review_round === "number" ? review.review_round : 1;
  const graduated = isGraduated(review);
  const doneNodes = completedRounds(rr);

  // 绝对日期：从卡片创建日期推算每个 SRS 节点的预计完成日期
  // 每个节点 i 的偏移天数 = SCHEDULE 的前缀和（前 i+1 项之和）
  const offsets = (() => {
    const arr: number[] = [];
    let acc = 0;
    for (let i = 0; i < EBBINGHAUS_SCHEDULE.length; i += 1) {
      acc += EBBINGHAUS_SCHEDULE[i];
      arr.push(acc);
    }
    return arr;
  })();
  const createdAtISO = (review.created_at || review.next_review_date || todayISO()).slice(0, 10);
  const timeline = EBBINGHAUS_SCHEDULE.map((d, i) => {
    const done = i < doneNodes;
    const isCurrent = !graduated && i === doneNodes;
    const iso = shiftDateISO(createdAtISO, offsets[i]);
    return {
      index: i,
      day: d,
      cumulativeDay: offsets[i],
      dateLabel: formatDateMD(iso),
      dateISO: iso,
      done,
      isCurrent,
    };
  });

  // —— 大环形进度条：doneNodes / 6
  const r = 58;
  const c = 2 * Math.PI * r;
  const pct = Math.round((doneNodes / 6) * 100);
  const dash = (doneNodes / 6) * c;
  const gradId = `review-detail-donut-${review.id.slice(0, 6)}`;

  const nextReviewLabel = graduated
    ? "🎉 你已经通过全部 6 轮复习，无需再复习"
    : `下一轮（第 ${Math.min(6, Math.max(1, rr))} 轮）复习：${formatDateMD(review.next_review_date)} · ${review.interval_days} 天后到期`;

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/45 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="复习进度详情"
    >
      <div
        className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-white/60 bg-white/70 shadow-[0_20px_80px_-20px_rgba(0,0,0,0.35)] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
        style={{ backdropFilter: "blur(18px)" }}
      >
        {/* 光晕 */}
        <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-primary-300/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 -bottom-20 h-64 w-64 rounded-full bg-emerald-300/30 blur-3xl" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-20 w-full -translate-x-1/2 bg-gradient-to-b from-white/60 to-transparent" />

        {/* 顶部栏 */}
        <div className="relative flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {sourceBadge(review.source)}
              {graduated ? (
                <Badge className="bg-gradient-to-br from-emerald-400 to-emerald-600 text-white border border-emerald-200 shadow-[0_1px_0_rgba(255,255,255,0.5)_inset]">
                  已毕业 ✅
                </Badge>
              ) : (
                <Badge className="bg-gradient-to-br from-purple-400 to-indigo-500 text-white border border-purple-200 shadow-[0_1px_0_rgba(255,255,255,0.5)_inset]">
                  第 {Math.min(6, Math.max(1, rr))}/6 轮 · 进行中
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                创建于 {formatDateMD(createdAtISO)}
              </span>
            </div>
            <h3 className="mt-3 break-words text-xl font-bold leading-snug text-foreground">
              {review.title}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{nextReviewLabel}</p>
          </div>
          <button
            type="button"
            aria-label="关闭详情"
            className="shrink-0 rounded-full bg-white/80 p-2 text-slate-600 shadow ring-1 ring-border transition hover:bg-white hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-400"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 主体：环形进度条 + 时间线 */}
        <div className="relative grid grid-cols-1 gap-5 px-6 pb-4 md:grid-cols-[240px_minmax(0,1fr)] md:items-center">
          {/* SVG 环形进度条 */}
          <div className="relative mx-auto flex h-[220px] w-[220px] items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/70 to-primary-50/60 shadow-inner ring-1 ring-white/60" />
            <svg viewBox="0 0 140 140" className="relative block h-[210px] w-[210px] -rotate-90">
              <defs>
                <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgb(139 92 246)" />
                  <stop offset="50%" stopColor="rgb(56 189 248)" />
                  <stop offset="100%" stopColor="rgb(16 185 129)" />
                </linearGradient>
              </defs>
              <circle
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke="rgb(226 232 240)"
                strokeWidth="11"
              />
              <circle
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={`url(#${gradId})`}
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${c}`}
                style={{ transition: "stroke-dasharray 600ms ease-out" }}
              />
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                已完成节点
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold tracking-tight text-foreground tabular-nums">
                  {doneNodes}
                </span>
                <span className="text-lg font-semibold text-muted-foreground tabular-nums">
                  /6
                </span>
              </div>
              <div className="mt-0.5 text-sm font-semibold text-primary-600 tabular-nums">
                {pct}%
              </div>
            </div>
          </div>

          {/* 时间线：6 节点 1→2→4→7→15→30 */}
          <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-slate-50 via-white/70 to-primary-50/40 p-4 shadow-inner">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-[13px] font-semibold text-foreground/90">
                🗓️ 完整复习时间线
              </div>
              <div className="text-[11px] text-muted-foreground">
                ✅ 已通过 · ⏳ 待复习
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {timeline.map((n, i) => {
                const tone = n.done
                  ? {
                      bar: "bg-gradient-to-r from-emerald-400 to-emerald-500",
                      pill: "bg-gradient-to-br from-emerald-400 to-emerald-600 text-white ring-2 ring-emerald-100",
                      text: "text-emerald-700",
                      sub: "text-emerald-600/80",
                      icon: "✅",
                    }
                  : n.isCurrent
                    ? {
                        bar: "bg-gradient-to-r from-sky-300 to-indigo-300",
                        pill: "bg-gradient-to-br from-sky-400 to-indigo-500 text-white ring-2 ring-sky-100 animate-pulse",
                        text: "text-sky-700",
                        sub: "text-sky-600/80",
                        icon: "⏳",
                      }
                    : {
                        bar: "bg-gradient-to-r from-slate-200 to-slate-300",
                        pill: "bg-white text-slate-500 ring-2 ring-slate-200",
                        text: "text-slate-500",
                        sub: "text-slate-400",
                        icon: "⏳",
                      };
                return (
                  <div key={i} className="flex items-center gap-3">
                    {/* 节点圆形徽章 */}
                    <div
                      className={cn(
                        "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-sm text-lg font-bold tabular-nums",
                        tone.pill
                      )}
                      aria-hidden
                    >
                      <span className="drop-shadow-sm">{n.day}</span>
                      <span className="absolute -bottom-1 right-0 text-[11px] leading-none">
                        {tone.icon}
                      </span>
                    </div>
                    {/* 连线 + 信息 */}
                    <div className="relative flex-1">
                      {i < timeline.length - 1 && (
                        <span
                          aria-hidden
                          className={cn(
                            "absolute left-0 top-1/2 h-[3px] w-3 -translate-y-1/2 rounded-full",
                            tone.bar
                          )}
                        />
                      )}
                      <div className="pl-5 sm:pl-6">
                        <div className={cn("text-[13px] font-semibold", tone.text)}>
                          第 {i + 1} 次复习 · D{n.day}（累计 +{n.cumulativeDay} 天）
                        </div>
                        <div className={cn("text-[12px]", tone.sub)}>
                          预计日期：{n.dateLabel}
                          {n.isCurrent && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                              <Clock3 className="h-3 w-3" />
                              当前轮 · {review.interval_days} 天间隔
                            </span>
                          )}
                          {n.done && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" />
                              已通过
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 底部小结：下一轮复习日 */}
            {!graduated && (
              <div className="mt-4 flex items-center justify-between rounded-xl border border-primary-200/70 bg-gradient-to-r from-primary-50/80 to-white/70 px-4 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]">
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <CalendarCheck2 className="h-4 w-4 text-primary-500" />
                  下一轮复习时间
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-primary-500 px-3 py-1 text-[13px] font-bold text-white shadow">
                    {formatDateMD(review.next_review_date)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    距今天数：
                    <b className="ml-0.5 text-foreground">
                      {daysBetween(todayISO(), review.next_review_date) || 0}
                    </b>{" "}
                    天
                  </span>
                </div>
              </div>
            )}
            {graduated && (
              <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-2.5">
                <Trophy className="h-5 w-5 text-emerald-500" />
                <span className="text-sm font-semibold text-emerald-700">
                  恭喜！该卡片已通过艾宾浩斯 6 轮复习，进入长期记忆 ✨
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 底部卡片内容（如存在） */}
        {(review.content || normalizeImages(review.images).length > 0) && (
          <div className="relative border-t border-border/60 bg-gradient-to-br from-white/70 to-slate-50/70 px-6 py-4">
            {review.content && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <BookOpen className="h-3 w-3" />
                  记忆要点
                </div>
                <p className="whitespace-pre-wrap text-[14px] leading-7 text-foreground/90">
                  {review.content}
                </p>
              </div>
            )}
            {normalizeImages(review.images).length > 0 && (
              <div className={review.content ? "mt-4" : ""}>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <ImagePlus className="h-3 w-3" />
                  配图 · {normalizeImages(review.images).length} 张
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {normalizeImages(review.images).map((src, i) => (
                    <button
                      key={i}
                      type="button"
                      className="group relative overflow-hidden rounded-lg border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                      onClick={() => {
                        // 将图片预览抛给父组件：借助 dispatch 自定义事件，ReviewBoard 监听
                        const ev = new CustomEvent("mindflow:review-detail-image", {
                          detail: { src },
                        });
                        window.dispatchEvent(ev);
                      }}
                    >
                      <div className="aspect-video w-full bg-muted/40">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`配图 ${i + 1}`}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function StatsRow({ stats }: { stats: ReviewsPayload["stats"] }) {
  const total = Math.max(
    1,
    stats.total ??
      (stats.today_due ?? 0) +
        (stats.tomorrow_due ?? 0) +
        (stats.in_progress ?? 0) +
        (stats.graduated ?? stats.mastered ?? 0)
  );
  const graduated = stats.graduated ?? stats.mastered ?? 0;
  const inProgress =
    stats.in_progress ?? Math.max(0, total - graduated - (stats.tomorrow_due ?? 0));
  const gradPercent = Math.min(100, Math.round((graduated / total) * 100));

  const donutR = 22;
  const donutC = 2 * Math.PI * donutR;
  const dash = (gradPercent / 100) * donutC;

  const items: ReadonlyArray<
    {
      k: string;
      v?: number | string;
      hint: string;
      icon: React.ComponentType<{ className?: string }>;
      tone: string; // bg class + ring
      extra?: React.ReactNode; // 右侧额外内容（Mini 环形进度）
      span?: string; // tailwind span col-span-2 etc
    }
  > = [
    {
      k: "今日待复习",
      v: stats.today_due,
      hint: stats.today_due === 0 ? "已全部搞定 ✨" : `还有 ${stats.today_due} 张等你`,
      icon: CalendarCheck2,
      tone: "from-primary-400 to-primary-600",
    },
    {
      k: "明日到期",
      v: stats.tomorrow_due,
      hint: shiftDateISO(todayISO(), 1),
      icon: Clock3,
      tone: "from-amber-400 to-orange-500",
    },
    {
      k: "进行中 SRS",
      v: inProgress,
      hint: inProgress === 0 ? "还在热身 🚀" : "正在 1~6 轮复习中",
      icon: Brain,
      tone: "from-sky-400 to-indigo-500",
    },
    {
      k: "已毕业 / 总卡片",
      v: `${graduated}/${total}`,
      hint: `${gradPercent}% 长期记忆率`,
      icon: Trophy,
      tone: "from-success-400 to-emerald-600",
      extra: (
        <div className="relative h-12 w-12 shrink-0" title={`毕业 ${graduated} / 总 ${total}`}>
          <svg viewBox="0 0 56 56" className="block h-12 w-12 -rotate-90">
            <circle
              cx="28"
              cy="28"
              r={donutR}
              fill="none"
              stroke="rgb(226 232 240)"
              strokeWidth="5"
            />
            <circle
              cx="28"
              cy="28"
              r={donutR}
              fill="none"
              stroke="url(#grad-donut-stats)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${donutC}`}
            />
            <defs>
              <linearGradient id="grad-donut-stats" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="rgb(16 185 129)" />
                <stop offset="100%" stopColor="rgb(59 130 246)" />
              </linearGradient>
            </defs>
          </svg>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-bold text-slate-700">
            {gradPercent}%
          </div>
        </div>
      ),
    },
    {
      k: "全部卡片",
      v: total,
      hint: "今天这一刻的体量",
      icon: Sparkles,
      tone: "from-fuchsia-400 via-purple-500 to-indigo-500",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {items.map((it) => (
        <div
          key={it.k}
          className="group relative overflow-hidden rounded-2xl border border-border bg-white/60 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md backdrop-blur-sm"
        >
          <div
            className={cn(
              "absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r shadow-[0_0_0_1px_rgba(255,255,255,0.3)_inset]",
              it.tone
            )}
          />
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm ring-1 ring-white/60",
                    it.tone
                  )}
                >
                  <it.icon className="h-3.5 w-3.5" />
                </div>
                <span className="text-[12px] font-medium text-muted-foreground truncate">
                  {it.k}
                </span>
              </div>
              <div className="mt-1 pl-9">
                <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {it.v}
                </span>
                <div className="truncate text-xs text-muted-foreground">{it.hint}</div>
              </div>
            </div>
            {it.extra}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 艾宾浩斯遗忘曲线 + 6 个复习节点可视化（纯 SVG，无第三方依赖）
 *  - 灰色虚线：不复习时的「记忆保留率」指数衰减曲线（30 天内）
 *  - 6 个节点：颜色代表「用户所有卡片中**已经通过该节点**的百分比」
 *      绿 (>66%)= 大部分卡都通过；蓝(33-66%)= 进行中；紫(<33%)= 刚开始
 *  - 绿色虚箭头：复习后的记忆「重建」效果（每次复习后保留率重新抬升）
 */
function EbbinghausCurve({
  nodePct = [0, 0, 0, 0, 0, 0],
  avgCompletedNodes = 0,
  totalReviewsForCurve = 0,
}: {
  nodePct?: number[]; // 长度 6，对应节点 D1..D30 的通过百分比 (0..100)
  avgCompletedNodes?: number; // 每张卡平均完成的节点数
  totalReviewsForCurve?: number; // 参与统计的卡片总数（due+graduated）
}) {
  const W = 720;
  const H = 180;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 22;
  const PAD_B = 34;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  // 6 个复习节点（天）
  const NODES = [1, 2, 4, 7, 15, 30];
  const maxDay = 30;

  // 遗忘曲线指数衰减公式（模拟）：R = 100 * exp(-t / 7)
  //  x=天数（0..maxDay），y=保留率（0..100）
  const xAt = (d: number) => PAD_L + (d / maxDay) * plotW;
  const yAt = (r: number) => PAD_T + (1 - r / 100) * plotH; // 100% -> 顶部，0% -> 底部

  // 绘制平滑衰减曲线的点
  const steps = 120;
  let decayPath = "";
  for (let i = 0; i <= steps; i++) {
    const d = (i / steps) * maxDay;
    const r = 100 * Math.exp(-d / 7);
    const x = xAt(d);
    const y = yAt(r);
    decayPath += (i === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2) + " ";
  }

  // 坐标轴刻度（天数 + 保留率）
  const xTicks = [0, 5, 10, 15, 20, 25, 30];
  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-slate-50 via-amber-50/40 to-purple-50/50 p-4 shadow-inner">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6.5 w-6.5 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-sm">
            <TrendingDown className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="text-[13px] font-semibold leading-tight">
              艾宾浩斯遗忘曲线 · 你的复习节奏
            </div>
            <div className="text-[11px] text-muted-foreground">
              1→2→4→7→15→30 天，6 个节点全通过 = 长期记忆 ✅ · 你的平均进度：
              <span className="mx-0.5 font-semibold text-foreground">
                {avgCompletedNodes}/6
              </span>
              节点
              {totalReviewsForCurve > 0 && (
                <span className="text-muted-foreground"> · 共 {totalReviewsForCurve} 张卡</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[3px] w-5 rounded-full bg-gradient-to-r from-slate-400 to-slate-300" />
            不复习 · 自然遗忘
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 ring-2 ring-purple-200" />
            节点 &lt;33%（初始）
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 ring-2 ring-sky-200" />
            节点 33~66%（推进中）
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 ring-2 ring-emerald-200" />
            节点 &gt;66%（稳固 ✅）
          </span>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-[180px] w-full min-w-[560px]"
          role="img"
          aria-label="艾宾浩斯遗忘曲线与 6 个 SRS 复习节点"
        >
          {/* defs：紫色节点径向渐变 + 记忆重建填充渐变 */}
          <defs>
            <linearGradient id="eb-decay-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgb(148 163 184)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="rgb(148 163 184)" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="eb-node-fill" cx="35%" cy="35%" r="70%">
              <stop offset="0%" stopColor="rgb(216 180 254)" />
              <stop offset="55%" stopColor="rgb(139 92 246)" />
              <stop offset="100%" stopColor="rgb(79 70 229)" />
            </radialGradient>
            <radialGradient id="eb-node-grad-blue" cx="35%" cy="35%" r="70%">
              <stop offset="0%" stopColor="rgb(186 230 253)" />
              <stop offset="55%" stopColor="rgb(14 165 233)" />
              <stop offset="100%" stopColor="rgb(37 99 235)" />
            </radialGradient>
            <radialGradient id="eb-node-grad-green" cx="35%" cy="35%" r="70%">
              <stop offset="0%" stopColor="rgb(167 243 208)" />
              <stop offset="55%" stopColor="rgb(16 185 129)" />
              <stop offset="100%" stopColor="rgb(5 150 105)" />
            </radialGradient>
            <linearGradient id="eb-rebuild-arrow" x1="0" x2="1" y1="1" y2="0">
              <stop offset="0%" stopColor="rgb(16 185 129)" />
              <stop offset="100%" stopColor="rgb(20 184 166)" />
            </linearGradient>
          </defs>

          {/* 绘图区背景网格 */}
          {yTicks.map((t) => (
            <line
              key={`yg-${t}`}
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke="rgb(148 163 184)"
              strokeOpacity="0.18"
              strokeDasharray="3 4"
            />
          ))}

          {/* 坐标轴 */}
          <line
            x1={PAD_L}
            x2={PAD_L}
            y1={PAD_T - 6}
            y2={PAD_T + plotH + 6}
            stroke="rgb(100 116 139)"
            strokeOpacity="0.55"
          />
          <line
            x1={PAD_L - 6}
            x2={W - PAD_R}
            y1={PAD_T + plotH}
            y2={PAD_T + plotH}
            stroke="rgb(100 116 139)"
            strokeOpacity="0.55"
          />

          {/* Y 轴刻度：保留率 % */}
          {yTicks.map((t) => (
            <g key={`yt-${t}`}>
              <line
                x1={PAD_L - 4}
                x2={PAD_L}
                y1={yAt(t)}
                y2={yAt(t)}
                stroke="rgb(100 116 139)"
                strokeOpacity="0.6"
              />
              <text
                x={PAD_L - 8}
                y={yAt(t) + 3}
                textAnchor="end"
                className="fill-slate-500"
                style={{ fontSize: 10 }}
              >
                {t}%
              </text>
            </g>
          ))}

          {/* X 轴刻度：天 */}
          {xTicks.map((d) => (
            <g key={`xt-${d}`}>
              <line
                x1={xAt(d)}
                x2={xAt(d)}
                y1={PAD_T + plotH}
                y2={PAD_T + plotH + 4}
                stroke="rgb(100 116 139)"
                strokeOpacity="0.6"
              />
              <text
                x={xAt(d)}
                y={PAD_T + plotH + 18}
                textAnchor="middle"
                className="fill-slate-500"
                style={{ fontSize: 10 }}
              >
                D{d}
              </text>
            </g>
          ))}

          {/* 遗忘曲线下填充 */}
          <path
            d={`${decayPath} L${(xAt(maxDay)).toFixed(2)},${(PAD_T + plotH).toFixed(
              2
            )} L${(PAD_L).toFixed(2)},${(PAD_T + plotH).toFixed(2)} Z`}
            fill="url(#eb-decay-fill)"
          />
          {/* 遗忘曲线虚线 */}
          <path
            d={decayPath}
            fill="none"
            stroke="rgb(100 116 139)"
            strokeOpacity="0.65"
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeLinecap="round"
          />

          {/* 6 个 SRS 复习节点：竖线 + 绿色重建虚箭头（从遗忘曲线点抬升到 ~85%）+ 圆点 */}
          {NODES.map((d, i) => {
            const decayR = 100 * Math.exp(-d / 7);
            const x = xAt(d);
            const yLow = yAt(decayR);
            const yHigh = yAt(88);
            const pct = nodePct[i] ?? 0;
            const tone =
              pct >= 67
                ? {
                    fill: "url(#eb-node-grad-green)",
                    stroke: "rgb(16 185 129)",
                    ring: "rgb(167 243 208)",
                    label: "text-emerald-700",
                    bar: "#10b981",
                  }
                : pct >= 33
                  ? {
                      fill: "url(#eb-node-grad-blue)",
                      stroke: "rgb(14 165 233)",
                      ring: "rgb(186 230 253)",
                      label: "text-sky-700",
                      bar: "#0ea5e9",
                    }
                  : {
                      fill: "url(#eb-node-fill)",
                      stroke: "rgb(139 92 246)",
                      ring: "rgb(221 214 254)",
                      label: "text-indigo-700",
                      bar: "#8b5cf6",
                    };
            return (
              <g key={`node-${d}`}>
                {/* 节点竖辅助线（颜色跟随 tone） */}
                <line
                  x1={x}
                  x2={x}
                  y1={PAD_T}
                  y2={PAD_T + plotH}
                  stroke={tone.stroke}
                  strokeOpacity="0.14"
                  strokeDasharray="3 5"
                />
                {/* 绿色复习重建箭头（曲线位置 → 抬升） */}
                <line
                  x1={x}
                  x2={x}
                  y1={yLow}
                  y2={yHigh + 6}
                  stroke="url(#eb-rebuild-arrow)"
                  strokeWidth="2.2"
                  strokeDasharray="3 3"
                  strokeLinecap="round"
                />
                <polygon
                  points={`${x - 4},${yHigh + 4} ${x + 4},${yHigh + 4} ${x},${yHigh - 2}`}
                  fill="rgb(16 185 129)"
                />
                {/* 圆点（颜色按用户通过百分比切换） */}
                <circle
                  cx={x}
                  cy={yLow}
                  r="8"
                  fill="white"
                  stroke={tone.ring}
                  strokeWidth="3"
                />
                <circle
                  cx={x}
                  cy={yLow}
                  r="5.5"
                  fill={tone.fill}
                />
                {/* 通过百分比小字（圆点右上角） */}
                <text
                  x={x + 10}
                  y={yLow - 8}
                  textAnchor="start"
                  className="fill-slate-500"
                  style={{ fontSize: 9 }}
                >
                  {pct}%
                </text>
                {/* 节点标签（圆形外底部 D1 / D2 ...  + 标题 「第 n 次」） */}
                <text
                  x={x}
                  y={yLow + 22}
                  textAnchor="middle"
                  className={cn("font-bold", tone.label)}
                  style={{ fontSize: 11 }}
                >
                  D{d}
                </text>
                <text
                  x={x}
                  y={yLow - 14}
                  textAnchor="middle"
                  className="fill-slate-500"
                  style={{ fontSize: 9 }}
                >
                  第{i + 1}次
                </text>
              </g>
            );
          })}

          {/* 起点 D0（学习日）标记 */}
          <g>
            <circle
              cx={xAt(0)}
              cy={yAt(100)}
              r="4.5"
              fill="rgb(249 115 22)"
              stroke="white"
              strokeWidth="2"
            />
            <text
              x={xAt(0) + 6}
              y={yAt(100) + 3}
              textAnchor="start"
              className="fill-slate-600 font-semibold"
              style={{ fontSize: 10 }}
            >
              今日学习
            </text>
          </g>

          {/* 「30 天达成长期记忆」终点徽章线 */}
          <g>
            <circle
              cx={xAt(30)}
              cy={yAt(100 * Math.exp(-30 / 7))}
              r="1"
              fill="transparent"
            />
            <text
              x={xAt(30)}
              y={PAD_T - 6}
              textAnchor="end"
              className="fill-purple-700 font-semibold"
              style={{ fontSize: 10 }}
            >
              🎉 30 天 · 长期记忆
            </text>
          </g>

          {/* 坐标轴标签 */}
          <text
            x={W - PAD_R}
            y={PAD_T + plotH + 26}
            textAnchor="end"
            className="fill-slate-500"
            style={{ fontSize: 10 }}
          >
            时间（学习后天数）
          </text>
          <text
            x={PAD_L - 4}
            y={PAD_T - 8}
            textAnchor="start"
            className="fill-slate-500"
            style={{ fontSize: 10 }}
          >
            记忆保留率
          </text>
        </svg>
      </div>
    </div>
  );
}

function ReviewCard({
  review,
  activeKey,
  feedback,
  expanded,
  archived = false,
  onToggleExpand,
  onStrength,
  onOpenLightbox,
  onOpenDetail,
}: {
  review: Review;
  activeKey: string | null;
  feedback: FeedbackState;
  expanded: boolean;
  archived?: boolean;
  onToggleExpand: () => void;
  onStrength: (k: "remember" | "fuzzy" | "reset") => void;
  onOpenLightbox: (src: string) => void;
  onOpenDetail?: () => void;
}) {
  const hasContent = !!review.content && String(review.content).trim().length > 0;
  const overdue = review.next_review_date < todayISO();

  // 计算当前复习进度：完成节点数 + 标签文案
  const rr = typeof review.review_round === "number" ? review.review_round : 1;
  const doneNodes = completedRounds(rr);
  const isGrad = isGraduated(review) || archived;
  const progressLabel = isGrad
    ? "已毕业 ✅"
    : `第 ${Math.min(6, Math.max(1, rr))}/6 轮`;
  const progressTone = isGrad
    ? "from-emerald-400 to-emerald-600 text-white border-emerald-200"
    : doneNodes >= 4
      ? "from-sky-400 to-indigo-500 text-white border-sky-200"
      : doneNodes >= 1
        ? "from-purple-400 to-indigo-500 text-white border-purple-200"
        : "from-amber-400 to-orange-500 text-white border-amber-200";

  // 如果 feedback 是确定的对象（非 null/loading），则整个卡片加一个"成功处理中"的外描边
  const isFeedbackDone = !archived && feedback && feedback !== "loading";
  const tone = isFeedbackDone
    ? STRENGTH_BTNS.find((b) => b.key === (feedback as any).key)
    : null;

  return (
    <li
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-white/70 p-4 shadow-sm backdrop-blur-sm transition-all",
        "hover:shadow-md hover:-translate-y-0.5",
        onOpenDetail && "cursor-pointer",
        isFeedbackDone
          ? cn(tone?.bannerRing || "", "ring-4 border-2", tone && `border-tone`)
          : archived
            ? "border-emerald-200/70"
            : "border-border"
      )}
      onClick={onOpenDetail}
    >
      {isFeedbackDone && tone && (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-30 mix-blend-multiply",
            tone.bannerTone.split(" ").find((c) => c.startsWith("from-")) || "from-transparent",
            "via-transparent to-transparent"
          )}
        />
      )}
      {/* 毕业卡柔和绿光晕 */}
      {archived && (
        <div className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-emerald-300/20 blur-2xl" />
      )}
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {sourceBadge(review.source)}
            {/* 进度徽章：第 X/6 轮 或 已毕业✅ */}
            <Badge
              className={cn(
                "border bg-gradient-to-br shadow-[0_1px_0_rgba(255,255,255,0.5)_inset]",
                progressTone
              )}
            >
              {progressLabel}
            </Badge>
            <Badge variant="ghost">
              间隔 <b className="ml-0.5 font-semibold">{review.interval_days}</b> 天
            </Badge>
            {!archived &&
              (overdue ? (
                <Badge variant="destructive">逾期 · {review.next_review_date}</Badge>
              ) : (
                <Badge variant="default">今天到期</Badge>
              ))}
            {archived && (
              <Badge variant="outline" className="border-emerald-200 text-emerald-700">
                长期记忆
              </Badge>
            )}
          </div>
          <div className="mt-2 flex items-start justify-between gap-3">
            <p
              className="flex-1 cursor-pointer whitespace-pre-wrap text-base font-semibold leading-relaxed text-foreground transition-colors hover:text-primary-600"
              onClick={(e) => {
                e.stopPropagation();
                if (hasContent) onToggleExpand();
              }}
              title={hasContent ? "点击查看/收起卡片内容" : undefined}
            >
              {review.title}
            </p>
            {hasContent && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand();
                }}
                className="shrink-0 gap-1.5 text-xs"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" />
                    收起
                    <X className="h-3.5 w-3.5 text-muted-foreground/60" />
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" />
                    查看内容
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                  </>
                )}
              </Button>
            )}
          </div>
          {/* 内容展开区（记忆要点文字 + 配图网格） */}
          {(() => {
            const imgs = normalizeImages(review.images);
            const hasImages = imgs.length > 0;
            if (!hasContent && !hasImages) return null;
            return (
              <div
                className={cn(
                  "mt-3 overflow-hidden rounded-xl border bg-gradient-to-br from-primary-50/60 via-white/40 to-success-50/40 transition-all duration-300",
                  expanded
                    ? "max-h-[1200px] border-primary-200/60 p-4 opacity-100"
                    : "max-h-0 border-transparent py-0 px-4 opacity-0"
                )}
              >
                {hasContent && (
                  <>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      <BookOpen className="h-3 w-3" />
                      记忆要点
                    </div>
                    <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">
                      {review.content}
                    </p>
                  </>
                )}
                {hasImages && (
                  <div className={hasContent ? "mt-4" : ""}>
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      <ImagePlus className="h-3 w-3" />
                      配图 · {imgs.length} 张（点击放大）
                    </div>
                    <div
                      className={cn(
                        "grid gap-2",
                        imgs.length === 1
                          ? "grid-cols-1"
                          : imgs.length === 2
                          ? "grid-cols-2"
                          : imgs.length % 3 === 0
                          ? "grid-cols-3"
                          : "grid-cols-2 sm:grid-cols-3"
                      )}
                    >
                      {imgs.map((src, i) => (
                        <button
                          key={i}
                          type="button"
                          aria-label={`查看配图 ${i + 1} 大图`}
                          className="group relative overflow-hidden rounded-lg border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenLightbox(src);
                          }}
                        >
                          <div className="aspect-video w-full bg-muted/40">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt={`配图 ${i + 1}`}
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          </div>
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/25">
                            <span className="flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white opacity-0 shadow transition group-hover:opacity-100">
                              <ZoomIn className="h-3 w-3" />
                              放大查看
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* 三档按钮（归档/已毕业卡片不显示；反馈展示中会 disabled，不允许再点）*/}
      {!archived && (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {STRENGTH_BTNS.map((b) => {
            const Icon = b.icon;
            const isActive = activeKey === b.key;
            const disabled =
              !!activeKey ||
              feedback === "loading" ||
              !!isFeedbackDone /* 反馈展示中不可再点 */;
            return (
              <Button
                key={b.key}
                variant={b.variant as any}
                onClick={(e) => {
                  e.stopPropagation();
                  onStrength(b.key);
                }}
                disabled={disabled}
                className={cn(
                  "flex-col !py-3 h-auto gap-1 items-center justify-center text-left transition-all",
                  isActive && "ring-2 ring-offset-2 ring-primary-400"
                )}
                title={b.explain(review.interval_days)}
              >
                <div className="flex items-center gap-2">
                  {activeKey === b.key || feedback === "loading" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                  <span className="font-semibold">{b.label}</span>
                </div>
                <div className="text-[11px] opacity-90">{b.desc}</div>
              </Button>
            );
          })}
        </div>
      )}

      {/* 即时反馈条 */}
      {isFeedbackDone && tone && (
        <div
          className={cn(
            "relative mt-3 flex items-start gap-3 rounded-xl border bg-gradient-to-br p-3.5 shadow-inner ring-1",
            tone.bannerTone,
            tone.bannerRing
          )}
          style={{ animation: "feedback-in 200ms ease-out" }}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 shadow-sm ring-1 ring-black/5">
            {(() => {
              const FIcon = tone.icon;
              if ((feedback as any).key === "remember")
                return <CheckCircle2 className="h-5 w-5 text-success-600" />;
              if ((feedback as any).key === "reset")
                return <RotateCcw className="h-5 w-5 text-rose-600" />;
              return <HelpCircle className="h-5 w-5 text-violet-600" />;
            })()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {tone.label} · {(feedback as any).nextMsg.split(" · ")[0]}
            </div>
            <div className="mt-0.5 break-all text-[13px] leading-6 opacity-90">
              {(feedback as any).nextMsg}
            </div>
          </div>
          <div className="ml-2 shrink-0">
            <Loader2 className="h-4 w-4 animate-spin opacity-70" />
          </div>
        </div>
      )}
    </li>
  );
}

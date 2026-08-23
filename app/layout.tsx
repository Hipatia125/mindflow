import type { Metadata, Viewport } from "next";
import "./globals.css";
import TabBar from "@/components/TabBar";
import { Toaster } from "@/components/ui/use-toast";

export const metadata: Metadata = {
  title: "MindFlow · 心情日记 & 计划打卡",
  description:
    "温暖的心理成长教练 —— 记录心情、管理计划、艾宾浩斯复习，温柔地陪你成为更好的自己。",
  applicationName: "MindFlow",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MindFlow",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // ⚠️ themeColor 必须全部放 viewport（Next.js 14 规定），放 metadata 会触发黄色警告
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF1E9" },
    { media: "(prefers-color-scheme: dark)", color: "#2A1F1A" },
  ],
};

/**
 * 根布局结构：
 * 1. 顶部装饰 + Logo 标题栏（sticky）
 * 2. 中间主内容区（下方预留底部 Tab 的 padding）
 * 3. 底部固定 Tab 栏（TabBar 客户端组件，根据路径高亮）
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen pb-28">
        {/* ===== 顶部装饰标题栏 ===== */}
        <header className="sticky top-0 z-30 border-b border-white/40 bg-white/50 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary-400 via-primary-500 to-secondary-500 shadow-glow" />
                <div className="absolute inset-0 h-10 w-10 animate-pulse-soft rounded-2xl bg-gradient-to-br from-primary-400 to-secondary-400 opacity-40 blur-md" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight gradient-text">
                  MindFlow
                </h1>
                <p className="text-[11px] text-muted-foreground">
                  慢一点，也没关系
                </p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "short",
              })}
            </div>
          </div>
        </header>

        {/* ===== 主内容区 ===== */}
        <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-4 animate-fade-in">
          {children}
        </main>

        {/* ===== 底部 Tab 栏 ===== */}
        <TabBar />

        {/* ===== 全局 Toast ===== */}
        <Toaster />
      </body>
    </html>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, MessageCircleHeart } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  {
    href: "/workspace",
    icon: LayoutDashboard,
    label: "工作台",
    match: ["/workspace", "/"],
  },
  {
    href: "/coach",
    icon: MessageCircleHeart,
    label: "对话教练",
    match: ["/coach"],
  },
] as const;

/**
 * 底部 Tab 栏（客户端组件，因为需要读取 usePathname）
 * 毛玻璃质感 + 选中高亮 + 移动端安全区域
 */
export default function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/50 bg-white/70 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-3xl items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom,0)]">
        {TABS.map((tab) => {
          const active = tab.match.some((p) =>
            p === "/" ? pathname === p : pathname.startsWith(p)
          );
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "group relative flex min-w-[80px] flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-all duration-300",
                active
                  ? "text-primary-600"
                  : "text-muted-foreground hover:text-foreground/80"
              )}
            >
              {/* 选中时的柔光圆点背景 */}
              {active && (
                <span className="absolute top-2 h-8 w-12 rounded-full bg-primary-100/70 -z-0 animate-fade-in" />
              )}
              <Icon
                size={22}
                strokeWidth={active ? 2.4 : 2}
                className={cn(
                  "relative z-10 transition-transform duration-300",
                  active &&
                    "drop-shadow-[0_2px_6px_hsl(var(--primary)/0.4)] scale-105"
                )}
              />
              <span className="relative z-10">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

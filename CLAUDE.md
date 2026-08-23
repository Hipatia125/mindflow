# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MindFlow is a mobile-first (max-w-3xl, bottom tab bar) **psychological growth & productivity app** in Chinese: mood journaling with an AI emotional-growth coach, daily task checklists, focus timers (Pomodoro/stopwatch/countdown/challenge), Ebbinghaus spaced-repetition review cards, long-term goal breakdown, and achievement badges.

Stack: Next.js 14 (App Router) + React 18 + TypeScript + Tailwind CSS (custom theme, not shadcn defaults) + Supabase (Postgres) + DeepSeek LLM for the coach. There is **no test suite** and no git repo in this directory.

## Commands

```bash
npm run dev     # dev server (Next.js)
npm run build   # production build
npm run start   # serve production build
npm run lint    # next lint (ESLint)
```

No test runner is installed; verification is manual via the dev server.

## Environment & Mock Fallback (critical)

Copy `.env.local.example` → `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser client (safe for client components)
- `SUPABASE_SERVICE_ROLE_KEY` — admin client, **server-only**, never expose to the frontend
- `DEEPSEEK_API_KEY` — coach AI (from platform.deepseek.com)

**Dual data layer, the app's defining pattern:** every API route tries Supabase via `getSupabaseAdmin()` and transparently falls back to an in-memory/JSON mock store when `shouldUseMock()` returns true (missing/placeholder keys) or when the Supabase call throws. The mock persists to `.mindflow-mock.json` at the project root (gitignored) and auto-seeds demo data on first run. So the app works fully without any real backend — changes to Supabase queries must be mirrored in `lib/supabase/mock-store.ts` or the mock path will behave differently (or crash) once Supabase is configured.

## Architecture & Data Flow

```
Client components ("use client")
  └─ fetchApi() in lib/fetch-api.ts
       └─ injects X-Mindflow-User-Id header (from getOrCreateUserId(), localStorage UUID)
       └─ returns { ok, data, error } and toasts errors
            └─ App Router API routes (app/api/**/route.ts)
                 ├─ getUserIdFromHeaders(req.headers) → user_id
                 ├─ withMockFallback(): try Supabase admin client → catch → mock-store fn
                 └─ NextResponse.json({ ok: true, data, mock?, ... })
```

Key invariants:

- **No Supabase Auth yet.** Anonymous mode: the frontend generates a UUID in `localStorage` (key `mindflow_user_id`), sends it as `X-Mindflow-User-Id`, and API routes use it as `user_id`. Supabase auth session-based RLS is stubbed for later (`auth.uid() = user_id`).
- **API responses always carry `mock: true`** when the mock layer served them (and optionally `mock_reason`/`mock_error`); the UI uses this to show a "模拟数据" indicator.
- **All components talk to Supabase only through API routes** — no client-side Supabase queries exist (the browser client is effectively unused for data). The admin client is server-only and bypasses RLS.
- Every API route follows the same shape: extract uid → parse/validate → `withMockFallback(...)` → JSON response with `ok` flag; errors are caught, logged with `[module/method]` prefix, and returned as `{ ok: false, error }`.
- Client-side state refresh uses a `refreshKey`/`tick` prop pattern (e.g. `WorkspacePage` bumps a counter passed to child panels to trigger refetch) — a deliberate light-weight alternative to global state.

## Directory Map

- `app/` — App Router: `page.tsx` redirects `/` → `/workspace`; `workspace/page.tsx` (dashboard) and `coach/page.tsx` (AI chat) are the two tabs in `components/TabBar.tsx`. `layout.tsx` holds the sticky header, max-w-3xl main column, TabBar, and Toaster.
- `app/api/` — one route per domain: `tasks`, `reviews`, `chat`, `focus/record`, `focus/stats`, `goals`, `goals/breakdown`, `goals/steps`, `achievements`, `workspace/overview`, `workspace/heatmap`, `workspace/heatmap`. All are thin Supabase/mock adapters; the only business logic lives in `chat/route.ts` and `goals/breakdown/route.ts`.
- `components/` — `FocusTimer.tsx` (timer + achievements + focus record API) and `workspace/` (OverviewCard, FocusStats, TodoList, HeatmapCalendar, ReviewBoard, GoalsManager, AchievementsPanel). `components/ui/` are shadcn-style primitives (Button, Card, Tabs, Toast, etc.).
- `lib/supabase/types.ts` — **single source of truth for all data types** (`Task`, `Review`, `Goal`, `FocusSession`, `Achievement`, …), Insert/Update variants, and `MindFlowDatabase` for the supabase-js generic. **Hand-maintained, not generated** — new columns must be added here AND to the SQL migrations.
- `lib/supabase/client.ts` — client factories (`createSupabaseBrowserClient`, `getSupabaseAdmin`) + anonymous user ID helpers.
- `lib/supabase/mock-store.ts` — mock CRUD + stats for every entity, persistent to `.mindflow-mock.json`.
- `lib/utils.ts` — `cn()`, `todayISO()` / `toDateISO()` / `shiftDateISO()` / `daysBetween()` (local-timezone-safe YYYY-MM-DD helpers — reuse these; do not hand-roll date math), `formatMinutes`, `formatMMSS`.
- `supabase/migrations/` — raw SQL, applied manually via Supabase SQL Editor (no migration CLI). `001_init_tables.sql` creates tasks/diary_entries/reviews with **permissive dev RLS policies**; later migrations add columns (e.g. reviews.content/images/review_round) and tables (focus_sessions, goals, goal_steps, achievements). Note: some policies differ between files — 001 uses open `using (true)` for dev, 005/006 use `auth.uid() = user_id`; the unified 007 is the idempotent consolidation.

## Domain Logic Worth Knowing

- **Ebbinghaus reviews** (`types.ts` + `mock-store.ts`): rounds 1..6 map to interval schedule `[1, 2, 4, 7, 15, 30]` days; round > 6 or status `graduated` = graduated. `scheduleRecall()` is the state machine for the three review buttons (remember → next round / fuzzy → stay, interval halved / reset → back to round 1). Keep these helpers and constants in sync between the two files.
- **Focus stats** (`focus/stats` + `mockFocusStats`): weekly aggregation with a hardcoded `targetMinutes = 120`.
- **Chat coach** (`chat/route.ts`): builds a user-context summary from live MindFlow data (tasks/focus/diary/goals), supports shortcut "special actions" (analyze diary, break down goal, etc.), calls DeepSeek **Responses API** (`https://api.deepseek.com/v1/responses`, model `deepseek-chat`) with `web_search` tool, parses citations, and falls back to canned mock replies when `DEEPSEEK_API_KEY` is unset. `PSYCHOLOGY_KNOWLEDGE` is an exported array of exercise templates used both by the system prompt and the `GET` endpoint.

## Conventions

- UI copy, code comments, and commit-worthy phrasing are in **Chinese**; match this in user-facing strings and comments.
- Path alias `@/*` → project root; import via `@/components/...`, `@/lib/...`.
- Client components declare `"use client"`. Never import `getSupabaseAdmin` or server-only env access into a client component.
- Tailwind theme is customized in `tailwind.config.ts` (custom `primary`/`secondary` palette, keyframes like `animate-fade-in`, `animate-pulse-soft`) — check it before assuming default Tailwind colors exist.
- UI code style: glassmorphism (white/translucent + `backdrop-blur`), rounded-2xl cards, `cn()` for class merging, lucide-react icons, Radix-based ui primitives.
- **Modals must use `createPortal(..., document.body)`** — `<main>` in `app/layout.tsx` has `animate-fade-in` (a `transform`), and any ancestor `transform` becomes the containing block for descendant `position: fixed`, breaking `fixed inset-0` modals (they stop centering/scrolling). Toast (`<Toaster/>`) and `TabBar` are `<body>`-direct children so they're unaffected.
- **Goal breakdown** (`goals/breakdown/route.ts`): accepts `starting_point` / `success_criteria` / `weekly_time` (columns added in `009_goal_context_fields.sql`) + `clarifications` (Q&A history). Two-phase prompt: ask 1~3 clarifying questions when info is insufficient (max 1 round, then must return steps), otherwise emit `{needs_clarification, steps, questions}` JSON; DeepSeek `web_search` is enabled for domain research.

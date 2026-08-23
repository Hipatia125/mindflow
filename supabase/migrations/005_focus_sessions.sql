-- ================================================================
-- 005 · 专注计时会话表 focus_sessions
-- 记录每次计时器完成的专注/休息会话
-- ================================================================

create table if not exists public.focus_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  task_id uuid null,                         -- 关联待办任务（独立启动时为 null）
  duration_minutes integer not null,         -- 本次会话时长（分钟）
  session_type varchar(20) not null,         -- 'pomodoro' | 'stopwatch' | 'countdown'
  phase varchar(10) not null default 'focus',-- 'focus' | 'break'（番茄钟专用）
  started_at timestamptz not null default now(),
  ended_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 索引：按用户 + 日期查询
create index if not exists idx_focus_sessions_user_date
  on public.focus_sessions (user_id, started_at desc);

-- 索引：按任务关联查询
create index if not exists idx_focus_sessions_task
  on public.focus_sessions (task_id)
  where task_id is not null;

-- RLS
alter table public.focus_sessions enable row level security;

create policy "focus_sessions_owner_select"
  on public.focus_sessions for select
  using (auth.uid() = user_id);

create policy "focus_sessions_owner_insert"
  on public.focus_sessions for insert
  with check (auth.uid() = user_id);

create policy "focus_sessions_owner_delete"
  on public.focus_sessions for delete
  using (auth.uid() = user_id);

comment on table public.focus_sessions is
  '专注计时会话记录：番茄钟 / 正计时 / 自定义倒计时 每次完成后的记录';

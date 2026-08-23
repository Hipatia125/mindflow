-- ================================================================
-- 006 · 新增功能迁移：专注目标 + 长期目标 + 连续专注挑战 + 成就
-- 一次性执行，包含所有新字段/新表
-- ================================================================

-- ① focus_sessions 新增字段
alter table if exists public.focus_sessions
  add column if not exists intent varchar(255),
  add column if not exists challenge_rounds integer not null default 0;

comment on column public.focus_sessions.intent
  is '专注意图（用户输入的本次专注想完成什么）';
comment on column public.focus_sessions.challenge_rounds
  is '连续专注挑战中完成的番茄钟数量（仅 session_type=challenge 时有意义）';

-- ② 长期目标表
create table if not exists public.goals (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  title varchar(255) not null,
  description text,
  target_date date,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  constraint goals_status_check check (status in ('active', 'completed', 'archived'))
);

create index if not exists idx_goals_user_status
  on public.goals (user_id, status);

alter table public.goals enable row level security;

create policy "goals_owner_select"
  on public.goals for select
  using (auth.uid() = user_id);

create policy "goals_owner_insert"
  on public.goals for insert
  with check (auth.uid() = user_id);

create policy "goals_owner_update"
  on public.goals for update
  using (auth.uid() = user_id);

create policy "goals_owner_delete"
  on public.goals for delete
  using (auth.uid() = user_id);

comment on table public.goals is
  '长期目标表：用户设定的长期目标，AI 自动拆解为子步骤';

-- ③ 目标子步骤表（AI 拆解的最小行动单元）
create table if not exists public.goal_steps (
  id uuid default gen_random_uuid() primary key,
  goal_id uuid not null references public.goals(id) on delete cascade,
  content text not null,
  step_order integer not null default 0,
  is_done boolean not null default false,
  scheduled_date date,
  added_to_tasks boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_goal_steps_goal
  on public.goal_steps (goal_id, step_order);

alter table public.goal_steps enable row level security;

create policy "goal_steps_owner_select"
  on public.goal_steps for select
  using (
    exists (
      select 1 from public.goals g
      where g.id = goal_steps.goal_id and g.user_id = auth.uid()
    )
  );

create policy "goal_steps_owner_insert"
  on public.goal_steps for insert
  with check (
    exists (
      select 1 from public.goals g
      where g.id = goal_steps.goal_id and g.user_id = auth.uid()
    )
  );

create policy "goal_steps_owner_update"
  on public.goal_steps for update
  using (
    exists (
      select 1 from public.goals g
      where g.id = goal_steps.goal_id and g.user_id = auth.uid()
    )
  );

create policy "goal_steps_owner_delete"
  on public.goal_steps for delete
  using (
    exists (
      select 1 from public.goals g
      where g.id = goal_steps.goal_id and g.user_id = auth.uid()
    )
  );

comment on table public.goal_steps is
  '目标子步骤表：由 AI 拆解生成，每个步骤是一天内可完成的最小行动单元';

-- ④ 成就表
create table if not exists public.achievements (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  badge_code varchar(50) not null,
  badge_name varchar(100) not null,
  description text,
  unlocked_at timestamptz not null default now(),
  progress_value integer not null default 0,
  metadata jsonb
);

create index if not exists idx_achievements_user_code
  on public.achievements (user_id, badge_code);

create unique index if not exists idx_achievements_user_code_unique
  on public.achievements (user_id, badge_code);

alter table public.achievements enable row level security;

create policy "achievements_owner_select"
  on public.achievements for select
  using (auth.uid() = user_id);

create policy "achievements_owner_insert"
  on public.achievements for insert
  with check (auth.uid() = user_id);

create policy "achievements_owner_update"
  on public.achievements for update
  using (auth.uid() = user_id);

create policy "achievements_owner_delete"
  on public.achievements for delete
  using (auth.uid() = user_id);

comment on table public.achievements is
  '成就表：用户解锁的各种成就徽章（专注新秀、深度专注者、心流大师等）';

-- ⑤ tasks 表新增 goal_step_id 关联字段
alter table if exists public.tasks
  add column if not exists goal_step_id uuid references public.goal_steps(id) on delete set null;

comment on column public.tasks.goal_step_id
  is '若来自长期目标拆解，关联对应的 goal_step';

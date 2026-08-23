-- =====================================================================
-- MindFlow · Supabase 数据库初始化脚本
-- 使用方法：
--   1. 打开 https://supabase.com/dashboard → 你的项目
--   2. 左侧菜单：SQL Editor → New query
--   3. 全选粘贴本文件，按 "Run"（或 F5）执行
--   4. 执行成功后，三张表 + 索引 + RLS 策略就全部建好了
--
-- 注意事项（生产环境）：
--   本脚本 RLS 策略默认"开发期宽松"（所有数据可读写）。
--   接入 Supabase Auth 后，请把每个表的 RLS 策略替换为：
--     using (auth.uid() = user_id::uuid)
--     with check (auth.uid() = user_id::uuid)
-- =====================================================================

-- ================================================================
-- 1. 扩展 & 工具（若尚未启用）
-- ================================================================
create extension if not exists "pgcrypto";

-- ================================================================
-- 2. tasks 表：待办任务
-- ================================================================
create table if not exists public.tasks (
    id              uuid primary key default gen_random_uuid(),
    user_id         text not null,                    -- MVP 匿名模式使用 text，接 Supabase Auth 可改为 uuid
    content         text not null,
    is_done         boolean not null default false,
    due_date        date not null,                     -- YYYY-MM-DD，按天查询
    source          text not null default 'manual'
                    check (source in ('ai', 'manual')),
    focus_minutes   integer not null default 0,        -- 专注累计分钟
    created_at      timestamptz not null default now()
);

comment on column public.tasks.source is '来源：ai=AI拆解生成，manual=手动添加';
comment on column public.tasks.focus_minutes is '番茄钟/正计时累计的专注分钟数';

-- 常用查询索引：按用户 + 日期取今日/某月任务
create index if not exists tasks_user_due_date_idx on public.tasks (user_id, due_date);
create index if not exists tasks_user_created_at_idx on public.tasks (user_id, created_at desc);

-- 行级安全（RLS）
alter table public.tasks enable row level security;

drop policy if exists "dev_tasks_read_all"  on public.tasks;
drop policy if exists "dev_tasks_write_all" on public.tasks;

-- ⚠️ 开发期宽松策略（任何人可读自己"当前 user_id"范围之外的数据也放行）
--    接入 Supabase Auth 后删除此两条，替换为：
--    create policy tasks_rls_read  on public.tasks for select using (auth.uid() = user_id::uuid);
--    create policy tasks_rls_write on public.tasks for all   with check (auth.uid() = user_id::uuid);
create policy "dev_tasks_read_all"
    on public.tasks for select
    using (true);

create policy "dev_tasks_write_all"
    on public.tasks for all
    using (true)
    with check (true);


-- ================================================================
-- 3. diary_entries 表：心情日记（倾诉原文 + AI 情绪分析 JSON）
-- ================================================================
create table if not exists public.diary_entries (
    id                uuid primary key default gen_random_uuid(),
    user_id           text not null,
    raw_text          text not null,                    -- 用户倾诉原文
    emotion_analysis  jsonb,                            -- AI 分析结果 JSON：{emotion, advice, action_steps, raw_reply}
    created_at        timestamptz not null default now()
);

comment on column public.diary_entries.emotion_analysis
    is 'AI 分析结果：{emotion:情绪标签, advice:建议, action_steps:[最小行动], raw_reply:完整回复文本}';

create index if not exists diary_user_created_idx on public.diary_entries (user_id, created_at desc);

alter table public.diary_entries enable row level security;

drop policy if exists "dev_diary_read_all"  on public.diary_entries;
drop policy if exists "dev_diary_write_all" on public.diary_entries;

create policy "dev_diary_read_all"
    on public.diary_entries for select
    using (true);

create policy "dev_diary_write_all"
    on public.diary_entries for all
    using (true)
    with check (true);


-- ================================================================
-- 4. reviews 表：艾宾浩斯复习卡片
-- ================================================================
create table if not exists public.reviews (
    id                 uuid primary key default gen_random_uuid(),
    user_id            text not null,
    title              text not null,
    source             text not null default 'manual'
                       check (source in ('ai', 'manual')),
    interval_days      integer not null default 1,     -- 当前间隔天数：1→2→4→7→15→30
    next_review_date   date not null,
    status             text not null default 'pending'
                       check (status in ('pending', 'reviewed')),
    created_at         timestamptz not null default now()
);

comment on column public.reviews.interval_days is '艾宾浩斯间隔：成功则推进到下一级，失败则回退';
comment on column public.reviews.status is 'pending=待复习，reviewed=已复习（当天的或已超期的）';

create index if not exists reviews_user_next_date_idx on public.reviews (user_id, next_review_date);
create index if not exists reviews_user_status_idx    on public.reviews (user_id, status);

alter table public.reviews enable row level security;

drop policy if exists "dev_reviews_read_all"  on public.reviews;
drop policy if exists "dev_reviews_write_all" on public.reviews;

create policy "dev_reviews_read_all"
    on public.reviews for select
    using (true);

create policy "dev_reviews_write_all"
    on public.reviews for all
    using (true)
    with check (true);


-- ================================================================
-- 5.（可选）让 Postgres 自动更新"完成后 status=reviewed"—— 暂不用触发器，应用层控制即可
--    预留一个"方便后续统计"的视图：今日完成度
-- ================================================================
create or replace view public.today_completion as
select
    user_id,
    count(*) filter (where due_date = current_date) as total,
    count(*) filter (where due_date = current_date and is_done) as done,
    coalesce(round(
        100.0 * count(*) filter (where due_date = current_date and is_done)
        / nullif(count(*) filter (where due_date = current_date), 0)
    ), 0) as pct
from public.tasks
group by user_id;

comment on view public.today_completion is '每行 = 一个用户今日任务完成度（total/done/pct）';

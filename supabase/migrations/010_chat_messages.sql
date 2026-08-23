-- =====================================================================
-- 010_chat_messages.sql
-- 用途：新增 chat_messages 表，保存对话教练的聊天历史，让教练跨刷新
--       记住用户的对话（会话记忆）。幂等。
-- 运行方式：在 Supabase SQL Editor 里粘贴本文件内容，点 Run 即可。
-- =====================================================================

create table if not exists public.chat_messages (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null,
    role        text not null check (role in ('user', 'assistant')),
    content     text not null,
    citations   jsonb,          -- 联网搜索引用 [{url,title,snippet}]
    meta        jsonb,          -- {mock, knowledge_hit, web_searched, action_hint}
    created_at  timestamptz not null default now()
);

comment on table public.chat_messages is
  '对话教练聊天历史：跨刷新保存，实现会话记忆';

create index if not exists chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at desc);

-- 开发期宽松 RLS（与 001 一致，接入 Auth 后替换为 auth.uid() = user_id）
alter table public.chat_messages enable row level security;

drop policy if exists "dev_chat_read_all"  on public.chat_messages;
drop policy if exists "dev_chat_write_all" on public.chat_messages;

create policy "dev_chat_read_all"
    on public.chat_messages for select
    using (true);

create policy "dev_chat_write_all"
    on public.chat_messages for all
    using (true)
    with check (true);

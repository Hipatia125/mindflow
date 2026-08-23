-- =====================================================================
-- 008_goal_steps_notes.sql
-- 用途：给 goal_steps 表新增「notes」列（步骤补充说明，可选）
--       AI 拆解目标时可为每条步骤附上一句「为什么这么安排 / 怎么做」
-- 运行方式：在 Supabase SQL Editor 里粘贴本文件内容，点 Run 即可。幂等。
-- =====================================================================

alter table if exists public.goal_steps
  add column if not exists notes text;

comment on column public.goal_steps.notes is
  '步骤补充说明（可选）：AI 生成的原因/提示/做法，帮助用户理解这一步为什么这么做';

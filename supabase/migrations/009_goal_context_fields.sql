-- =====================================================================
-- 009_goal_context_fields.sql
-- 用途：给 goals 表新增三个「拆解上下文」字段，帮助 AI 拆出更贴合用户、
--       可直接照做的子步骤（可选，均为 text）：
--         starting_point  当前起点 / 水平（"我会 useCallback 但一上复杂项目就卡"）
--         success_criteria 想要达成的具体成果 / 验收标准（"能独立重构一个列表页"）
--         weekly_time     每周可投入的时间节奏（"工作日晚上 2h × 3 天"）
-- 运行方式：在 Supabase SQL Editor 里粘贴本文件内容，点 Run 即可。幂等。
-- =====================================================================

alter table if exists public.goals
  add column if not exists starting_point text;

alter table if exists public.goals
  add column if not exists success_criteria text;

alter table if exists public.goals
  add column if not exists weekly_time text;

comment on column public.goals.starting_point is
  '当前起点 / 水平（可选）：帮助 AI 判断第一步从哪里开始';
comment on column public.goals.success_criteria is
  '想要达成的具体成果 / 验收标准（可选）：帮助 AI 明确每一步的方向';
comment on column public.goals.weekly_time is
  '每周可投入的时间节奏（可选）：帮助 AI 控制每日任务量';

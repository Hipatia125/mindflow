-- =====================================================================
-- 004_reviews_add_review_round.sql
-- 用途：给 reviews 表新增 review_round 列（整数 默认 1，表示「正在进行的复习轮次」）
--       1..6 = SRS 进行中（第 1~6 轮待做）
--       > 6  = 已毕业（6 轮全通过）
--       同时给现有行初始化 review_round=1 保证非空。
-- 运行方式：Supabase SQL Editor 粘贴 Run 即可，幂等。
-- =====================================================================

alter table if exists public.reviews
  add column if not exists review_round integer not null default 1;

do $$
begin
  -- 把 review_round 约束到 [1, 7]（7=刚毕业的边界）
  execute 'alter table if exists public.reviews drop constraint if exists reviews_review_round_check';
  execute 'alter table if exists public.reviews add constraint reviews_review_round_check check (review_round between 1 and 7)';
exception
  when others then null;
end $$;

comment on column public.reviews.review_round
  is '正在进行的复习轮次（默认 1）：1~6 = SRS 第 1~6 轮待做；= 7 即 6 轮全通过已毕业。实际间隔 = [1,2,4,7,15,30][review_round-1]';

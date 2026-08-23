-- =====================================================================
-- 002_reviews_add_content.sql
-- 用途：给 reviews 表新增「content」列（卡片内容，可选）
--       用户反馈：复习卡片只有标题、点"记住了"根本记不住内容
--       所以从现在开始添加卡片时可以（可选地）填写知识点正文
-- 运行方式：在 Supabase SQL Editor 里粘贴本文件内容，点 Run 即可。幂等。
-- =====================================================================

alter table if exists public.reviews
  add column if not exists content text;

comment on column public.reviews.content is '卡片内容（可选）：知识点正文 / 定义 / 答案 — 点击"查看内容"后展开显示';

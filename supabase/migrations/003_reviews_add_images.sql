-- =====================================================================
-- 003_reviews_add_images.sql
-- 用途：给 reviews 表新增「images」列（图片数组，数组元素是 base64 dataURL 或外链 URL）
--       MVP 用户本地选图（导图 / 公式 / 手绘笔记）→ 直存列里，零依赖。
--       以后接 Supabase Storage：把字段值改为 storage public URL 即可，前端兼容。
-- 运行方式：在 Supabase SQL Editor 里粘贴本文件内容，点 Run 即可。幂等。
-- =====================================================================

alter table if exists public.reviews
  add column if not exists images text[];

comment on column public.reviews.images
  is '卡片配图（可选）：数组，每一项是 base64 dataURL 或公开外链 URL。渲染时按顺序网格预览，点击放大。';

-- ================================================================
-- 007 · 统一迁移脚本（一次性执行，幂等安全）
-- 包含：focus_sessions / goals / goal_steps / achievements + RLS + 索引
-- 在 Supabase Dashboard → SQL Editor 中整段粘贴执行即可
-- ================================================================

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  1. focus_sessions 表（专注计时记录）                           ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.focus_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  task_id UUID,                                   -- 关联待办任务（独立启动时为 null）
  duration_minutes INTEGER NOT NULL,               -- 本次会话时长（分钟）
  session_type VARCHAR(20) NOT NULL,               -- 'pomodoro' | 'stopwatch' | 'countdown' | 'challenge'
  phase VARCHAR(10) NOT NULL DEFAULT 'focus',      -- 'focus' | 'break'
  challenge_rounds INTEGER NOT NULL DEFAULT 0,     -- 连续专注挑战完成的番茄钟数
  intent VARCHAR(255),                             -- 用户输入的专注意图
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 补充新字段（若表已存在但缺少字段）
ALTER TABLE IF EXISTS public.focus_sessions
  ADD COLUMN IF NOT EXISTS challenge_rounds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intent VARCHAR(255);

-- 索引：按用户 + 日期查询
CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_date
  ON public.focus_sessions (user_id, started_at DESC);

-- 索引：按任务关联查询
CREATE INDEX IF NOT EXISTS idx_focus_sessions_task
  ON public.focus_sessions (task_id)
  WHERE task_id IS NOT NULL;

-- RLS
ALTER TABLE public.focus_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- 逐条创建 policy，忽略已存在
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'focus_sessions' AND policyname = 'focus_sessions_owner_select') THEN
    CREATE POLICY "focus_sessions_owner_select" ON public.focus_sessions FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'focus_sessions' AND policyname = 'focus_sessions_owner_insert') THEN
    CREATE POLICY "focus_sessions_owner_insert" ON public.focus_sessions FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'focus_sessions' AND policyname = 'focus_sessions_owner_delete') THEN
    CREATE POLICY "focus_sessions_owner_delete" ON public.focus_sessions FOR DELETE USING (true);
  END IF;
END $$;

COMMENT ON TABLE public.focus_sessions IS
  '专注计时会话记录：番茄钟 / 正计时 / 自定义倒计时 / 连续专注挑战 每次完成后的记录';

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  2. goals 表（长期目标主表）                                    ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  target_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT goals_status_check CHECK (status IN ('active', 'completed', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_goals_user_status
  ON public.goals (user_id, status);

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goals' AND policyname = 'goals_owner_select') THEN
    CREATE POLICY "goals_owner_select" ON public.goals FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goals' AND policyname = 'goals_owner_insert') THEN
    CREATE POLICY "goals_owner_insert" ON public.goals FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goals' AND policyname = 'goals_owner_update') THEN
    CREATE POLICY "goals_owner_update" ON public.goals FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goals' AND policyname = 'goals_owner_delete') THEN
    CREATE POLICY "goals_owner_delete" ON public.goals FOR DELETE USING (true);
  END IF;
END $$;

COMMENT ON TABLE public.goals IS
  '长期目标表：用户设定的长期目标，AI 自动拆解为子步骤';

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  3. goal_steps 表（目标子步骤）                                 ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.goal_steps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  goal_id UUID NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  step_order INTEGER NOT NULL DEFAULT 0,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  scheduled_date DATE,
  added_to_tasks BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 补充字段（若表已存在但缺少字段）
ALTER TABLE IF EXISTS public.goal_steps
  ADD COLUMN IF NOT EXISTS added_to_tasks BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_goal_steps_goal
  ON public.goal_steps (goal_id, step_order);

ALTER TABLE public.goal_steps ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goal_steps' AND policyname = 'goal_steps_owner_select') THEN
    CREATE POLICY "goal_steps_owner_select" ON public.goal_steps FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goal_steps' AND policyname = 'goal_steps_owner_insert') THEN
    CREATE POLICY "goal_steps_owner_insert" ON public.goal_steps FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goal_steps' AND policyname = 'goal_steps_owner_update') THEN
    CREATE POLICY "goal_steps_owner_update" ON public.goal_steps FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goal_steps' AND policyname = 'goal_steps_owner_delete') THEN
    CREATE POLICY "goal_steps_owner_delete" ON public.goal_steps FOR DELETE USING (true);
  END IF;
END $$;

COMMENT ON TABLE public.goal_steps IS
  '目标子步骤表：由 AI 拆解生成，每个步骤是一天内可完成的最小行动单元';

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  4. achievements 表（成就徽章）                                 ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.achievements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  badge_code VARCHAR(50) NOT NULL,
  badge_name VARCHAR(100) NOT NULL,
  description TEXT,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  progress_value INTEGER NOT NULL DEFAULT 0,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_achievements_user_code
  ON public.achievements (user_id, badge_code);

CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_user_code_unique
  ON public.achievements (user_id, badge_code);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'achievements' AND policyname = 'achievements_owner_select') THEN
    CREATE POLICY "achievements_owner_select" ON public.achievements FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'achievements' AND policyname = 'achievements_owner_insert') THEN
    CREATE POLICY "achievements_owner_insert" ON public.achievements FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'achievements' AND policyname = 'achievements_owner_update') THEN
    CREATE POLICY "achievements_owner_update" ON public.achievements FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'achievements' AND policyname = 'achievements_owner_delete') THEN
    CREATE POLICY "achievements_owner_delete" ON public.achievements FOR DELETE USING (true);
  END IF;
END $$;

COMMENT ON TABLE public.achievements IS
  '成就表：用户解锁的各种成就徽章（专注新秀、深度专注者、心流大师等）';

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  5. tasks 表补充 goal_step_id 字段                             ║
-- ╚══════════════════════════════════════════════════════════════╝

ALTER TABLE IF EXISTS public.tasks
  ADD COLUMN IF NOT EXISTS goal_step_id UUID REFERENCES public.goal_steps(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tasks.goal_step_id IS
  '若来自长期目标拆解，关联对应的 goal_step';

-- ================================================================
-- 完成！所有表已创建（幂等，重复执行不会报错）
-- ================================================================

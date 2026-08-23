"use client";

import * as React from "react";
import OverviewCard from "@/components/workspace/OverviewCard";
import TodoList from "@/components/workspace/TodoList";
import HeatmapCalendar from "@/components/workspace/HeatmapCalendar";
import ReviewBoard from "@/components/workspace/ReviewBoard";
import FocusTimer from "@/components/FocusTimer";
import GoalsManager from "@/components/workspace/GoalsManager";
import AchievementsPanel from "@/components/workspace/AchievementsPanel";
import FocusStats from "@/components/workspace/FocusStats";
import type { Task, FocusSessionType } from "@/lib/supabase/types";

/**
 * 工作台页面
 *  ① 顶部概览
 *  ② 专注计时器（番茄钟 / 正计时 / 自定义倒计时）+ 连续专注挑战
 *  ③ 长期目标（AI 智能拆解为每日小步骤）
 *  ④ 今日待办清单
 *  ⑤ 打卡月历
 *  ⑥ 艾宾浩斯复习卡片
 *  ⑦ 专注成就（徽章展示）
 */
export default function WorkspacePage() {
  const [tick, setTick] = React.useState(0);
  const bump = React.useCallback(() => setTick((v) => v + 1), []);

  // —— 计时器与待办联动 ——
  const [timerTask, setTimerTask] = React.useState<Task | null>(null);
  const [timerMode, setTimerMode] = React.useState<FocusSessionType>("pomodoro");
  const [timerTrigger, setTimerTrigger] = React.useState(0);

  const handleStartTimer = React.useCallback(
    (task: Task, mode: FocusSessionType) => {
      setTimerTask(task);
      setTimerMode(mode);
      setTimerTrigger((n) => n + 1);
      if (typeof window !== "undefined") {
        const el = document.getElementById("focus-timer-section");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    []
  );

  // —— 长期目标步骤加入待办后，刷新 TodoList ——
  const handleStepAdded = React.useCallback(() => {
    bump();
  }, [bump]);

  return (
    <div className="flex flex-col gap-5">
      {/* ① 顶部概览 */}
      <OverviewCard refreshKey={tick} />

      {/* ①b 专注可视化统计（环形进度条 + 7天柱状图） */}
      <FocusStats refreshKey={tick} />

      {/* ② 专注计时器 + 连续专注挑战 */}
      <div id="focus-timer-section" className="scroll-mt-4">
        <FocusTimer
          task={timerTask}
          externalMode={timerMode}
          trigger={timerTrigger}
          onSessionEnd={bump}
          onClearTask={() => setTimerTask(null)}
        />
      </div>

      {/* ③ 长期目标（AI 拆解） */}
      <GoalsManager onStepAdded={handleStepAdded} />

      {/* ④ 今日待办清单 */}
      <TodoList onChange={bump} onStartTimer={handleStartTimer} />

      {/* ⑤ 打卡月历 */}
      <HeatmapCalendar refreshKey={tick} />

      {/* ⑥ 艾宾浩斯复习卡片 */}
      <ReviewBoard refreshKey={tick} />

      {/* ⑦ 专注成就 */}
      <AchievementsPanel refreshKey={tick} />
    </div>
  );
}

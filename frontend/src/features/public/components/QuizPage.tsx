import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatElapsedTime } from "../utils";
import type { BoardItem, QuizData, ScoreSubmissionResult, StudentForm } from "../types";
import { LoadingPage, ResultPanel, StatusCard, StudentFields } from "./Common";
import { MatchCard } from "./MatchCard";

interface QuizPageProps {
  quiz: QuizData | null;
  leftItems: BoardItem[];
  rightItems: BoardItem[];
  matchedPairIds: Set<number>;
  selectedItem: BoardItem | null;
  studentForm: StudentForm;
  message: string;
  matchedCount: number;
  totalPairs: number;
  score: number;
  elapsedSeconds: number;
  lastResult: ScoreSubmissionResult | null;
  isLoading: boolean;
  publicError: string;
  isSubmitting: boolean;
  styleClass: string;
  onCardClick: (item: BoardItem) => void;
  onResetGame: () => void;
  onSubmitScore: () => void;
  onStudentFormChange: (fieldName: keyof StudentForm, value: string) => void;
  onNavigateLeaderboard: () => void;
}

/**
 * 答题页面展示层。
 *
 * 结构：
 * - hero 渐变标题区（题库名 + 站点标题 + 描述 + 学生信息表单）
 * - 状态栏（配对数 / 得分 / 用时 / 操作提示）
 * - 配对区（左列表 + 右列表 + 操作按钮 + 结果面板）
 *
 * 桌面端 hero 为双列布局（标题 + 表单），移动端单列。
 */
export function QuizPage({
  quiz,
  leftItems,
  rightItems,
  matchedPairIds,
  selectedItem,
  studentForm,
  message,
  matchedCount,
  totalPairs,
  score,
  elapsedSeconds,
  lastResult,
  isLoading,
  publicError,
  isSubmitting,
  styleClass,
  onCardClick,
  onResetGame,
  onSubmitScore,
  onStudentFormChange,
  onNavigateLeaderboard,
}: QuizPageProps) {
  if (isLoading) {
    return <LoadingPage text="正在加载题库..." />;
  }

  if (publicError || !quiz) {
    return <LoadingPage text={publicError || "题库数据不可用，请刷新页面重试。"} />;
  }

  return (
    <main
      className={cn(
        "mx-auto grid min-h-screen w-[min(100%-1rem,94rem)] place-items-center py-3 sm:w-[min(100%-2rem,94rem)] sm:py-5",
        styleClass,
      )}
    >
      <section className="grid w-full">
        {/* hero 标题区 */}
        <header className="hero-gradient grid gap-4 rounded-t-lg p-4 text-brand-surface shadow-soft sm:grid-cols-[minmax(20rem,1fr)_minmax(32rem,38rem)] sm:items-end sm:p-5">
          <div className="grid max-w-46rem gap-2">
            <h1 className="font-serif text-4xl sm:text-[2.25rem] lg:text-[2.55rem]">
              {quiz.question_bank.name}
            </h1>
            {quiz.question_bank.description && (
              <p className="leading-relaxed text-brand-hero-text">
                {quiz.question_bank.description}
              </p>
            )}
          </div>
          <div
            aria-label="学生信息"
            className="grid gap-3 sm:grid-cols-3"
          >
            <StudentFields form={studentForm} onChange={onStudentFormChange} variant="on-dark" />
          </div>
        </header>

        {/* 状态栏 */}
        <section
          aria-label="测验状态"
          className="grid grid-cols-2 gap-2.5 border-x border-brand-line bg-[rgba(var(--surface-rgb),0.86)] p-3.5 sm:grid-cols-3 sm:gap-3.5 sm:p-4"
        >
          <StatusCard label="配对" value={`${matchedCount}/${totalPairs}`} />
          <StatusCard label="得分" value={`${score}/100`} />
          <StatusCard
            label="用时"
            value={formatElapsedTime(elapsedSeconds)}
            variant="timer"
          />
          <div
            role="status"
            aria-live="polite"
            className="col-span-full flex min-h-13 items-center rounded-lg border border-brand-line bg-brand-message-bg p-3 text-brand-message-text font-bold leading-relaxed"
          >
            {message}
          </div>
        </section>

        {/* 配对区 */}
        <section className="grid overflow-hidden rounded-b-lg border border-brand-line border-t-0 bg-[rgba(var(--surface-rgb),0.84)] shadow-soft">
          <div className="min-w-0 bg-[rgba(var(--surface-rgb),0.94)] p-3.5 sm:p-4 xl:p-5">
            {quiz.total_pairs === 0 ? (
              <p className="leading-relaxed text-brand-text-soft">
                当前题库暂无题目，请联系管理员。
              </p>
            ) : (
              <>
                {/* 表头 */}
                <div className="mb-2 grid grid-cols-2 gap-2 text-xs font-black text-brand sm:gap-3">
                  <span className="border-b-[0.16rem] border-b-brand-accent pb-2">左侧</span>
                  <span className="border-b-[0.16rem] border-b-brand-accent pb-2">右侧</span>
                </div>

                {/* 配对表格 */}
                <div role="list" className="grid gap-2 sm:gap-2.5 xl:gap-2.5">
                  {leftItems.map((leftItem, index) => {
                    const rightItem = rightItems[index];
                    return (
                      <div
                        className="grid grid-cols-2 gap-2 sm:gap-3"
                        key={`${leftItem.uid}-${rightItem.uid}`}
                      >
                        <MatchCard
                          isMatched={matchedPairIds.has(leftItem.pairId)}
                          isSelected={selectedItem?.uid === leftItem.uid}
                          item={leftItem}
                          onClick={onCardClick}
                        />
                        <MatchCard
                          isMatched={matchedPairIds.has(rightItem.pairId)}
                          isSelected={selectedItem?.uid === rightItem.uid}
                          item={rightItem}
                          onClick={onCardClick}
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* 操作按钮区 */}
            <div className="mt-4 grid gap-2.5 sm:flex sm:justify-end">
              <Button variant="secondary" onClick={onResetGame}>
                重新随机排序
              </Button>
              <Button variant="secondary" onClick={onNavigateLeaderboard}>
                查看排行榜
              </Button>
              <Button
                disabled={isSubmitting || quiz.total_pairs === 0}
                onClick={onSubmitScore}
              >
                {isSubmitting ? "正在保存..." : "提交成绩"}
              </Button>
            </div>

            {lastResult && <ResultPanel result={lastResult} />}
          </div>
        </section>
      </section>
    </main>
  );
}

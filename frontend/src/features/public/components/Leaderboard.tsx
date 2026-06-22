import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatElapsedTime, formatSubmittedTime } from "../utils";
import type { LeaderboardEntry, QuizData } from "../types";
import { EmptyState } from "./Common";

/* ==================== LeaderboardTableRow ==================== */

interface LeaderboardTableRowProps {
  entry: LeaderboardEntry;
}

/**
 * 桌面端排行榜表格行。
 *
 * 仅在 sm(768px) 及以上断点显示。
 */
export function LeaderboardTableRow({ entry }: LeaderboardTableRowProps) {
  return (
    <div
      role="row"
      className="hidden grid-cols-[3.2rem_minmax(5rem,1.1fr)_minmax(5rem,0.9fr)_minmax(4rem,0.8fr)_4rem_4.5rem_5rem_minmax(8rem,1.2fr)] gap-3 items-center rounded-lg border border-brand-line bg-brand-surface p-2.5 sm:grid"
    >
      <span
        role="cell"
        className="grid h-8 w-8 place-items-center rounded-full bg-brand-accent-soft text-sm font-black text-brand"
      >
        {entry.rank}
      </span>
      <strong role="cell" className="overflow-hidden text-ellipsis whitespace-nowrap text-brand">
        {entry.student_name}
      </strong>
      <span role="cell" className="overflow-hidden text-ellipsis whitespace-nowrap">
        {entry.student_class}
      </span>
      <span role="cell" className="overflow-hidden text-ellipsis whitespace-nowrap">
        {entry.student_id}
      </span>
      <strong role="cell" className="text-lg text-brand-accent">
        {entry.score}
      </strong>
      <span role="cell">
        {entry.correct_count}/{entry.total_pairs}
      </span>
      <span role="cell">{formatElapsedTime(entry.elapsed_seconds)}</span>
      <span role="cell">{formatSubmittedTime(entry.submitted_at)}</span>
    </div>
  );
}

/* ==================== LeaderboardCard ==================== */

interface LeaderboardCardProps {
  entry: LeaderboardEntry;
}

/**
 * 移动端排行榜卡片。
 *
 * 仅在 sm(768px) 以下断点显示。
 */
export function LeaderboardCard({ entry }: LeaderboardCardProps) {
  return (
    <li className="grid gap-3 rounded-lg border border-brand-line bg-brand-surface p-3 sm:hidden">
      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] gap-2.5 items-center">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-accent-soft text-sm font-black text-brand">
          {entry.rank}
        </span>
        <div className="grid min-w-0 gap-0.5">
          <strong className="overflow-hidden text-ellipsis whitespace-nowrap">
            {entry.student_name}
          </strong>
          <small className="text-brand-text-soft">
            {entry.student_class} · {entry.student_id}
          </small>
        </div>
        <strong className="text-xl text-brand-accent">{entry.score}</strong>
      </div>
      <dl className="grid grid-cols-2 gap-2.5">
        <div>
          <dt className="text-xs font-black text-brand-text-soft">正确数</dt>
          <dd className="overflow-hidden text-ellipsis whitespace-nowrap font-bold text-brand">
            {entry.correct_count}/{entry.total_pairs}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-black text-brand-text-soft">用时</dt>
          <dd className="overflow-hidden text-ellipsis whitespace-nowrap font-bold text-brand">
            {formatElapsedTime(entry.elapsed_seconds)}
          </dd>
        </div>
        <div className="col-span-full">
          <dt className="text-xs font-black text-brand-text-soft">提交时间</dt>
          <dd className="overflow-hidden text-ellipsis whitespace-nowrap font-bold text-brand">
            {formatSubmittedTime(entry.submitted_at)}
          </dd>
        </div>
      </dl>
    </li>
  );
}

/* ==================== LeaderboardPanel ==================== */

interface LeaderboardPanelProps {
  entries: LeaderboardEntry[];
  isLoading: boolean;
}

/**
 * 排行榜内容面板。
 *
 * 双套 DOM 模式：移动端卡片列表 + 桌面端表格行，由 Tailwind sm: 断点控制显隐。
 * 加载/空状态有独立占位。
 */
export function LeaderboardPanel({ entries, isLoading }: LeaderboardPanelProps) {
  return (
    <section
      aria-label="排行榜"
      className="rounded-lg border border-brand-line bg-[rgba(var(--surface-rgb),0.92)] p-3.5 shadow-soft sm:p-4"
    >
      {isLoading ? (
        <div className="grid min-h-28 place-items-center text-brand-text-soft">
          正在加载排行榜...
        </div>
      ) : entries.length === 0 ? (
        <EmptyState className="rounded-lg border border-dashed border-brand-line-strong bg-brand-surface-muted p-4">
          暂无成绩，提交后会出现在这里。
        </EmptyState>
      ) : (
        <>
          {/* 桌面端表格 */}
          <div role="table" aria-label="排行榜" className="hidden gap-2 sm:grid">
            <div
              role="row"
              className="grid grid-cols-[3.2rem_minmax(5rem,1.1fr)_minmax(5rem,0.9fr)_minmax(4rem,0.8fr)_4rem_4.5rem_5rem_minmax(8rem,1.2fr)] gap-3 items-center rounded-lg border border-transparent bg-brand p-2.5 text-xs font-black text-brand-surface"
            >
              <span role="columnheader">排名</span>
              <span role="columnheader">学生</span>
              <span role="columnheader">班级</span>
              <span role="columnheader">学号</span>
              <span role="columnheader">分数</span>
              <span role="columnheader">正确数</span>
              <span role="columnheader">用时</span>
              <span role="columnheader">提交时间</span>
            </div>
            {entries.map((entry) => (
              <LeaderboardTableRow entry={entry} key={entry.id} />
            ))}
          </div>

          {/* 移动端卡片列表 */}
          <ol className="grid gap-3 list-none m-0 p-0 sm:hidden">
            {entries.map((entry) => (
              <LeaderboardCard entry={entry} key={entry.id} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/* ==================== LeaderboardPage ==================== */

interface LeaderboardPageProps {
  quiz: QuizData | null;
  entries: LeaderboardEntry[];
  isLoading: boolean;
  publicError: string;
  siteTitle: string;
  styleClass: string;
  onNavigateHome: () => void;
}

/**
 * 排行榜页面外壳。
 *
 * hero 渐变标题区 + 返回按钮 + 排行榜面板。
 * 桌面端 hero 为双列布局（标题 + 按钮），移动端单列。
 */
export function LeaderboardPage({
  quiz,
  entries,
  isLoading,
  publicError,
  siteTitle,
  styleClass,
  onNavigateHome,
}: LeaderboardPageProps) {
  if (isLoading && !quiz) {
    return (
      <main className="mx-auto w-[min(100%-1rem,80rem)] py-3 sm:w-[min(100%-2rem,80rem)]">
        <section className="grid min-h-48 place-items-center rounded-lg border border-brand-line bg-brand-surface p-5 text-center text-brand-text-soft">
          正在加载排行榜...
        </section>
      </main>
    );
  }

  if (publicError || !quiz) {
    return (
      <main className="mx-auto w-[min(100%-1rem,80rem)] py-3 sm:w-[min(100%-2rem,80rem)]">
        <section className="grid min-h-48 place-items-center rounded-lg border border-brand-line bg-brand-surface p-5 text-center text-brand-text-soft">
          {publicError || "排行榜数据不可用，请刷新页面重试。"}
        </section>
      </main>
    );
  }

  return (
    <main
      className={cn(
        "mx-auto w-[min(100%-1rem,80rem)] py-3 sm:w-[min(100%-2rem,80rem)] sm:py-5",
        styleClass,
      )}
    >
      <section className="grid gap-4">
        <header className="hero-gradient grid gap-4 rounded-lg p-4 text-brand-surface shadow-soft sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-5">
          <div>
            <p className="text-xs font-black tracking-wide text-brand-hero-accent">
              {quiz.question_bank.name}
            </p>
            <h1 className="font-serif text-4xl sm:text-[2.25rem]">
              {siteTitle}排行榜
            </h1>
            <p className="mt-1 leading-relaxed text-brand-hero-text">
              显示前 {quiz.question_bank.leaderboard_limit} 名，同分时用时更短排名更靠前。
            </p>
          </div>
          <Button variant="secondary" onClick={onNavigateHome}>
            返回答题
          </Button>
        </header>
        <LeaderboardPanel entries={entries} isLoading={isLoading} />
      </section>
    </main>
  );
}

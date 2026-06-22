import {cn} from "@/lib/utils";
import {FIELD_LIMITS} from "../constants";
import {formatElapsedTime} from "../utils";
import type {ScoreSubmissionResult, StudentForm} from "../types";

/* ==================== HomePage ==================== */

interface HomePageProps {
    isLoading: boolean;
}

/**
 * 无默认题库时的入口占位页。
 */
export function HomePage({isLoading}: HomePageProps) {
    return (
        <main className="grid min-h-screen place-items-center p-4">
            <section
                className="grid w-full max-w-md gap-4 rounded-lg border border-brand-line bg-brand-surface p-5 shadow-soft">
                <h1 className="font-serif text-4xl">
                    {isLoading ? "正在读取默认题库" : "尚未配置默认题库"}
                </h1>
                <p className="text-brand-text-soft">请进入后台创建题库，并设置主域名默认跳转题库。</p>
            </section>
        </main>
    );
}

/* ==================== LoadingPage ==================== */

interface LoadingPageProps {
    text: string;
}

/**
 * 加载/错误占位页。
 */
export function LoadingPage({text}: LoadingPageProps) {
    return (
        <main className="mx-auto w-[min(100%-1rem,94rem)] py-3">
            <section
                className="grid min-h-48 place-items-center rounded-lg border border-brand-line bg-brand-surface p-5 text-center text-brand-text-soft">
                {text}
            </section>
        </main>
    );
}

/* ==================== StatusCard ==================== */

interface StatusCardProps {
    label: string;
    value: string;
    variant?: "default" | "timer";
}

/**
 * 状态卡片：配对数 / 得分 / 用时。
 *
 * timer 变体使用强调色和等宽数字。
 */
export function StatusCard({label, value, variant = "default"}: StatusCardProps) {
    return (
        <div
            className={cn(
                "grid min-w-0 gap-0.5 rounded-lg border border-brand-line bg-brand-surface p-3",
            )}
        >
            <span className="text-xs font-black text-brand-text-soft">{label}</span>
            <strong
                className={cn(
                    "overflow-wrap-anywhere text-2xl leading-none",
                    variant === "timer"
                        ? "text-brand-accent tabular-nums"
                        : "text-brand",
                    "sm:text-[1.7rem]",
                )}
            >
                {value}
            </strong>
        </div>
    );
}

/* ==================== StudentFields ==================== */

interface StudentFieldsProps {
    form: StudentForm;
    onChange: (fieldName: keyof StudentForm, value: string) => void;
    variant?: "on-dark" | "on-light";
}

/**
 * 学生信息字段组：班级 / 学号 / 姓名。
 *
 * variant="on-dark" 用于深色 hero 背景上（答题页 header）；
 * variant="on-light" 用于浅色背景上（身份确认弹窗）。
 */
export function StudentFields({form, onChange, variant = "on-dark"}: StudentFieldsProps) {
    const labelClass =
        variant === "on-dark"
            ? "text-brand-hero-text text-xs font-bold"
            : "text-brand text-xs font-black";
    const inputClass =
        variant === "on-dark"
            ? "border-white/30 bg-[rgba(var(--surface-rgb),0.96)] shadow-[0_0.3rem_0.9rem_rgba(var(--focus-ring-rgb),0.14)]"
            : "border-brand-line-strong bg-brand-input-light";

    return (
        <>
            <label className="grid min-w-0 gap-1.5">
                <span className={labelClass}>班级</span>
                <input
                    className={cn(
                        "w-full rounded-lg border px-3 py-2.5 outline-none",
                        "focus-visible:outline-[0.18rem_solid_rgba(var(--focus-ring-rgb),0.36)]",
                        inputClass,
                    )}
                    value={form.studentClass}
                    maxLength={FIELD_LIMITS.studentClass}
                    onChange={(e) => onChange("studentClass", e.target.value)}
                    placeholder="例如：一班"
                />
            </label>
            <label className="grid min-w-0 gap-1.5">
                <span className={labelClass}>学号</span>
                <input
                    className={cn(
                        "w-full rounded-lg border px-3 py-2.5 outline-none",
                        "focus-visible:outline-[0.18rem_solid_rgba(var(--focus-ring-rgb),0.36)]",
                        inputClass,
                    )}
                    value={form.studentId}
                    inputMode="numeric"
                    maxLength={FIELD_LIMITS.studentId}
                    onChange={(e) => onChange("studentId", e.target.value)}
                    placeholder="例如：001234567"
                />
            </label>
            <label className="grid min-w-0 gap-1.5">
                <span className={labelClass}>姓名</span>
                <input
                    className={cn(
                        "w-full rounded-lg border px-3 py-2.5 outline-none",
                        "focus-visible:outline-[0.18rem_solid_rgba(var(--focus-ring-rgb),0.36)]",
                        inputClass,
                    )}
                    value={form.studentName}
                    maxLength={FIELD_LIMITS.studentName}
                    onChange={(e) => onChange("studentName", e.target.value)}
                    placeholder="例如：张三"
                />
            </label>
        </>
    );
}

/* ==================== ResultPanel ==================== */

interface ResultPanelProps {
    result: ScoreSubmissionResult;
}

/**
 * 提交结果展示面板。
 *
 * 三列布局：本次记录 / 学生信息 / 成绩详情。
 */
export function ResultPanel({result}: ResultPanelProps) {
    const {record} = result;
    return (
        <section
            className="mt-4 grid gap-2.5 rounded-lg border border-brand-line border-l-[0.32rem] border-l-brand-accent bg-brand-surface-muted p-3.5 sm:grid-cols-3">
            <div className="grid min-w-0 gap-1">
                <span className="text-xs font-black text-brand-text-soft">本次记录</span>
                <strong className="overflow-wrap-anywhere text-brand">
                    {result.saved_as_best ? "已计入最佳成绩" : "未超过最佳成绩"}
                </strong>
            </div>
            <div className="grid min-w-0 gap-1">
                <span className="text-xs font-black text-brand-text-soft">学生</span>
                <strong className="overflow-wrap-anywhere text-brand">
                    {record.student_class} · {record.student_name} · {record.student_id}
                </strong>
            </div>
            <div className="grid min-w-0 gap-1">
                <span className="text-xs font-black text-brand-text-soft">成绩</span>
                <strong className="overflow-wrap-anywhere text-brand">
                    {record.correct_count}/{record.total_pairs} · {record.score} 分 ·{" "}
                    {formatElapsedTime(record.elapsed_seconds)}
                </strong>
            </div>
        </section>
    );
}

/* ==================== EmptyState ==================== */

interface EmptyStateProps {
    children: React.ReactNode;
    className?: string;
}

/**
 * 空状态提示。
 */
export function EmptyState({children, className}: EmptyStateProps) {
    return (
        <p className={cn("text-brand-text-soft leading-relaxed", className)}>
            {children}
        </p>
    );
}

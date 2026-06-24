/**
 * 后台概览仪表盘
 *
 * 替代原 react-admin Dashboard.tsx。
 * 4 指标卡 + ECharts 7天提交趋势折线统计图。
 * 使用 useThemeMode 替代 RA useTheme 驱动 ECharts 配色。
 * echarts-for-react 改为 lazy import 减小公开端 bundle 体积。
 */

import { lazy, Suspense, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle,
  HelpCircle,
  LayoutDashboard,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useThemeMode } from "@/lib/theme";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchOverview, fetchSubmissionTrend, fetchQuestionBanks } from "./api";
import type {
  SubmissionTrendResponse,
  QuestionBank,
} from "./types";

const ReactECharts = lazy(() => import("echarts-for-react"));

/** ECharts 渲染配置（模块级常量，避免每次渲染创建新对象触发组件重建） */
const CHART_OPTS = { renderer: "canvas" as const };

/** 趋势图主题：避免暗色模式下出现低对比或过亮的默认色。 */
const CHART_THEMES = {
  light: {
    colors: ["#0284c7", "#d97706", "#059669", "#dc2626", "#ea580c", "#0d9488", "#65a30d"],
    text: "#52525b",
    axis: "#d4d4d8",
    split: "#e5e7eb",
    tooltipBg: "#ffffff",
    tooltipBorder: "#d4d4d8",
  },
  dark: {
    colors: ["#22d3ee", "#fbbf24", "#34d399", "#fb7185", "#fdba74", "#2dd4bf", "#a3e635"],
    text: "#cbd5e1",
    axis: "#52525b",
    split: "#27272a",
    tooltipBg: "#0f172a",
    tooltipBorder: "#334155",
  },
} as const;

/** 指标卡 */
function MetricCard({
  icon: Icon,
  label,
  value,
  description,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  description: string;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { theme } = useThemeMode();
  const isDark = theme === "dark";
  const [bankFilter, setBankFilter] = useState<string>("");

  /** 概览统计 */
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: fetchOverview,
  });

  /** 题库列表（筛选下拉用） */
  const { data: banksData } = useQuery({
    queryKey: ["admin-banks-for-filter"],
    queryFn: () => fetchQuestionBanks({ limit: 100, offset: 0 }),
  });

  /** 7天提交趋势 */
  const {
    data: trend,
    isLoading: trendLoading,
    isError: trendIsError,
    error: trendError,
  } = useQuery({
    queryKey: ["admin-trend", bankFilter],
    queryFn: () => fetchSubmissionTrend(bankFilter || undefined),
  });

  const banks: QuestionBank[] = banksData?.entries ?? [];
  const trendData: SubmissionTrendResponse | undefined = trend;
  const hasTrendSeries = (trendData?.series?.length ?? 0) > 0;
  const trendErrorMessage =
    trendError instanceof Error ? trendError.message : "提交趋势读取失败";
  const chartTheme = isDark ? CHART_THEMES.dark : CHART_THEMES.light;

  /** ECharts 配置（useMemo 避免每次渲染重建对象） */
  const chartOption = useMemo(
    () => ({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line" },
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: chartTheme.text },
      },
      legend: {
        type: "scroll",
        top: 0,
        data: trendData?.series?.map((b) => b.bank_name) ?? [],
        textStyle: { color: chartTheme.text },
        pageTextStyle: { color: chartTheme.text },
      },
      grid: {
        left: "3%",
        right: "4%",
        top: 48,
        bottom: "3%",
        containLabel: true,
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: trendData?.dates ?? [],
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisTick: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { color: chartTheme.text },
      },
      yAxis: {
        type: "value",
        min: 0,
        minInterval: 1,
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisTick: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { color: chartTheme.text },
        splitLine: { lineStyle: { color: chartTheme.split } },
      },
      series:
        trendData?.series?.map((bank, i) => ({
          name: bank.bank_name,
          type: "line",
          smooth: false,
          symbol: "circle",
          symbolSize: 6,
          showSymbol: true,
          data: bank.data,
          lineStyle: {
            width: 2,
            color: chartTheme.colors[i % chartTheme.colors.length],
          },
          itemStyle: { color: chartTheme.colors[i % chartTheme.colors.length] },
          emphasis: { focus: "series" },
        })) ?? [],
    }),
    [trendData, chartTheme],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">概览</h1>
        </div>
        <Select
          value={bankFilter || "all"}
          onValueChange={(v) => setBankFilter(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="全部题库" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部题库</SelectItem>
            {banks.map((bank) => (
              <SelectItem key={bank.id} value={String(bank.id)}>
                {bank.name}
                {!bank.is_active ? "（停用）" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 指标卡 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={BookOpen}
          label="题库总数"
          value={stats?.bank_count ?? 0}
          description="所有题库"
          loading={statsLoading}
        />
        <MetricCard
          icon={CheckCircle}
          label="启用题库"
          value={stats?.active_bank_count ?? 0}
          description="当前可用题库"
          loading={statsLoading}
        />
        <MetricCard
          icon={HelpCircle}
          label="题目总数"
          value={stats?.total_question_count ?? 0}
          description="所有题库题目"
          loading={statsLoading}
        />
        <MetricCard
          icon={TrendingUp}
          label="7天提交数"
          value={stats?.submission_count_7d ?? 0}
          description="近7天成绩提交"
          loading={statsLoading}
        />
      </div>

      {/* 趋势图 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">7天提交趋势</CardTitle>
        </CardHeader>
        <CardContent>
          {trendLoading ? (
            <Skeleton className="h-[340px] w-full" />
          ) : trendIsError ? (
            <div className="grid h-[340px] place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
              {trendErrorMessage}
            </div>
          ) : !hasTrendSeries ? (
            <div className="grid h-[340px] place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
              暂无趋势数据
            </div>
          ) : (
            <Suspense fallback={<Skeleton className="h-[340px] w-full" />}>
              <ReactECharts
                option={chartOption}
                notMerge
                style={{ height: "340px", width: "100%" }}
                opts={CHART_OPTS}
              />
            </Suspense>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

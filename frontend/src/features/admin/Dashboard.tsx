/**
 * 后台概览仪表盘
 *
 * 替代原 react-admin Dashboard.tsx。
 * 4 指标卡 + ECharts 7天提交趋势堆叠柱状图。
 * 使用 useThemeMode 替代 RA useTheme 驱动 ECharts 配色。
 * echarts-for-react 改为 lazy import 减小公开端 bundle 体积。
 */

import { lazy, Suspense, useEffect, useState } from "react";
import {
  BookOpen,
  CheckCircle,
  HelpCircle,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useThemeMode } from "@/lib/theme";
import { httpClient, apiUrl } from "@/lib/http-client";
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
  AdminOverviewStats,
  SubmissionTrendResponse,
  QuestionBank,
} from "./types";

const ReactECharts = lazy(() => import("echarts-for-react"));

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
  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ["admin-trend", bankFilter],
    queryFn: () => fetchSubmissionTrend(bankFilter || undefined),
  });

  const banks: QuestionBank[] = banksData?.entries ?? [];
  const trendData: SubmissionTrendResponse | undefined = trend;

  /** ECharts 配置 */
  const chartOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    legend: {
      data: trendData?.series?.map((b) => b.bank_name) ?? [],
      textStyle: { color: isDark ? "#a1a1aa" : "#666" },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: trendData?.dates ?? [],
      axisLine: { lineStyle: { color: isDark ? "#3f3f46" : "#ddd" } },
      axisLabel: { color: isDark ? "#a1a1aa" : "#666" },
    },
    yAxis: {
      type: "value",
      axisLine: { lineStyle: { color: isDark ? "#3f3f46" : "#ddd" } },
      axisLabel: { color: isDark ? "#a1a1aa" : "#666" },
      splitLine: { lineStyle: { color: isDark ? "#27272a" : "#eee" } },
    },
    series:
      trendData?.series?.map((bank, i) => ({
        name: bank.bank_name,
        type: "bar",
        stack: "total",
        data: bank.data,
        itemStyle: {
          color: [
            "#0070f3",
            "#7928ca",
            "#f5a623",
            "#30a46c",
            "#e5484d",
            "#f81ce5",
            "#50e3c2",
          ][i % 7],
        },
      })) ?? [],
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">概览</h1>
        <Select value={bankFilter || "all"} onValueChange={setBankFilter}>
          <SelectTrigger className="w-48">
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
          ) : (
            <Suspense fallback={<Skeleton className="h-[340px] w-full" />}>
              <ReactECharts
                option={chartOption}
                style={{ height: "340px", width: "100%" }}
                opts={{ renderer: "canvas" }}
              />
            </Suspense>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

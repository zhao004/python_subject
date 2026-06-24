/**
 * 系统设置页
 *
 * 替代原 react-admin SettingsPage.tsx。
 * 默认题库下拉选择 + 保存。
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, CheckCircle2, Save, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchSiteSettings, updateSiteSettings, fetchQuestionBanks } from "./api";
import type { QuestionBank } from "./types";

const NO_DEFAULT_BANK_VALUE = "none";

/** 根据题库 ID 查找题库，接口数据缺失时返回 null，由界面展示兜底状态。 */
function findBankById(banks: QuestionBank[], bankId: number | null): QuestionBank | null {
  if (bankId == null) {
    return null;
  }
  return banks.find((bank) => bank.id === bankId) ?? null;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [selectedBankId, setSelectedBankId] = useState<string>(NO_DEFAULT_BANK_VALUE);

  /** 加载站点设置 */
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["admin-site-settings"],
    queryFn: fetchSiteSettings,
  });

  /** 加载题库列表 */
  const { data: banksData } = useQuery({
    queryKey: ["admin-banks-for-settings"],
    queryFn: () => fetchQuestionBanks({ limit: 100, offset: 0 }),
  });

  /** 设置加载后填充选中值 */
  useEffect(() => {
    if (settings) {
      setSelectedBankId(
        settings.default_question_bank_id != null
          ? String(settings.default_question_bank_id)
          : NO_DEFAULT_BANK_VALUE,
      );
    }
  }, [settings]);

  const banks = banksData?.entries ?? [];
  const selectedBank = findBankById(
    banks,
    selectedBankId === NO_DEFAULT_BANK_VALUE ? null : Number(selectedBankId),
  );
  const currentDefaultBank = findBankById(banks, settings?.default_question_bank_id ?? null);
  const activeBankCount = banks.filter((bank) => bank.is_active).length;
  const hasDeletedDefaultBank =
    settings?.default_question_bank_id != null && currentDefaultBank === null;
  const currentDefaultLabel =
    settings?.default_question_bank_id == null
      ? "未设置"
      : currentDefaultBank?.name ?? "题库不存在或已删除";
  const currentDefaultSlug =
    settings?.default_question_bank_slug ?? currentDefaultBank?.slug ?? "-";
  const selectedBankStatus =
    selectedBankId === NO_DEFAULT_BANK_VALUE
      ? "用户访问首页时显示占位页面"
      : selectedBank
        ? selectedBank.is_active
          ? "用户访问首页时将跳转到该题库"
          : "该题库已停用，建议启用后再设为默认"
        : "当前选择不在题库列表中，请重新选择";

  /** 保存 mutation */
  const saveMutation = useMutation({
    mutationFn: () => {
      if (
        selectedBankId !== NO_DEFAULT_BANK_VALUE &&
        !banks.some((bank) => String(bank.id) === selectedBankId)
      ) {
        throw new Error("默认题库选择无效，请重新选择");
      }
      const bankId =
        selectedBankId === NO_DEFAULT_BANK_VALUE
          ? null
          : Number(selectedBankId);
      return updateSiteSettings({ default_question_bank_id: bankId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-site-settings"] });
      toast.success("设置已保存");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (settingsLoading) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">系统设置</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">默认题库</CardTitle>
            <CardDescription>
              配置用户访问站点首页时优先进入的题库。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="default-question-bank" className="text-sm font-medium">
                默认题库
              </label>
              <Select value={selectedBankId} onValueChange={setSelectedBankId}>
                <SelectTrigger id="default-question-bank">
                  <SelectValue placeholder="选择默认题库" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NO_DEFAULT_BANK_VALUE}>无默认题库</SelectItem>
                    {banks.map((bank) => (
                      <SelectItem key={bank.id} value={String(bank.id)}>
                        {bank.name}
                        {!bank.is_active ? "（停用）" : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">{selectedBankStatus}</p>
            </div>

            <Alert variant="info">
              <AlertDescription>
                默认题库只影响用户访问首页时的跳转目标，不会改变题库自身的启用状态或公开地址。
              </AlertDescription>
            </Alert>

            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                保存后，新访问首页的用户会立即使用最新配置。
              </p>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="sm:w-auto"
              >
                <Save className="mr-2 h-4 w-4" />
                {saveMutation.isPending ? "保存中..." : "保存设置"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">当前状态</CardTitle>
            </div>
            <CardDescription>
              用于核对首页跳转配置是否符合预期。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">默认题库</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {currentDefaultLabel}
                </p>
              </div>
              <Badge variant={settings?.default_question_bank_id == null ? "secondary" : "outline"}>
                {settings?.default_question_bank_id == null ? "未设置" : "已设置"}
              </Badge>
            </div>

            <div className="flex flex-col gap-3">
              <StatusRow label="公开标识" value={currentDefaultSlug} mono />
              <StatusRow label="可选题库" value={`${banks.length} 个`} />
              <StatusRow label="启用题库" value={`${activeBankCount} 个`} />
            </div>

            {hasDeletedDefaultBank ? (
              <Alert variant="destructive">
                <AlertDescription>
                  当前默认题库 ID 已不存在，请重新选择一个有效题库并保存。
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex items-start gap-2 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>配置保存成功后，公开首页会按当前默认题库规则处理访问。</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** 状态摘要中的键值行，长标识使用等宽字体便于核对。 */
function StatusRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 truncate text-right ${mono ? "font-mono text-xs" : "font-medium"}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * 系统设置页
 *
 * 替代原 react-admin SettingsPage.tsx。
 * 默认题库下拉选择 + 保存。
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchSiteSettings, updateSiteSettings, fetchQuestionBanks } from "./api";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [selectedBankId, setSelectedBankId] = useState<string>("none");

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
          : "none",
      );
    }
  }, [settings]);

  const banks = banksData?.entries ?? [];

  /** 保存 mutation */
  const saveMutation = useMutation({
    mutationFn: () => {
      const bankId =
        selectedBankId === "none"
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
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">系统设置</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">默认题库</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">默认题库</label>
            <Select value={selectedBankId} onValueChange={setSelectedBankId}>
              <SelectTrigger>
                <SelectValue placeholder="选择默认题库" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">无默认题库</SelectItem>
                {banks.map((bank) => (
                  <SelectItem key={bank.id} value={String(bank.id)}>
                    {bank.name}
                    {!bank.is_active ? "（停用）" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Alert variant="info">
            <AlertDescription>
              默认题库为用户访问首页时自动跳转的题库。选择"无"则显示占位页面。
            </AlertDescription>
          </Alert>

          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "保存中..." : "保存设置"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

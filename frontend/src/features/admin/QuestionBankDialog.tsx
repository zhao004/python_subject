/**
 * 题库编辑/创建弹窗（仅基本信息）
 *
 * 由 QuestionBanksList 以 Dialog 形式调用，不再跳转独立页面。
 * 题目配对编辑已移至独立的 QuestionItemsPage 页面。
 * 编辑模式下 items 字段保留原值原样提交，避免覆盖题目数据。
 */

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  fetchQuestionBank,
  createQuestionBank,
  updateQuestionBank,
  fetchRandomSlug,
} from "./api";
import type {
  QuestionBank,
  QuestionBankPayload,
  SubmissionStyleKey,
} from "./types";

/** 提交样式选项 */
const STYLE_CHOICES: { value: SubmissionStyleKey; label: string }[] = [
  { value: "classic", label: "经典" },
  { value: "slate", label: "板岩" },
  { value: "paper", label: "纸张" },
];

/** 表单值类型（items 保留用于整体提交，不在弹窗中编辑） */
interface BankFormValues {
  name: string;
  slug: string;
  description: string;
  is_active: boolean;
  leaderboard_limit: number;
  submission_style: SubmissionStyleKey;
  items: { left_text: string; right_text: string }[];
}

/** 空表单默认值（新建时 items 为空数组） */
const DEFAULT_VALUES: BankFormValues = {
  name: "",
  slug: "",
  description: "",
  is_active: true,
  leaderboard_limit: 10,
  submission_style: "classic",
  items: [],
};

/** 将题库数据转为表单值 */
function bankToForm(bank: QuestionBank): BankFormValues {
  return {
    name: bank.name,
    slug: bank.slug,
    description: bank.description ?? "",
    is_active: bank.is_active,
    leaderboard_limit: bank.leaderboard_limit,
    submission_style: bank.submission_style,
    items:
      (bank.items ?? []).length > 0
        ? (bank.items ?? []).map((item) => ({
            left_text: item.left_text,
            right_text: item.right_text,
          }))
        : [{ left_text: "", right_text: "" }],
  };
}

/** 过滤空行并转换为提交载荷 */
function transformPayload(values: BankFormValues): QuestionBankPayload {
  return {
    name: values.name.trim(),
    slug: values.slug.trim(),
    description: values.description.trim(),
    is_active: values.is_active,
    leaderboard_limit: Number(values.leaderboard_limit),
    submission_style: values.submission_style,
    items: values.items
      .map((item) => ({
        left_text: item.left_text.trim(),
        right_text: item.right_text.trim(),
      }))
      .filter((item) => item.left_text && item.right_text),
  };
}

interface QuestionBankDialogProps {
  /** 传入题库 ID 时为编辑模式，否则为新建模式 */
  bankId: number | string | null;
  open: boolean;
  /** 关闭弹窗回调 */
  onOpenChange: (open: boolean) => void;
}

export default function QuestionBankDialog({
  bankId,
  open,
  onOpenChange,
}: QuestionBankDialogProps) {
  const isEdit = bankId !== null;
  const queryClient = useQueryClient();

  /** 编辑模式：加载题库数据 */
  const { data: bank, isLoading } = useQuery({
    queryKey: ["admin-question-bank", bankId],
    queryFn: () => fetchQuestionBank(bankId!),
    enabled: isEdit && open,
  });

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<BankFormValues>({
    defaultValues: DEFAULT_VALUES,
  });

  /** 编辑模式：数据加载后填充表单；新建模式：弹窗打开时重置为默认值 */
  useEffect(() => {
    if (!open) return;
    if (bank) {
      reset(bankToForm(bank));
    } else {
      reset(DEFAULT_VALUES);
    }
  }, [bank, reset, open]);

  /** 创建/更新 mutation */
  const mutation = useMutation({
    mutationFn: async (values: BankFormValues) => {
      const payload = transformPayload(values);
      if (isEdit && bankId !== null) {
        return updateQuestionBank(bankId, payload);
      }
      return createQuestionBank(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-question-banks"] });
      queryClient.invalidateQueries({ queryKey: ["admin-banks-for-filter"] });
      queryClient.invalidateQueries({ queryKey: ["admin-banks-for-settings"] });
      toast.success(isEdit ? "题库已更新" : "题库已创建");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "操作失败");
    },
  });

  /** 随机 slug 生成 */
  const handleGenerateSlug = async () => {
    try {
      const result = await fetchRandomSlug();
      setValue("slug", result.slug);
      toast.success("已生成随机标识");
    } catch (err) {
      toast.error((err as Error).message || "生成失败");
    }
  };

  const slugValue = watch("slug");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑题库" : "新建题库"}</DialogTitle>
        </DialogHeader>

        {isEdit && isLoading ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <form
            onSubmit={handleSubmit((values) => mutation.mutate(values))}
            className="space-y-6"
          >
            {/* 基本信息 */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">基本信息</h3>

              <div className="space-y-2">
                <Label htmlFor="name">名称 *</Label>
                <Input
                  id="name"
                  {...register("name", { required: "请输入题库名称" })}
                  placeholder="题库名称"
                />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">标识 *</Label>
                <div className="flex gap-2">
                  <Input
                    id="slug"
                    {...register("slug", { required: "请输入题库标识" })}
                    placeholder="URL 标识"
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" onClick={handleGenerateSlug}>
                    <Wand2 className="mr-2 h-4 w-4" />
                    随机生成
                  </Button>
                </div>
                {errors.slug && (
                  <p className="text-sm text-destructive">{errors.slug.message}</p>
                )}
                {slugValue && (
                  <p className="text-xs text-muted-foreground">
                    访问地址：/b/{slugValue}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">描述</Label>
                <Textarea
                  id="description"
                  {...register("description")}
                  placeholder="题库描述（选填）"
                  rows={2}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="leaderboard_limit">排行榜上限</Label>
                  <Input
                    id="leaderboard_limit"
                    type="number"
                    min={1}
                    max={100}
                    {...register("leaderboard_limit", {
                      valueAsNumber: true,
                      min: { value: 1, message: "最小为 1" },
                      max: { value: 100, message: "最大为 100" },
                    })}
                  />
                  {errors.leaderboard_limit && (
                    <p className="text-sm text-destructive">
                      {errors.leaderboard_limit.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>提交样式</Label>
                  <Controller
                    control={control}
                    name="submission_style"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STYLE_CHOICES.map((choice) => (
                            <SelectItem key={choice.value} value={choice.value}>
                              {choice.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Controller
                  control={control}
                  name="is_active"
                  render={({ field }) => (
                    <Checkbox
                      id="is_active"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
                <Label htmlFor="is_active" className="cursor-pointer text-sm font-normal">
                  启用此题库
                </Label>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "保存中..." : isEdit ? "保存" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
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
import { buildPublicQuizUrl } from "@/features/public/links";
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

/** 主题风格选项 */
const STYLE_CHOICES: { value: SubmissionStyleKey; label: string }[] = [
  { value: "classic", label: "经典风格" },
  { value: "slate", label: "板岩风格" },
  { value: "paper", label: "纸张风格" },
];

/** 默认主题风格，接口返回缺失值或历史脏值时使用。 */
const DEFAULT_SUBMISSION_STYLE: SubmissionStyleKey = "classic";

/** 有效主题风格值集合，用于校验后端返回值。 */
const VALID_STYLES = new Set<SubmissionStyleKey>(STYLE_CHOICES.map((c) => c.value));
const INVALID_STYLE_MESSAGE = "主题风格设置无效，请重新选择";

/** 表单值类型（items 保留用于整体提交，不在弹窗中编辑） */
interface BankFormValues {
  name: string;
  slug: string;
  description: string;
  announcement: string;
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
  announcement: "",
  is_active: true,
  leaderboard_limit: 10,
  submission_style: DEFAULT_SUBMISSION_STYLE,
  items: [],
};

/** 解析主题风格，非法值返回 null，避免保存时静默覆盖为经典风格。 */
function parseSubmissionStyle(value: unknown): SubmissionStyleKey | null {
  if (typeof value === "string" && VALID_STYLES.has(value as SubmissionStyleKey)) {
    return value as SubmissionStyleKey;
  }
  return null;
}

/** 归一化主题风格，仅用于 Select 展示，保存链路必须走严格校验。 */
function normalizeSubmissionStyle(value: unknown): SubmissionStyleKey {
  const parsedStyle = parseSubmissionStyle(value);
  if (parsedStyle) {
    return parsedStyle;
  }
  return DEFAULT_SUBMISSION_STYLE;
}

/** 保存前严格校验主题风格，避免异常值被默认值吞掉。 */
function requireSubmissionStyle(value: unknown): SubmissionStyleKey {
  const parsedStyle = parseSubmissionStyle(value);
  if (!parsedStyle) {
    throw new Error(INVALID_STYLE_MESSAGE);
  }
  return parsedStyle;
}

/** 将题库数据转为表单值 */
function bankToForm(bank: QuestionBank): BankFormValues {
  return {
    name: bank.name,
    slug: bank.slug,
    description: bank.description ?? "",
    announcement: bank.announcement ?? "",
    is_active: bank.is_active,
    leaderboard_limit: bank.leaderboard_limit,
    // 防御性处理：后端或缓存可能返回空字符串、缺失值或不在选项中的历史旧值。
    submission_style: normalizeSubmissionStyle(bank.submission_style),
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
    announcement: values.announcement.trim(),
    is_active: values.is_active,
    leaderboard_limit: Number(values.leaderboard_limit),
    submission_style: requireSubmissionStyle(values.submission_style),
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
  const { data: bank, isLoading, isError, error } = useQuery({
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
    setError,
    clearErrors,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<BankFormValues>({
    defaultValues: DEFAULT_VALUES,
  });

  /** 编辑模式：数据加载后填充表单；新建模式：弹窗打开时重置为默认值 */
  useEffect(() => {
    if (!open) return;
    if (!isEdit) {
      reset(DEFAULT_VALUES);
      return;
    }
    if (bank) {
      reset(bankToForm(bank));
      if (!parseSubmissionStyle(bank.submission_style)) {
        setError("submission_style", {
          type: "validate",
          message: "题库主题风格数据异常，请重新选择并保存",
        });
      }
    }
  }, [bank, isEdit, reset, setError, open]);

  /** 创建/更新 mutation */
  const mutation = useMutation({
    mutationFn: async (values: BankFormValues) => {
      const payload = transformPayload(values);
      const response =
        isEdit && bankId !== null
          ? await updateQuestionBank(bankId, payload)
          : await createQuestionBank(payload);
      if (parseSubmissionStyle(response.submission_style) !== payload.submission_style) {
        throw new Error("主题风格未保存成功，请刷新页面后重试");
      }
      const confirmedBank = await fetchQuestionBank(response.id);
      if (parseSubmissionStyle(confirmedBank.submission_style) !== payload.submission_style) {
        throw new Error("主题风格未保存成功，请刷新页面后重试");
      }
      return confirmedBank;
    },
    onSuccess: (data) => {
      const normalizedData = {
        ...data,
        announcement: data.announcement ?? "",
        submission_style: normalizeSubmissionStyle(data.submission_style),
      };
      if (isEdit && bankId !== null) {
        queryClient.setQueryData(["admin-question-bank", bankId], normalizedData);
        queryClient.invalidateQueries({ queryKey: ["admin-question-bank", bankId] });
      }
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
  const previewUrl = slugValue ? buildPublicQuizUrl(slugValue) : "";
  const isSaving = isSubmitting || mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑题库" : "新建题库"}</DialogTitle>
        </DialogHeader>

        {isEdit && isError ? (
          <div className="py-4 text-sm text-destructive">
            {error instanceof Error ? error.message : "题库加载失败，请关闭后重试"}
          </div>
        ) : isEdit && (isLoading || !bank) ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <form
            onSubmit={handleSubmit(async (values) => {
              try {
                await mutation.mutateAsync(values);
              } catch {
                // mutation.onError 已统一给出用户提示，这里只阻止未处理的 Promise 拒绝。
              }
            })}
            className="space-y-6"
          >
            <div className="rounded-lg border bg-muted/30 px-4 py-3">
              <Controller
                control={control}
                name="is_active"
                render={({ field }) => (
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">启用此题库</Label>
                      <p className="text-xs text-muted-foreground">
                        {field.value ? "当前已启用" : "当前已停用"}
                      </p>
                    </div>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      aria-label="启用此题库"
                    />
                  </div>
                )}
              />
            </div>

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
                    访问地址：{previewUrl}
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
                  <Label>主题风格</Label>
                  <Controller
                    control={control}
                    name="submission_style"
                    rules={{
                      validate: (value) =>
                        parseSubmissionStyle(value) ? true : INVALID_STYLE_MESSAGE,
                    }}
                    render={({ field }) => (
                      <Select
                        value={normalizeSubmissionStyle(field.value)}
                        onValueChange={(value) => {
                          const nextStyle = parseSubmissionStyle(value);
                          if (!nextStyle) {
                            setError("submission_style", {
                              type: "validate",
                              message: INVALID_STYLE_MESSAGE,
                            });
                            return;
                          }
                          setValue("submission_style", nextStyle, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                          clearErrors("submission_style");
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="请选择主题风格" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {STYLE_CHOICES.map((choice) => (
                              <SelectItem key={choice.value} value={choice.value}>
                                {choice.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.submission_style && (
                    <p className="text-sm text-destructive">
                      {errors.submission_style.message}
                    </p>
                  )}
                </div>
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
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "保存中..." : isEdit ? "保存" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

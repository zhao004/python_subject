/**
 * 题目管理页（独立页面，展开模式 + 表格展示）
 *
 * 从题库编辑弹窗中拆分出来，单独管理某题库的题目配对。
 * 后端 PUT /api/admin/question-banks/{id} 为整体替换，
 * 因此保存时需携带题库基本信息 + 修改后的 items。
 *
 * 功能：
 * - 表格展示题目配对，行内可编辑左右文本
 * - 批量删除：勾选多行后一次性删除
 * - 批量添加：textarea 批量输入，每行一组，内容对以空格或竖线 | 分隔
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useFieldArray, useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchQuestionBank, updateQuestionBank } from "./api";
import type { QuestionBank, QuestionBankPayload } from "./types";

/** 表单值类型（仅 items，保存时与基本信息合并） */
interface ItemsFormValues {
  items: { left_text: string; right_text: string }[];
}

/** 空表单默认值 */
const DEFAULT_VALUES: ItemsFormValues = {
  items: [{ left_text: "", right_text: "" }],
};

/** 批量添加解析结果项 */
interface ParsedItem {
  left_text: string;
  right_text: string;
}

/** 批量添加解析失败的行号集合 */
interface ParseResult {
  items: ParsedItem[];
  failedLines: number[];
}

/**
 * 解析单行批量输入文本，提取左右配对内容。
 *
 * 解析规则（按优先级）：
 * 1. 优先以竖线 `|` 作为分隔符，取第一个竖线左右两侧。
 * 2. 无竖线时以首个空白字符（空格/制表符）作为分隔符。
 * 3. 无法拆出两个非空部分则视为解析失败。
 */
function parseBatchLine(line: string): ParsedItem | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // 优先竖线分隔
  const pipeIdx = trimmed.indexOf("|");
  if (pipeIdx > 0) {
    const left = trimmed.slice(0, pipeIdx).trim();
    const right = trimmed.slice(pipeIdx + 1).trim();
    if (left && right) return { left_text: left, right_text: right };
  }

  // 回退到首个空白分隔
  const match = trimmed.match(/^(\S+)\s+(.+)$/);
  if (match) {
    const left = match[1].trim();
    const right = match[2].trim();
    if (left && right) return { left_text: left, right_text: right };
  }

  return null;
}

/**
 * 解析批量添加文本框内容，返回成功项和失败行号（从 1 开始）。
 */
function parseBatchText(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const items: ParsedItem[] = [];
  const failedLines: number[] = [];

  lines.forEach((line, idx) => {
    if (line.trim() === "") return; // 空行跳过，不计入失败
    const parsed = parseBatchLine(line);
    if (parsed) {
      items.push(parsed);
    } else {
      failedLines.push(idx + 1);
    }
  });

  return { items, failedLines };
}

/** 将题库 items 转为表单值 */
function bankToItemsForm(bank: QuestionBank): ItemsFormValues {
  const items = bank.items ?? [];
  return {
    items:
      items.length > 0
        ? items.map((item) => ({
            left_text: item.left_text,
            right_text: item.right_text,
          }))
        : [{ left_text: "", right_text: "" }],
  };
}

/** 过滤空行，并与题库基本信息合并为完整提交载荷 */
function buildPayload(
  bank: QuestionBank,
  values: ItemsFormValues,
): QuestionBankPayload {
  return {
    name: bank.name,
    slug: bank.slug,
    description: bank.description ?? "",
    announcement: bank.announcement ?? "",
    is_active: bank.is_active,
    leaderboard_limit: bank.leaderboard_limit,
    submission_style: bank.submission_style,
    items: values.items
      .map((item) => ({
        left_text: item.left_text.trim(),
        right_text: item.right_text.trim(),
      }))
      .filter((item) => item.left_text && item.right_text),
  };
}

export default function QuestionItemsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: bank, isLoading } = useQuery({
    queryKey: ["admin-question-bank", id],
    queryFn: () => fetchQuestionBank(id!),
    enabled: Boolean(id),
  });

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<ItemsFormValues>({
    defaultValues: DEFAULT_VALUES,
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  /** 选中行的索引集合（基于 useFieldArray 的 index） */
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  /** 批量添加文本 */
  const [batchText, setBatchText] = useState("");
  /** 批量添加弹窗开关 */
  const [batchAddOpen, setBatchAddOpen] = useState(false);
  /** 批量删除确认弹窗开关 */
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

  /** 数据加载后填充表单 */
  useEffect(() => {
    if (bank) {
      reset(bankToItemsForm(bank));
      setSelectedIndices(new Set());
    }
  }, [bank, reset]);

  /** 保存 mutation */
  const mutation = useMutation({
    mutationFn: async (values: ItemsFormValues) => {
      if (!bank) throw new Error("题库数据未加载");
      const payload = buildPayload(bank, values);
      return updateQuestionBank(id!, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-question-banks"] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-banks-for-filter"] });
      queryClient.invalidateQueries({ queryKey: ["admin-banks-for-settings"] });
      toast.success("题目已保存");
      navigate("/admin/question-banks", { replace: true });
    },
    onError: (err: Error) => {
      toast.error(err.message || "保存失败");
    },
  });

  /** 题目数统计（左右均非空的有效行） */
  const itemCount = useMemo(() => {
    return fields.filter(
      (f) => f.left_text?.trim() && f.right_text?.trim(),
    ).length;
  }, [fields]);

  /** 全选/取消全选 */
  const toggleSelectAll = () => {
    if (selectedIndices.size === fields.length && fields.length > 0) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(fields.map((_, idx) => idx)));
    }
  };

  /** 切换单行选择 */
  const toggleSelect = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  /** 确认批量删除：按索引降序移除以避免索引偏移 */
  const confirmBatchDelete = () => {
    if (selectedIndices.size === 0) return;
    const sorted = Array.from(selectedIndices).sort((a, b) => b - a);
    remove(sorted);
    setSelectedIndices(new Set());
    setBatchDeleteOpen(false);
    toast.success(`已删除 ${sorted.length} 行`);
  };

  /** 批量导入：解析 textarea 内容并追加到字段数组 */
  const handleBatchImport = () => {
    const { items, failedLines } = parseBatchText(batchText);
    if (items.length === 0) {
      toast.error("未解析到有效题目，请检查格式（每行：左侧 空格或| 右侧）");
      return;
    }
    append(items.map((item) => ({ left_text: item.left_text, right_text: item.right_text })));
    if (failedLines.length > 0) {
      toast.warning(
        `已导入 ${items.length} 条，第 ${failedLines.join("、")} 行格式无效已跳过`,
      );
    } else {
      toast.success(`已导入 ${items.length} 条题目`);
    }
    setBatchText("");
    setBatchAddOpen(false);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!bank) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">题库不存在或加载失败</p>
        <Button variant="outline" asChild>
          <Link to="/admin/question-banks">返回题库列表</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 标题与返回 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin/question-banks")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">题目管理</h1>
          <p className="text-sm text-muted-foreground">
            题库：{bank.name}（{itemCount} 条有效）
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setBatchAddOpen(true)}>
          <Upload className="mr-1 h-4 w-4" />
          批量添加
        </Button>
      </div>

      <form
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
        className="space-y-4"
      >
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">题目配对</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ left_text: "", right_text: "" })}
              >
                <Plus className="mr-1 h-4 w-4" />
                添加
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {/* 批量操作栏 */}
            {selectedIndices.size > 0 && (
              <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
                <span className="text-sm text-muted-foreground">
                  已选 {selectedIndices.size} 项
                </span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setBatchDeleteOpen(true)}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  批量删除
                </Button>
              </div>
            )}

            {/* 题目表格 */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={
                        fields.length > 0 && selectedIndices.size === fields.length
                      }
                      onCheckedChange={toggleSelectAll}
                      aria-label="全选"
                    />
                  </TableHead>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>左侧文本（如英文）</TableHead>
                  <TableHead className="w-8 text-center">↔</TableHead>
                  <TableHead>右侧文本（如中文）</TableHead>
                  <TableHead className="w-12 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      暂无题目，点击"添加"或"批量添加"创建配对
                    </TableCell>
                  </TableRow>
                ) : (
                  fields.map((field, index) => (
                    <TableRow key={field.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIndices.has(index)}
                          onCheckedChange={() => toggleSelect(index)}
                          aria-label={`选择第 ${index + 1} 行`}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {index + 1}
                      </TableCell>
                      <TableCell>
                        <Input
                          {...register(`items.${index}.left_text`)}
                          placeholder="左侧文本"
                          className="w-full"
                        />
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">↔</TableCell>
                      <TableCell>
                        <Input
                          {...register(`items.${index}.right_text`)}
                          placeholder="右侧文本"
                          className="w-full"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            remove(index);
                            setSelectedIndices((prev) => {
                              const next = new Set(prev);
                              next.delete(index);
                              return next;
                            });
                          }}
                          className="text-destructive hover:text-destructive"
                          aria-label={`删除第 ${index + 1} 行`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <p className="px-4 py-2 text-xs text-muted-foreground">
              空行将在保存时自动过滤
            </p>
          </CardContent>
        </Card>

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/admin/question-banks")}
          >
            取消
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "保存中..." : "保存题目"}
          </Button>
        </div>
      </form>

      {/* 批量添加弹窗 */}
      <Dialog open={batchAddOpen} onOpenChange={setBatchAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>批量添加题目</DialogTitle>
            <DialogDescription>
              每行一组题目配对，左右内容之间以空格或竖线（|）分隔。
              <br />
              示例：
              <br />
              <code className="rounded bg-muted px-1">apple 苹果</code>
              {"  "}
              <code className="rounded bg-muted px-1">hello world|你好世界</code>
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
            placeholder={"apple 苹果\nhello world|你好世界\nbook 书本"}
            className="min-h-[200px] font-mono text-sm"
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setBatchText("");
                setBatchAddOpen(false);
              }}
            >
              <X className="mr-1 h-4 w-4" />
              取消
            </Button>
            <Button type="button" onClick={handleBatchImport}>
              <Upload className="mr-1 h-4 w-4" />
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量删除确认弹窗 */}
      <Dialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除选中的 {selectedIndices.size} 行题目吗？删除后需点击"保存题目"才会生效。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDeleteOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmBatchDelete}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

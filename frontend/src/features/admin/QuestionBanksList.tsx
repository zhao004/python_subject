/**
 * 题库列表页
 *
 * 替代原 react-admin QuestionBanks.tsx 的 BankList。
 * 搜索 + 状态过滤 + 分页 + 行操作（编辑/排行榜/日志）+ 批量勾选删除。
 * 新建/编辑通过弹窗操作，不再跳转独立页面。
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookOpen,
  ClipboardList,
  Copy,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  batchDeleteQuestionBanks,
  fetchQuestionBank,
  fetchQuestionBanks,
  updateQuestionBank,
} from "./api";
import type { QuestionBank, QuestionBankPayload } from "./types";
import QuestionBankDialog from "./QuestionBankDialog";
import { buildPublicQuizUrl } from "@/features/public/links";

const PAGE_SIZE = 25;

/** 复制文本到剪贴板，Clipboard API 不可用时使用隐藏文本域回退。 */
async function copyTextToClipboard(text: string): Promise<void> {
  const value = text.trim();
  if (!value) {
    throw new Error("复制内容为空");
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // 非安全上下文或权限拒绝时，继续尝试旧式复制。
    }
  }

  if (
    typeof document === "undefined" ||
    typeof document.execCommand !== "function" ||
    !document.body
  ) {
    throw new Error("当前环境不支持自动复制");
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("浏览器拒绝复制");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

/** 将完整题库详情转为提交载荷，并允许覆盖启用状态。 */
function buildQuestionBankPayload(
  bank: QuestionBank,
  isActive: boolean,
): QuestionBankPayload {
  return {
    name: bank.name,
    slug: bank.slug,
    description: bank.description ?? "",
    announcement: bank.announcement ?? "",
    is_active: isActive,
    leaderboard_limit: bank.leaderboard_limit,
    submission_style: bank.submission_style,
    items: (bank.items ?? []).map((item) => ({
      left_text: item.left_text,
      right_text: item.right_text,
    })),
  };
}

/** 格式日期时间 */
function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
    });
  } catch {
    return dateStr;
  }
}

export default function QuestionBanksList() {
  const [search, setSearch] = useState("");
  const [isActive, setIsActive] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBankId, setEditingBankId] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const queryClient = useQueryClient();
  const offset = (page - 1) * PAGE_SIZE;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-question-banks", { search, isActive, offset }],
    queryFn: () =>
      fetchQuestionBanks({
        limit: PAGE_SIZE,
        offset,
        search: search || undefined,
        is_active:
          isActive === "all" ? undefined : isActive === "true",
      }),
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** 批量删除 mutation */
  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => batchDeleteQuestionBanks(ids),
    onSuccess: (res) => {
      toast.success(`已删除 ${res.deleted} 个题库`);
      setSelectedIds(new Set());
      setDeleteConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin-question-banks"] });
      queryClient.invalidateQueries({ queryKey: ["admin-banks-for-filter"] });
      queryClient.invalidateQueries({ queryKey: ["admin-banks-for-settings"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "删除失败");
    },
  });

  /** 切换题库启用状态。 */
  const statusMutation = useMutation({
    mutationFn: async ({
      bank,
      nextActive,
    }: {
      bank: QuestionBank;
      nextActive: boolean;
    }) => {
      const latestBank = await fetchQuestionBank(bank.id);
      const payload = buildQuestionBankPayload(latestBank, nextActive);
      return updateQuestionBank(bank.id, payload);
    },
    onSuccess: (updatedBank) => {
      queryClient.setQueryData(["admin-question-bank", updatedBank.id], updatedBank);
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank", updatedBank.id] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-banks"] });
      queryClient.invalidateQueries({ queryKey: ["admin-banks-for-filter"] });
      queryClient.invalidateQueries({ queryKey: ["admin-banks-for-settings"] });
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
      toast.success(updatedBank.is_active ? "题库已启用" : "题库已停用");
    },
    onError: (err: Error) => {
      toast.error(err.message || "状态更新失败");
    },
  });

  /** 打开新建弹窗 */
  const openCreateDialog = () => {
    setEditingBankId(null);
    setDialogOpen(true);
  };

  /** 打开编辑弹窗 */
  const openEditDialog = (bank: QuestionBank) => {
    setEditingBankId(bank.id);
    setDialogOpen(true);
  };

  /** 全选/取消全选 */
  const toggleSelectAll = () => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map((b) => b.id)));
    }
  };

  /** 切换单行选择 */
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /** 确认批量删除 */
  const confirmBatchDelete = () => {
    if (selectedIds.size === 0) return;
    batchDeleteMutation.mutate(Array.from(selectedIds));
  };

  /** 复制题库公开地址。 */
  const handleCopyAddress = async (address: string) => {
    try {
      await copyTextToClipboard(address);
      toast.success("题库地址已复制");
    } catch (err) {
      toast.error((err as Error).message || "复制失败，请手动复制链接");
    }
  };

  /** 切换题库状态。 */
  const handleToggleStatus = (bank: QuestionBank, nextActive: boolean) => {
    if (statusMutation.isPending) return;
    statusMutation.mutate({ bank, nextActive });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">题库管理</h1>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          新建题库
        </Button>
      </div>

      {/* 过滤工具栏 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          placeholder="搜索题库名称..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="sm:max-w-xs"
        />
        <Select
          value={isActive}
          onValueChange={(v) => {
            setIsActive(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="true">启用</SelectItem>
            <SelectItem value="false">停用</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-md border bg-muted/50 px-4 py-2">
          <span className="text-sm text-muted-foreground">
            已选 {selectedIds.size} 项
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 className="mr-1 h-4 w-4" />
            批量删除
          </Button>
        </div>
      )}

      {/* 列表表格 */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={
                      entries.length > 0 && selectedIds.size === entries.length
                    }
                    onCheckedChange={toggleSelectAll}
                    aria-label="全选"
                  />
                </TableHead>
                <TableHead className="text-center">状态</TableHead>
                <TableHead>名称</TableHead>
                <TableHead className="w-[24rem]">题库地址</TableHead>
                <TableHead className="text-right">题目数</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    暂无题库
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((bank) => {
                  const publicUrl = buildPublicQuizUrl(bank.slug);
                  return (
                    <TableRow key={bank.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(bank.id)}
                          onCheckedChange={() => toggleSelect(bank.id)}
                          aria-label={`选择 ${bank.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center">
                          <Switch
                            checked={bank.is_active}
                            onCheckedChange={(nextActive) =>
                              handleToggleStatus(bank, nextActive)
                            }
                            disabled={statusMutation.isPending}
                            aria-label={bank.is_active ? `停用 ${bank.name}` : `启用 ${bank.name}`}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          onClick={() => openEditDialog(bank)}
                          className="text-left text-primary hover:underline"
                        >
                          {bank.name}
                        </button>
                      </TableCell>
                      <TableCell className="max-w-[24rem]">
                        <div className="flex min-w-0 items-center gap-2">
                          <a
                            href={publicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={publicUrl}
                            aria-label={`新窗口打开题库地址 ${publicUrl}`}
                            className="min-w-0 flex-1 truncate text-primary underline-offset-4 hover:underline"
                          >
                            {publicUrl}
                          </a>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => handleCopyAddress(publicUrl)}
                            aria-label="复制题库地址"
                            title="复制题库地址"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{bank.item_count}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(bank.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(bank)}
                            aria-label="编辑"
                          >
                            <Pencil className="mr-1 h-4 w-4" />
                            编辑
                          </Button>
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/admin/question-banks/${bank.id}/items`}>
                              <ListChecks className="mr-1 h-4 w-4" />
                              题目
                            </Link>
                          </Button>
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/admin/question-banks/${bank.id}/leaderboard`}>
                              <Trophy className="mr-1 h-4 w-4" />
                              排行榜
                            </Link>
                          </Button>
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/admin/question-banks/${bank.id}/logs`}>
                              <ClipboardList className="mr-1 h-4 w-4" />
                              日志
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            共 {total} 条，第 {page}/{totalPages} 页
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      {/* 新建/编辑弹窗 */}
      <QuestionBankDialog
        bankId={editingBankId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      {/* 批量删除确认弹窗 */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除选中的 {selectedIds.size} 个题库吗？此操作不可撤销，
              相关的排行榜和提交流水也会被删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={confirmBatchDelete}
              disabled={batchDeleteMutation.isPending}
            >
              {batchDeleteMutation.isPending ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

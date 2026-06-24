/**
 * 题库排行榜管理
 *
 * 替代原 react-admin BankLeaderboard.tsx。
 * 列表 + Dialog 增改 + 行删除 + 批量删除。
 * 保留学号 9 位校验 + 分数留空自动计算逻辑。
 */

import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Edit, Trash2, Plus, Download, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchQuestionBank,
  fetchLeaderboard,
  createLeaderboardRecord,
  updateLeaderboardRecord,
  deleteLeaderboardRecord,
  batchDeleteLeaderboardRecords,
} from "./api";
import type { LeaderboardRecord, LeaderboardRecordPayload } from "./types";
import { exportToExcel, fetchAllPages } from "@/lib/export-excel";

/** 可选每页条数 */
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const STUDENT_ID_PATTERN = /^\d{9}$/;

/** 秒 → h:mm:ss 或 mm:ss */
function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
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

/** 空表单 */
const EMPTY_FORM: LeaderboardRecordPayload = {
  student_class: "",
  student_id: "",
  student_name: "",
  correct_count: 0,
  elapsed_seconds: 0,
  score: null,
};

export default function BankLeaderboard() {
  const { id: bankId } = useParams();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<LeaderboardRecord | null>(null);
  const [form, setForm] = useState<LeaderboardRecordPayload>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [exporting, setExporting] = useState(false);

  const offset = (page - 1) * pageSize;

  /** 获取题库名称 */
  const { data: bank } = useQuery({
    queryKey: ["admin-question-bank", bankId],
    queryFn: () => fetchQuestionBank(bankId!),
    enabled: Boolean(bankId),
  });

  /** 排行榜列表 */
  const { data, isLoading } = useQuery({
    queryKey: ["admin-leaderboard", bankId, offset, pageSize],
    queryFn: () =>
      fetchLeaderboard(bankId!, { limit: pageSize, offset }),
    enabled: Boolean(bankId),
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /** 打开新增对话框 */
  const openCreateDialog = () => {
    setEditingRecord(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setDialogOpen(true);
  };

  /** 打开编辑对话框 */
  const openEditDialog = (record: LeaderboardRecord) => {
    setEditingRecord(record);
    setForm({
      student_class: record.student_class,
      student_id: record.student_id,
      student_name: record.student_name,
      correct_count: record.correct_count,
      elapsed_seconds: record.elapsed_seconds,
      score: record.score,
    });
    setFormError("");
    setDialogOpen(true);
  };

  /** 表单字段更新 */
  const updateForm = (field: keyof LeaderboardRecordPayload, value: string | number | null) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  /** 创建/更新 mutation */
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!STUDENT_ID_PATTERN.test(form.student_id)) {
        throw new Error("学号必须是 9 位数字");
      }
      const isEdit = editingRecord !== null;
      if (isEdit && editingRecord) {
        return updateLeaderboardRecord(editingRecord.id, form);
      }
      return createLeaderboardRecord(bankId!, form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-leaderboard", bankId] });
      toast.success(editingRecord ? "记录已更新" : "记录已添加");
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  /** 单条删除 */
  const deleteMutation = useMutation({
    mutationFn: (recordId: number) => deleteLeaderboardRecord(recordId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-leaderboard", bankId] });
      toast.success("已删除");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  /** 批量删除 */
  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => batchDeleteLeaderboardRecords(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-leaderboard", bankId] });
      setSelectedIds(new Set());
      toast.success("批量删除完成");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  /** 全选/取消全选 */
  const toggleSelectAll = () => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map((e) => e.id)));
    }
  };

  /** 切换单选 */
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 表单提交 */
  const handleSubmit = () => {
    saveMutation.mutate();
  };

  /** 导出当前题库排行榜全量数据为 Excel */
  const handleExport = async () => {
    if (!bankId) return;
    setExporting(true);
    try {
      const allEntries = await fetchAllPages(
        (offset, limit) => fetchLeaderboard(bankId, { limit, offset }),
        100,
      );
      if (allEntries.length === 0) {
        toast.warning("没有可导出的数据");
        return;
      }
      const rows = allEntries.map((r, idx) => ({
        rank: idx + 1,
        student_class: r.student_class,
        student_id: r.student_id,
        student_name: r.student_name,
        score: r.score,
        correct_count: r.correct_count,
        total_pairs: r.total_pairs,
        elapsed: formatElapsed(r.elapsed_seconds),
        type: r.is_manual ? "手工" : "系统",
        submitted_at: formatDateTime(r.submitted_at),
      }));
      exportToExcel(
        `排行榜_${bank?.name ?? bankId}_${new Date().toISOString().slice(0, 10)}`,
        "排行榜",
        [
          { key: "rank", label: "排名" },
          { key: "student_class", label: "班级" },
          { key: "student_id", label: "学号" },
          { key: "student_name", label: "姓名" },
          { key: "score", label: "分数" },
          { key: "correct_count", label: "正确数" },
          { key: "total_pairs", label: "总题数" },
          { key: "elapsed", label: "用时" },
          { key: "type", label: "类型" },
          { key: "submitted_at", label: "提交时间" },
        ],
        rows,
      );
      toast.success(`已导出 ${rows.length} 条记录`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 标题 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/admin/question-banks">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">排行榜管理</h1>
          </div>
          {bank && <p className="text-sm text-muted-foreground">{bank.name}</p>}
        </div>
      </div>

      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                已选 {selectedIds.size} 项
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => batchDeleteMutation.mutate([...selectedIds])}
                disabled={batchDeleteMutation.isPending}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                批量删除
              </Button>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">共 {total} 条记录</span>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">每页</span>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => {
                setPageSize(Number(val));
                setPage(1);
                setSelectedIds(new Set());
              }}
            >
              <SelectTrigger className="w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">条</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting}
          >
            <Download className="mr-1 h-4 w-4" />
            {exporting ? "导出中..." : "导出 Excel"}
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新增记录
          </Button>
        </div>
      </div>

      {/* 列表 */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={selectedIds.size > 0 && selectedIds.size === entries.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead className="w-12">排名</TableHead>
                <TableHead>班级</TableHead>
                <TableHead>学号</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead className="text-right">分数</TableHead>
                <TableHead className="text-right">正确数</TableHead>
                <TableHead>用时</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>提交时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 11 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                    暂无记录
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((record, index) => (
                  <TableRow key={record.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(record.id)}
                        onCheckedChange={() => toggleSelect(record.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{offset + index + 1}</TableCell>
                    <TableCell>{record.student_class}</TableCell>
                    <TableCell>{record.student_id}</TableCell>
                    <TableCell>{record.student_name}</TableCell>
                    <TableCell className="text-right font-bold">{record.score}</TableCell>
                    <TableCell className="text-right">{record.correct_count}</TableCell>
                    <TableCell>{formatElapsed(record.elapsed_seconds)}</TableCell>
                    <TableCell>
                      {record.is_manual ? (
                        <Badge variant="secondary">手工</Badge>
                      ) : (
                        <Badge variant="outline">系统</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(record.submitted_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(record)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm("确认删除此记录？")) {
                              deleteMutation.mutate(record.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            第 {page}/{totalPages} 页
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

      {/* 新增/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRecord ? "编辑记录" : "新增记录"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="student_class">班级</Label>
                <Input
                  id="student_class"
                  maxLength={40}
                  value={form.student_class}
                  onChange={(e) => updateForm("student_class", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="student_id">学号（9 位数字）</Label>
                <Input
                  id="student_id"
                  maxLength={9}
                  value={form.student_id}
                  onChange={(e) => updateForm("student_id", e.target.value)}
                  placeholder="9 位纯数字"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="student_name">姓名</Label>
              <Input
                id="student_name"
                maxLength={40}
                value={form.student_name}
                onChange={(e) => updateForm("student_name", e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="correct_count">正确数</Label>
                <Input
                  id="correct_count"
                  type="number"
                  min={0}
                  value={form.correct_count}
                  onChange={(e) =>
                    updateForm("correct_count", Number(e.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="elapsed_seconds">用时（秒）</Label>
                <Input
                  id="elapsed_seconds"
                  type="number"
                  min={0}
                  value={form.elapsed_seconds}
                  onChange={(e) =>
                    updateForm("elapsed_seconds", Number(e.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="score">分数</Label>
                <Input
                  id="score"
                  type="number"
                  min={0}
                  max={100}
                  value={form.score ?? ""}
                  onChange={(e) =>
                    updateForm(
                      "score",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                  placeholder="留空自动计算"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              分数留空时由系统自动计算
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

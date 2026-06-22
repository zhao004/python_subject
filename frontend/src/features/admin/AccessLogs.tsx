/**
 * 访问日志页
 *
 * 替代原 react-admin AccessLogs.tsx。
 * 只读列表 + search 过滤 + 批量勾选删除。
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchAccessLogs, batchDeleteAccessLogs } from "./api";

const PAGE_SIZE = 25;

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

export default function AccessLogs() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const queryClient = useQueryClient();
  const offset = (page - 1) * PAGE_SIZE;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-access-logs", { search, offset }],
    queryFn: () =>
      fetchAccessLogs({
        limit: PAGE_SIZE,
        offset,
        search: search || undefined,
      }),
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** 批量删除 mutation */
  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => batchDeleteAccessLogs(ids),
    onSuccess: (res) => {
      toast.success(`已删除 ${res.deleted} 条记录`);
      setSelectedIds(new Set());
      setDeleteConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin-access-logs"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "删除失败");
    },
  });

  /** 全选/取消全选 */
  const toggleSelectAll = () => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map((l) => l.id)));
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

  return (
    <div className="space-y-4">
      {/* 标题 */}
      <h1 className="text-2xl font-bold">访问日志</h1>

      {/* 搜索 */}
      <Input
        placeholder="搜索路径/IP/地区..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="max-w-xs"
      />

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

      {/* 列表 */}
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
                <TableHead>访问时间</TableHead>
                <TableHead>页面路径</TableHead>
                <TableHead>设备</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>地区</TableHead>
                <TableHead>User-Agent</TableHead>
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
                    暂无记录
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(log.id)}
                        onCheckedChange={() => toggleSelect(log.id)}
                        aria-label={`选择记录 ${log.id}`}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(log.visited_at)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.page_path}</TableCell>
                    <TableCell>{log.device || "-"}</TableCell>
                    <TableCell>{log.ip_address || "-"}</TableCell>
                    <TableCell>{log.region || "-"}</TableCell>
                    <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">
                      {log.user_agent || "-"}
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

      {/* 批量删除确认弹窗 */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除选中的 {selectedIds.size} 条访问日志吗？此操作不可撤销。
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

/**
 * 访问日志页
 *
 * 替代原 react-admin AccessLogs.tsx。
 * 只读列表 + search 过滤 + 批量勾选删除 + 详情弹窗 + Excel 导出 + 每页条数可选。
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Eye, Download, ClipboardList } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchAccessLogs, batchDeleteAccessLogs } from "./api";
import type { AccessLog } from "./types";
import { exportToExcel, fetchAllPages } from "@/lib/export-excel";

/** 可选每页条数 */
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

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
  const [pageSize, setPageSize] = useState<number>(20);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [detailLog, setDetailLog] = useState<AccessLog | null>(null);
  const [exporting, setExporting] = useState(false);

  const queryClient = useQueryClient();
  const offset = (page - 1) * pageSize;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-access-logs", { search, offset, pageSize }],
    queryFn: () =>
      fetchAccessLogs({
        limit: pageSize,
        offset,
        search: search || undefined,
      }),
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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

  /** 导出当前筛选条件下的全部数据为 Excel */
  const handleExport = async () => {
    setExporting(true);
    try {
      const allEntries = await fetchAllPages(
        (offset, limit) =>
          fetchAccessLogs({
            limit,
            offset,
            search: search || undefined,
          }),
        500,
      );
      if (allEntries.length === 0) {
        toast.warning("没有可导出的数据");
        return;
      }
      // 格式化后导出，确保日期列可读
      const rows = allEntries.map((log) => ({
        visited_at: formatDateTime(log.visited_at),
        page_path: log.page_path,
        device: log.device || "",
        ip_address: log.ip_address || "",
        region: log.region || "",
        user_agent: log.user_agent || "",
      }));
      exportToExcel(
        `访问日志_${new Date().toISOString().slice(0, 10)}`,
        "访问日志",
        [
          { key: "visited_at", label: "访问时间" },
          { key: "page_path", label: "页面路径" },
          { key: "device", label: "设备" },
          { key: "ip_address", label: "IP地址" },
          { key: "region", label: "地区" },
          { key: "user_agent", label: "User-Agent" },
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
      {/* 标题 + 导出 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">访问日志</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting}
        >
          <Download className="mr-1 h-4 w-4" />
          {exporting ? "导出中..." : "导出 Excel"}
        </Button>
      </div>

      {/* 搜索 + 每页条数 */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="搜索路径/IP/地区..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
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
                <TableHead className="w-16 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
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
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDetailLog(log)}
                        aria-label="查看详情"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
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

      {/* 详情弹窗 */}
      <Dialog open={detailLog !== null} onOpenChange={(open) => !open && setDetailLog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>访问日志详情</DialogTitle>
            <DialogDescription>记录 ID：{detailLog?.id}</DialogDescription>
          </DialogHeader>
          {detailLog && (
            <div className="space-y-3 py-2">
              <DetailRow label="访问时间" value={formatDateTime(detailLog.visited_at)} />
              <DetailRow label="页面路径" value={detailLog.page_path} mono />
              <DetailRow label="设备" value={detailLog.device || "-"} />
              <DetailRow label="IP 地址" value={detailLog.ip_address || "-"} />
              <DetailRow label="地区" value={detailLog.region || "-"} />
              <div className="space-y-1">
                <span className="text-sm font-medium text-muted-foreground">User-Agent</span>
                <p className="break-all rounded-md bg-muted p-3 text-xs">
                  {detailLog.user_agent || "-"}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailLog(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

/** 详情行组件 */
function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-sm font-medium text-muted-foreground">
        {label}
      </span>
      <span className={`text-right text-sm ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  );
}

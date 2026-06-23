/**
 * IP 黑名单管理页
 *
 * 管理公开访问链路的全站 IP 黑名单，支持手动添加、搜索、分页和解除拉黑。
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, ShieldBan, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  createIpBlacklistEntry,
  deleteIpBlacklistEntry,
  fetchIpBlacklist,
} from "./api";
import type { IpBlacklistEntry } from "./types";

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

export default function IpBlacklistPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [ipAddress, setIpAddress] = useState("");
  const [reason, setReason] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<IpBlacklistEntry | null>(null);
  const offset = (page - 1) * pageSize;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-ip-blacklist", { search, offset, pageSize }],
    queryFn: () =>
      fetchIpBlacklist({
        limit: pageSize,
        offset,
        search: search || undefined,
      }),
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const createMutation = useMutation({
    mutationFn: () =>
      createIpBlacklistEntry({
        ip_address: ipAddress,
        reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-ip-blacklist"] });
      setIpAddress("");
      setReason("");
      setPage(1);
      toast.success("已添加 IP 黑名单");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteIpBlacklistEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-ip-blacklist"] });
      setDeleteTarget(null);
      toast.success("已解除拉黑");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  /** 提交新增黑名单，前端做空值拦截，格式由后端统一校验 */
  const handleCreate = () => {
    if (!ipAddress.trim()) {
      toast.error("请输入 IP 地址");
      return;
    }
    createMutation.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldBan className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">IP 黑名单</h1>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(180px,260px)_1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="ip-address">IP 地址</Label>
            <Input
              id="ip-address"
              value={ipAddress}
              onChange={(event) => setIpAddress(event.target.value)}
              placeholder="例如 8.8.8.8"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="blacklist-reason">备注</Label>
            <Textarea
              id="blacklist-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="记录拉黑原因"
              maxLength={255}
              className="min-h-10 resize-none"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              <Plus className="mr-1 h-4 w-4" />
              {createMutation.isPending ? "添加中..." : "添加"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="搜索 IP/备注..."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="w-full sm:w-72"
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">共 {total} 条，每页</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>IP 地址</TableHead>
                <TableHead>备注</TableHead>
                <TableHead>添加时间</TableHead>
                <TableHead className="w-24 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {Array.from({ length: 4 }).map((__, cellIndex) => (
                      <TableCell key={cellIndex}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    暂无黑名单记录
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs">{entry.ip_address}</TableCell>
                    <TableCell className="max-w-[420px] truncate">
                      {entry.reason || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(entry.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(entry)}
                        aria-label="解除拉黑"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>解除拉黑</DialogTitle>
            <DialogDescription>
              确定要解除 IP {deleteTarget?.ip_address} 的访问限制吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending || deleteTarget === null}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "解除中..." : "解除拉黑"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

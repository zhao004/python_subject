/**
 * 题库提交流水
 *
 * 替代原 react-admin BankLogs.tsx。
 * 只读列表 + 批量删除 + 返回按钮。
 */

import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Trash2, Download, ShieldBan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchQuestionBank,
  fetchSubmissionLogs,
  batchDeleteSubmissionLogs,
  createIpBlacklistEntry,
  fetchIpDetails,
} from "./api";
import type { SubmissionLog } from "./types";
import { exportToExcel, fetchAllPages } from "@/lib/export-excel";

/** 可选每页条数 */
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const UNKNOWN_IP = "0.0.0.0";

/** 秒 → m:ss */
function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
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

/** 判断提交流水 IP 是否可用于拉黑 */
function canBlacklistIp(ipAddress: string | undefined, isManual: boolean): boolean {
  return !isManual && Boolean(ipAddress && ipAddress !== UNKNOWN_IP);
}

/** 展示提交流水 IP，兼容历史记录 */
function formatLogIp(ipAddress: string | undefined): string {
  return ipAddress && ipAddress !== UNKNOWN_IP ? ipAddress : "未知";
}

export default function BankLogs() {
  const { id: bankId } = useParams();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [detailLog, setDetailLog] = useState<SubmissionLog | null>(null);
  const [blacklistReason, setBlacklistReason] = useState("");

  const offset = (page - 1) * pageSize;

  const { data: bank } = useQuery({
    queryKey: ["admin-question-bank", bankId],
    queryFn: () => fetchQuestionBank(bankId!),
    enabled: Boolean(bankId),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-submission-logs", bankId, { offset, pageSize, search }],
    queryFn: () => fetchSubmissionLogs(bankId!, { limit: pageSize, offset, search: search || undefined }),
    enabled: Boolean(bankId),
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const detailIp = detailLog?.ip_address ?? "";

  const { data: ipDetails, isLoading: ipDetailsLoading } = useQuery({
    queryKey: ["admin-ip-details", detailIp],
    queryFn: () => fetchIpDetails(detailIp),
    enabled: Boolean(detailLog && canBlacklistIp(detailLog.ip_address, detailLog.is_manual)),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => batchDeleteSubmissionLogs(bankId!, ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-submission-logs", bankId] });
      setSelectedIds(new Set());
      toast.success("批量删除完成");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const blacklistMutation = useMutation({
    mutationFn: ({ ipAddress, reason }: { ipAddress: string; reason: string }) =>
      createIpBlacklistEntry({
        ip_address: ipAddress,
        reason,
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-ip-blacklist"] });
      queryClient.invalidateQueries({ queryKey: ["admin-ip-details", variables.ipAddress] });
      toast.success(`已拉黑 IP：${variables.ipAddress}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  /** 打开 IP 详情弹窗，默认备注带上流水来源，便于后续追踪 */
  const openIpDetails = (log: SubmissionLog) => {
    if (!canBlacklistIp(log.ip_address, log.is_manual)) {
      return;
    }
    setDetailLog(log);
    setBlacklistReason(`来自提交流水 #${log.id}`);
  };

  /** 从弹窗提交 IP 黑名单 */
  const handleBlacklistFromDialog = () => {
    if (!detailLog || !canBlacklistIp(detailLog.ip_address, detailLog.is_manual)) {
      toast.error("当前记录没有可拉黑的 IP");
      return;
    }
    blacklistMutation.mutate({
      ipAddress: detailLog.ip_address,
      reason: blacklistReason.trim() || `来自提交流水 #${detailLog.id}`,
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map((e) => e.id)));
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 导出当前题库全量提交流水为 Excel */
  const handleExport = async () => {
    if (!bankId) return;
    setExporting(true);
    try {
      const allEntries = await fetchAllPages(
        (offset, limit) => fetchSubmissionLogs(bankId, { limit, offset, search: search || undefined }),
        100,
      );
      if (allEntries.length === 0) {
        toast.warning("没有可导出的数据");
        return;
      }
      const rows = allEntries.map((log) => ({
        student_class: log.student_class,
        student_id: log.student_id,
        student_name: log.student_name,
        score: log.score,
        ip_address: formatLogIp(log.ip_address),
        correct_count: log.correct_count,
        total_pairs: log.total_pairs,
        elapsed: formatElapsed(log.elapsed_seconds),
        type: log.is_manual ? "手工" : "系统",
        submitted_at: formatDateTime(log.submitted_at),
      }));
      exportToExcel(
        `提交流水_${bank?.name ?? bankId}_${new Date().toISOString().slice(0, 10)}`,
        "提交流水",
        [
          { key: "student_class", label: "班级" },
          { key: "student_id", label: "学号" },
          { key: "student_name", label: "姓名" },
          { key: "score", label: "分数" },
          { key: "ip_address", label: "IP地址" },
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
      {/* 标题 + 导出 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/admin/question-banks">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">提交流水</h1>
            {bank && <p className="text-sm text-muted-foreground">{bank.name}</p>}
          </div>
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

      {/* 搜索 + 操作栏 */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            placeholder="搜索姓名/学号/IP..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
              setSelectedIds(new Set());
            }}
            className="w-full sm:w-64"
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
                <TableHead>班级</TableHead>
                <TableHead>学号</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead className="text-right">分数</TableHead>
                <TableHead className="text-right">正确数</TableHead>
                <TableHead className="text-right">总题数</TableHead>
                <TableHead>用时</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>提交时间</TableHead>
                <TableHead className="w-24 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 12 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="h-24 text-center text-muted-foreground">
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
                      />
                    </TableCell>
                    <TableCell>{log.student_class}</TableCell>
                    <TableCell>{log.student_id}</TableCell>
                    <TableCell>{log.student_name}</TableCell>
                    <TableCell className="text-right font-bold">{log.score}</TableCell>
                    <TableCell className="text-right">{log.correct_count}</TableCell>
                    <TableCell className="text-right">{log.total_pairs}</TableCell>
                    <TableCell>{formatElapsed(log.elapsed_seconds)}</TableCell>
                    <TableCell>
                      {canBlacklistIp(log.ip_address, log.is_manual) ? (
                        <Button
                          variant="link"
                          className="h-auto p-0 font-mono text-xs"
                          onClick={() => openIpDetails(log)}
                        >
                          {formatLogIp(log.ip_address)}
                        </Button>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatLogIp(log.ip_address)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.is_manual ? (
                        <Badge variant="secondary">手工</Badge>
                      ) : (
                        <Badge variant="outline">系统</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(log.submitted_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canBlacklistIp(log.ip_address, log.is_manual) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openIpDetails(log)}
                          disabled={blacklistMutation.isPending}
                        >
                          <ShieldBan className="mr-1 h-4 w-4" />
                          拉黑
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
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

      <Dialog
        open={detailLog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailLog(null);
            setBlacklistReason("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>提交 IP 详情</DialogTitle>
            <DialogDescription>
              提交流水 #{detailLog?.id}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border bg-muted/30 p-4">
              {ipDetailsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-5 w-1/3" />
                </div>
              ) : (
                <div className="space-y-3">
                  <DetailRow label="IP 地址" value={ipDetails?.ip_address ?? formatLogIp(detailLog?.ip_address)} mono />
                  <DetailRow label="归属地" value={ipDetails?.region || "未知"} />
                  <DetailRow label="IP 网络" value={ipDetails?.network || "未知网络"} />
                  <DetailRow
                    label="黑名单"
                    value={ipDetails?.is_blacklisted ? "已拉黑" : "未拉黑"}
                  />
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="submission-ip-blacklist-reason">拉黑备注</Label>
              <Textarea
                id="submission-ip-blacklist-reason"
                value={blacklistReason}
                onChange={(event) => setBlacklistReason(event.target.value)}
                maxLength={255}
                placeholder="记录拉黑原因"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailLog(null)}>
              关闭
            </Button>
            <Button
              variant="destructive"
              onClick={handleBlacklistFromDialog}
              disabled={blacklistMutation.isPending || Boolean(ipDetails?.is_blacklisted)}
            >
              <ShieldBan className="mr-1 h-4 w-4" />
              {ipDetails?.is_blacklisted ? "已拉黑" : "一键拉黑 IP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** IP 详情弹窗中的键值行 */
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

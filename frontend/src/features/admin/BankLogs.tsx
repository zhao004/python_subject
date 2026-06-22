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
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  fetchQuestionBank,
  fetchSubmissionLogs,
  batchDeleteSubmissionLogs,
} from "./api";

const PAGE_SIZE = 25;

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

export default function BankLogs() {
  const { id: bankId } = useParams();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const offset = (page - 1) * PAGE_SIZE;

  const { data: bank } = useQuery({
    queryKey: ["admin-question-bank", bankId],
    queryFn: () => fetchQuestionBank(bankId!),
    enabled: Boolean(bankId),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-submission-logs", bankId, offset],
    queryFn: () => fetchSubmissionLogs(bankId!, { limit: PAGE_SIZE, offset }),
    enabled: Boolean(bankId),
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => batchDeleteSubmissionLogs(bankId!, ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-submission-logs", bankId] });
      setSelectedIds(new Set());
      toast.success("批量删除完成");
    },
    onError: (err: Error) => toast.error(err.message),
  });

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
          <h1 className="text-2xl font-bold">提交流水</h1>
          {bank && <p className="text-sm text-muted-foreground">{bank.name}</p>}
        </div>
      </div>

      {/* 操作栏 */}
      <div className="flex items-center justify-between">
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
                <TableHead>类型</TableHead>
                <TableHead>提交时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 10 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
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
                      {log.is_manual ? (
                        <Badge variant="secondary">手工</Badge>
                      ) : (
                        <Badge variant="outline">系统</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(log.submitted_at)}
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
    </div>
  );
}

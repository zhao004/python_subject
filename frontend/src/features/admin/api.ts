/**
 * 后台 API 封装
 *
 * 替代原 src/admin/dataProvider.ts 的资源→端点映射。
 * 保留所有业务端点和 bank_id 隐式传参约定，
 * 但改为显式参数传递（不再依赖 RA filter/meta 机制）。
 */

import { httpClient, apiUrl, buildQuery } from "@/lib/http-client";
import type {
  QuestionBank,
  QuestionBankPayload,
  LeaderboardRecord,
  LeaderboardRecordPayload,
  SubmissionLog,
  IpBlacklistEntry,
  IpBlacklistPayload,
  IpDetails,
  AccessLog,
  SiteSettings,
  AdminOverviewStats,
  SubmissionTrendResponse,
  ListResponse,
  BatchDeleteResponse,
  RandomSlugResponse,
  AdminSessionResponse,
} from "./types";

const ADMIN_API = "/admin";

/** 列表查询参数 */
export interface ListParams {
  limit?: number;
  offset?: number;
  search?: string;
  is_active?: boolean;
  bank_id?: string | number;
}

// ==================== 题库管理 ====================

export async function fetchQuestionBanks(
  params: ListParams = {},
): Promise<ListResponse<QuestionBank>> {
  const qs = buildQuery({
    limit: params.limit ?? 25,
    offset: params.offset ?? 0,
    search: params.search,
    is_active: params.is_active,
  });
  return httpClient(apiUrl(`${ADMIN_API}/question-banks${qs}`));
}

export async function fetchQuestionBank(id: number | string): Promise<QuestionBank> {
  return httpClient(apiUrl(`${ADMIN_API}/question-banks/${id}`));
}

export async function createQuestionBank(
  payload: QuestionBankPayload,
): Promise<QuestionBank> {
  return httpClient(apiUrl(`${ADMIN_API}/question-banks`), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateQuestionBank(
  id: number | string,
  payload: QuestionBankPayload,
): Promise<QuestionBank> {
  return httpClient(apiUrl(`${ADMIN_API}/question-banks/${id}`), {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteQuestionBank(id: number | string): Promise<void> {
  await httpClient(apiUrl(`${ADMIN_API}/question-banks/${id}`), {
    method: "DELETE",
  });
}

export async function batchDeleteQuestionBanks(
  ids: (number | string)[],
): Promise<BatchDeleteResponse> {
  return httpClient(apiUrl(`${ADMIN_API}/question-banks/batch-delete`), {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function fetchRandomSlug(): Promise<RandomSlugResponse> {
  return httpClient(apiUrl(`${ADMIN_API}/question-banks/random-slug`), {
    method: "POST",
  });
}

// ==================== 排行榜管理 ====================

export async function fetchLeaderboard(
  bankId: number | string,
  params: ListParams = {},
): Promise<ListResponse<LeaderboardRecord>> {
  const qs = buildQuery({
    limit: params.limit ?? 25,
    offset: params.offset ?? 0,
    search: params.search,
  });
  return httpClient(
    apiUrl(`${ADMIN_API}/question-banks/${bankId}/leaderboard${qs}`),
  );
}

export async function createLeaderboardRecord(
  bankId: number | string,
  payload: LeaderboardRecordPayload,
): Promise<LeaderboardRecord> {
  return httpClient(apiUrl(`${ADMIN_API}/question-banks/${bankId}/leaderboard`), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateLeaderboardRecord(
  id: number | string,
  payload: LeaderboardRecordPayload,
): Promise<LeaderboardRecord> {
  return httpClient(apiUrl(`${ADMIN_API}/leaderboard-records/${id}`), {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteLeaderboardRecord(id: number | string): Promise<void> {
  await httpClient(apiUrl(`${ADMIN_API}/leaderboard-records/${id}`), {
    method: "DELETE",
  });
}

export async function batchDeleteLeaderboardRecords(
  ids: (number | string)[],
): Promise<BatchDeleteResponse> {
  return httpClient(apiUrl(`${ADMIN_API}/leaderboard-records/batch-delete`), {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

// ==================== 提交流水 ====================

export async function fetchSubmissionLogs(
  bankId: number | string,
  params: ListParams = {},
): Promise<ListResponse<SubmissionLog>> {
  const qs = buildQuery({
    limit: params.limit ?? 25,
    offset: params.offset ?? 0,
    search: params.search,
  });
  return httpClient(
    apiUrl(`${ADMIN_API}/question-banks/${bankId}/submission-logs${qs}`),
  );
}

export async function batchDeleteSubmissionLogs(
  bankId: number | string,
  ids: (number | string)[],
): Promise<BatchDeleteResponse> {
  return httpClient(
    apiUrl(`${ADMIN_API}/question-banks/${bankId}/submission-logs/batch-delete`),
    {
      method: "POST",
      body: JSON.stringify({ ids }),
    },
  );
}

// ==================== IP 黑名单 ====================

export async function fetchIpBlacklist(
  params: ListParams = {},
): Promise<ListResponse<IpBlacklistEntry>> {
  const qs = buildQuery({
    limit: params.limit ?? 25,
    offset: params.offset ?? 0,
    search: params.search,
  });
  return httpClient(apiUrl(`${ADMIN_API}/ip-blacklist${qs}`));
}

export async function createIpBlacklistEntry(
  payload: IpBlacklistPayload,
): Promise<IpBlacklistEntry> {
  return httpClient(apiUrl(`${ADMIN_API}/ip-blacklist`), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchIpDetails(ipAddress: string): Promise<IpDetails> {
  return httpClient(
    apiUrl(`${ADMIN_API}/ip-details/${encodeURIComponent(ipAddress)}`),
  );
}

export async function deleteIpBlacklistEntry(id: number | string): Promise<void> {
  await httpClient(apiUrl(`${ADMIN_API}/ip-blacklist/${id}`), {
    method: "DELETE",
  });
}

// ==================== 访问日志 ====================

export async function fetchAccessLogs(
  params: ListParams = {},
): Promise<ListResponse<AccessLog>> {
  const qs = buildQuery({
    limit: params.limit ?? 25,
    offset: params.offset ?? 0,
    search: params.search,
    bank_id: params.bank_id,
  });
  return httpClient(apiUrl(`${ADMIN_API}/access-logs${qs}`));
}

export async function batchDeleteAccessLogs(
  ids: (number | string)[],
): Promise<BatchDeleteResponse> {
  return httpClient(apiUrl(`${ADMIN_API}/access-logs/batch-delete`), {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

// ==================== 站点设置 ====================

export async function fetchSiteSettings(): Promise<SiteSettings> {
  return httpClient(apiUrl(`${ADMIN_API}/site-settings`));
}

export async function updateSiteSettings(
  payload: Partial<SiteSettings>,
): Promise<SiteSettings> {
  return httpClient(apiUrl(`${ADMIN_API}/site-settings`), {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// ==================== 概览统计 ====================

export async function fetchOverview(): Promise<AdminOverviewStats> {
  return httpClient(apiUrl(`${ADMIN_API}/overview`));
}

export async function fetchSubmissionTrend(
  bankId?: string | number,
): Promise<SubmissionTrendResponse> {
  const qs = buildQuery({ bank_id: bankId });
  return httpClient(apiUrl(`${ADMIN_API}/submission-trend${qs}`));
}

// ==================== 认证 ====================

export async function fetchAdminSession(): Promise<AdminSessionResponse> {
  return httpClient(apiUrl(`${ADMIN_API}/session`));
}

export async function loginAdmin(
  username: string,
  password: string,
): Promise<void> {
  await httpClient(apiUrl(`${ADMIN_API}/login`), {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function logoutAdmin(): Promise<void> {
  await httpClient(apiUrl(`${ADMIN_API}/logout`), { method: "POST" });
}

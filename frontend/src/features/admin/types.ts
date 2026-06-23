/**
 * 后端数据模型类型定义
 * 对应 app/models.py 中的 6 张表
 */

/** 题目配对项 — 嵌套在题库中，无独立 CRUD */
export interface QuestionItem {
  id?: number;
  left_text: string;
  right_text: string;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

/** 题库 */
export interface QuestionBank {
  id: number;
  name: string;
  slug: string;
  description: string;
  announcement: string;
  is_active: boolean;
  leaderboard_limit: number;
  submission_style: SubmissionStyleKey;
  item_count: number;
  created_at: string;
  updated_at: string;
  items?: QuestionItem[];
}

/** 题库创建/更新载荷 */
export interface QuestionBankPayload {
  name: string;
  slug: string;
  description: string;
  announcement: string;
  is_active: boolean;
  leaderboard_limit: number;
  submission_style: SubmissionStyleKey;
  items: Array<Pick<QuestionItem, 'left_text' | 'right_text'>>;
}

/** 排行榜记录（最佳成绩） */
export interface LeaderboardRecord {
  id: number;
  question_bank_id: number;
  student_class: string;
  student_id: string;
  student_name: string;
  correct_count: number;
  total_pairs: number;
  score: number;
  elapsed_seconds: number;
  matched_pair_ids: string;
  is_manual: boolean;
  submitted_at: string;
  created_at?: string;
  updated_at?: string;
  rank?: number;
}

/** 排行榜记录创建/更新载荷 */
export interface LeaderboardRecordPayload {
  student_class: string;
  student_id: string;
  student_name: string;
  correct_count: number;
  elapsed_seconds: number;
  score?: number | null;
}

/** 提交流水（每次提交都记录，不合并） */
export interface SubmissionLog {
  id: number;
  question_bank_id: number;
  student_class: string;
  student_id: string;
  student_name: string;
  correct_count: number;
  total_pairs: number;
  score: number;
  elapsed_seconds: number;
  ip_address: string;
  is_manual: boolean;
  submitted_at: string;
  created_at?: string;
}

/** IP 黑名单记录 */
export interface IpBlacklistEntry {
  id: number;
  ip_address: string;
  reason: string;
  created_at: string;
}

/** IP 黑名单创建载荷 */
export interface IpBlacklistPayload {
  ip_address: string;
  reason?: string;
}

/** 访问日志 */
export interface AccessLog {
  id: number;
  question_bank_id: number | null;
  page_path: string;
  device: string;
  ip_address: string;
  region: string;
  user_agent: string;
  visited_at: string;
}

/** 站点设置（单行表） */
export interface SiteSettings {
  default_question_bank_id: number | null;
  default_question_bank_slug: string | null;
}

/** 概览统计 */
export interface AdminOverviewStats {
  bank_count: number;
  active_bank_count: number;
  total_question_count: number;
  submission_count_7d: number;
}

/** 提交趋势 */
export interface SubmissionTrendResponse {
  dates: string[];
  series: Array<{
    bank_id: number;
    bank_name: string;
    data: number[];
  }>;
}

/** 提交页样式选项 */
export type SubmissionStyleKey = 'classic' | 'slate' | 'paper';

export interface SubmissionStyle {
  key: SubmissionStyleKey;
  name: string;
  description: string;
}

/** 列表响应信封 */
export interface ListResponse<T> {
  total: number;
  entries: T[];
}

/** 认证会话响应 */
export interface AdminSessionResponse {
  authenticated: boolean;
  username: string | null;
}

/** 批量删除响应 */
export interface BatchDeleteResponse {
  deleted: number;
}

/** 随机 slug 响应 */
export interface RandomSlugResponse {
  slug: string;
}

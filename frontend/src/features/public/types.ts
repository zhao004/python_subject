/**
 * 公开端学生信息与排行榜条目类型定义
 *
 * 与后端 /api/public/* 响应结构对齐。
 */

/** 配对题目项（后端 word_pairs 数组元素） */
export interface WordPair {
  id: number;
  left_text: string;
  right_text: string;
}

/** 题库基本信息（嵌套在 quiz 响应中） */
export interface QuizQuestionBank {
  id: number;
  name: string;
  slug: string;
  description: string;
  announcement: string | null;
  is_active: boolean;
  leaderboard_limit: number;
  submission_style: string;
}

/** 测验配置（GET /api/public/question-banks/:slug/quiz 响应） */
export interface QuizData {
  question_bank: QuizQuestionBank;
  word_pairs: WordPair[];
  total_pairs: number;
  points_per_pair: number;
}

/** 默认题库响应（GET /api/public/default-question-bank） */
export interface DefaultQuestionBankResponse {
  question_bank: { slug: string } | null;
}

/** 排行榜条目（GET /api/public/question-banks/:slug/leaderboard 响应 entries 元素） */
export interface LeaderboardEntry {
  id: number;
  rank: number;
  student_class: string;
  student_id: string;
  student_name: string;
  score: number;
  correct_count: number;
  total_pairs: number;
  elapsed_seconds: number;
  submitted_at: string;
}

/** 排行榜响应 */
export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
}

/** 成绩提交后的记录详情 */
export interface ScoreRecord {
  student_class: string;
  student_id: string;
  student_name: string;
  score: number;
  correct_count: number;
  total_pairs: number;
  elapsed_seconds: number;
}

/** 成绩提交响应（POST /api/public/question-banks/:slug/scores） */
export interface ScoreSubmissionResult {
  saved_as_best: boolean;
  record: ScoreRecord;
}

/** 学生信息表单（前端内部状态） */
export interface StudentForm {
  studentClass: string;
  studentId: string;
  studentName: string;
}

/** 卡片项（buildBoard 生成，前端内部状态） */
export interface BoardItem {
  uid: string;
  pairId: number;
  side: "left" | "right";
  text: string;
}

/** 前端路由解析结果 */
export interface RouteInfo {
  page: "home" | "quiz" | "leaderboard" | "admin";
  slug?: string;
  path: string;
}

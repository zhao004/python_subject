import type {
  DefaultQuestionBankResponse,
  LeaderboardResponse,
  QuizData,
  ScoreSubmissionResult,
} from "./types";

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * 解析 API 响应，失败时抛出带中文提示的异常。
 *
 * @param response Fetch 返回对象。
 * @returns JSON 响应体。
 * @throws {Error} 当服务端返回非 2xx 或响应不可解析时抛出。
 */
async function parseJsonResponse(response: Response): Promise<any> {
  let body = null;
  try {
    body = await response.json();
  } catch {
    throw new Error("服务端响应格式不正确");
  }

  if (!response.ok) {
    const detail = Array.isArray(body.detail)
      ? body.detail.map((item: { msg: string }) => item.msg).join("；")
      : body.detail;
    throw new Error(detail || "请求失败，请稍后重试");
  }

  return body;
}

/**
 * 解析空响应，仅检查 HTTP 状态码。
 *
 * @param response Fetch 返回对象。
 * @throws {Error} 当服务端返回非 2xx 时抛出。
 */
async function parseEmptyResponse(response: Response): Promise<void> {
  if (!response.ok) {
    let detail = "请求失败，请稍后重试";
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {
      // 访问记录接口允许空响应，错误信息不影响主流程。
    }
    throw new Error(detail);
  }
}

/**
 * 统一发起 JSON 请求。
 *
 * @param url 请求地址。
 * @param options 请求选项。
 * @returns 响应体。
 */
async function fetchJson(url: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...JSON_HEADERS,
      ...(options.headers || {}),
    },
  });
  return parseJsonResponse(response);
}

/**
 * 获取公开默认题库。
 *
 * @returns 默认题库响应。
 */
export async function fetchDefaultQuestionBank(): Promise<DefaultQuestionBankResponse> {
  return fetchJson("/api/public/default-question-bank");
}

/**
 * 获取指定题库测验配置。
 *
 * @param slug 题库链接标识。
 * @returns 测验配置。
 */
export async function fetchQuizBySlug(slug: string): Promise<QuizData> {
  return fetchJson(`/api/public/question-banks/${encodeURIComponent(slug)}/quiz`);
}

/**
 * 提交指定题库成绩，服务端会重新计算分数并维护最佳记录。
 *
 * @param slug 题库链接标识。
 * @param payload 成绩提交数据。
 * @returns 提交结果。
 */
export async function submitScoreBySlug(
  slug: string,
  payload: {
    student_class: string;
    student_id: string;
    student_name: string;
    elapsed_seconds: number;
    matched_pair_ids: number[];
  },
): Promise<ScoreSubmissionResult> {
  return fetchJson(`/api/public/question-banks/${encodeURIComponent(slug)}/scores`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * 获取指定题库排行榜。
 *
 * @param slug 题库链接标识。
 * @param limit 返回条数。
 * @returns 排行榜响应。
 */
export async function fetchLeaderboardBySlug(slug: string, limit: number = 10): Promise<LeaderboardResponse> {
  return fetchJson(
    `/api/public/question-banks/${encodeURIComponent(slug)}/leaderboard?limit=${encodeURIComponent(limit)}`,
  );
}

/**
 * 上报公开页面访问记录。
 *
 * @param payload 访问记录。
 * @throws {Error} 当服务端返回非 2xx 时抛出（调用方应 catch 忽略）。
 */
export async function submitAccessLog(payload: {
  page_path: string;
  question_bank_slug: string;
}): Promise<void> {
  const response = await fetch("/api/public/access-logs", {
    method: "POST",
    credentials: "same-origin",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  await parseEmptyResponse(response);
}

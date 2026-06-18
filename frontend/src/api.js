const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * 解析 API 响应，失败时抛出带中文提示的异常。
 *
 * @param {Response} response Fetch 返回对象。
 * @returns {Promise<object>} JSON 响应体。
 * @throws {Error} 当服务端返回非 2xx 或响应不可解析时抛出。
 */
async function parseJsonResponse(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    throw new Error('服务端响应格式不正确');
  }

  if (!response.ok) {
    const detail = Array.isArray(body.detail)
      ? body.detail.map((item) => item.msg).join('；')
      : body.detail;
    throw new Error(detail || '请求失败，请稍后重试');
  }

  return body;
}

/**
 * 获取测验配置。
 *
 * @returns {Promise<object>} 测验配置。
 */
export async function fetchQuiz() {
  const response = await fetch('/api/quiz');
  return parseJsonResponse(response);
}

/**
 * 提交成绩，服务端会重新计算分数并维护最佳记录。
 *
 * @param {object} payload 成绩提交数据。
 * @returns {Promise<object>} 提交结果。
 */
export async function submitScore(payload) {
  const response = await fetch('/api/scores', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response);
}

/**
 * 获取全局排行榜。
 *
 * @param {number} limit 返回条数。
 * @returns {Promise<object>} 排行榜响应。
 */
export async function fetchLeaderboard(limit = 10) {
  const response = await fetch(`/api/leaderboard?limit=${encodeURIComponent(limit)}`);
  return parseJsonResponse(response);
}


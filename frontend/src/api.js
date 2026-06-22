const JSON_HEADERS = {'Content-Type': 'application/json'};

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
        const detail = Array.isArray(body.detail) ? body.detail.map((item) => item.msg).join('；') : body.detail;
        throw new Error(detail || '请求失败，请稍后重试');
    }

    return body;
}

/**
 * 解析空响应。
 *
 * @param {Response} response Fetch 返回对象。
 * @returns {Promise<void>} 无内容。
 */
async function parseEmptyResponse(response) {
    if (!response.ok) {
        let detail = '请求失败，请稍后重试';
        try {
            const body = await response.json();
            detail = body.detail || detail;
        } catch {
            // 访问记录和注销接口允许空响应，错误信息不影响主流程。
        }
        throw new Error(detail);
    }
}

/**
 * 统一发起 JSON 请求。
 *
 * @param {string} url 请求地址。
 * @param {RequestInit} options 请求选项。
 * @returns {Promise<object>} 响应体。
 */
async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin', ...options, headers: {
            ...JSON_HEADERS, ...(options.headers || {}),
        },
    });
    return parseJsonResponse(response);
}

/**
 * 获取公开默认题库。
 *
 * @returns {Promise<object>} 默认题库响应。
 */
export async function fetchDefaultQuestionBank() {
    return fetchJson('/api/public/default-question-bank');
}

/**
 * 获取指定题库测验配置。
 *
 * @param {string} slug 题库链接标识。
 * @returns {Promise<object>} 测验配置。
 */
export async function fetchQuizBySlug(slug) {
    return fetchJson(`/api/public/question-banks/${encodeURIComponent(slug)}/quiz`);
}

/**
 * 提交指定题库成绩，服务端会重新计算分数并维护最佳记录。
 *
 * @param {string} slug 题库链接标识。
 * @param {object} payload 成绩提交数据。
 * @returns {Promise<object>} 提交结果。
 */
export async function submitScoreBySlug(slug, payload) {
    return fetchJson(`/api/public/question-banks/${encodeURIComponent(slug)}/scores`, {
        method: 'POST', body: JSON.stringify(payload),
    });
}

/**
 * 获取指定题库排行榜。
 *
 * @param {string} slug 题库链接标识。
 * @param {number} limit 返回条数。
 * @returns {Promise<object>} 排行榜响应。
 */
export async function fetchLeaderboardBySlug(slug, limit = 10) {
    return fetchJson(`/api/public/question-banks/${encodeURIComponent(slug)}/leaderboard?limit=${encodeURIComponent(limit)}`);
}

/**
 * 上报公开页面访问记录。
 *
 * @param {object} payload 访问记录。
 * @returns {Promise<void>} 无返回值。
 */
export async function submitAccessLog(payload) {
    const response = await fetch('/api/public/access-logs', {
        method: 'POST', credentials: 'same-origin', headers: JSON_HEADERS, body: JSON.stringify(payload),
    });
    await parseEmptyResponse(response);
}

/**
 * 读取管理员登录状态。
 *
 * @returns {Promise<object>} 登录状态。
 */
export async function fetchAdminSession() {
    return fetchJson('/api/admin/session');
}

/**
 * 管理员登录。
 *
 * @param {object} payload 登录表单。
 * @returns {Promise<object>} 登录结果。
 */
export async function loginAdmin(payload) {
    return fetchJson('/api/admin/login', {
        method: 'POST', body: JSON.stringify(payload),
    });
}

/**
 * 管理员退出登录。
 *
 * @returns {Promise<void>} 无返回值。
 */
export async function logoutAdmin() {
    const response = await fetch('/api/admin/logout', {
        method: 'POST', credentials: 'same-origin',
    });
    await parseEmptyResponse(response);
}

/**
 * 获取题库列表（支持分页与搜索筛选）。
 *
 * @param {object} [options] 查询参数。
 * @param {number} [options.limit=100] 每页条数（1-100）。
 * @param {number} [options.offset=0] 偏移量。
 * @param {string} [options.search] 搜索关键字（匹配名称或 slug）。
 * @param {boolean} [options.isActive] 启用状态筛选。
 * @returns {Promise<{total: number, entries: Array<object>}>} 题库分页结果。
 */
export async function fetchAdminQuestionBanks({ limit = 100, offset = 0, search = '', isActive } = {}) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (search) {
        params.set('search', search);
    }
    if (isActive !== undefined && isActive !== null) {
        params.set('is_active', String(isActive));
    }
    return fetchJson(`/api/admin/question-banks?${params.toString()}`);
}

/**
 * 获取题库详情。
 *
 * @param {number} bankId 题库 ID。
 * @returns {Promise<object>} 题库详情。
 */
export async function fetchAdminQuestionBank(bankId) {
    return fetchJson(`/api/admin/question-banks/${encodeURIComponent(bankId)}`);
}

/**
 * 创建题库。
 *
 * @param {object} payload 题库表单。
 * @returns {Promise<object>} 创建结果。
 */
export async function createAdminQuestionBank(payload) {
    return fetchJson('/api/admin/question-banks', {
        method: 'POST', body: JSON.stringify(payload),
    });
}

/**
 * 更新题库。
 *
 * @param {number} bankId 题库 ID。
 * @param {object} payload 题库表单。
 * @returns {Promise<object>} 更新结果。
 */
export async function updateAdminQuestionBank(bankId, payload) {
    return fetchJson(`/api/admin/question-banks/${encodeURIComponent(bankId)}`, {
        method: 'PUT', body: JSON.stringify(payload),
    });
}

/**
 * 删除题库。
 *
 * @param {number} bankId 题库 ID。
 * @returns {Promise<void>} 无返回值。
 */
export async function deleteAdminQuestionBank(bankId) {
    const response = await fetch(`/api/admin/question-banks/${encodeURIComponent(bankId)}`, {
        method: 'DELETE', credentials: 'same-origin',
    });
    await parseEmptyResponse(response);
}

/**
 * 获取站点设置。
 *
 * @returns {Promise<object>} 站点设置。
 */
export async function fetchSiteSettings() {
    return fetchJson('/api/admin/site-settings');
}

/**
 * 更新站点设置。
 *
 * @param {object} payload 站点设置。
 * @returns {Promise<object>} 更新结果。
 */
export async function updateSiteSettings(payload) {
    return fetchJson('/api/admin/site-settings', {
        method: 'PUT', body: JSON.stringify(payload),
    });
}

/**
 * 获取后台排行榜（支持分页与搜索）。
 *
 * @param {number} bankId 题库 ID。
 * @param {object} [options] 查询参数。
 * @param {number} [options.limit=100] 每页条数（1-100）。
 * @param {number} [options.offset=0] 偏移量。
 * @param {string} [options.search] 搜索关键字（匹配学生姓名或学号）。
 * @returns {Promise<{total: number, entries: Array<object>}>} 排行榜分页结果。
 */
export async function fetchAdminLeaderboard(bankId, { limit = 100, offset = 0, search = '' } = {}) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (search) {
        params.set('search', search);
    }
    return fetchJson(`/api/admin/question-banks/${encodeURIComponent(bankId)}/leaderboard?${params.toString()}`);
}

/**
 * 创建后台排行榜记录。
 *
 * @param {number} bankId 题库 ID。
 * @param {object} payload 记录表单。
 * @returns {Promise<object>} 创建结果。
 */
export async function createAdminLeaderboardRecord(bankId, payload) {
    return fetchJson(`/api/admin/question-banks/${encodeURIComponent(bankId)}/leaderboard`, {
        method: 'POST', body: JSON.stringify(payload),
    });
}

/**
 * 更新后台排行榜记录。
 *
 * @param {number} recordId 记录 ID。
 * @param {object} payload 记录表单。
 * @returns {Promise<object>} 更新结果。
 */
export async function updateAdminLeaderboardRecord(recordId, payload) {
    return fetchJson(`/api/admin/leaderboard-records/${encodeURIComponent(recordId)}`, {
        method: 'PUT', body: JSON.stringify(payload),
    });
}

/**
 * 删除后台排行榜记录。
 *
 * @param {number} recordId 记录 ID。
 * @returns {Promise<void>} 无返回值。
 */
export async function deleteAdminLeaderboardRecord(recordId) {
    const response = await fetch(`/api/admin/leaderboard-records/${encodeURIComponent(recordId)}`, {
        method: 'DELETE', credentials: 'same-origin',
    });
    await parseEmptyResponse(response);
}

/**
 * 批量删除后台排行榜记录。
 *
 * @param {Array<number>} ids 排行榜记录 ID 列表。
 * @returns {Promise<object>} 包含 deleted 字段的对象。
 */
export async function batchDeleteLeaderboardRecords(ids) {
    return fetchJson('/api/admin/leaderboard-records/batch-delete', {
        method: 'POST', body: JSON.stringify({ ids }),
    });
}

/**
 * 获取后台访问记录（支持分页、按题库过滤与搜索）。
 *
 * @param {object} [options] 查询参数。
 * @param {number} [options.limit=100] 每页条数（1-500）。
 * @param {number} [options.offset=0] 偏移量。
 * @param {number} [options.bankId] 题库 ID，传入则仅返回该题库的访问记录。
 * @param {string} [options.search] 搜索关键字（匹配路径、IP 或地区）。
 * @returns {Promise<{total: number, entries: Array<object>}>} 访问记录分页结果。
 */
export async function fetchAdminAccessLogs({ limit = 100, offset = 0, bankId = null, search = '' } = {}) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (bankId) {
        params.set('bank_id', String(bankId));
    }
    if (search) {
        params.set('search', search);
    }
    return fetchJson(`/api/admin/access-logs?${params.toString()}`);
}

/**
 * 批量删除后台访问记录。
 *
 * @param {Array<number>} ids 访问记录 ID 列表。
 * @returns {Promise<object>} 包含 deleted 字段的对象。
 */
export async function batchDeleteAccessLogs(ids) {
    return fetchJson('/api/admin/access-logs/batch-delete', {
        method: 'POST', body: JSON.stringify({ ids }),
    });
}

/**
 * 获取提交页样式选项。
 *
 * @returns {Promise<Array<object>>} 样式选项。
 */
export async function fetchSubmissionStyles() {
    return fetchJson('/api/admin/submission-styles');
}

/**
 * 生成随机题库 slug。
 *
 * @returns {Promise<object>} 包含 slug 字段的对象。
 */
export async function fetchRandomSlug() {
    return fetchJson('/api/admin/question-banks/random-slug', {
        method: 'POST',
    });
}

/**
 * 批量删除题库。
 *
 * @param {Array<number>} ids 题库 ID 列表。
 * @returns {Promise<object>} 包含 deleted 字段的对象。
 */
export async function batchDeleteQuestionBanks(ids) {
    return fetchJson('/api/admin/question-banks/batch-delete', {
        method: 'POST', body: JSON.stringify({ ids }),
    });
}

/**
 * 获取概览统计数据。
 *
 * @returns {Promise<object>} 概览统计。
 */
export async function fetchAdminOverview() {
    return fetchJson('/api/admin/overview');
}

/**
 * 获取 7 天提交趋势。
 *
 * @param {number} [bankId] 题库 ID，可选过滤。
 * @returns {Promise<object>} 趋势数据。
 */
export async function fetchSubmissionTrend(bankId = null) {
    const params = new URLSearchParams();
    if (bankId) {
        params.set('bank_id', String(bankId));
    }
    const query = params.toString();
    return fetchJson(`/api/admin/submission-trend${query ? `?${query}` : ''}`);
}

/**
 * 获取题库提交日志（支持分页与搜索）。
 *
 * @param {number} bankId 题库 ID。
 * @param {object} [options] 查询参数。
 * @param {number} [options.limit=100] 每页条数（1-500）。
 * @param {number} [options.offset=0] 偏移量。
 * @param {string} [options.search] 搜索关键字（匹配学生姓名或学号）。
 * @returns {Promise<{total: number, entries: Array<object>}>} 提交日志分页结果。
 */
export async function fetchBankSubmissionLogs(bankId, { limit = 100, offset = 0, search = '' } = {}) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (search) {
        params.set('search', search);
    }
    return fetchJson(`/api/admin/question-banks/${encodeURIComponent(bankId)}/submission-logs?${params.toString()}`);
}

/**
 * 批量删除指定题库的提交日志。
 *
 * @param {number} bankId 题库 ID。
 * @param {Array<number>} ids 提交日志 ID 列表。
 * @returns {Promise<object>} 包含 deleted 字段的对象。
 */
export async function batchDeleteSubmissionLogs(bankId, ids) {
    return fetchJson(`/api/admin/question-banks/${encodeURIComponent(bankId)}/submission-logs/batch-delete`, {
        method: 'POST', body: JSON.stringify({ ids }),
    });
}

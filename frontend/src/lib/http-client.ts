/**
 * 后台 API 通用 HTTP 客户端
 *
 * 替代原 src/admin/httpClient.ts，移除 react-admin HttpError 依赖，
 * 改用自定义 ApiError。保留 credentials:'include' + FastAPI detail 解析逻辑。
 */

/** 自定义 API 错误，替代 react-admin 的 HttpError */
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** FastAPI detail 解析：支持字符串或 Pydantic 校验错误数组 */
function parseErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "请求失败";
  const detail = (body as Record<string, unknown>).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map(
        (item: Record<string, unknown>) =>
          String(item.msg || "校验错误") +
          (Array.isArray(item.loc) ? `（字段: ${item.loc.join(".")}）` : ""),
      )
      .join("；");
  }
  return "请求失败";
}

/** 构建 query string，跳过 null/undefined/空字符串 */
export function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** 通用 fetch 封装，强制携带 Cookie */
export async function httpClient<T = unknown>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // 非 JSON 响应体，忽略
    }
    throw new ApiError(parseErrorMessage(body), response.status, body);
  }

  // 204 No Content 或空响应体
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

const API_BASE = "/api";

/** 构造完整 API URL */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

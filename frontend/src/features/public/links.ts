/** 公开题库链接工具，统一管理新旧路径和完整地址生成。 */

export const PUBLIC_LEADERBOARD_SEGMENT = "leaderboard";
export const LEGACY_PUBLIC_BANK_SEGMENT = "b";
export const PUBLIC_SLUG_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

const RESERVED_ROOT_SEGMENTS = new Set([
  "admin",
  "api",
  "assets",
  "b",
  "docs",
  "openapi.json",
  "redoc",
]);

/** 裁剪题库短码，避免空白字符进入路由或复制地址。 */
export function normalizePublicSlug(slug: string): string {
  return String(slug ?? "").trim();
}

/** 判断根路径片段是否被系统路由占用，防止公开短码误解析为题库。 */
export function isReservedPublicRootSegment(segment: string): boolean {
  return RESERVED_ROOT_SEGMENTS.has(normalizePublicSlug(segment).toLowerCase());
}

/** 判断片段是否符合公开题库短码的基础格式。 */
export function isValidPublicSlugSegment(segment: string): boolean {
  return PUBLIC_SLUG_PATTERN.test(normalizePublicSlug(segment));
}

/** 构建新版公开答题路径：/{slug}。空短码回退到首页。 */
export function buildPublicQuizPath(slug: string): string {
  const safeSlug = normalizePublicSlug(slug);
  if (!safeSlug) {
    return "/";
  }
  return `/${encodeURIComponent(safeSlug)}`;
}

/** 构建新版公开排行榜路径：/{slug}/leaderboard。 */
export function buildPublicLeaderboardPath(slug: string): string {
  const quizPath = buildPublicQuizPath(slug);
  if (quizPath === "/") {
    return "/";
  }
  return `${quizPath}/${PUBLIC_LEADERBOARD_SEGMENT}`;
}

/** 构建旧版答题路径，用于兼容重定向。 */
export function buildLegacyPublicQuizPath(slug: string): string {
  const safeSlug = normalizePublicSlug(slug);
  if (!safeSlug) {
    return "/";
  }
  return `/${LEGACY_PUBLIC_BANK_SEGMENT}/${encodeURIComponent(safeSlug)}`;
}

/** 构建旧版排行榜路径，用于兼容重定向。 */
export function buildLegacyPublicLeaderboardPath(slug: string): string {
  const quizPath = buildLegacyPublicQuizPath(slug);
  if (quizPath === "/") {
    return "/";
  }
  return `${quizPath}/${PUBLIC_LEADERBOARD_SEGMENT}`;
}

/** 构建公开答题完整地址；浏览器环境缺失或 origin 异常时回退为相对路径。 */
export function buildPublicQuizUrl(slug: string, origin?: string): string {
  return buildAbsolutePublicUrl(buildPublicQuizPath(slug), origin);
}

function buildAbsolutePublicUrl(path: string, origin?: string): string {
  const browserOrigin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  const baseOrigin = origin ?? browserOrigin;
  if (!baseOrigin) {
    return path;
  }
  try {
    return new URL(path, baseOrigin).toString();
  } catch {
    return path;
  }
}

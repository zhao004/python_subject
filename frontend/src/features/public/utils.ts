import {
  APP_TIME_ZONE,
  DEFAULT_STUDENT_FORM,
  FIELD_LIMITS,
  STUDENT_ID_LENGTH,
  STUDENT_ID_PATTERN,
} from "./constants";
import {
  LEGACY_PUBLIC_BANK_SEGMENT,
  PUBLIC_LEADERBOARD_SEGMENT,
  isReservedPublicRootSegment,
  isValidPublicSlugSegment,
} from "./links";
import type { BoardItem, RouteInfo, StudentForm, WordPair } from "./types";

/**
 * 解析当前浏览器路径，避免未知路径导致空白页。
 *
 * 路由约定：
 * - /admin→后台
 * - /:slug→答题页
 * - /:slug/leaderboard→排行榜页
 * - /b/:slug→旧版答题链接，仅用于兼容已复制出去的地址
 * - /b/:slug/leaderboard→旧版排行榜链接，仅用于兼容已复制出去的地址
 * - 其余→首页
 *
 * @param pathname 浏览器路径，默认取 window.location.pathname。
 * @returns 路由信息对象。
 */
export function readRoute(pathname: string = window.location.pathname): RouteInfo {
  const path = pathname;
  if (path.startsWith("/admin")) {
    return { page: "admin", path };
  }
  const legacyPattern = new RegExp(
    `^/${LEGACY_PUBLIC_BANK_SEGMENT}/([^/]+)(?:/(${PUBLIC_LEADERBOARD_SEGMENT}))?$`,
  );
  const legacyMatch = path.match(legacyPattern);
  if (legacyMatch) {
    return buildRouteFromSlugMatch(path, legacyMatch[1], legacyMatch[2]);
  }
  const publicMatch = path.match(/^\/([^/]+)(?:\/([^/]+))?$/);
  if (
    publicMatch &&
    publicMatch[2] !== undefined &&
    publicMatch[2] !== PUBLIC_LEADERBOARD_SEGMENT
  ) {
    return { page: "home", path };
  }
  if (
    publicMatch &&
    isValidPublicSlugSegment(publicMatch[1]) &&
    !isReservedPublicRootSegment(publicMatch[1])
  ) {
    return buildRouteFromSlugMatch(path, publicMatch[1], publicMatch[2]);
  }
  return { page: "home", path };
}

/** 从路由正则匹配结果中安全解码 slug，解码失败时回退首页。 */
function buildRouteFromSlugMatch(
  path: string,
  encodedSlug: string,
  segment?: string,
): RouteInfo {
  try {
    const slug = decodeURIComponent(encodedSlug);
    return {
      page: segment === PUBLIC_LEADERBOARD_SEGMENT ? "leaderboard" : "quiz",
      slug,
      path,
    };
  } catch {
    return { page: "home", path };
  }
}

/**
 * Fisher-Yates 洗牌，返回新数组避免修改原始数据。
 *
 * @param items 待随机排序的数组。
 * @returns 随机后的新数组。
 */
export function shuffleItems<T>(items: T[]): T[] {
  const copiedItems = [...items];
  for (let index = copiedItems.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copiedItems[index], copiedItems[randomIndex]] = [copiedItems[randomIndex], copiedItems[index]];
  }
  return copiedItems;
}

/**
 * 将秒数格式化为 mm:ss 或 h:mm:ss。
 *
 * @param totalSeconds 总秒数。
 * @returns 展示用时间。
 */
export function formatElapsedTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(Number(totalSeconds)) ? Number(totalSeconds) : 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 将服务端时间按应用时区格式化为可读时间。
 *
 * @param submittedAt 服务端返回的 ISO 时间。
 * @returns 本地时间文本。
 */
export function formatSubmittedTime(submittedAt: string): string {
  const submittedDate = new Date(submittedAt);
  if (Number.isNaN(submittedDate.getTime())) {
    return "时间未知";
  }
  return submittedDate.toLocaleString("zh-CN", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 构建左右两列卡片，各自独立洗牌。
 *
 * @param wordPairs 后端返回的配对题目。
 * @returns 随机后的左右列表。
 */
export function buildBoard(wordPairs: WordPair[]): { leftItems: BoardItem[]; rightItems: BoardItem[] } {
  const leftItems = wordPairs.map((item) => ({
    uid: `left-${item.id}`,
    pairId: item.id,
    side: "left" as const,
    text: item.left_text,
  }));
  const rightItems = wordPairs.map((item) => ({
    uid: `right-${item.id}`,
    pairId: item.id,
    side: "right" as const,
    text: item.right_text,
  }));

  return {
    leftItems: shuffleItems(leftItems),
    rightItems: shuffleItems(rightItems),
  };
}

/**
 * 生成题库隔离的学生信息存储键。
 *
 * @param slug 题库标识。
 * @returns localStorage 键。
 */
export function studentProfileStorageKey(slug: string): string {
  return `wordMatchStudentProfile:v2:${slug}`;
}

/**
 * 将学生信息统一裁剪并去除首尾空白。
 *
 * @param form 学生信息表单。
 * @returns 标准化后的学生信息。
 */
export function normalizeStudentForm(form: StudentForm): StudentForm {
  return {
    studentClass: String(form.studentClass ?? "").trim().slice(0, FIELD_LIMITS.studentClass),
    studentId: String(form.studentId ?? "").trim().slice(0, FIELD_LIMITS.studentId),
    studentName: String(form.studentName ?? "").trim().slice(0, FIELD_LIMITS.studentName),
  };
}

/**
 * 校验学生信息，返回第一个错误提示。
 *
 * @param form 学生信息表单。
 * @returns 错误提示，空字符串表示通过。
 */
export function validateStudentForm(form: StudentForm): string {
  const normalizedForm = normalizeStudentForm(form);
  const requiredFields: ReadonlyArray<readonly [keyof StudentForm, string]> = [
    ["studentClass", "班级"],
    ["studentId", "学号"],
    ["studentName", "姓名"],
  ];

  for (const [fieldName, label] of requiredFields) {
    const value = normalizedForm[fieldName];
    if (!value) {
      return `请填写${label}`;
    }
  }

  if (!STUDENT_ID_PATTERN.test(normalizedForm.studentId)) {
    return `学号必须是 ${STUDENT_ID_LENGTH} 位数字`;
  }

  return "";
}

/**
 * 读取题库内记住的学生信息。
 *
 * @param slug 题库标识。
 * @returns 本地记忆状态。
 */
export function readRememberedStudentProfile(slug: string): { form: StudentForm; rememberStudent: boolean } {
  try {
    const rawProfile = window.localStorage.getItem(studentProfileStorageKey(slug));
    if (!rawProfile) {
      return { form: { ...DEFAULT_STUDENT_FORM }, rememberStudent: false };
    }
    const parsedProfile = JSON.parse(rawProfile);
    return {
      form: normalizeStudentForm(parsedProfile),
      rememberStudent: true,
    };
  } catch {
    return { form: { ...DEFAULT_STUDENT_FORM }, rememberStudent: false };
  }
}

/**
 * 保存学生信息到本地。
 *
 * @param slug 题库标识。
 * @param form 已通过校验的学生信息。
 * @returns 是否保存成功。
 */
export function saveRememberedStudentProfile(slug: string, form: StudentForm): boolean {
  try {
    window.localStorage.setItem(studentProfileStorageKey(slug), JSON.stringify(normalizeStudentForm(form)));
    return true;
  } catch {
    return false;
  }
}

/**
 * 清除题库内记住的学生信息。
 *
 * @param slug 题库标识。
 */
export function removeRememberedStudentProfile(slug: string): void {
  try {
    window.localStorage.removeItem(studentProfileStorageKey(slug));
  } catch {
    // 浏览器可能禁用本地存储，清理失败时保持静默。
  }
}

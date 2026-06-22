/**
 * 公开端常量定义
 *
 * 从原 App.jsx 提取，保持业务语义不变。
 * 避免魔法值，所有可配置项集中管理。
 */

/** 首次操作前的默认提示文案 */
export const DEFAULT_MESSAGE = "先点击任意英文或中文，计时从第一次操作开始";

/** 一秒的毫秒数，用于计时器 interval */
export const ONE_SECOND_MS = 1000;

/** Toast 自动消失时间（毫秒） */
export const TOAST_LIFETIME_MS = 3000;

/** 排行榜回退条数上限，公开端默认拉取前 50 名 */
export const LEADERBOARD_FALLBACK_LIMIT = 50;

/** 应用统一时区 */
export const APP_TIME_ZONE = "Asia/Shanghai";

/** 学号长度（固定 9 位数字） */
export const STUDENT_ID_LENGTH = 9;

/** 学号正则：9 位纯数字 */
export const STUDENT_ID_PATTERN = /^\d{9}$/;

/** 学生信息字段长度限制 */
export const FIELD_LIMITS = {
  studentClass: 40,
  studentId: STUDENT_ID_LENGTH,
  studentName: 40,
} as const;

/** 学生信息表单默认值 */
export const DEFAULT_STUDENT_FORM = {
  studentClass: "",
  studentId: "",
  studentName: "",
} as const;

/** 站点标题，从环境变量读取，异常时回退默认值 */
export const SITE_TITLE = String(
  import.meta.env.VITE_SITE_TITLE ?? "配对检测系统",
).trim() || "配对检测系统";

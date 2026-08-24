/**
 * Excel 导出工具
 *
 * 基于 SheetJS (xlsx) 封装通用导出函数。
 * 列定义顺序即输出列顺序，label 作为表头。
 * 另提供 fetchAllPages 辅助函数，分页拉取超出单次 limit 上限的全量数据。
 */

import * as XLSX from "xlsx";
import type { ListResponse } from "@/features/admin/types";

/** 列定义：key 取值、label 表头 */
export interface ExcelColumn<T> {
  key: keyof T;
  label: string;
}

/** 后端各列表端点的 limit 上限不一致，此处取最小值 100 以兼容所有端点 */
const DEFAULT_FETCH_LIMIT = 100;

/**
 * 分页拉取全量数据，自动以 limit 为步长循环请求直到取完。
 *
 * @param fetcher 传入 offset + limit，返回 ListResponse<T>
 * @param limit 单次请求条数，须 <= 对应后端端点的 limit 上限（排行榜/提交流水为 100，访问日志为 500）
 * @param maxRecords 安全上限，避免极端数据耗尽内存（默认 50000）
 */
export async function fetchAllPages<T>(
  fetcher: (offset: number, limit: number) => Promise<ListResponse<T>>,
  limit = DEFAULT_FETCH_LIMIT,
  maxRecords = 50000,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetcher(offset, limit);
    all.push(...res.entries);
    if (res.entries.length < limit) break;
    offset += limit;
    if (all.length >= maxRecords) break;
  }
  return all;
}

/**
 * 将数据导出为 .xlsx 文件并触发浏览器下载。
 *
 * @param filename 文件名（不含扩展名）
 * @param sheetName 工作表名称
 * @param columns 列定义，决定输出列与表头
 * @param rows 数据行
 */
export function exportToExcel<T extends Record<string, unknown>>(
  filename: string,
  sheetName: string,
  columns: ExcelColumn<T>[],
  rows: T[],
): void {
  // 将原始行转换为 { label: value } 形式，保证表头可读且列顺序固定
  const sheetData = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      obj[col.label] = row[col.key];
    }
    return obj;
  });

  const worksheet = XLSX.utils.json_to_sheet(sheetData, {
    // 显式指定列顺序，避免 json_to_sheet 按 key 字母序排列
    header: columns.map((c) => c.label),
  });

  // 根据表头内容粗略设置列宽
  worksheet["!cols"] = columns.map((col) => {
    const maxLen = Math.max(
      col.label.length * 2,
      ...sheetData.map((row) => String(row[col.label] ?? "").length),
    );
    return { wch: Math.min(50, Math.max(10, maxLen + 2)) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

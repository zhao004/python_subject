import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { BoardItem } from "../types";

/**
 * 配对卡片样式定义
 *
 * 状态说明：
 * - left：左侧卡片，左 border 强调色，暖色背景，粗体
 * - right：右侧卡片，右 border 品牌色，冷色背景，中等粗体
 * - selected：选中态，蓝色边框 + inset 阴影 + 浅蓝背景
 * - matched：已配对态，删除线 + 灰化 + 无阴影
 */
const matchCardVariants = cva(
  "flex w-full min-h-[3.35rem] items-center rounded-lg p-3 text-left leading-snug transition-all duration-150 cursor-pointer border border-transparent shadow-card hover:not(:disabled):-translate-y-0.5 hover:not(:disabled):shadow-cardHover sm:min-h-[3.55rem] sm:p-3.5 sm:px-4",
  {
    variants: {
      side: {
        left: "border-l-[0.32rem] border-l-brand-accent bg-brand-surface-warm font-extrabold",
        right: "border-r-[0.32rem] border-r-brand bg-brand-surface-cool font-semibold",
      },
      state: {
        default: "",
        selected:
          "border-brand-selected bg-brand-selected shadow-selected border-brand-selected-border",
        matched:
          "text-brand-text-soft bg-brand-matched-bg shadow-none cursor-default line-through opacity-70",
      },
    },
    compoundVariants: [
      {
        side: "left",
        state: "matched",
        className: "border-l-brand-accent",
      },
      {
        side: "right",
        state: "matched",
        className: "border-r-brand",
      },
    ],
    defaultVariants: {
      side: "left",
      state: "default",
    },
  },
);

type MatchCardVariantProps = VariantProps<typeof matchCardVariants>;

interface MatchCardProps {
  item: BoardItem;
  isMatched: boolean;
  isSelected: boolean;
  onClick: (item: BoardItem) => void;
}

/**
 * 单张配对卡片。
 *
 * 根据 side（left/right）和状态（selected/matched）渲染不同视觉。
 * 已配对时禁用点击。
 */
export function MatchCard({ item, isMatched, isSelected, onClick }: MatchCardProps) {
  const state: MatchCardVariantProps["state"] = isMatched
    ? "matched"
    : isSelected
      ? "selected"
      : "default";

  return (
    <button
      type="button"
      className={cn(matchCardVariants({ side: item.side, state }))}
      disabled={isMatched}
      onClick={() => onClick(item)}
    >
      <span className="min-w-0 overflow-wrap-anywhere">{item.text}</span>
    </button>
  );
}

import type {Config} from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/**
 * Tailwind 配置：双设计系统（公开端暖色 + 后台冷蓝暗色）
 *
 * 公开端 token 使用 --brand/--accent 等原始 CSS 变量，通过 .public-style-* 类切换换肤
 * 后台 token 使用 shadcn 标准 --background/--foreground 等 HSL 变量，通过 .dark 类切换暗色
 *
 * 注意：shadcn 的 accent token 重命名为 accent-hsl 以避免与公开端 --accent 冲突
 */
const config: Config = {
    darkMode: "class",
    content: [
        "./index.html",
        "./src/**/*.{js,jsx,ts,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // shadcn 后台 token（HSL 格式 CSS 变量，支持 light/dark）
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent-hsl))",
                    foreground: "hsl(var(--accent-hsl-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                // 公开端品牌色（原始 CSS 变量，支持 .public-style-* 换肤）
                brand: "var(--brand)",
                "brand-strong": "var(--brand-strong)",
                "brand-accent": "var(--accent)",
                "brand-accent-soft": "var(--accent-soft)",
                "brand-surface": "var(--surface)",
                "brand-surface-muted": "var(--surface-muted)",
                "brand-surface-cool": "var(--surface-cool)",
                "brand-surface-warm": "var(--surface-warm)",
                "brand-text": "var(--text)",
                "brand-text-soft": "var(--text-soft)",
                "brand-line": "var(--line)",
                "brand-line-strong": "var(--line-strong)",
                "brand-success": "var(--success)",
                "brand-danger": "var(--danger)",
                "brand-selected": "var(--selected)",
                "brand-selected-border": "var(--selected-border)",
                "brand-matched-bg": "var(--matched-bg)",
                "brand-hero-accent": "var(--hero-accent)",
                "brand-hero-text": "var(--hero-text)",
                "brand-message-bg": "var(--message-bg)",
                "brand-message-text": "var(--message-text)",
                "brand-input-light": "var(--input-light-bg)",
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            screens: {
                // 自定义断点对齐原 styles.css 体系：768px / 1100px / 1408px
                sm: "768px",
                lg: "1100px",
                xl: "1408px",
            },
            fontFamily: {
                sans: [
                    "Inter",
                    "PingFang SC",
                    "Microsoft YaHei",
                    "system-ui",
                    "sans-serif",
                ],
                serif: [
                    "Noto Serif SC",
                    "Songti SC",
                    "STSong",
                    "Georgia",
                    "serif",
                ],
            },
            boxShadow: {
                soft: "var(--shadow-soft)",
                card: "0 0.22rem 0.7rem rgba(41, 63, 56, 0.08)",
                cardHover: "0 0.42rem 0.95rem rgba(41, 63, 56, 0.13)",
                selected: "inset 0 0 0 0.08rem #2f6edb, 0 0.45rem 1.1rem rgba(47, 110, 219, 0.16)",
                primary: "0 0.35rem 0 var(--brand-strong)",
                primaryActive: "0 0.2rem 0 var(--brand-strong)",
                toast: "0 0.8rem 1.5rem rgba(22, 42, 40, 0.22)",
            },
        },
    },
    plugins: [tailwindcssAnimate],
};

export default config;

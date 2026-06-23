/**
 * 后台主题上下文
 *
 * 替代 react-admin useTheme + MUI createTheme。
 * 管理暗色模式切换，localStorage key 兼容 quizAdminTheme:v1。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const THEME_KEY = "quizAdminTheme:v1";
const DARK_ROOT_BACKGROUND = "hsl(220 18% 7%)";
const LIGHT_ROOT_BACKGROUND = "hsl(0 0% 100%)";

export type ThemeMode = "light" | "dark";

export function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function saveStoredTheme(mode: ThemeMode): boolean {
  try {
    localStorage.setItem(THEME_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

interface ThemeContextValue {
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme());

  /** 应用主题到 <html> 的 class */
  const applyTheme = useCallback((mode: ThemeMode) => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    if (mode === "dark") {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
      root.style.backgroundColor = DARK_ROOT_BACKGROUND;
    } else {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
      root.style.backgroundColor = LIGHT_ROOT_BACKGROUND;
    }
  }, []);

  const setTheme = useCallback(
    (mode: ThemeMode) => {
      setThemeState(mode);
      saveStoredTheme(mode);
      applyTheme(mode);
    },
    [applyTheme],
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === "light" ? "dark" : "light");
  }, [theme, setTheme]);

  /** 初始化时应用存储的主题，卸载时移除 .dark 防止公开端污染 */
  useEffect(() => {
    applyTheme(theme);
    return () => {
      if (typeof document !== "undefined") {
        const root = document.documentElement;
        root.classList.remove("dark");
        root.style.removeProperty("color-scheme");
        root.style.removeProperty("background-color");
      }
    };
  }, [theme, applyTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, toggleTheme, setTheme }),
    [theme, toggleTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useThemeMode(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeMode 必须在 ThemeProvider 内使用");
  return ctx;
}

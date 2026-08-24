/**
 * 后台认证上下文
 *
 * 替代 react-admin authProvider，保留 localStorage 兼容键：
 * - quizAdminCredentials:v1（按用户要求在本机浏览器记住账号和密码）
 * - quizAdminTheme:v1（主题偏好，由 ThemeProvider 管理）
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
import { httpClient, apiUrl, ApiError } from "./http-client";
import type { AdminSessionResponse } from "@/features/admin/types";

const CREDENTIALS_KEY = "quizAdminCredentials:v1";

interface RememberedCredentials {
  username: string;
  password: string;
}

function removeRememberedCredentialsSafely() {
  try {
    localStorage.removeItem(CREDENTIALS_KEY);
  } catch {
    // 浏览器禁用本地存储时忽略，认证状态仍以 HttpOnly Cookie 为准。
  }
}

/** 读取本机保存的账号密码；旧版只有账号时保持兼容，等待下次登录写回密码。 */
export function readRememberedCredentials(): RememberedCredentials | null {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const username = typeof parsed?.username === "string" ? parsed.username : "";
    const password = typeof parsed?.password === "string" ? parsed.password : "";
    if (!username.trim()) {
      removeRememberedCredentialsSafely();
      return null;
    }
    return { username, password };
  } catch {
    removeRememberedCredentialsSafely();
    return null;
  }
}

/** 按业务要求持久化账号密码；失败时降级为不记住，不阻断登录。 */
export function saveRememberedCredentials(username: string, password: string) {
  try {
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({ username, password }));
  } catch {
    // 记住账号密码只是体验优化，失败不影响登录流程。
  }
}

export function clearRememberedCredentials() {
  removeRememberedCredentialsSafely();
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isCheckingSession: boolean;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [username, setUsername] = useState<string | null>(null);

  /** 检查当前会话是否有效 */
  const checkSession = useCallback(async () => {
    setIsCheckingSession(true);
    try {
      const session = await httpClient<AdminSessionResponse>(
        apiUrl("/admin/session"),
      );
      if (session.authenticated) {
        setIsAuthenticated(true);
        setUsername(session.username ?? null);
        return true;
      }
      setIsAuthenticated(false);
      setUsername(null);
      return false;
    } catch {
      setIsAuthenticated(false);
      setUsername(null);
      return false;
    } finally {
      setIsCheckingSession(false);
    }
  }, []);

  /** 登录 */
  const login = useCallback(async (username: string, password: string) => {
    await httpClient(apiUrl("/admin/login"), {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setIsAuthenticated(true);
    setUsername(username);
  }, []);

  /** 登出 */
  const logout = useCallback(async () => {
    try {
      await httpClient(apiUrl("/admin/logout"), { method: "POST" });
    } catch {
      // 登出失败不阻塞跳转
    }
    setIsAuthenticated(false);
    setUsername(null);
  }, []);

  /** 初始化时检查会话 */
  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ isAuthenticated, isCheckingSession, username, login, logout, checkSession }),
    [isAuthenticated, isCheckingSession, username, login, logout, checkSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}

/** 401 拦截：全局监听 ApiError 401，清空认证状态 */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

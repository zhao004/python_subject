/**
 * 后台根组件：路由表 + Provider 组合 + 认证守卫
 *
 * 替代 react-admin <Admin> 的全部职责：
 * - 路由注册（替代 Resource 自动路由 + CustomRoutes）
 * - 认证守卫（替代 RA authProvider.checkAuth）
 * - Provider 组合（QueryClient + Auth + Theme + Toaster）
 *
 * 路由命名已统一为 question-banks（消除原 /admin/banks/:id 分裂）。
 */

import { lazy, Suspense, useEffect, type ReactNode } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { queryClient } from "@/lib/query-client";
import { TooltipProvider } from "@/components/ui/tooltip";
import AdminLayout from "./Layout";
import LoginPage from "./LoginPage";
import Dashboard from "./Dashboard";
import QuestionBanksList from "./QuestionBanksList";
import QuestionItemsPage from "./QuestionItemsPage";
import BankLeaderboard from "./BankLeaderboard";
import BankLogs from "./BankLogs";
import AccessLogs from "./AccessLogs";
import SettingsPage from "./SettingsPage";

/** 认证守卫：未认证时重定向到登录页 */
function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/admin/login", { replace: true, state: { from: location } });
    }
  }, [isAuthenticated, location, navigate]);

  if (!isAuthenticated) return null;
  return <>{children}</>;
}

/** 加载占位 */
function LoadingFallback() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="text-muted-foreground">加载中...</div>
    </div>
  );
}

/** 后台路由表 */
function AdminRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <AuthGuard>
            <AdminLayout />
          </AuthGuard>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="question-banks" element={<QuestionBanksList />} />
        <Route path="question-banks/:id/items" element={<QuestionItemsPage />} />
        <Route path="question-banks/:id/leaderboard" element={<BankLeaderboard />} />
        <Route path="question-banks/:id/logs" element={<BankLogs />} />
        <Route path="access-logs" element={<AccessLogs />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

/** 后台 Provider 组合 */
export default function AdminApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <AdminRoutes />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

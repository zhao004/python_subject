import { lazy, Suspense, useMemo } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { PublicApp, readRoute } from "@/features/public/PublicApp";
import { SITE_TITLE } from "@/features/public/constants";

/** 后台管理应用懒加载，避免公开端加载后台依赖 */
const AdminAppLazy = lazy(() => import("@/features/admin/AdminApp"));

/**
 * 应用根组件。
 *
 * 职责：
 * - 路由表：公开端 3 条 + 后台通配 + 未知路径兜底
 * - Toaster：sonner 全局 toast 容器（公开端与后台共用）
 * - 路由解析：readRoute 解析 pathname 传入 PublicApp
 *
 * 已移除：旧版 ToastStack prop drilling、adminTheme 僵尸逻辑、echarts 静态导入
 */
export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const route = useMemo(() => readRoute(location.pathname), [location.pathname]);

  const navigateTo = useMemo(
    () => (path: string, replace = false) => navigate(path, { replace }),
    [navigate],
  );

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={<PublicApp route={route} navigateTo={navigateTo} />}
        />
        <Route
          path="/b/:slug"
          element={<PublicApp route={route} navigateTo={navigateTo} />}
        />
        <Route
          path="/b/:slug/leaderboard"
          element={<PublicApp route={route} navigateTo={navigateTo} />}
        />
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={null}>
              <AdminAppLazy />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
      <Toaster />
    </>
  );
}

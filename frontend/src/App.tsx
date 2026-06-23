import { lazy, Suspense, useMemo } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { PublicApp, readRoute } from "@/features/public/PublicApp";
import {
  buildPublicLeaderboardPath,
  buildPublicQuizPath,
} from "@/features/public/links";

/** 后台管理应用懒加载，避免公开端加载后台依赖 */
const AdminAppLazy = lazy(() => import("@/features/admin/AdminApp"));

/** 旧版 /b/:slug 答题链接重定向到新版根路径短码。 */
function LegacyQuizRedirect() {
  const { slug = "" } = useParams();
  return <Navigate replace to={buildPublicQuizPath(slug)} />;
}

/** 旧版 /b/:slug/leaderboard 排行榜链接重定向到新版根路径短码。 */
function LegacyLeaderboardRedirect() {
  const { slug = "" } = useParams();
  return <Navigate replace to={buildPublicLeaderboardPath(slug)} />;
}

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
          element={<LegacyQuizRedirect />}
        />
        <Route
          path="/b/:slug/leaderboard"
          element={<LegacyLeaderboardRedirect />}
        />
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={null}>
              <AdminAppLazy />
            </Suspense>
          }
        />
        <Route
          path="/:slug"
          element={<PublicApp route={route} navigateTo={navigateTo} />}
        />
        <Route
          path="/:slug/leaderboard"
          element={<PublicApp route={route} navigateTo={navigateTo} />}
        />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
      <Toaster />
    </>
  );
}

import { QueryClient } from "@tanstack/react-query";

/**
 * react-query 全局配置
 *
 * 替代 react-admin 的缓存刷新机制（useRefresh → invalidateQueries）。
 * 401 错误不重试，由 AuthProvider 负责跳转登录。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // 401 不重试
        if (error instanceof Error && "status" in error && error.status === 401) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

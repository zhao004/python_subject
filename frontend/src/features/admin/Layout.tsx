/**
 * 后台布局：侧栏导航 + 顶栏 + 主内容区
 *
 * - 桌面端（≥lg）：侧栏可展开/收缩，展开 w-60 显示图标+文字，收缩 w-16 仅图标。
 *   收缩状态持久化到 localStorage。
 * - 移动端（<lg）：抽屉式侧栏 w-60，顶栏 hamburger 按钮控制开合，遮罩点击关闭。
 * 顶栏含主题切换按钮（替代 RA 自动注入的 ToggleThemeButton）。
 */

import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  BookOpen,
  ClipboardList,
  Settings,
  LogOut,
  Moon,
  Sun,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  GraduationCap,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useThemeMode } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 侧栏展开状态持久化 key */
const SIDEBAR_COLLAPSED_KEY = "quizAdminSidebarCollapsed:v1";

/** 侧边栏顶部标题文案，从 .env 的 ADMIN_SIDEBAR_TITLE 注入，异常时回退默认值 */
const SIDEBAR_TITLE = String(
  import.meta.env.VITE_ADMIN_SIDEBAR_TITLE ?? "后台管理",
).trim() || "后台管理";

/** 读取持久化的侧栏收缩状态 */
function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

/** 侧栏导航项 */
const navItems = [
  { to: "/admin", label: "概览", icon: LayoutDashboard, end: true },
  { to: "/admin/question-banks", label: "题库管理", icon: BookOpen, end: false },
  { to: "/admin/access-logs", label: "访问日志", icon: ClipboardList, end: false },
  { to: "/admin/settings", label: "站点设置", icon: Settings, end: false },
];

/** 主题切换按钮 */
function ThemeToggle() {
  const { theme, toggleTheme } = useThemeMode();
  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="切换主题">
      {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
    </Button>
  );
}

export default function AdminLayout() {
  const { username, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);

  const handleLogout = async () => {
    await logout();
    navigate("/admin/login", { replace: true });
  };

  /** 切换 PC 端侧栏展开/收缩 */
  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // localStorage 不可用时忽略
      }
      return next;
    });
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 侧栏：桌面固定（可收缩）+ 移动抽屉 */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 transform border-r bg-card transition-all duration-200 lg:translate-x-0",
          collapsed ? "w-16" : "w-60",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* 标题区：展开时图标 + 标题，收缩时仅图标 */}
        <div
          className={cn(
            "flex h-14 items-center border-b",
            collapsed ? "justify-center px-0" : "gap-2 px-6",
          )}
        >
          <GraduationCap className="h-6 w-6 shrink-0 text-primary" />
          {!collapsed && (
            <span className="text-lg font-bold text-foreground">{SIDEBAR_TITLE}</span>
          )}
        </div>

        {/* 导航项 */}
        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  "flex items-center rounded-md text-sm font-medium transition-colors",
                  collapsed
                    ? "justify-center px-0 py-2.5"
                    : "gap-3 px-3 py-2",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* 主区域 */}
      <div
        className={cn(
          "flex flex-1 flex-col transition-all duration-200",
          collapsed ? "lg:pl-16" : "lg:pl-60",
        )}
      >
        {/* 顶栏 */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card/95 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-1">
            {/* 移动端 hamburger */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="打开导航菜单"
            >
              <Menu className="h-5 w-5" />
            </Button>
            {/* PC 端展开/收缩按钮 */}
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:flex"
              onClick={toggleCollapse}
              aria-label={collapsed ? "展开侧栏" : "收缩侧栏"}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-5 w-5" />
              ) : (
                <PanelLeftClose className="h-5 w-5" />
              )}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {username && !collapsed && (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {username}
              </span>
            )}
            <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="登出">
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </header>

        {/* 内容区 */}
        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

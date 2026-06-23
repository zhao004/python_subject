/**
 * 后台布局：侧栏导航 + 顶栏 + 主内容区
 *
 * - 桌面端（≥lg）：使用两列 grid 承载侧栏和主区域，侧栏宽度变化时主区域同步过渡。
 *   收缩状态持久化到 localStorage。
 * - 移动端（<lg）：抽屉式侧栏 w-60，顶栏 hamburger 按钮控制开合，遮罩点击关闭。
 * 顶栏含主题切换按钮（替代 RA 自动注入的 ToggleThemeButton）。
 */

import {useState} from "react";
import {NavLink, Outlet, useNavigate} from "react-router-dom";
import {
    BookOpen,
    ClipboardList,
    GraduationCap,
    LayoutDashboard,
    Menu,
    Moon,
    PanelLeftClose,
    PanelLeftOpen,
    Settings,
    ShieldBan,
    Sun,
} from "lucide-react";
import {useAuth} from "@/lib/auth";
import {useThemeMode} from "@/lib/theme";
import {Button} from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {cn} from "@/lib/utils";

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
    {to: "/admin", label: "概览", icon: LayoutDashboard, end: true},
    {to: "/admin/question-banks", label: "题库管理", icon: BookOpen, end: false},
    {to: "/admin/access-logs", label: "访问日志", icon: ClipboardList, end: false},
    {to: "/admin/ip-blacklist", label: "IP 黑名单", icon: ShieldBan, end: false},
    {to: "/admin/settings", label: "系统设置", icon: Settings, end: false},
];

/** 主题切换按钮 */
function ThemeToggle() {
    const {theme, toggleTheme} = useThemeMode();
    return (
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="切换主题">
            {theme === "light" ? <Moon className="h-5 w-5"/> : <Sun className="h-5 w-5"/>}
        </Button>
    );
}

export default function AdminLayout() {
    const {username, logout} = useAuth();
    const navigate = useNavigate();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
    // 用户名为空时仍保留菜单入口，避免会话接口短暂未返回用户名导致操作入口消失。
    const displayUsername = username?.trim() || "管理员";

    const handleLogout = async () => {
        await logout();
        navigate("/admin/login", {replace: true});
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
        <div
            className={cn(
                "min-h-screen overflow-x-hidden bg-background lg:grid lg:grid-cols-[var(--admin-sidebar-width)_minmax(0,1fr)] lg:transition-[grid-template-columns] lg:duration-200",
                collapsed
                    ? "[--admin-sidebar-width:var(--admin-sidebar-collapsed-width)]"
                    : "[--admin-sidebar-width:var(--admin-sidebar-expanded-width)]",
            )}
        >
            {/* 移动端遮罩 */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/* 侧栏：桌面占位（可收缩）+ 移动抽屉 */}
            <aside
                className={cn(
                    "fixed inset-y-0 left-0 z-50 w-[var(--admin-sidebar-expanded-width)] transform border-r bg-card transition-[transform,width] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
                    collapsed
                        ? "lg:w-[var(--admin-sidebar-collapsed-width)]"
                        : "lg:w-[var(--admin-sidebar-expanded-width)]",
                    sidebarOpen ? "translate-x-0" : "-translate-x-full",
                )}
            >
                {/* 标题区：展开时图标 + 标题，收缩时仅图标 */}
                <div
                    className={cn(
                        "flex h-14 items-center gap-2 border-b px-6",
                        collapsed && "lg:justify-center lg:gap-0 lg:px-0",
                    )}
                >
                    <GraduationCap className="h-6 w-6 shrink-0 text-primary"/>
                    <span className={cn("text-lg font-bold text-foreground", collapsed && "lg:hidden")}>
                        {SIDEBAR_TITLE}
                    </span>
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
                            className={({isActive}) =>
                                cn(
                                    "flex items-center rounded-md text-sm font-medium transition-colors",
                                    "gap-3 px-3 py-2",
                                    collapsed && "lg:justify-center lg:gap-0 lg:px-0 lg:py-2.5",
                                    isActive
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                                )
                            }
                        >
                            <item.icon className="h-4 w-4 shrink-0"/>
                            <span className={cn(collapsed && "lg:hidden")}>{item.label}</span>
                        </NavLink>
                    ))}
                </nav>
            </aside>

            {/* 主区域 */}
            <div
                className="flex min-w-0 flex-col"
            >
                {/* 顶栏 */}
                <header
                    className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card/95 px-4 backdrop-blur lg:px-6">
                    <div className="flex items-center gap-1">
                        {/* 移动端 hamburger */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="lg:hidden"
                            onClick={() => setSidebarOpen(true)}
                            aria-label="打开导航菜单"
                        >
                            <Menu className="h-5 w-5"/>
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
                                <PanelLeftOpen className="h-5 w-5"/>
                            ) : (
                                <PanelLeftClose className="h-5 w-5"/>
                            )}
                        </Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <ThemeToggle/>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="max-w-[var(--admin-user-menu-max-width)] px-2"
                                    aria-label="打开用户菜单"
                                >
                                    <span className="truncate">{displayUsername}</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuGroup>
                                    <DropdownMenuItem onSelect={() => navigate("/admin/settings")}>
                                        系统设置
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => void handleLogout()}>
                                        退出登录
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </header>

                {/* 内容区 */}
                <main className="min-w-0 flex-1 p-4 lg:p-6">
                    <Outlet/>
                </main>
            </div>
        </div>
    );
}

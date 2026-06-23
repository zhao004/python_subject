/**
 * 后台登录页
 *
 * 替代 react-admin LoginPage + MUI 表单。
 * 保留记住账号密码逻辑（localStorage key: quizAdminCredentials:v1）。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Lock, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import {
  clearRememberedCredentials,
  readRememberedCredentials,
  saveRememberedCredentials,
  useAuth,
} from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";

function resolvePostLoginPath(state: unknown): string {
  if (!state || typeof state !== "object") {
    return "/admin";
  }
  const from = (state as { from?: unknown }).from;
  if (!from || typeof from !== "object") {
    return "/admin";
  }
  const locationState = from as { pathname?: unknown; search?: unknown; hash?: unknown };
  const pathname = typeof locationState.pathname === "string" ? locationState.pathname : "";
  if (!pathname.startsWith("/admin") || pathname === "/admin/login") {
    return "/admin";
  }
  const search = typeof locationState.search === "string" ? locationState.search : "";
  const hash = typeof locationState.hash === "string" ? locationState.hash : "";
  return `${pathname}${search}${hash}`;
}

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const redirectPath = resolvePostLoginPath(location.state);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /** 已认证则跳转后台首页 */
  useEffect(() => {
    if (isAuthenticated) {
      navigate(redirectPath, { replace: true });
    }
  }, [isAuthenticated, navigate, redirectPath]);

  /** 恢复本机保存的账号密码；密码为空时兼容旧版只记住账号的数据。 */
  useEffect(() => {
    const saved = readRememberedCredentials();
    if (saved) {
      setUsername(saved.username);
      setPassword(saved.password);
      setRemember(true);
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    if (!trimmedUsername || !trimmedPassword) {
      setError("请输入账号和密码");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await login(trimmedUsername, trimmedPassword);
      if (remember) {
        saveRememberedCredentials(trimmedUsername, trimmedPassword);
      } else {
        clearRememberedCredentials();
      }
      toast.success("登录成功");
      navigate(redirectPath, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "登录失败";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-md border-border/80 bg-card/95 shadow-[0_1.5rem_3.5rem_rgba(0,0,0,0.24)]">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 dark:border-primary/30 dark:bg-primary/15">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">后台登录</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="username">账号</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入管理员账号"
                autoComplete="username"
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  disabled={loading}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-10 w-10"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={remember}
                onCheckedChange={(checked) => setRemember(checked === true)}
              />
              <Label htmlFor="remember" className="cursor-pointer text-sm font-normal">
                记住账号密码
              </Label>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "登录中..." : "登录"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

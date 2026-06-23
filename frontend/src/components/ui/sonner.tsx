import { useEffect, useState } from "react";
import { Toaster as Sonner } from "sonner";

/**
 * Toast 容器，替代原 App.jsx 的 ToastStack prop drilling 机制
 * 使用 sonner 直接调用 toast.success() / toast.error()
 *
 * 通过 MutationObserver 监听 <html> 上 .dark 类的变化，
 * 使 sonner 在深色模式下自动切换 theme，无需 Toaster 在 ThemeProvider 内部。
 */
const Toaster = () => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    setIsDark(root.classList.contains("dark"));

    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      theme={isDark ? "dark" : "light"}
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "border border-border shadow-lg",
        },
      }}
    />
  );
};

export { Toaster };

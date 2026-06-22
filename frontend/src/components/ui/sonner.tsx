import { Toaster as Sonner } from "sonner";

/**
 * Toast 容器，替代原 App.jsx 的 ToastStack prop drilling 机制
 * 使用 sonner 直接调用 toast.success() / toast.error()
 */
const Toaster = () => {
  return (
    <Sonner
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

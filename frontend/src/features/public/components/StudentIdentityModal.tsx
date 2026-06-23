import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { StudentFields } from "./Common";
import type { StudentForm } from "../types";

interface StudentIdentityModalProps {
  open: boolean;
  errorMessage: string;
  form: StudentForm;
  rememberStudent: boolean;
  styleClass: string;
  onConfirm: () => void;
  onFormChange: (fieldName: keyof StudentForm, value: string) => void;
  onRememberChange: (checked: boolean) => void;
}

/**
 * 入场身份确认弹窗。
 *
 * 使用 shadcn Dialog（Radix UI）替代手写 modal，自动处理：
 * - 焦点陷阱
 * - Esc 关闭（此处禁用，强制填写）
 * - aria-modal 语义
 *
 * 渐变标题区保留原始视觉设计。
 */
export function StudentIdentityModal({
  open,
  errorMessage,
  form,
  rememberStudent,
  styleClass,
  onConfirm,
  onFormChange,
  onRememberChange,
}: StudentIdentityModalProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        className={cn(
          styleClass,
          "max-w-[34rem] gap-4 border-brand-line bg-brand-surface p-4 text-brand-text",
        )}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* 渐变标题区 */}
        <DialogHeader className="hero-gradient rounded-lg p-4">
          <p className="text-xs font-black tracking-wide text-brand-hero-accent">身份确认</p>
          <DialogTitle className="font-serif text-xl text-brand-surface">
            请认真填写
          </DialogTitle>
        </DialogHeader>

        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <StudentFields form={form} onChange={onFormChange} variant="on-light" />
          </div>

          <label className="flex items-center gap-2.5 font-bold leading-snug text-brand-text">
            <Checkbox
              checked={rememberStudent}
              className="border-brand data-[state=checked]:bg-brand data-[state=checked]:text-brand-surface focus-visible:ring-brand-accent"
              onCheckedChange={(checked) => onRememberChange(checked === true)}
            />
            <span>记住这次填写的信息</span>
          </label>

          {errorMessage && (
            <p
              role="alert"
              className="rounded-lg border border-brand-danger/30 bg-brand-danger/10 p-3 text-sm font-black leading-relaxed text-brand-danger"
            >
              {errorMessage}
            </p>
          )}

          <Button type="submit" variant="publicPrimary" className="w-full" size="lg">
            确认并开始
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

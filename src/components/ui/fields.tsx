import clsx from "clsx";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

// Labelled form controls for Settings and dialogs: no placeholder-as-label, errors tied with
// aria-describedby, inset background, 44 px on phone.

export const inputClass = (className?: string) =>
  clsx(
    "h-11 w-full rounded-chip border border-hairline bg-inset px-3 text-[15px] text-ink placeholder:text-ink-3 transition-colors duration-150 hover:border-strong focus:border-strong focus:bg-sheet lg:h-9 lg:text-[14px]",
    className,
  );

export function Field({ label, hint, error, htmlFor, children, className }: { label: string; hint?: string; error?: string | null; htmlFor: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-[12px] leading-4 text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-[12px] leading-4 text-signal">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={clsx(inputClass(className), invalid && "border-signal")} aria-invalid={invalid || undefined} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(inputClass("h-auto min-h-[120px] py-2 font-mono text-[13px] leading-[20px] lg:text-[13px]"), className)} {...rest} />;
}

export function NativeSelect({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(inputClass("appearance-none pr-8"), className)} style={{ backgroundImage: "none" }} {...rest}>
      {children}
    </select>
  );
}

/** Two-column settings form layout: label column 240 px, controls fluid. Stacks under 768. */
export function FormRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-hairline py-4 first:border-t-0 md:grid-cols-[240px_1fr] md:gap-6">
      <div>
        <p className="text-[14px] font-medium text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[13px] leading-[18px] text-ink-3">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

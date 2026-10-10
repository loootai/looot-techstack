import * as React from "react";
import { cn } from "@/lib/utils";

const FIELD = "w-full rounded-control border border-line-strong bg-panel px-2.5 text-13 text-ink transition-colors duration-100 placeholder:text-faint hover:border-mute focus-visible:border-emerald focus-visible:outline-offset-0 disabled:opacity-50 aria-[invalid=true]:border-high";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD, "h-11 md:h-8", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(FIELD, "h-11 appearance-none bg-[length:16px] bg-[right_6px_center] bg-no-repeat pr-7 md:h-8", "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a9a92' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-12 font-medium text-ink", className)} {...props} />;
}

/** Label above, control, then help or error below. */
export function Field({ label, htmlFor, error, help, children, className }: { label: string; htmlFor?: string; error?: string; help?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-12 text-high" role="alert">
          {error}
        </p>
      ) : help ? (
        <p className="text-12 text-mute">{help}</p>
      ) : null}
    </div>
  );
}

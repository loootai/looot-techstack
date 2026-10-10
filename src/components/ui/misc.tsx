import * as React from "react";
import { cn } from "@/lib/utils";

/** Small label with a tinted background. */
export function Badge({ className, tone = "neutral", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "brand" | "high" | "medium" | "low" | "amber" }) {
  const tones = {
    neutral: "bg-hover text-mute",
    brand: "bg-brand-soft text-link",
    high: "bg-high-soft text-high",
    medium: "bg-medium-soft text-medium",
    low: "bg-low-soft text-low",
    amber: "bg-amber-soft text-amber",
  };
  return <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-11 font-medium", tones[tone], className)} {...props} />;
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton", className)} aria-hidden {...props} />;
}

/** A key cap, for the shortcut hints. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("num inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-page px-1 text-11 text-mute", className)}>{children}</kbd>;
}

/** Table parts with the app's 32 px rows. Real table markup. */
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-left text-13", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn("h-8 whitespace-nowrap border-b border-line px-3 text-11 font-medium text-mute first:pl-4 last:pr-4 md:first:pl-6 md:last:pr-6", className)} {...props} />;
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("h-8 border-b border-line px-3 py-1 align-middle first:pl-4 last:pr-4 md:first:pl-6 md:last:pr-6", className)} {...props} />;
}

/** Two or three choices in a row, one active. Renders buttons with aria-pressed. */
export function Segmented<T extends string>({ value, onChange, options, className, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string; label: string }) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex h-11 items-center rounded-control border border-line-strong bg-panel p-0.5 md:h-8", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={cn("flex h-full items-center gap-1.5 rounded-[4px] px-2.5 text-12 font-medium text-mute transition-colors duration-100 hover:text-ink", value === o.value && "bg-brand-soft text-link")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

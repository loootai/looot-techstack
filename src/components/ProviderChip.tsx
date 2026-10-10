import { PROVIDERS } from "@/lib/providers";
import { cn } from "@/lib/utils";

const TONES = ["bg-brand-soft text-link", "bg-medium-soft text-medium", "bg-low-soft text-ink", "bg-high-soft text-high", "bg-amber-soft text-amber"];

/** Short provider label with a stable colour per provider. */
export function ProviderChip({ id }: { id: string }) {
  const i = Math.max(0, PROVIDERS.findIndex((p) => p.id === id));
  const label = PROVIDERS.find((p) => p.id === id)?.label ?? (id === "builtwith" ? "BuiltWith" : id);
  return <span className={cn("inline-flex h-5 items-center whitespace-nowrap rounded px-1.5 text-11 font-medium", TONES[i % TONES.length])}>{label}</span>;
}

import { z } from "zod";
import { PROVIDERS } from "./providers";

export const ConfigSchema = z.object({
  /** Provider ids to call for every domain. Empty means each provider's default. */
  providers: z.array(z.enum(PROVIDERS.map((p) => p.id) as [string, ...string[]])).default(PROVIDERS.filter((p) => p.defaultOn).map((p) => p.id)),
  /** Hard cap for one run, in dollars. A run stops before a call that would pass it. */
  spendCapUsd: z.number().min(0).default(1),
  /** A stored answer older than this is bought again. */
  cacheDays: z.number().int().min(1).max(365).default(30),
});
export type TechstackConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: TechstackConfig = ConfigSchema.parse({});

export function parseConfig(text: string): TechstackConfig {
  return ConfigSchema.parse(JSON.parse(text));
}

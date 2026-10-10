import { parseBuiltWithFree, parseBuiltWithFull, parsePredictLeads, parseTheirStack, parseTomba } from "./parse";
import type { ParsedProvider } from "./types";

/** One technology-detection provider reachable through looot. Prices are list prices in micro-dollars, read 2026-10-10. */
export interface Provider {
  id: string;
  label: string;
  /** looot job: company.technographics. */
  jobId: "company.technographics";
  endpointId: string;
  priceMicros: number;
  /** On unless the config turns it off. Expensive providers start off. */
  defaultOn: boolean;
  /** Returns technology names. The free BuiltWith answer only returns category counts. */
  listsTechnologies: boolean;
  note: string;
  input: (domain: string) => Record<string, unknown>;
  parse: (body: unknown) => ParsedProvider;
}

export const PRICES_AS_OF = "2026-10-10";

export const PROVIDERS: Provider[] = [
  { id: "builtwith-free", label: "BuiltWith Free", jobId: "company.technographics", endpointId: "builtwith-free1-api-json", priceMicros: 0, defaultOn: true, listsTechnologies: false, note: "Category counts and first/last seen. No technology names.", input: (d) => ({ LOOKUP: d }), parse: parseBuiltWithFree },
  { id: "tomba", label: "Tomba", jobId: "company.technographics", endpointId: "tomba-technology", priceMicros: 8900, defaultOn: true, listsTechnologies: true, note: "Technologies with categories.", input: (d) => ({ domain: d }), parse: parseTomba },
  { id: "predictleads", label: "PredictLeads", jobId: "company.technographics", endpointId: "predictleads-companies-technology-detections", priceMicros: 10000, defaultOn: true, listsTechnologies: true, note: "Technologies with first and last seen dates.", input: (d) => ({ company_id_or_domain: d, limit: 100 }), parse: parsePredictLeads },
  { id: "builtwith", label: "BuiltWith", jobId: "company.technographics", endpointId: "builtwith-api-json", priceMicros: 49500, defaultOn: false, listsTechnologies: true, note: "Full profile, live and dead technologies, first and last detected.", input: (d) => ({ LOOKUP: d }), parse: parseBuiltWithFull },
  { id: "theirstack", label: "TheirStack", jobId: "company.technographics", endpointId: "theirstack-companies-technologies", priceMicros: 98100, defaultOn: false, listsTechnologies: true, note: "From job posts, with a confidence level and first and last seen.", input: (d) => ({ company_domain: d, limit: 25 }), parse: parseTheirStack },
];

export const providerById = (id: string): Provider | undefined => PROVIDERS.find((p) => p.id === id);

/** "Find companies using X" endpoints. */
export const SEARCH_PROVIDERS = [
  { id: "builtwith", label: "BuiltWith Lists", endpointId: "builtwith-lists12-api-json", priceMicros: 49500, note: "Websites using a technology, by technology name." },
  { id: "predictleads", label: "PredictLeads", endpointId: "predictleads-discover-technologies-technology-detections", priceMicros: 10000 + 30000, note: "Resolves the technology (predictleads-technologies-2, $0.03), then lists detections ($0.01)." },
] as const;
export type SearchProviderId = (typeof SEARCH_PROVIDERS)[number]["id"];

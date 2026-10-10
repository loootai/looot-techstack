/** One technology as one provider reported it. */
export interface Tech {
  name: string;
  /** Lower-case key used to match the same technology across providers. */
  slug: string;
  category: string;
  /** ISO dates, only when the provider gives them. */
  firstSeen?: string;
  lastSeen?: string;
  /** The provider's own confidence word, when it has one. */
  confidence?: string;
}

/** Technology and category counts from the free BuiltWith answer. It has no technology names. */
export interface CategoryCount {
  name: string;
  live: number;
  dead: number;
}

export interface ParsedProvider {
  technologies: Tech[];
  categoryCounts: CategoryCount[];
  firstSeen?: string;
  lastSeen?: string;
}

export type CallStatus = "ok" | "pending" | "failed";

/** What one provider said about one domain. Cached, so the same pair is never bought twice. */
export interface LookupRecord {
  domain: string;
  providerId: string;
  status: CallStatus;
  costMicros: number;
  at: string;
  error?: string;
  data?: ParsedProvider;
}

/** One technology on one domain after merging providers. */
export interface MergedTech {
  name: string;
  slug: string;
  category: string;
  /** Providers that listed it. */
  providers: string[];
  /** Providers that returned a technology list for this domain, so "2 of 3". */
  of: number;
  firstSeen?: string;
  lastSeen?: string;
  confidence?: string;
}

export interface DomainResult {
  domain: string;
  technologies: MergedTech[];
  categoryCounts: CategoryCount[];
  /** Providers that returned a technology list (not counting the free category counts). */
  listProviders: string[];
  pendingProviders: string[];
  failedProviders: string[];
  costMicros: number;
  /** Overlap between each pair of providers that returned a list. */
  pairs: { a: string; b: string; shared: number; jaccard: number }[];
  firstSeen?: string;
  lastSeen?: string;
}

export interface CallRecord {
  providerId: string;
  key: string;
  costMicros: number;
  status: string;
  at: string;
}

export interface SearchHit {
  domain: string;
  name?: string;
  providers: string[];
  firstSeen?: string;
  lastSeen?: string;
}

/** A "find companies using X" search, cached by technology and provider. */
export interface SearchRecord {
  tech: string;
  providerId: string;
  status: CallStatus;
  costMicros: number;
  at: string;
  error?: string;
  hits: SearchHit[];
}

import type { CategoryCount, ParsedProvider, Tech } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** Spellings that providers use for the same product. Add to this list when two providers disagree on a name. */
const ALIASES: Record<string, string> = { amazonwebservices: "aws", office365: "microsoft365", googletagmanager: "googletagmanager", gtm: "googletagmanager", ga4: "googleanalytics", googleanalytics4: "googleanalytics", hubspotcrm: "hubspot" };

/** Match key for a technology name: "React.js", "ReactJS" and "react" all become "react". */
export function slugOf(name: string): string {
  const key = rawSlug(name);
  return ALIASES[key] ?? key;
}

function rawSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.js\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .replace(/(?<=[a-z]{3})js$/, "");
}

/** Title-cases a category label and falls back to "Other". */
export function categoryOf(v: unknown): string {
  const s = Array.isArray(v) ? str(v[0]) : isObj(v) ? str(v.name) : str(v);
  if (!s) return "Other";
  const t = s.replace(/[-_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Epoch seconds or milliseconds, or a date string, to an ISO string. */
export function isoDate(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : /^\d{9,13}$/.test(String(v)) ? Number(v) : NaN;
  const d = Number.isNaN(n) ? new Date(String(v)) : new Date(n < 1e11 ? n * 1000 : n);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const minIso = (a?: string, b?: string) => (a === undefined ? b : b === undefined ? a : a < b ? a : b);
const maxIso = (a?: string, b?: string) => (a === undefined ? b : b === undefined ? a : a > b ? a : b);

function unwrap(body: unknown): Obj {
  if (!isObj(body)) return {};
  return body;
}

/** First array of objects found under the given keys, searched two levels deep. */
function findList(o: unknown, keys: string[], depth = 2): Obj[] {
  if (!isObj(o)) return [];
  for (const k of keys) if (Array.isArray(o[k]) && (o[k] as unknown[]).every(isObj)) return o[k] as Obj[];
  if (depth > 0) for (const v of Object.values(o)) if (isObj(v)) {
    const hit = findList(v, keys, depth - 1);
    if (hit.length > 0) return hit;
  }
  return [];
}

function finish(technologies: Tech[], categoryCounts: CategoryCount[] = []): ParsedProvider {
  // The same technology can appear twice (two paths on a site). Keep one, widen the dates.
  const by = new Map<string, Tech>();
  for (const t of technologies) {
    const have = by.get(t.slug);
    if (!have) by.set(t.slug, { ...t });
    else {
      have.firstSeen = minIso(have.firstSeen, t.firstSeen);
      have.lastSeen = maxIso(have.lastSeen, t.lastSeen);
    }
  }
  const list = [...by.values()];
  return { technologies: list, categoryCounts, firstSeen: list.reduce<string | undefined>((m, t) => minIso(m, t.firstSeen), undefined), lastSeen: list.reduce<string | undefined>((m, t) => maxIso(m, t.lastSeen), undefined) };
}

/** BuiltWith Free API: groups and categories with live and dead counts and latest/oldest times. No technology names. */
export function parseBuiltWithFree(body: unknown): ParsedProvider {
  const b = unwrap(body);
  const groups = findList(b, ["groups", "Groups"]);
  const cats = findList(b, ["categories", "Categories"]);
  const rows = groups.length > 0 ? groups : cats;
  const counts: CategoryCount[] = rows.map((g) => ({ name: categoryOf(g.name ?? g.Name), live: num(g.live ?? g.Live), dead: num(g.dead ?? g.Dead) }));
  const out = finish([], counts);
  out.firstSeen = rows.reduce<string | undefined>((m, g) => minIso(m, isoDate(g.oldest ?? g.Oldest)), undefined);
  out.lastSeen = rows.reduce<string | undefined>((m, g) => maxIso(m, isoDate(g.latest ?? g.Latest)), undefined);
  return out;
}

/** BuiltWith Domain API: Results[].Result.Paths[].Technologies[] with Name, Tag, FirstDetected, LastDetected. */
export function parseBuiltWithFull(body: unknown): ParsedProvider {
  const techs: Tech[] = [];
  const results = findList(unwrap(body), ["Results", "results"], 1);
  for (const r of results) {
    const result = isObj(r.Result) ? r.Result : r;
    for (const p of findList(result, ["Paths", "paths"], 0)) {
      for (const t of findList(p, ["Technologies", "technologies"], 0)) {
        const name = str(t.Name ?? t.name);
        if (!name) continue;
        techs.push({ name, slug: slugOf(name), category: categoryOf(t.Tag ?? t.tag ?? t.Category), firstSeen: isoDate(t.FirstDetected ?? t.firstDetected), lastSeen: isoDate(t.LastDetected ?? t.lastDetected) });
      }
    }
  }
  return finish(techs);
}

/** Tomba: technologies[] with name and categories. No dates. */
export function parseTomba(body: unknown): ParsedProvider {
  const list = findList(unwrap(body), ["technologies", "tech", "data"]);
  return finish(list.flatMap((t) => (str(t.name) ? [{ name: str(t.name)!, slug: slugOf(str(t.name)!), category: categoryOf(t.categories ?? t.category) }] : [])));
}

/** PredictLeads: JSON:API detections with first_seen_at and last_seen_at, technology names in `included`. */
export function parsePredictLeads(body: unknown): ParsedProvider {
  const b = unwrap(body);
  const included = new Map<string, Obj>();
  for (const i of findList(b, ["included"], 0)) if (str(i.id)) included.set(String(i.id), isObj(i.attributes) ? i.attributes : i);
  const techs: Tech[] = [];
  for (const d of findList(b, ["data"], 0)) {
    const a = isObj(d.attributes) ? d.attributes : {};
    const rel = isObj(d.relationships) && isObj(d.relationships.technology) && isObj(d.relationships.technology.data) ? d.relationships.technology.data : {};
    const inc = included.get(String(rel.id ?? "")) ?? {};
    const name = str(inc.name ?? a.technology_name ?? a.name ?? (isObj(a.technology) ? a.technology.name : undefined));
    if (!name) continue;
    techs.push({ name, slug: slugOf(name), category: categoryOf(inc.category ?? inc.categories ?? a.category), firstSeen: isoDate(a.first_seen_at), lastSeen: isoDate(a.last_seen_at) });
  }
  return finish(techs);
}

/** TheirStack: data[] with a technology object, a confidence word and first and last date found. */
export function parseTheirStack(body: unknown): ParsedProvider {
  const techs: Tech[] = [];
  for (const d of findList(unwrap(body), ["data", "technologies"], 1)) {
    const t = isObj(d.technology) ? d.technology : d;
    const name = str(t.name ?? t.technology_name);
    if (!name) continue;
    techs.push({ name, slug: slugOf(name), category: categoryOf(t.category ?? t.parent_category ?? t.technology_category), firstSeen: isoDate(d.first_date_found), lastSeen: isoDate(d.last_date_found), confidence: str(d.confidence) });
  }
  return finish(techs);
}

/** Reverse search bodies: BuiltWith Lists (Results[].D) and PredictLeads discover (included companies with a domain). */
export function parseSearchHits(providerId: string, body: unknown): { domain: string; name?: string; firstSeen?: string; lastSeen?: string }[] {
  const b = unwrap(body);
  const host = (v: unknown) => str(v)?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (providerId === "builtwith") {
    return findList(b, ["Results", "results"], 1).flatMap((r) => {
      const domain = host(r.D ?? r.domain ?? r.Domain);
      return domain ? [{ domain, name: str(r.N ?? r.name), firstSeen: isoDate(r.FD ?? r.firstDetected), lastSeen: isoDate(r.LD ?? r.lastDetected) }] : [];
    });
  }
  const companies = new Map<string, Obj>();
  for (const i of findList(b, ["included"], 0)) if (str(i.id)) companies.set(String(i.id), isObj(i.attributes) ? i.attributes : i);
  return findList(b, ["data"], 0).flatMap((d) => {
    const a = isObj(d.attributes) ? d.attributes : {};
    const rel = isObj(d.relationships) && isObj(d.relationships.company) && isObj(d.relationships.company.data) ? d.relationships.company.data : {};
    const c = companies.get(String(rel.id ?? "")) ?? {};
    const domain = host(c.domain ?? a.domain ?? rel.id);
    return domain ? [{ domain, name: str(c.company_name ?? c.name), firstSeen: isoDate(a.first_seen_at), lastSeen: isoDate(a.last_seen_at) }] : [];
  });
}

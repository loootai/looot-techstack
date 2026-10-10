const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "https://www.Stripe.com/pricing?x=1" to "stripe.com". Returns null when it is not a hostname. */
export function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase().replace(/^["']|["']$/g, "");
  s = s.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "");
  return HOST.test(s) ? s : null;
}

/** Reads domains from pasted text: one per line, comma separated, or the first column of a CSV. Dedupes and keeps order. */
export function parseDomains(text: string): { domains: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const invalid: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0]?.toLowerCase().split(",")[0].trim();
  const body = header && ["domain", "domains", "website", "url", "site"].includes(header) ? lines.slice(1) : lines;
  for (const line of body) {
    const cells = line.includes(",") && !/^\s*[^,\s]+\.[a-z]{2,}\s*,\s*[^,\s]+\.[a-z]{2,}/i.test(line) ? [line.split(",")[0]] : line.split(/[,\s;]+/);
    for (const c of cells) {
      if (c.trim() === "") continue;
      const d = normalizeDomain(c);
      if (d === null) invalid.push(c.trim());
      else seen.add(d);
    }
  }
  return { domains: [...seen], invalid };
}

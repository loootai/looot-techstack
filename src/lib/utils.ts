import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The app's own font sizes (text-11 to text-20) are sizes, not colours. Without this, merging
// "text-brand-ink text-13" would drop the colour.
const twMerge = extendTailwindMerge({ extend: { classGroups: { "font-size": [{ text: ["11", "12", "13", "14", "16", "20"] }] } } });

/** Merges class names, with later Tailwind classes winning over earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Host name of a URL without "www.", or null when the text is not a URL. */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Small stable hash (FNV-1a, 64 bit as hex). Used for fingerprints and content hashes, not for security. */
export function hash(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** Shortens long text in the middle, keeping both ends readable. */
export function middle(text: string, max = 44): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  return `${text.slice(0, Math.ceil(keep * 0.6))}…${text.slice(text.length - Math.floor(keep * 0.4))}`;
}

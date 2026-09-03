// Brand-aware "Tip" label.
//
// The "Daniel's Tip" callout is a Daniel's-brand asset. For every other brand
// the same callout should be labelled generically ("Tip" / "Tip of the Day").
// This helper centralises that decision so the AI prompt, block parsing and
// rendering all agree on the label for a given brand.

const DANIELS_SLUGS = new Set(['daniels-tasty-petfoods', 'daniels']);
const DANIELS_NAME_RE = /daniel'?s/i;

/** True when the brand is the Daniel's brand (by slug or name). */
export function isDanielsBrand(brand?: { slug?: string; name?: string } | null): boolean {
  if (!brand) return false;
  const slug = String(brand.slug || '').trim().toLowerCase();
  if (slug && DANIELS_SLUGS.has(slug)) return true;
  const name = String(brand.name || '').trim();
  if (name && DANIELS_NAME_RE.test(name)) return true;
  return false;
}

/**
 * The display label for the tip callout for a given brand.
 * Daniel's brand → "Daniel's Tip"; every other brand → "Tip of the Day".
 */
export function tipLabel(brand?: { slug?: string; name?: string } | null): string {
  return isDanielsBrand(brand) ? "Daniel's Tip" : 'Tip of the Day';
}

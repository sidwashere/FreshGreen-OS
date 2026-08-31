/**
 * Blog Register & Blog Numbering System.
 *
 * Carol's feature requests (feat-auto-blog-numbering, feat-blog-register-sync,
 * feat-duplicate-number-prevention):
 *  - Each brand gets a unique prefix / brand code (DTP, OC, HP, FGC).
 *  - Every blog gets a reference number in the format {PREFIX}{3-digit},
 *    e.g. DTP001, OC001, HP001 — starting at 001 per brand.
 *  - The number is written into the WordPress slug (hidden, not the title) so
 *    it never appears on the live page but is useful for internal tracking.
 *  - The same number is recorded in the Blog Register (Firestore) so the number
 *    on the published article always matches the records.
 *  - A number can never be issued twice, even if a blog is deleted, rescheduled
 *    or returned to draft.
 */
import { Brand, ContentItem } from '../types';

/** Default brand codes, keyed by brand slug. User-editable via BrandManager. */
export const DEFAULT_BRAND_CODES: Record<string, string> = {
  'daniels-tasty-petfoods': 'DTP',
  'organised-and-clean': 'OC',
  'home-at-peace': 'HP',
  'fresh-green-classics': 'FGC',
};

/** Fallback: derive a code from the brand slug when no default or override. */
export function deriveCodeFromSlug(slug: string): string {
  const words = slug
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (words || 'BR').slice(0, 4);
}

/** Resolve the effective brand code for a brand (override > default > derived). */
export function resolveBrandCode(brand?: Brand | null): string {
  if (!brand) return 'BR';
  if (brand.brandCode && brand.brandCode.trim()) return brand.brandCode.trim().toUpperCase();
  const def = DEFAULT_BRAND_CODES[brand.slug];
  if (def) return def;
  return deriveCodeFromSlug(brand.slug);
}

/** Format a sequence number as a zero-padded 3-digit string (1 -> "001"). */
export function formatBlogNumber(seq: number): string {
  return String(Math.max(1, seq)).padStart(3, '0');
}

/**
 * Compute the next available blog number for a brand, given the set of
 * numbers already in use (from the register + existing content items).
 * Returns the lowest unused sequence so gaps are never reused and numbers
 * are never duplicated.
 */
export function nextBlogNumber(
  brand: Brand | null | undefined,
  existingNumbers: string[],
): { number: string; seq: number } {
  const code = resolveBrandCode(brand);
  const used = new Set(
    existingNumbers
      .map((n) => n?.trim().toUpperCase())
      .filter(Boolean)
      .map((n) => n as string),
  );
  let seq = 1;
  while (used.has(`${code}${formatBlogNumber(seq)}`)) {
    seq++;
  }
  return { number: `${code}${formatBlogNumber(seq)}`, seq };
}

/** Collect every blog number already in use for a brand across items + register. */
export function collectUsedNumbers(
  items: ContentItem[],
  register: BlogRegisterEntry[],
  brandId: string,
): string[] {
  const fromItems = items
    .filter((i) => i.brandId === brandId && i.blogNumber)
    .map((i) => i.blogNumber as string);
  const fromRegister = register
    .filter((r) => r.brandId === brandId && r.blogNumber)
    .map((r) => r.blogNumber as string);
  return [...new Set([...fromItems, ...fromRegister])];
}

/** A single row in the Blog Register (Firestore `blog_register` collection). */
export interface BlogRegisterEntry {
  id: string;            // Firestore doc id (same as the content item id)
  blogNumber: string;    // e.g. "DTP001"
  brandId: string;
  brandCode: string;     // e.g. "DTP"
  title: string;
  slug: string;
  contentType: 'post' | 'page';
  primaryKeyword: string;
  secondaryKeywords: string[];
  metaTitle?: string;
  metaDescription?: string;
  status: string;        // PipelineStatus
  dateCreated: string;   // ISO
  datePublished?: string; // ISO — set when published live
  dateUpdated?: string;  // ISO
  /** ISO of the FIRST live publication — never overwritten. */
  firstPublishedAt?: string;
  /** ISO of the most recent refresh/repurpose. */
  lastRefreshedAt?: string;
  /** Number of times the content has been repurposed/refreshed. */
  repurposeCount?: number;
  wpPostId?: number;
  wpLiveUrl?: string;    // link to the live page
  wpPreviewUrl?: string;
  contentItemId: string; // link back to the content item
  userId: string;
  updatedAt: string;
}

/** Build a register entry from a content item + brand. */
export function buildRegisterEntry(
  item: ContentItem,
  brand: Brand | null | undefined,
  userId: string,
): BlogRegisterEntry {
  const code = resolveBrandCode(brand);
  const entry: BlogRegisterEntry = {
    id: item.id,
    blogNumber: item.blogNumber || `${code}${formatBlogNumber(1)}`,
    brandId: item.brandId,
    brandCode: code,
    title: item.title,
    slug: item.slug,
    contentType: item.contentType,
    primaryKeyword: item.primaryKeyword || '',
    secondaryKeywords: item.secondaryKeywords || [],
    status: item.status,
    dateCreated: item.createdAt,
    dateUpdated: item.updatedAt,
    contentItemId: item.id,
    userId,
    updatedAt: new Date().toISOString(),
  };
  // Firestore rejects `undefined` field values, so only attach optional fields
  // when they actually hold a value.
  if (item.metaTitle) entry.metaTitle = item.metaTitle;
  if (item.metaDescription) entry.metaDescription = item.metaDescription;
  if (item.status === 'Published') {
    entry.datePublished = item.lastAutoPublishedAt || item.updatedAt;
  }
  if (item.firstPublishedAt) entry.firstPublishedAt = item.firstPublishedAt;
  if (item.lastRefreshedAt) entry.lastRefreshedAt = item.lastRefreshedAt;
  if (typeof item.repurposeCount === 'number') entry.repurposeCount = item.repurposeCount;
  if (typeof item.wpPostId === 'number') entry.wpPostId = item.wpPostId;
  if (item.wpLiveUrl) entry.wpLiveUrl = item.wpLiveUrl;
  if (item.wpPreviewUrl) entry.wpPreviewUrl = item.wpPreviewUrl;
  return entry;
}

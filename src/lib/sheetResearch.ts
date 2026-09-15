// ─────────────────────────────────────────────────────────────────────────────
// sheetResearch.ts — layout‑agnostic, lossless research extractor for the
// FreshGreen Autoblog pipeline.
//
// THE PROBLEM IT SOLVES
//   Google Sheets come in every shape: some name the title column "Blog Title",
//   others "Topic", "Headline" or "Post Title"; keyword columns wander between
//   "Primary Keyword", "Focus Kw", "SEO Target", or live inline in the summary.
//   Pasted research in the Write tab has no columns at all. The old importer
//   matched a fixed list of hardcoded header names and silently **dropped**
//   every cell that didn't land on a known slot — so the brief/plan lost the
//   researched topics and the post drifted off the sheet's intent.
//
// THE FIX
//   A single parser used by BOTH the Sheets import and the Write-tab paste:
//   1. Column/header matching by alias + fuzzy "contains" — layout never matters.
//   2. If a row has NO recognizable headers (paste), we classify CELLS by
//      content shape (title‑like, keyword‑like, long-form research).
//   3. LOSSLESS: every non‑empty cell that does not map to a structured slot
//      is folded into a `research` bundle labeled with its source header, so
//      nothing the sheet or the paste contains is thrown away.
//   4. A guard always wins: known slots fall back to content heuristics so a
//      blank/misnamed column still yields a title, keywords, and an intent.
// ─────────────────────────────────────────────────────────────────────────────

// Labels we look for when scanning headers / cells. Ordered best -> acceptable
// and matched case-insensitively with "contains" semantics, so columns named
// "Blog Title (EN)", "Primary Keyword — focus", "One Line Summary / Intent"
// all hit the right slot.
const SLOT_ALIASES: Record<string, string[]> = {
  title: [
    'blog title', 'post title', 'article title', 'headline', 'topic',
    'title', 'h1', 'what we are writing', 'subject',
  ],
  primaryKeyword: [
    'primary keyword', 'primary kw', 'focus keyword', 'main keyword',
    'primary', 'seo target', 'kw', 'keyword',
  ],
  secondaryKeywords: [
    'secondary keyword', 'secondary kw', 'related keyword', 'supporting keyword',
    'secondary', 'lsi keywords', 'extra keywords', 'longtail', 'long tail',
    'keywords', 'tags',
  ],
  summary: [
    'one line summary', 'summary', 'brief', 'overview', 'description',
    'about this post', 'seo brief', 'search intent', 'intent',
  ],
  cta: ['call to action', 'cta', 'call to action / cta'],
  research: [
    'research', 'source', 'reference', 'link', 'internal link', 'facts',
    'statistic', 'quote', 'question people also ask', 'people also ask',
    'faq', 'answer', 'notes',
  ],
  audience: ['audience', 'who is this for', 'persona', 'reader', 'target audience'],
  category: ['category', 'section', 'pillar', 'collection'],
};

// Typical "keyword-ish" content shapes used when there are no headers at all
// (write-tab paste or a headerless row).
const KEYWORD_CELL_RE =
  /^(?:[a-z0-9][a-z0-9 ,.&'’()\-–—/]{2,69}[a-z0-9)])$/i;
const LONG_CELL_RE = /[.!?]\s+[A-Z]/; // 2+ sentences => research, not a keyword

export interface SheetColumn {
  name: string;
  values: string[];
}

export interface SheetParseResult {
  title: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  summary: string;
  cta: string;
  research: string;
  taggedResearch: Record<string, string[]>; // header -> preserved values (lossless)
  audience: string[];
  category: string;
  matchedColumns: string[]; // headers we positively assigned
  unmatchedColumns: string[]; // headers that produced content (all preserved in taggedResearch)
}

// “Contains” lookup against a slugified header name (e.g. "Blog Title (EN)" ->
// slug "blog title en"). Returns the matching slot key.
type SlotKey =
  | 'title' | 'primaryKeyword' | 'secondaryKeywords' | 'summary' | 'cta'
  | 'research' | 'audience' | 'category';

function slugify(h: string): string {
  return (h || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^ +| +$/g, '')
    .replace(/\s+/g, ' ');
}

function detectSlot(header: string): SlotKey | null {
  const slug = slugify(header);
  if (!slug) return null;
  for (const [slot, aliases] of Object.entries(SLOT_ALIASES)) {
    for (const alias of aliases) {
      const a = slugify(alias);
      if (!a) continue;
      // "contains" with minimum length to avoid over-eager matches like
      // Keyword vs Keywords, or Title vs Keywords.
      if (slot === 'primaryKeyword' || slot === 'secondaryKeywords') {
        if (slug === a) return slot as SlotKey;
        continue guardedBothDirections; // placeholder — replaced below
      }
      if (slug.includes(a)) return slot as SlotKey;
    }
  }
  return null;
}

// ── Header-less / paste classification ──────────────────────────────────────
function classifyCell(value: string): SlotKey | 'drop' {
  const v = (value || '').trim();
  if (!v) return 'drop';
  // A title-ish cell: a few words, ends without sentence punctuation, not a
  // question, not URL.
  if (v.length >= 12 && v.length <= 90 && !LONG_CELL_RE.test(v) && !v.startsWith('http') && !KEYWORD_CELL_RE.test(v)) {
    return 'title';
  }
  if (KEYWORD_CELL_RE.test(v) && !LONG_CELL_RE.test(v)) {
    return 'secondaryKeywords';
  }
  if (v.startsWith('http')) return 'research';
  if (LONG_CELL_RE.test(v)) return 'research';
  return 'drop';
}

function parseSelectAllRows(headers: string[], rows: Array<Record<string, string>>): SheetParseResult {
  const columns: SheetColumn[] = headers.map((h) => ({
    name: h,
    values: [],
  }));

  // Column-first orientation: iterate rows, push each value into its column so
  // column-level heuristics (e.g. "this column is mostly keywords") work.
  for (const row of rows) {
    headers.forEach((h, idx) => {
      if (row[h] != null && String(row[h]).trim()) {
        columns[idx].values.push(String(row[h]).trim());
      }
    });
  }

  const taggedResearch: Record<string, string[]> = {};
  const used: Set<string> = new Set();

  const put = (slot: SlotKey, val: string) => {
    if (!val) return;
    placeValue(slot, val);
  };

  // slot buckets
  const title: string[] = [];
  const primary: string[] = [];
  const secondary: string[] = [];
  const summary: string[] = [];
  const cta: string[] = [];
  const research: string[] = [];
  const audience: string[] = [];
  const category: string[] = [];

  function placeValue(slot: SlotKey, val: string) {
    switch (slot) {
      case 'title': title.push(val); break;
      case 'primaryKeyword': primary.push(val); break;
      case 'secondaryKeywords': secondary.push(val); break;
      case 'summary': summary.push(val); break;
      case 'cta': cta.push(val); break;
      case 'research': research.push(val); break;
      case 'audience': audience.push(val); break;
      case 'category': category.push(val); break;
      default: break;
    }
  }

  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci];
    const slot = detectSlot(col.name);
    // If a whole column looks like one thing, treat all its cells uniformly.
    const headerCellSlot = slot || inferColumnSlot(col);

    for (const val of col.values) {
      const target: SlotKey | null = headerCellSlot || classifyCell(val);
      if (target && target !== 'drop') {
        put(target, val);
      } else {
        // Lossless escape hatch: anything unrecognized is preserved under its
        // header so research is never dropped.
        (taggedResearch[col.name] ||= []).push(val);
        research.push(`[${col.name}] ${val}`);
      }
    }
  }

  const pickTitle =
    title[0] ||
    infproTitle() ||
    (Array.isArray(secondary) ? secondary[0] : undefined) ||
    'Untitled Blog Post';

  // Guard: ensure we always return a title even when every column is empty.
  return finalize({
    title: pickTitle,
    primaryKeyword: primary[0] || (secondary[0] || '').split(/[,;|]/)[0]?.trim() || pickTitle,
    secondaryKeywords: dedupe(flattenAll(secondary)),
    summary: summary[0] || research[0] || '',
    cta: cta[0] || '',
    research: dedupeCompact(research),
    taggedResearch,
    audience,
    category: category[0] || '',
    used,
  });

  // local helpers boxed above; implementations below
  function infproTitle(): string | undefined {
    // first non-trivial (>=3 words, not punctuation-y) research line is a
    // reasonable title candidate for headerless rows
    return research.find((r) => r.split(/\s+/).filter(Boolean).length >= 3);
  }
}

function inferColumnSlot(col: SheetColumn): SlotKey | null {
  if (!col.values.length) return null;
  const keywordy = col.values.filter((v) => KEYWORD_CELL_RE.test(v)).length;
  const researchy = col.values.filter((v) => LONG_CELL_RE.test(v)).length;
  const n = col.values.length;
  const titley = col.values.filter((v) => v.length >= 12 && v.length <= 90 && !LONG_CELL_RE.test(v)).length;
  if (keywordy / n >= 0.6) return 'secondaryKeywords';
  if (titley / n >= 0.5) return 'title';
  if (researchy / n >= 0.5) return 'research';
  return null;
}

// Flat helpers used above
function flattenAll(input: unknown[]): string[] {
  const out: string[] = [];
  for (const item of input) {
    if (!item) continue;
    if (Array.isArray(item)) out.push(...flattenAll(item));
    else out.push(String(item));
  }
  // split multi-keyword cells on common separators and individual whitelist
  const split: string[] = [];
  for (const s of out) {
    for (const part of s.split(/[,;|]/)) {
      const t = part.trim();
      if (t) split.push(t);
    }
  }
  return split;
}

function dedupe(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of input) {
    const k = s.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

function dedupeCompact(input: string[]): string[] {
  return dedupe(input.filter(Boolean)).slice(0, 200);
}

// The HTML branch: given a header array and a single row object, parse it.
export function parseSheetRowToResearch(
  headers: string[],
  row: Record<string, string>,
  explicitTitle?: string | null,
): SheetParseResult {
  const result = parseSelectAllRows(headers, [row]);
  if (explicitTitle && explicitTitle.trim()) {
    result.title = explicitTitle.trim();
    result.taggedResearch['__explicit_title__'] = [explicitTitle.trim()];
  }
  return result;
}

// The paste branch: no columns — classify free text lines.
export function parsePastedResearch(text: string): SheetParseResult {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean assistant0)
    ;
  // Fall back to sentence-fragments if very few line breaks (single paragraph).
  const sentences = text?.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean) || [];
  const sources = lines.length > 2 ? lines : sentences;

  const result = parseSelectAllRows(['Pasted Content'], [{ 'Pasted Content': sources.join('\n') }]);
  // Reclassify: for a paste, prepend original (non-headerless) shaping so the
  // title isn't grabbed from a random keyword line.
  const firstMeaningful = sources.find((s) => s.split(/\s+/).length >= 3);
  if (firstMeaningful) result.title = firstMeaningful;
  return result;
}

function finalize(raw: any): SheetParseResult {
  return {
    title: String(raw.title || 'Untitled Blog Post'),
    primaryKeyword: String(raw.primaryKeyword || raw.title || ''),
    secondaryKeywords: Array.isArray(raw.secondaryKeywords) ? raw.secondaryKeywords : [],
    summary: String(raw.summary || ''),
    cta: String(raw.cta || ''),
    research: String(Array.isArray(raw.research) ? raw.research.join('\n') : raw.research || ''),
    taggedResearch: raw.taggedResearch || {},
    audience: Array.isArray(raw.audience) ? raw.audience : [],
    category: String(raw.category || ''),
    matchedColumns: raw.used ? Array.from(raw.used) : [],
    unmatchedColumns: Object.keys(raw.taggedResearch || {}),
  };
}

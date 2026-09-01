/**
 * Populate production Firestore with the initial seed data.
 *
 * Reads the owner's ID token from /tmp/fgos_id_token.txt (obtained via the
 * Firebase Auth REST API) and writes the INITIAL_BRANDS, INITIAL_CONTENT, and
 * initialFeatures seed data to the production Firestore project
 * (gen-lang-client-0697329654), scoped to the owner's UID exactly as the app's
 * checkAndSeed() does.
 *
 * Usage: npx tsx scripts/populate-production.ts
 */
import { INITIAL_BRANDS, INITIAL_CONTENT } from '../src/data/initialData';
import * as fs from 'fs';

const PROJECT = 'gen-lang-client-0697329654';
const API_KEY = 'AIzaSyC4XqYhAjtOdBXuCSSAcabsy_IMShVrSDE';
const OWNER_EMAIL = 'owner@fgos.local';
const OWNER_PASSWORD = 'Owner-Petfoods-2026';

// ── Auth: get an ID token for the owner ─────────────────────────────────────
async function getOwnerToken(): Promise<{ idToken: string; uid: string }> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        returnSecureToken: true,
      }),
    }
  );
  const data = await res.json();
  if (!data.idToken) {
    throw new Error('Owner sign-in failed: ' + JSON.stringify(data));
  }
  return { idToken: data.idToken, uid: data.localId };
}

// ── Firestore REST helpers ──────────────────────────────────────────────────
function toFirestoreValue(value: any): any {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

async function writeDoc(idToken: string, collection: string, docId: string, data: any) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${docId}`;
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    fields[k] = toFirestoreValue(v);
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Write to ${collection}/${docId} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.status;
}

// ── Seed data ───────────────────────────────────────────────────────────────
// Replicate the initialFeatures array from src/App.tsx (checkAndSeed).
function buildInitialFeatures(scope: (id: string) => string) {
  return [
    {
      id: scope('feat-pub-dates'),
      title: 'Record original publication date & refresh date',
      description: 'Prevent rehashed content becoming duplicates. Track when a blog was first published and when it was last refreshed, plus count how many times it has been repurposed.',
      status: 'shipped', priority: 'high', area: 'editor',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-21T10:35:00').toISOString(),
      tags: ['content-management', 'dates'], notes: '',
      shippedInVersion: 'v0.4', completedAt: new Date('2026-08-31T00:00:00').toISOString(),
    },
    {
      id: scope('feat-brand-numbering'),
      title: 'Brand-specific blog numbering sequences',
      description: "Each brand gets its own starting number: Home At Peace starts at 1000, Daniel's Tasty Petfoods at 2000, etc. Prevents cross-brand reference collisions.",
      status: 'shipped', priority: 'high', area: 'autoblog',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-21T10:35:00').toISOString(),
      tags: ['autoblog', 'branding', 'numbering'], notes: 'Per-brand prefixes (DTP/OC/HP/FGC) prevent cross-brand collisions.',
      shippedInVersion: 'v0.4', completedAt: new Date('2026-08-31T00:00:00').toISOString(),
    },
    {
      id: scope('feat-quarterly-themes'),
      title: 'Quarterly theme-based blog generation',
      description: 'Phase 2: Give FGOS a theme (e.g. "Helping Children Fall in Love with Reading") and it searches the Information Bank for relevant material, creates multiple articles around subtopics, identifies older blogs that fit the theme for refreshing.',
      status: 'requested', priority: 'medium', area: 'autoblog',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-21T10:35:00').toISOString(),
      tags: ['phase-2', 'themes', 'information-bank'], notes: 'Also need a way to remind FGOS to draw on the Information Bank / IP.',
    },
    {
      id: scope('feat-internal-linking'),
      title: 'AI-powered contextual internal linking',
      description: 'For every new blog, identify relevant existing content and insert contextual internal links naturally within the article.',
      status: 'shipped', priority: 'critical', area: 'seo',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-25T12:15:00').toISOString(),
      tags: ['seo', 'internal-linking', 'content-intelligence'], notes: 'Real published articles fed to the model; in-body links rewired to real slugs.',
      shippedInVersion: 'v0.4', completedAt: new Date('2026-08-31T00:00:00').toISOString(),
    },
    {
      id: scope('feat-related-sections'),
      title: 'Dynamic Related Articles / Products / CTA sections',
      description: 'Templates contain designated sections for Related Articles, Related Products/Services, and a dynamic final CTA. FGOS determines what is relevant and populates these sections per brand.',
      status: 'shipped', priority: 'high', area: 'wordpress',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-25T12:15:00').toISOString(),
      tags: ['wordpress', 'templates', 'cta'], notes: 'Theme-agnostic semantic sections appended when missing; per-brand recommendation type (FCC books, DTP products, HaP services). Works with any WP theme incl. Hello Elementor.',
      shippedInVersion: 'v0.4', completedAt: new Date('2026-08-31T00:00:00').toISOString(),
    },
    {
      id: scope('feat-content-register'),
      title: 'Content register / library awareness',
      description: 'Maintain a register of all published content: title, URL, brand, category/topic, keywords, publication date, related products. AI uses this for internal linking decisions.',
      status: 'shipped', priority: 'critical', area: 'dashboard',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-25T12:15:00').toISOString(),
      tags: ['content-intelligence', 'wp-rest-api', 'seo'], notes: 'Firestore blog_register maintains title, URL, brand, keywords, dates, live link per published item. ZenEditor feeds real published items to the server; buildInternalLinkingPrompt() + populateDynamicFields() use them for contextual internal links and related-article sections.',
      shippedInVersion: 'v0.4', completedAt: new Date('2026-09-01T00:00:00').toISOString(),
    },
    {
      id: scope('feat-kadence-templates'),
      title: 'Universal reusable blog templates (any theme)',
      description: 'Long Blog and Short Blog templates that work with any theme — not just Kadence. No hard-coded brand fonts/colours; each site applies its own global styling automatically. FGOS outputs theme-agnostic semantic markup so the same template renders correctly across every theme in use.',
      status: 'planned', priority: 'high', area: 'wordpress',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-25T11:39:00').toISOString(),
      tags: ['wordpress', 'templates', 'theme-agnostic', 'universal'], notes: 'Multiple themes in use, so templates must be universal, not Kadence-only. Sumbul building the templates. FGOS automation must target these reliably.',
    },
    {
      id: scope('feat-wp-mcp-capabilities'),
      title: 'WordPress MCP — full capability mapping',
      description: 'Document what the WP MCP exposes: create/update posts & pages, SEO titles/meta, headings, image alt text, product/CTA links, internal linking, Gutenberg/Kadence blocks, menus, CSS/template settings, routine maintenance.',
      status: 'planned', priority: 'medium', area: 'wordpress',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-20T11:28:00').toISOString(),
      tags: ['wordpress', 'mcp', 'integration'], notes: 'Carol wants to know if ChatGPT can also use the WP MCP for ongoing maintenance.',
    },
    {
      id: scope('feat-grammar-rules'),
      title: 'Grammar & style rules — no "And"/"But" sentence starts',
      description: 'Adjust content-generation instructions so sentences never begin with "And" or "But". Use British English, correct grammar and punctuation, natural sentence construction, avoid unnecessary repetition and obvious AI-style phrasing. Generated copy should require very little editorial correction.',
      status: 'shipped', priority: 'critical', area: 'editor',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-29T23:30:00').toISOString(),
      tags: ['writing-rules', 'grammar', 'british-english', 'quality'], notes: 'Per-brand toggles + deterministic post-generation enforcement.',
      shippedInVersion: 'v0.4', completedAt: new Date('2026-08-31T00:00:00').toISOString(),
    },
    {
      id: scope('feat-end-to-end-test'),
      title: 'End-to-end final test — generation to published blog',
      description: 'Final test must cover the complete process from content generation through to the finished WordPress blog, including all dynamic template fields.',
      status: 'shipped', priority: 'high', area: 'deployment',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-29T23:30:00').toISOString(),
      tags: ['testing', 'qa', 'deployment'], notes: 'scripts/e2e-final-test.ts — 38 checks across generation, dynamic template fields (Related Articles/Products/CTA), and publish-to-WordPress (mock WP REST API). Run with: npx tsx scripts/e2e-final-test.ts',
      shippedInVersion: 'v0.4', completedAt: new Date('2026-08-31T00:00:00').toISOString(),
    },
    {
      id: scope('feat-auto-blog-numbering'),
      title: 'Automatic Blog Number generation & population',
      description: 'Automatically generate and populate the Blog Number field in WordPress. Format per brand: FGC-001, HAP-001, DTP-001, OC-001. System identifies the website/brand, assigns the next available number, and inserts it into the WordPress Blog Number field automatically.',
      status: 'shipped', priority: 'critical', area: 'wordpress',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-29T23:30:00').toISOString(),
      tags: ['blog-numbering', 'wordpress', 'automation'], notes: 'Per-brand codes (DTP/OC/HP/FGC) resolve the site, nextBlogNumber() assigns the lowest unused number (no duplicates), the number is recorded in the Blog Register, and on publish it is written into the WordPress slug AND the Blog Number custom field (post meta blog_number/blogNumber). Covered by scripts/e2e-final-test.ts.',
      shippedInVersion: 'v0.4', completedAt: new Date('2026-09-01T00:00:00').toISOString(),
    },
    {
      id: scope('feat-blog-register-sync'),
      title: 'Blog Register sync — number matches records',
      description: 'The same reference number must be recorded automatically in the Blog Register/Blog History so the number shown on the published article always matches the number held in records. This becomes the permanent reference for tracking as the library grows.',
      status: 'shipped', priority: 'critical', area: 'dashboard',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-29T23:30:00').toISOString(),
      tags: ['blog-register', 'tracking', 'content-library'], notes: 'buildRegisterEntry() writes the same blogNumber to the Firestore blog_register collection on every save (incl. publish), so the number on the published article (slug + meta) always matches the register record. Register view shows number, status, live link.',
      shippedInVersion: 'v0.4', completedAt: new Date('2026-09-01T00:00:00').toISOString(),
    },
    {
      id: scope('feat-duplicate-number-prevention'),
      title: 'Duplicate Blog Number prevention',
      description: 'Check the existing Blog History before assigning a number so a reference can never accidentally be issued twice — even if a blog is deleted, rescheduled, or returned to draft.',
      status: 'requested', priority: 'critical', area: 'autoblog',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-29T23:30:00').toISOString(),
      tags: ['blog-numbering', 'uniqueness', 'data-integrity'], notes: 'Must never issue the same number twice under any workflow state.',
    },
    {
      id: scope('feat-dynamic-fields-population'),
      title: 'Auto-populate dynamic template fields (CTA, Related Articles, Products)',
      description: 'Where the template contains dynamic fields such as the CTA, Related Articles and Related Products/Services, the automation must populate these wherever agreed, rather than creating unnecessary manual work.',
      status: 'shipped', priority: 'high', area: 'wordpress',
      requestedBy: 'Carol', requestedAt: new Date('2026-08-29T23:30:00').toISOString(),
      tags: ['wordpress', 'templates', 'dynamic-fields', 'automation'], notes: 'Real WooCommerce products + real related articles injected into generate/enhance.',
      shippedInVersion: 'v0.4', completedAt: new Date('2026-08-31T00:00:00').toISOString(),
    },
  ];
}

async function main() {
  const { idToken, uid } = await getOwnerToken();
  console.log(`Authenticated as owner (uid: ${uid})`);

  const scope = (id: string) => `${uid}_${id}`;
  const scopedBrandIds = new Map<string, string>();

  // 1. Brands
  console.log('\n--- Writing brands ---');
  for (const brand of INITIAL_BRANDS) {
    const brandId = scope(brand.id);
    scopedBrandIds.set(brand.id, brandId);
    const data = { ...brand, id: brandId, userId: uid };
    await writeDoc(idToken, 'brands', brandId, data);
    console.log(`  ✓ ${brand.name} (${brandId})`);
  }

  // 2. Content items
  console.log('\n--- Writing content items ---');
  for (const item of INITIAL_CONTENT) {
    const itemId = scope(item.id);
    const brandId = scopedBrandIds.get(item.brandId) || scope(item.brandId);
    const data = { ...item, id: itemId, brandId, userId: uid };
    await writeDoc(idToken, 'content_items', itemId, data);
    console.log(`  ✓ ${item.title.slice(0, 50)}... (${itemId})`);
  }

  // 3. Feature requests
  console.log('\n--- Writing feature requests ---');
  const features = buildInitialFeatures(scope);
  for (const feat of features) {
    const data = { ...feat, userId: uid };
    await writeDoc(idToken, 'feature_requests', feat.id, data);
    console.log(`  ✓ ${feat.title.slice(0, 50)}... (${feat.id})`);
  }

  // 4. Mark user as seeded
  console.log('\n--- Marking user as seeded ---');
  await writeDoc(idToken, 'users', uid, { isSeeded: true });
  console.log('  ✓ users/' + uid);

  console.log('\n✅ Seed data populated successfully.');
}

main().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * END-TO-END FINAL TEST — generation → dynamic template fields → published blog
 * (feat-end-to-end-test)
 *
 * Verifies the complete FGOS pipeline without depending on a live Gemini call
 * or a live WordPress site:
 *
 *   PHASE 1 — Dynamic template fields (unit): exercises populateDynamicFields
 *             directly (the shared, theme-agnostic core) to confirm Related
 *             Articles / Related Products-Services-Books / final CTA sections
 *             are appended correctly, per-brand recommendation types work, and
 *             existing sections are never duplicated.
 *
 *   PHASE 2 — Publish pipeline (integration): boots a mock WordPress REST API
 *             and pushes a content item through the REAL /api/wp/sync-content
 *             endpoint, verifying the post is created with the correct slug
 *             (blog number), template mapping, H1 injection and dynamic
 *             sections — i.e. the article actually reaches a "published blog".
 *
 *   PHASE 3 — Live generation (optional): attempts a real /api/ai/generate-article
 *             call and scores it with /api/seo/analyze. Skipped gracefully when
 *             the AI provider is unavailable (flaky quota), so the test never
 *             hard-fails on an external service.
 *
 * Usage:  npx tsx scripts/e2e-final-test.ts
 *         (requires the FGOS dev server on http://127.0.0.1:3000)
 */
import { populateDynamicFields } from '../src/lib/dynamicFields.js';

const BASE = 'http://127.0.0.1:3000';
let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passCount++;
    console.log(`  \u2713 ${name}`);
  } else {
    failCount++;
    failures.push(name);
    console.log(`  \u2717 ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/* ------------------------------------------------------------------ *
 * PHASE 1 — Dynamic template fields (deterministic unit tests)
 * ------------------------------------------------------------------ */
function phase1() {
  section('PHASE 1: Dynamic template fields (populateDynamicFields)');

  const products = [
    { name: 'Freeze-Dried Chicken Treats', price: '9.99', currency: '£', image: 'https://cdn.example.com/chicken.jpg', permalink: 'https://shop.example.com/freeze-dried-chicken', shortDescription: 'Single-ingredient freeze-dried chicken.' },
    { name: 'Salmon Skin Chews', price: '7.50', currency: '£', image: '', permalink: 'https://shop.example.com/salmon-skin', shortDescription: 'Naturally rich in omega-3.' },
  ];
  const related = [
    { slug: 'benefits-of-natural-pet-treats', title: 'Benefits of Natural Pet Treats', excerpt: 'Why natural ingredients matter.' },
    { slug: 'how-to-choose-the-right-pet-food', title: 'How to Choose the Right Pet Food', excerpt: 'A practical buying guide.' },
  ];
  const cta = 'Browse our full range of natural treats in the shop today.';

  // 1a) Appends all three missing dynamic sections with theme-agnostic markup.
  const plainHtml = '<h1>Natural Dog Treats</h1><p>Natural treats are better for your dog.</p>';
  const r1 = populateDynamicFields(plainHtml, { products, relatedArticles: related, cta, recommendationType: 'products', brandName: "Daniel's Tasty Petfoods" });
  check('appends Related Articles section', /fg-related-articles/.test(r1.html));
  check('appends Related Products section', /fg-related-products/.test(r1.html));
  check('appends final CTA section', /fg-cta/.test(r1.html));
  check('uses theme-agnostic fg- classes (no hard-coded brand fonts/colours)', !/font-family|color:\s*#[0-9a-f]{3,6}/i.test(r1.html));
  check('related cards link to real article slugs', r1.html.includes('/blog/benefits-of-natural-pet-treats'));
  check('product cards link to real product permalinks', r1.html.includes('https://shop.example.com/freeze-dried-chicken'));
  check('CTA carries the agreed call-to-action text', r1.html.includes(cta));
  check('reports appended sections in fixes', r1.fixes.some((f) => f.includes('appended missing dynamic section(s)')));
  check('product section heading is "Explore Our Products"', /Explore Our Products/.test(r1.html));

  // 1b) Per-brand recommendation type: services.
  const r2 = populateDynamicFields('<h1>Cleaning Services</h1><p>We clean homes.</p>', {
    products: [{ name: 'Deep Clean', price: '120', currency: '£', permalink: 'https://shop.example.com/deep-clean' }],
    relatedArticles: related, cta, recommendationType: 'services',
  });
  check('services recommendation type uses "Explore Our Services"', /Explore Our Services/.test(r2.html));

  // 1c) Per-brand recommendation type: books.
  const r3 = populateDynamicFields('<h1>Reading</h1><p>Books for children.</p>', {
    products: [{ name: 'The Reading Adventure', price: '12', currency: '£', permalink: 'https://shop.example.com/reading-adventure' }],
    relatedArticles: related, cta, recommendationType: 'books',
  });
  check('books recommendation type uses "Explore Our Books"', /Explore Our Books/.test(r3.html));

  // 1d) No duplication when sections already exist.
  const withSections = `${plainHtml}
<section class="fg-related-articles"><h2>Keep Reading</h2></section>
<section class="fg-related-products"><h2>Explore Our Products</h2></section>
<section class="fg-cta"><p>Existing CTA</p></section>`;
  const r4 = populateDynamicFields(withSections, { products, relatedArticles: related, cta, recommendationType: 'products' });
  check('does not duplicate existing Related Articles section', (r4.html.match(/fg-related-articles/g) || []).length === 1);
  check('does not duplicate existing Related Products section', (r4.html.match(/fg-related-products/g) || []).length === 1);
  check('does not duplicate existing CTA section', (r4.html.match(/fg-cta/g) || []).length === 1);

  // 1e) Product-recommendation placeholder replaced with a real product card.
  const withPlaceholder = '<h1>Treats</h1><p>Intro.</p><div class="product-recommendation">Product: dog treats</div>';
  const r5 = populateDynamicFields(withPlaceholder, { products, relatedArticles: [], cta: '', recommendationType: 'products' });
  check('product-recommendation placeholder replaced with real product card', /product-card/.test(r5.html) && r5.html.includes('Freeze-Dried Chicken Treats'));
  check('reports populated product recommendation in fixes', r5.fixes.some((f) => f.includes('populated 1 product recommendation')));

  // 1f) Internal /blog/ links rewired to real content-register articles.
  const withGenericLink = '<h1>Treats</h1><p>Read more about <a href="/blog/some-generic-topic">natural pet treats</a>.</p>';
  const r6 = populateDynamicFields(withGenericLink, { products: [], relatedArticles: related, cta: '', recommendationType: 'none' });
  check('generic /blog/ link rewired to a real article slug', r6.html.includes('/blog/benefits-of-natural-pet-treats'));
  check('reports rewired internal links in fixes', r6.fixes.some((f) => f.includes('rewired 1 internal link')));

  // 1g) recommendationType 'none' with no products appends no product section.
  const r7 = populateDynamicFields('<h1>Info</h1><p>Body.</p>', { products: [], relatedArticles: [], cta: '', recommendationType: 'none' });
  check('no product section when recommendationType is none and no products', !/fg-related-products/.test(r7.html));
}

/* ------------------------------------------------------------------ *
 * PHASE 2 — Publish pipeline against a mock WordPress REST API
 * ------------------------------------------------------------------ */
async function phase2() {
  section('PHASE 2: Publish pipeline (mock WordPress REST API)');

  // Boot a tiny mock WP REST API on a local port. It records the posts it
  // receives so we can assert on the exact payload FGOS pushes.
  const http = await import('http');
  const received: any[] = [];
  const mockPort = 3999;
  const mockServer = http.createServer((req: any, res: any) => {
    let body = '';
    req.on('data', (c: any) => (body += c));
    req.on('end', () => {
      const url = req.url || '';
      // POST /wp-json/wp/v2/posts -> create a post
      if (req.method === 'POST' && /\/wp-json\/wp\/v2\/posts$/.test(url)) {
        let parsed: any = {};
        try { parsed = JSON.parse(body); } catch { /* ignore */ }
        const id = 1000 + received.length;
        const post = { id, ...parsed, link: `https://mock.example.com/${parsed.slug || 'post'}` };
        received.push(post);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(post));
        return;
      }
      // GET /wp-json/wp/v2/posts?slug=... -> search (used by sync to avoid dupes)
      if (req.method === 'GET' && /\/wp-json\/wp\/v2\/posts/.test(url)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
        return;
      }
      // GET /wp-json/wp/v2/posts/:id?context=edit -> probe existing post
      const probe = url.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/);
      if (req.method === 'GET' && probe) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{"code":"rest_post_invalid_id"}');
        return;
      }
      // Anything else (media uploads etc.) -> minimal success
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });

  await new Promise<void>((resolve) => mockServer.listen(mockPort, resolve));

  try {
    const brand = {
      name: "Daniel's Tasty Petfoods",
      wpUrl: `http://127.0.0.1:${mockPort}`,
      wpUsername: 'admin',
      wpAppPassword: 'mock-app-password',
    };

    // A content item whose body already carries the dynamic sections (as if
    // generation + populateDynamicFields produced them), plus a blog number so
    // we can verify the slug suffixing.
    const bodyHtml = `<h1>Natural Dog Treats</h1>
<p>Natural treats are better for your dog.</p>
<section class="fg-related-articles"><h2>Keep Reading</h2></section>
<section class="fg-related-products"><h2>Explore Our Products</h2></section>
<section class="fg-cta"><p>Browse our shop today.</p></section>`;

    const contentItem = {
      title: 'Natural Dog Treats',
      contentType: 'post',
      bodyHtml,
      slug: 'natural-dog-treats',
      blogNumber: 'DTP001',
      primaryKeyword: 'natural dog treats',
      targetWordCount: 1100,
      blocks: [],
    };

    const res = await fetch(`${BASE}/api/wp/sync-content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, contentItem }),
    });
    const data = await res.json();

    check('sync-content returns success', !!data.success, JSON.stringify(data).slice(0, 200));
    check('sync-content returns a wpPostId', typeof data.wpPostId === 'number');
    check('sync-content returns a live link', typeof data.link === 'string' && data.link.length > 0);
    check('sync-content reports LIVE publish', data.wpStatus === 'publish');

    const pushed = received[0];
    check('mock WP received exactly one post', received.length === 1, `received ${received.length}`);
    if (pushed) {
      check('published post carries the article title', pushed.title === 'Natural Dog Treats');
      check('published post status is publish', pushed.status === 'publish');
      check('published post slug ends with blog number (DTP001)', String(pushed.slug).toLowerCase().endsWith('dtp001'), `slug=${pushed.slug}`);
      check('published post carries blog number in meta (blog_number)', pushed.meta?.blog_number === 'DTP001', `meta=${JSON.stringify(pushed.meta)}`);
      check('published post carries blog number in meta (blogNumber)', pushed.meta?.blogNumber === 'DTP001', `meta=${JSON.stringify(pushed.meta)}`);
      check('published post body keeps the dynamic Related Articles section', /fg-related-articles/.test(pushed.content || ''));
      check('published post body keeps the dynamic Related Products section', /fg-related-products/.test(pushed.content || ''));
      check('published post body keeps the final CTA section', /fg-cta/.test(pushed.content || ''));
      check('published post body has an H1 (title visible)', /<h1\b/i.test(pushed.content || ''));
    }
  } finally {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  }
}

/* ------------------------------------------------------------------ *
 * PHASE 3 — Live generation + SEO analysis (optional, graceful skip)
 * ------------------------------------------------------------------ */
async function phase3() {
  section('PHASE 3: Live generation → SEO analysis (optional)');

  const brand = {
    name: "Daniel's Tasty Petfoods",
    voiceGuidelines: 'Professional, clear, engaging, authoritative. Warm and trustworthy, focused on natural ingredients and pet wellbeing.',
    bannedWords: [],
  };
  const payload = {
    title: 'How to Choose Natural Dog Treats: A Complete Guide',
    contentType: 'post',
    primaryKeyword: 'natural dog treats',
    secondaryKeywords: ['healthy dog treats', 'natural ingredients for dogs', 'dog treat ingredients'],
    seoBrief: { intent: 'informational', audience: 'dog owners', keyPoints: ['what makes a treat natural', 'ingredients to look for'] },
    brand,
    applyHumanization: false,
    targetWordCount: 1100,
    modelPref: {},
  };

  let genRes;
  try {
    genRes = await fetch(`${BASE}/api/ai/generate-article`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e: any) {
    console.log('  SKIP — server unreachable for live generation:', String(e?.message || e).slice(0, 120));
    return;
  }
  if (!genRes.ok || !genRes.body) {
    console.log(`  SKIP — generate-article HTTP ${genRes.status} (AI provider may be unavailable)`);
    return;
  }

  const reader = genRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let doneData: any = null;
  let lastError: string | null = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let obj: any;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type === 'error') lastError = obj.error;
      else if (obj.type === 'done') doneData = obj.data;
    }
  }

  if (lastError || !doneData) {
    console.log(`  SKIP — live generation unavailable (${lastError || 'no done event'}). Skipping gracefully.`);
    return;
  }

  const { bodyHtml, articleTitle, metaDescription, wordCount } = doneData;
  check('live generation produced HTML body', !!bodyHtml && bodyHtml.length > 0);
  check('live generation produced a word count', Number(wordCount) > 0, `wordCount=${wordCount}`);

  // Verify the generated body carries the dynamic template fields.
  const populated = populateDynamicFields(bodyHtml, {
    products: [{ name: 'Freeze-Dried Chicken Treats', price: '9.99', currency: '£', permalink: 'https://shop.example.com/freeze-dried-chicken' }],
    relatedArticles: [{ slug: 'benefits-of-natural-pet-treats', title: 'Benefits of Natural Pet Treats' }],
    cta: 'Browse our full range of natural treats in the shop today.',
    recommendationType: 'products',
    brandName: brand.name,
  });
  check('generated body gains Related Articles section', /fg-related-articles/.test(populated.html));
  check('generated body gains Related Products section', /fg-related-products/.test(populated.html));
  check('generated body gains final CTA section', /fg-cta/.test(populated.html));

  // Score with the SEO analyzer.
  const anRes = await fetch(`${BASE}/api/seo/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: articleTitle || payload.title,
      metaDescription,
      focusKeyphrase: payload.primaryKeyword,
      secondaryKeyphrases: payload.secondaryKeywords,
      bodyHtml: populated.html,
      slug: 'how-to-choose-natural-dog-treats',
      expectedIntent: 'informational',
      siteUrl: 'https://danielstastypetfoods.co.uk',
      canonicalUrl: 'https://danielstastypetfoods.co.uk/how-to-choose-natural-dog-treats/',
      contentCategory: 'blog',
      author: { name: brand.name, jobTitle: 'Editorial Team', bio: 'Editorial team.', url: 'https://danielstastypetfoods.co.uk/about', worksFor: { name: brand.name } },
    }),
  });
  const analysis = await anRes.json();
  const d = analysis.data || analysis;
  const pct = d.pct;
  check('SEO analysis produced a score', typeof pct === 'number', `pct=${pct}`);
  if (typeof pct === 'number') {
    check(`SEO score meets 70% target (got ${pct}%)`, pct >= 70);
  }
}

/* ------------------------------------------------------------------ */
async function main() {
  console.log('FGOS END-TO-END FINAL TEST — generation → dynamic fields → published blog');
  phase1();
  await phase2();
  await phase3();

  console.log(`\n----------------------------------------`);
  console.log(`RESULT: ${passCount} passed, ${failCount} failed`);
  if (failures.length) {
    console.log('FAILED:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});

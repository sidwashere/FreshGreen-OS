#!/usr/bin/env node
/* E2E: generate article via /api/ai/generate-article, then score via /api/seo/analyze */
const BASE = 'http://127.0.0.1:3000';

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
  seoBrief: {
    intent: 'informational',
    audience: 'dog owners looking for healthier treat options',
    keyPoints: ['what makes a treat natural', 'ingredients to look for', 'ingredients to avoid', 'how to read labels'],
  },
  brand,
  applyHumanization: false,
  targetWordCount: 1100,
  modelPref: {},
};

async function main() {
  console.log('=== PHASE 1: generate article ===');
  const genRes = await fetch(`${BASE}/api/ai/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!genRes.ok || !genRes.body) {
    console.error('generate-article HTTP', genRes.status);
    process.exit(1);
  }

  const reader = genRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let doneData = null;
  let lastError = null;
  let lastStatus = '';
  const started = Date.now();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type === 'status') { lastStatus = obj.message; console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${obj.message}`); }
      else if (obj.type === 'heartbeat') { console.log(`  [${Math.round((Date.now() - started) / 1000)}s] heartbeat`); }
      else if (obj.type === 'error') { lastError = obj.error; console.error('  ERROR:', obj.error); }
      else if (obj.type === 'done') { doneData = obj.data; console.log('  DONE in', Math.round((Date.now() - started) / 1000) + 's'); }
    }
  }

  if (lastError) { console.error('Generation failed:', lastError); process.exit(1); }
  if (!doneData) { console.error('No done event received. Last status:', lastStatus); process.exit(1); }

  const { bodyHtml, articleTitle, metaTitle, metaDescription, wordCount, model, provider, fallback } = doneData;
  console.log(`\n  articleTitle: ${articleTitle}`);
  console.log(`  wordCount: ${wordCount}`);
  console.log(`  model: ${model} (provider ${provider}${fallback ? ', fallback used' : ''})`);
  console.log(`  metaTitle: ${metaTitle}`);
  console.log(`  metaDescription: ${metaDescription}`);

  console.log('\n=== PHASE 2: analyze ===');
  const anRes = await fetch(`${BASE}/api/seo/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: articleTitle || payload.title,
      metaDescription,
      focusKeyphrase: payload.primaryKeyword,
      secondaryKeyphrases: payload.secondaryKeywords,
      bodyHtml,
      slug: 'how-to-choose-natural-dog-treats',
      expectedIntent: 'informational',
      siteUrl: 'https://danielstastypetfoods.co.uk',
      canonicalUrl: 'https://danielstastypetfoods.co.uk/how-to-choose-natural-dog-treats/',
      contentCategory: 'blog',
      author: {
        name: "Daniel's Tasty Petfoods",
        jobTitle: 'Editorial Team',
        bio: "The editorial team at Daniel's Tasty Petfoods writes practical, evidence-based guides on natural pet nutrition, ingredient transparency, and healthy feeding habits for dogs.",
        url: 'https://danielstastypetfoods.co.uk/about',
        worksFor: { name: "Daniel's Tasty Petfoods" },
      },
    }),
  });
  const analysis = await anRes.json();
  if (!anRes.ok) { console.error('analyze HTTP', anRes.status, JSON.stringify(analysis).slice(0, 500)); process.exit(1); }

  const d = analysis.data || analysis;
  const { score, maxScore, pct, results } = d;
  console.log(`  score: ${score} / ${maxScore} (${pct}%)`);
  const pass = pct >= 70;
  console.log(`  TARGET >=70%: ${pass ? 'PASS' : 'FAIL'}`);

  if (results && Array.isArray(results)) {
    console.log('\n  --- failing checks (score < max) ---');
    const fails = results.filter((c) => c.score < c.maxScore);
    for (const c of fails) {
      console.log(`  [${c.score}/${c.maxScore}] ${c.title || c.name}: ${(c.description || '').slice(0, 120)}`);
    }
    console.log(`  (${fails.length} of ${results.length} checks below max)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
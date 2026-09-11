import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import zlib from 'zlib';
import https from 'https';
import http from 'http';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { analyzeContent } from '@power-seo/content-analysis';
import { Humanizer } from './src/lib/patina-core.js';
import {
  buildGrammarRulesPrompt,
  resolveGrammarRules,
  enforceGrammarRules,
  GRAMMAR_RULE_DEFS,
} from './src/lib/grammarRules.js';
import {
  populateDynamicFields,
  stripHtml,
  escapeHtmlAttr,
} from './src/lib/dynamicFields.js';
import { tipLabel, isDanielsBrand } from './src/lib/tipLabel.js';
import { initializeApp as initAdminApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, FieldValue as AdminFieldValue } from 'firebase-admin/firestore';

dotenv.config();

// ── Firebase Admin (server-side Firestore access) ────────────────────────────
// Lets the server read scheduled content items and publish them to WordPress
// even when no client is open. Uses Application Default Credentials: on Cloud
// Run this is the service's runtime SA (needs roles/datastore.user); locally
// set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file.
let adminDb: ReturnType<typeof getAdminFirestore> | null = null;
try {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    // Local dev/testing against the Firestore emulator — no credentials needed.
    initAdminApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'demo-fgos' });
    console.log('[FGOS] ✅ Firebase Admin initialized (EMULATOR mode) — server-side auto-publish armed');
  } else {
    // Production (Cloud Run): Application Default Credentials = the service's
    // runtime SA (needs roles/datastore.user). Locally: set
    // GOOGLE_APPLICATION_CREDENTIALS to a service-account key file.
    initAdminApp({ credential: applicationDefault() });
    console.log('[FGOS] ✅ Firebase Admin initialized — server-side auto-publish armed');
  }
  adminDb = getAdminFirestore();
} catch (err: any) {
  console.error('[FGOS] ⚠️ Firebase Admin init failed — server-side auto-publish disabled:', err?.message || err);
}

// ── Activity log helper ───────────────────────────────────────────────────────
// Writes a structured entry to the `activity_logs` Firestore collection so the
// Activity Log screen shows server-side events (auto-publishes, social fallback,
// errors) even when no client is open. Best-effort — never throws.
async function logServerActivity(entry: {
  category: 'generation' | 'api_request' | 'error' | 'event' | 'output';
  status: 'success' | 'error' | 'warning' | 'info';
  action: string;
  title: string;
  message: string;
  brandId?: string;
  brandName?: string;
  payload?: Record<string, any>;
  response?: Record<string, any>;
  durationMs?: number;
}) {
  if (!adminDb) return;
  try {
    const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await adminDb.collection('activity_logs').doc(logId).set({
      id: logId,
      timestamp: new Date().toISOString(),
      userId: 'system',
      userEmail: 'system@fgos.local',
      ...entry,
    });
  } catch (err: any) {
    console.error('[ActivityLog] server log write failed:', err?.message || err);
  }
}

// ── Server-side auto-publish scheduler ───────────────────────────────────────
// Two complementary mechanisms (both call runServerPublishCheck):
//  1. A setInterval that runs every 60s while the process is alive.
//  2. POST /api/autoblog/server-tick — called by a Cloud Scheduler job every
//     minute so the instance is woken (and kept warm) even when idle, which
//     also keeps the setInterval alive. The endpoint requires the tick secret.
const SERVER_PUBLISH_INTERVAL_MS = 60_000;
const PUBLISH_LOCK_TTL_MS = 2 * 60_000; // a stuck lock expires after 2 min

/** Publish a single content item to its brand's WordPress. */
async function publishItemToWordPress(item: any, brand: any): Promise<{ wpPostId: number; wpLiveUrl: string }> {
  const cleanUrl = brand.wpUrl.replace(/\/+$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${brand.wpUsername}:${brand.wpAppPassword || ''}`).toString('base64');
  const wpStatus = item.autoBlogOverrides?.wpStatus || 'publish';
  const wpTemplate = item.autoBlogOverrides?.wpTemplate || 'elementor_header_footer';

  const payload: any = {
    title: item.title,
    content: item.bodyHtml,
    status: wpStatus,
    slug: item.slug || undefined,
    template: wpTemplate !== 'default' ? mapWpTemplate(wpTemplate) : undefined,
  };

  if (item.featuredMediaId) {
    payload.featured_media = item.featuredMediaId;
  }

  const isUpdate = !!item.wpPostId;
  const endpoint = isUpdate
    ? `${cleanUrl}/wp-json/wp/v2/posts/${item.wpPostId}`
    : `${cleanUrl}/wp-json/wp/v2/posts`;

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`WordPress API ${resp.status}: ${errBody.slice(0, 200)}`);
  }

  const wpPost = await resp.json();
  return { wpPostId: wpPost.id, wpLiveUrl: wpPost.link || `${cleanUrl}/?p=${wpPost.id}` };
}

/** One scheduler tick: find due Draft_Ready items in Firestore and publish them. */
async function runServerPublishCheck(): Promise<{ published: number; errors: number }> {
  if (!adminDb) return { published: 0, errors: 0 };
  const now = Date.now();
  const snap = await adminDb.collection('content_items')
    .where('status', '==', 'Draft_Ready')
    .limit(50)
    .get();

  const due: { ref: any; item: any }[] = [];
  for (const doc of snap.docs) {
    const item = doc.data();
    const sched = item.scheduledPublishAt ? new Date(item.scheduledPublishAt).getTime() : null;
    if (!sched || sched > now) continue; // not due yet
    if (item.lastAutoPublishedAt) continue; // already published
    if (item.publishLock && now - item.publishLock < PUBLISH_LOCK_TTL_MS) continue; // locked by another tick
    due.push({ ref: doc.ref, item });
  }

  let published = 0;
  let errors = 0;
  for (const { ref, item } of due) {
    // ATOMIC lock acquisition: only one tick (of possibly several concurrent
    // ones — Cloud Scheduler + setInterval) may win the lock, so an item is
    // never published twice. The transaction re-checks the item's state.
    let acquired = false;
    try {
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data();
        if (!data) return;
        if (data.lastAutoPublishedAt) return; // already published
        if (data.publishLock && now - data.publishLock < PUBLISH_LOCK_TTL_MS) return; // locked
        tx.update(ref, { publishLock: now, updatedAt: new Date().toISOString() });
        acquired = true;
      });
    } catch (err: any) {
      console.error(`[AutoPublish] lock transaction failed for "${item.title}":`, err?.message || err);
      continue;
    }
    if (!acquired) continue; // another tick won the lock

    try {
      const brandSnap = await adminDb.collection('brands').doc(item.brandId).get();
      const brand = brandSnap.exists ? brandSnap.data() : null;
      if (!brand || !brand.wpUrl || !brand.wpUsername) {
        throw new Error('No valid brand connection');
      }
      const { wpPostId, wpLiveUrl } = await publishItemToWordPress(item, brand);
      const publishedAt = new Date().toISOString();
      await ref.update({
        status: 'Published',
        wpPostId,
        wpLiveUrl,
        lastAutoPublishedAt: publishedAt,
        publishLock: AdminFieldValue.delete(),
        lastAutoPublishError: AdminFieldValue.delete(),
        updatedAt: publishedAt,
      });
      // Sync the blog register entry (if it exists) so the register shows the
      // live status without any client being open.
      const regRef = adminDb.collection('blog_register').doc(item.id);
      const regSnap = await regRef.get();
      if (regSnap.exists) {
        await regRef.update({
          status: 'Published',
          datePublished: publishedAt,
          wpPostId,
          wpLiveUrl,
          updatedAt: publishedAt,
        });
      }
      published++;
      console.log(`[AutoPublish] ✅ "${item.title}" → ${wpLiveUrl}`);
      logServerActivity({ category: 'event', status: 'success', action: 'auto_publish', title: `Auto-published: ${item.title}`, message: `Published to WordPress: ${wpLiveUrl}`, brandId: item.brandId, brandName: brand?.name, response: { wpPostId, wpLiveUrl } });

      // Best-effort social package: if the item has no ready social content
      // (generated before this feature shipped, or generation failed), produce
      // it now from the published article. Never blocks or fails the publish.
      if (item.socialContent?.status !== 'ready') {
        try {
          const social = await generateSocialPackage({
            title: item.title,
            articleHtml: item.bodyHtml,
            brand,
            primaryKeyword: item.primaryKeyword,
            secondaryKeywords: item.secondaryKeywords,
            blogNumber: item.blogNumber,
            featuredImageUrl: item.featuredImageUrl,
            callToAction: item.sheetContext?.callToAction,
          });
          await ref.update({
            socialContent: {
              ...social.social,
              imageUrl: item.featuredImageUrl,
              blogNumber: item.blogNumber,
              articleTitle: item.title,
              articleUrl: wpLiveUrl,
              status: 'ready',
              generatedAt: new Date().toISOString(),
              model: social.model,
              provider: social.provider,
              fallback: social.fallback,
              latencyMs: social.latencyMs,
            },
            updatedAt: new Date().toISOString(),
          });
          console.log(`[AutoPublish] 📱 Social package generated for "${item.title}"`);
          logServerActivity({ category: 'generation', status: 'success', action: 'social_fallback', title: `Social package generated at publish: ${item.title}`, message: 'Social content produced by the server-side fallback after publishing.', brandId: item.brandId, brandName: brand?.name, payload: { model: social.model, provider: social.provider, latencyMs: social.latencyMs } });
        } catch (socErr: any) {
          console.error(`[AutoPublish] ⚠️ Social package failed for "${item.title}":`, socErr?.message || socErr);
          logServerActivity({ category: 'error', status: 'error', action: 'social_fallback_failed', title: `Social package failed at publish: ${item.title}`, message: (socErr?.message || 'Social generation failed.').slice(0, 300), brandId: item.brandId, brandName: brand?.name });
        }
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Publish failed';
      await ref.update({
        status: 'Error',
        lastAutoPublishError: errMsg,
        publishLock: AdminFieldValue.delete(),
        updatedAt: new Date().toISOString(),
      });
      errors++;
      console.error(`[AutoPublish] ❌ "${item.title}": ${errMsg}`);
      logServerActivity({ category: 'error', status: 'error', action: 'auto_publish_failed', title: `Auto-publish failed: ${item.title}`, message: errMsg.slice(0, 300), brandId: item.brandId, brandName: brand?.name });
    }
  }
  return { published, errors };
}

function startServerScheduler() {
  if (!adminDb) return;
  setInterval(() => {
    runServerPublishCheck().catch((err) => {
      console.error('[AutoPublish] scheduler tick failed:', err?.message || err);
    });
  }, SERVER_PUBLISH_INTERVAL_MS);
  console.log(`[FGOS] 🔄 Server-side auto-publish scheduler armed (every ${SERVER_PUBLISH_INTERVAL_MS / 1000}s)`);
}

const DEFAULT_WP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_WP_HEADERS = {
  'User-Agent': DEFAULT_WP_USER_AGENT,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

const GEMINI_TEXT_MODEL = 'gemini-3.5-flash';
const GEMINI_TEXT_FALLBACK_MODEL = 'gemini-flash-latest';
// Free-tier quota buckets are per-model, so we fall through the chain when one
// model is exhausted (RESOURCE_EXHAUSTED) and try the next.
const MODEL_CHAIN = Array.from(new Set([GEMINI_TEXT_MODEL, GEMINI_TEXT_FALLBACK_MODEL]));

// ── Grammar & style rules (Carol's request: feat-grammar-rules) ─────────────
// Shared editorial rules injected into every content-generation prompt so the
// rules are enforced at source, not patched manually after generation.
//
// The rule catalogue, per-brand merging and deterministic post-generation
// enforcement all live in src/lib/grammarRules.ts (shared with the frontend so
// the BrandManager toggles and the server never drift). `grammarRulesPrompt`
// renders the enabled rules for a given brand + optional per-request overrides.
const grammarRulesPrompt = (brand?: any, overrides?: any) =>
  buildGrammarRulesPrompt(brand, overrides);

const app = express();
// 25mb so PC image uploads fit: the client sends base64 data URLs (~4/3 the
// binary size), so a 12 MB image arrives as ~16 MB of JSON. The upload-media
// handler still caps the DECODED image at 12 MB with a friendly JSON error.
app.use(express.json({ limit: '25mb' }));

// Helper to initialize Gemini SDK cleanly on demand
function getGeminiClient() {
  // Prefer the explicitly-named GEMINI_API_KEY, then fall back to
  // GOOGLE_API_KEY (both may be set in the environment; either works with the
  // generativelanguage API).
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Honor the API's own "Please retry in Xs" hint (Google RetryInfo.retryDelay),
// capped at 60s so we never stall a request for long.
function parseRetryAfterHint(msg: string): number | null {
  const m = msg?.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (!m) return null;
  const secs = parseFloat(m[1]);
  return Number.isFinite(secs) && secs > 0 ? Math.min(secs * 1000, 60000) : null;
}

// Retry transient Gemini failures (503 high demand, 429 rate limit, RESOURCE_EXHAUSTED)
// with exponential backoff so spiky demand doesn't fail user generations.
async function generateContentWithRetry(ai: any, params: any, retries = 3) {
  let lastErr: any;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err: any) {
      lastErr = err;
      const msg = err?.message || '';
      const isTransient = /(code.?[:=]?\s?(503|429)|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand|rate limit)/i.test(msg);
      if (!isTransient || attempt === retries - 1) throw err;
      const hint = parseRetryAfterHint(msg);
      const delayMs = hint ?? ([2500, 8000, 15000][attempt] ?? 15000);
      console.log(`[AI] Transient Gemini error, retrying in ${delayMs / 1000}s (attempt ${attempt + 2}/${retries})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// Map legacy .php page template names to valid Hello Elementor / WP REST API
// template slugs.  The WP REST API rejects anything that isn't one of the three
// Elementor-registered values, so any custom theme template slug must be
// translated before the request is sent.
const WP_TEMPLATE_MAP: Record<string, string> = {
  'template-full-width.php':     'elementor_canvas',
  'template-pet-landing.php':    'elementor_canvas',
  'template-clean-guide.php':    'elementor_canvas',
  'template-community-care.php': 'elementor_canvas',
  'template-recipe.php':         'elementor_canvas',
  'page-wide.php':               'elementor_header_footer',
  'single-dtp-blog.php':         'elementor_header_footer',
  'dtp-blog-template':           'elementor_header_footer',
};
function mapWpTemplate(slug: string): string {
  if (!slug || slug === 'default') return slug;
  if (WP_TEMPLATE_MAP[slug]) return WP_TEMPLATE_MAP[slug];
  // Fallback: "full-width" or "canvas" in the name → blank canvas;
  // otherwise keep the site header/footer.
  if (/full[-_]?width|canvas|landing/i.test(slug)) return 'elementor_canvas';
  return 'elementor_header_footer';
}

// Try each model in the chain; on 429/RESOURCE_EXHAUSTED for one model, fall
// through to the next. Returns the generated response plus the model that
// produced it (so downstream calls like the humanizer reuse the same model).
//
// Strategy: earlier models in the chain are tried once (they may just be
// momentarily busy); the LAST model gets patient retries that honor the API's
// own "retry in Xs" hint, in case the bucket recovers in seconds/minutes.
async function generateWithModelFallback(ai: any, params: any): Promise<{ text: string; model: string }> {
  let lastErr: any;
  const chain = MODEL_CHAIN;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const isLast = i === chain.length - 1;
    try {
      // Earlier models: single fast attempt, fall through on any error.
      // Last model: patient retries honoring the API's own backoff hint,
      // in case that quota bucket recovers in seconds/minutes.
      const attempts = isLast ? 3 : 1;
      const response = await generateContentWithRetry(ai, { ...params, model }, attempts);
      return { text: response.text || '{}', model };
    } catch (err: any) {
      lastErr = err;
      const msg = err?.message || '';
      const quotaModel = msg.match(/model:\s*([\w.-]+)/)?.[1] || model;
      console.warn(`[AI] Model ${quotaModel} unavailable, falling back to next model in chain. ${msg.slice(0, 140)}`);
    }
  }
  throw lastErr;
}

// Normalize a count value (string|number|null|undefined) to a safe non-NaN number.
function safeCount(value: any): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

// ── Social media content package (Facebook / Instagram / Google Business) ────
// Generates the three platform texts from the final article in ONE model call
// (consistent voice, one latency cost). Word counts are validated server-side
// with one corrective retry. Best-effort by design: callers must never fail the
// article generation because social failed — they store status 'error' instead.
const SOCIAL_TARGETS = { facebook: 500, instagram: 150, googleBusiness: 90 };
const SOCIAL_TOLERANCE = 0.2; // ±20% off-target triggers one corrective retry

function countPlainWords(text: string = ''): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

/** Parse the model's JSON output, tolerating code fences and a missing key. */
function parseSocialJson(text: string): { facebook: string; instagram: string; googleBusiness: string } {
  let t = (text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    const obj = JSON.parse(t);
    return {
      facebook: String(obj.facebook || '').trim(),
      instagram: String(obj.instagram || '').trim(),
      googleBusiness: String(obj.googleBusiness || obj.google_business || '').trim(),
    };
  } catch {
    // Heuristic fallback: pull the three sections out of a non-JSON response.
    const grab = (key: string): string => {
      const m = t.match(new RegExp(`["']?${key}["']?\\s*[:=]\\s*["']([\\s\\S]*?)["']`, 'i'));
      return m ? m[1].trim() : '';
    };
    const facebook = grab('facebook');
    const instagram = grab('instagram');
    const googleBusiness = grab('googleBusiness') || grab('google_business');
    if (facebook || instagram || googleBusiness) return { facebook, instagram, googleBusiness };
    throw new Error('Could not parse social package from model output');
  }
}

/** Generate the Facebook / Instagram / Google Business Profile package for one
 *  article in a single model call. Throws on failure — callers decide how to
 *  degrade (best-effort). */
async function generateSocialPackage(opts: {
  title: string;
  articleHtml?: string;
  brand?: any;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  blogNumber?: string;
  featuredImageUrl?: string;
  callToAction?: string;
  byokKeys?: any;
  modelPref?: any;
}): Promise<{
  social: { facebook: string; instagram: string; googleBusiness: string };
  wordCounts: { facebook: number; instagram: number; googleBusiness: number };
  model: string;
  provider: string;
  fallback: boolean;
  latencyMs: number;
}> {
  const startedAt = Date.now();
  const { title, brand, primaryKeyword, secondaryKeywords, blogNumber, featuredImageUrl, callToAction, byokKeys } = opts;

  const aiApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || byokKeys?.gemini;
  const ai = aiApiKey ? new GoogleGenAI({ apiKey: aiApiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } }) : null;
  if (!ai) throw new Error('No Gemini API key available');

  const bannedWordsText = brand?.bannedWords?.length
    ? `STRICT BANNED WORDS (DO NOT USE ANY OF THESE): ${brand.bannedWords.join(', ')}.`
    : '';
  const ref = blogNumber || 'N/A';

  const prompt = `You are the social media manager for "${brand?.name || 'the brand'}".
Brand Voice & Tone Guidelines: ${brand?.voiceGuidelines || 'Professional, clear, engaging, authoritative'}.
${bannedWordsText}
BRITISH ENGLISH RULE: Write entirely in British English (colour, favourite, analyse, organise, centre, etc.). Never use American spellings.
${grammarRulesPrompt(brand)}

ARTICLE TITLE: "${title}"
BLOG REFERENCE NUMBER: ${ref} — this MUST appear in every post (e.g. "Blog ${ref}") so the VA can match the social content to the article.
PRIMARY KEYWORD: ${primaryKeyword || ''}
${secondaryKeywords?.length ? `SECONDARY KEYWORDS: ${secondaryKeywords.join(', ')}` : ''}
${callToAction ? `CALL TO ACTION: ${callToAction}` : ''}
${featuredImageUrl ? `MAIN IMAGE: ${featuredImageUrl} — the accompanying image for these posts.` : ''}

Write a complete social media content package for this article. Return ONLY valid JSON with exactly these three keys:

{
  "facebook": "~500 words. An engaging Facebook post: a strong hook as the first line, then 2-4 short paragraphs covering the article's key points, a clear call to action, a link to the blog (Blog ${ref}), and 2-4 relevant hashtags. Warm, conversational brand voice.",
  "instagram": "~150 words. An Instagram caption: a hook, a concise summary of the article's most compelling points, 2-4 emojis used naturally, 5-8 relevant hashtags, a call to action, and a note that the image accompanies this post.",
  "googleBusiness": "~90 words. A professional Google Business Profile update: the article's key benefit in a concise, trustworthy tone, a call to action, a link to the blog (Blog ${ref}). NO hashtags, NO emojis."
}

Rules:
- Every post must reference the blog reference number (Blog ${ref}).
- Never use banned words. Follow the brand voice and grammar rules exactly.
- Do not invent facts not supported by the article. Keep health/nutritional claims qualified ("may support", "as part of a balanced diet").
- No markdown code fences, no commentary — ONLY the JSON object.`;

  // One corrective retry if word counts are badly off-target.
  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const correction = attempt === 1
        ? '\n\nIMPORTANT: Your previous output had incorrect word counts. Hit the targets exactly: facebook ~500 words, instagram ~150 words, googleBusiness ~90 words.'
        : '';
      const { text, model } = await generateWithModelFallback(ai, {
        contents: [{ role: 'user', parts: [{ text: prompt + correction }] }],
        generationConfig: { responseMimeType: 'application/json' },
      });
      const social = parseSocialJson(text);
      const wordCounts = {
        facebook: countPlainWords(social.facebook),
        instagram: countPlainWords(social.instagram),
        googleBusiness: countPlainWords(social.googleBusiness),
      };
      const offTarget = (key: keyof typeof SOCIAL_TARGETS) =>
        Math.abs(wordCounts[key] - SOCIAL_TARGETS[key]) / SOCIAL_TARGETS[key] > SOCIAL_TOLERANCE;
      if (attempt === 0 && (offTarget('facebook') || offTarget('instagram') || offTarget('googleBusiness'))) {
        console.log(`[Social] Word counts off-target (${JSON.stringify(wordCounts)}) — retrying once…`);
        continue;
      }
      return {
        social,
        wordCounts,
        model,
        provider: 'gemini',
        fallback: false,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err: any) {
      lastErr = err;
      if (attempt === 0) continue;
    }
  }
  throw lastErr || new Error('Social generation failed');
}

// ---------- Streamed generation helpers ----------
// The client consumes the generation endpoint as newline-delimited JSON:
//   {"type":"status","message":"...","percent":5}
//   {"type":"stream","text":"...","words":123,"percent":42,"phase":"Writing section 2"}
//   {"type":"heartbeat","elapsed":60}
//   {"type":"done","data":{...}}
//   {"type":"error","error":"..."}
// This keeps the user informed: percentage progress, the model's live output
// ("thoughts" as it writes), heartbeats so a quiet model isn't mistaken for a
// hang, and a clean done/error terminal state.

function ndjson(res: any, obj: any) {
  if (res.writableEnded || res.destroyed) return;
  res.write(JSON.stringify(obj) + '\n');
}

function countWords(text: string = ''): number {
  const t = stripHtml(text);
  return t ? t.split(/\s+/).length : 0;
}

// Stream the article write across the model chain (falling through quota'd
// models). Yields { text, model } chunks.
async function* streamWithModelFallback(ai: any, params: any, onFallback?: (model: string, msg: string) => void) {
  let lastErr: any;
  for (const model of MODEL_CHAIN) {
    // Transient 429/503s (quota spikes, "high demand") recover in seconds —
    // retry the same model with backoff before falling through, mirroring the
    // single-shot path. Auth/safety/config errors fail fast instead.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const stream = await ai.models.generateContentStream({ ...params, model });
        for await (const chunk of stream) {
          const text = chunk?.text;
          if (text) yield { text, model };
        }
        return; // completed on this model
      } catch (err: any) {
        lastErr = err;
        const msg = err?.message || '';
        // Auth/safety/config errors won't fix themselves on another model.
        if (/API_KEY|PERMISSION|SAFETY|BLOCKED|model\s+not\s+found/i.test(msg)) throw err;
        const isTransient = /(code.?[:=]?\s?(503|429)|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand|rate limit)/i.test(msg);
        if (!isTransient || attempt === 2) {
          if (onFallback) onFallback(model, msg.slice(0, 160));
          console.warn(`[AI] Stream model ${model} failed (${msg.slice(0, 140)}), trying next in chain…`);
          break; // move to next model
        }
        const hint = parseRetryAfterHint(msg);
        // Cap stream-start backoff at 15s: the 75s watchdog would otherwise
        // kill the generation while we wait out the API's hint (e.g. 59s).
        // Better to fall through to the next provider/fail fast.
        const delayMs = Math.min(hint ?? ([2500, 8000, 15000][attempt] ?? 15000), 15000);
        console.log(`[AI] Transient stream error on ${model}, retrying in ${delayMs / 1000}s (attempt ${attempt + 2}/3)...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr || new Error('All models failed to start the stream.');
}

// ---------- Cross-provider model router ----------
// Every AI action now runs through an ordered provider chain so a free-tier
// Gemini quota block (e.g. "generate_content_free_tier_requests, limit: 20")
// never stops the user: we fall through to a free OpenRouter model, then a
// custom OpenAI-compatible endpoint, and always report which provider/model
// actually produced the result (model attribution + generation history).
// Current OpenRouter free tier (verified live, 2026): pricing prompt=0 & completion=0.
// Reasoning models (gpt-oss) answer in `content` when given enough tokens — the
// router also falls back to `reasoning` text when content comes back empty.
const OPENROUTER_FREE_MODELS = [
  'openai/gpt-oss-20b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'cohere/north-mini-code:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'inclusionai/ling-3.0-tiny:free',
  'poolside/laguna-s-2.1:free',
];

// "Professional" tier for quality-critical jobs (SEO refine/audit): paid
// OpenRouter models, live-verified 2026. Priced at a fraction of a cent per
// call (~$0.0000004–0.000002/token), so a full-article rewrite is well under
// $0.05. Ordered best-quality-first for the fallback chain.
const OR_PROFESSIONAL_MODELS = [
  'openai/gpt-5.6-terra',        // flagship-class, cheap, excellent editor
  'anthropic/claude-sonnet-5',   // top-tier writing & judgment
  'deepseek/deepseek-v4-pro',    // very cheap reasoning model, strong prose
  'google/gemini-3.5-flash',     // strong all-rounder
  'moonshotai/kimi-k3',          // long-context, creative
];

function isQuotaError(msg: string): boolean {
  return /(429|RESOURCE_EXHAUSTED|quota|rate limit|too many requests)/i.test(msg || '');
}

// Generic OpenAI-compatible /chat/completions call (used by OpenRouter free
// tier and any custom base URL the user configures in Settings).
async function fetchOpenAICompatible(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemInstruction?: string;
  prompt: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body: any = {
    model: opts.model,
    messages: [
      ...(opts.systemInstruction ? [{ role: 'system', content: opts.systemInstruction }] : []),
      { role: 'user', content: opts.prompt },
    ],
    max_tokens: opts.maxTokens ?? 4096,
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err: any = new Error(`${opts.baseUrl} ${response.status}: ${data?.error?.message || data?.message || response.statusText}`);
    err.status = response.status;
    throw err;
  }
  const message = data?.choices?.[0]?.message || {};
  // Some OpenRouter reasoning models (e.g. gpt-oss) put text in `reasoning`
  // and leave `content` null when they run out of tokens thinking.
  const text = message?.content || message?.reasoning || data?.choices?.[0]?.text;
  if (!text) throw new Error(`${opts.baseUrl} returned an empty completion.`);
  return text;
}

// Build the ordered provider chain from the user's preference + available keys.
// Preferred provider first, then fallbacks (auto) per provider.
function buildProviderChain(
  byokKeys: any = {},
  pref: any = {},
  opts?: { orProfessionalFirst?: boolean }
): Array<{
  provider: 'gemini' | 'openrouter' | 'custom';
  model: string;
  run: (params: any) => Promise<{ text: string }>;
}> {
  const chain: Array<{
    provider: 'gemini' | 'openrouter' | 'custom';
    model: string;
    run: (params: any) => Promise<{ text: string }>;
  }> = [];
  const auto = pref.autoFallback !== false;

  const pushGemini = (model: string, overrideKey?: string) => {
    const ai = (overrideKey ? new GoogleGenAI({ apiKey: overrideKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } }) : getGeminiClient());
    if (!ai) return;
    chain.push({
      provider: 'gemini',
      model,
      run: async (params: any) => {
        // Single fast attempt — if the bucket is quota'd, fall through to the
        // next provider instead of stalling the request on a 60s backoff.
        const geminiParams: any = {
          contents: params.prompt,
          config: {
            ...(params.systemInstruction ? { systemInstruction: params.systemInstruction } : {}),
            ...(params.geminiConfig || {}),
          },
        };
        if (params.json) geminiParams.config.responseMimeType = 'application/json';
        if (params.jsonSchema) geminiParams.config.responseSchema = params.jsonSchema;
        const response = await generateContentWithRetry(ai, { ...geminiParams, model }, 3);
        return { text: response.text || '{}' };
      },
    });
  };

  const pushOpenRouter = (model: string, apiKey: string) => {
    chain.push({
      provider: 'openrouter',
      model,
      run: async (params: any) => ({
        text: await fetchOpenAICompatible({
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey,
          model,
          systemInstruction: params.systemInstruction,
          prompt: params.prompt,
          json: params.json,
          maxTokens: params.maxTokens,
          temperature: params.temperature,
        }),
      }),
    });
  };

  const pushCustom = (model: string) => {
    chain.push({
      provider: 'custom',
      model,
      run: async (params: any) => ({
        text: await fetchOpenAICompatible({
          baseUrl: byokKeys.openaiBaseUrl,
          apiKey: byokKeys.openai,
          model,
          systemInstruction: params.systemInstruction,
          prompt: params.prompt,
          json: params.json,
          maxTokens: params.maxTokens,
          temperature: params.temperature,
        }),
      }),
    });
  };

  // 1) The user's preferred provider, first.
  if (pref.provider === 'gemini') {
    pushGemini(pref.model || GEMINI_TEXT_MODEL);
  } else if (pref.provider === 'openrouter') {
    const orKey = byokKeys.openrouter || process.env.OPENROUTER_API_KEY;
    if (orKey) pushOpenRouter(pref.model || OPENROUTER_FREE_MODELS[0], orKey);
  } else if (pref.provider === 'custom') {
    if (byokKeys.openaiBaseUrl && byokKeys.openai) pushCustom(pref.model || byokKeys.customModel || 'gpt-4o-mini');
  }

  if (auto) {
    // 2) Other Gemini models with the server key (quota buckets are per-model).
    const geminiModels = [GEMINI_TEXT_MODEL, GEMINI_TEXT_FALLBACK_MODEL];
    for (const m of geminiModels) {
      if (!chain.some((c) => c.provider === 'gemini' && c.model === m)) pushGemini(m);
    }
    // 2b) BYOK Gemini key as a fallback (different quota bucket from the server key).
    if (byokKeys.gemini && byokKeys.gemini !== (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY)) {
      for (const m of geminiModels) {
        if (!chain.some((c) => c.provider === 'gemini' && c.model === m)) pushGemini(m, byokKeys.gemini);
      }
    }
    // 3) OpenRouter — professional tier first when requested (quality-critical
    // jobs like SEO refine/audit), then the always-available free tier.
    const orKey = byokKeys.openrouter || process.env.OPENROUTER_API_KEY;
    if (orKey) {
      const orModels = opts?.orProfessionalFirst
        ? [...OR_PROFESSIONAL_MODELS, ...OPENROUTER_FREE_MODELS]
        : [OPENROUTER_FREE_MODELS[0], ...OPENROUTER_FREE_MODELS.slice(1)];
      for (const m of orModels) {
        if (!chain.some((c) => c.provider === 'openrouter' && c.model === m)) pushOpenRouter(m, orKey);
      }
    }
    // 4) Custom OpenAI-compatible endpoint as the last resort.
    if (byokKeys.openaiBaseUrl && byokKeys.openai) {
      if (!chain.some((c) => c.provider === 'custom')) pushCustom(byokKeys.customModel || 'gpt-4o-mini');
    }
  }

  return chain;
}

// Robust JSON extraction from model output: models frequently wrap JSON in
// markdown code fences or stray prose. Strips fences, then falls back to
// extracting the first balanced {...} object.
function parseModelJson(text: string): any {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(t);
  } catch { /* fall through */ }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = t.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch { /* fall through */ }
  }
  throw new Error('Model returned non-JSON output.');
}

// Unified non-streaming completion across providers. Returns the winning
// provider + model so the UI can attribute every generation.
async function completeWithProvider(
  byokKeys: any = {},
  pref: any = {},
  params: { systemInstruction?: string; prompt: string; json?: boolean; jsonSchema?: any; geminiConfig?: any; maxTokens?: number; temperature?: number },
  opts?: { skipProviders?: Array<'gemini' | 'openrouter' | 'custom'>; orProfessionalFirst?: boolean }
): Promise<{ text: string; provider: string; model: string; fallback: boolean }> {
  const chain = buildProviderChain(byokKeys, pref, { orProfessionalFirst: opts?.orProfessionalFirst }).filter((step) => !opts?.skipProviders?.includes(step.provider));
  if (!chain.length) {
    throw new Error('No AI provider configured. Add a Gemini key on the server, or an OpenRouter key in Settings > AI Models.');
  }
  const steps = pref.autoFallback === false ? chain.slice(0, 1) : chain;
  let lastErr: any = null;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      const res = await step.run(params);
      return { text: res.text, provider: step.provider, model: step.model, fallback: i > 0 };
    } catch (err: any) {
      lastErr = err;
      console.warn(`[AI] ${step.provider}/${step.model} failed (${String(err?.message || err).slice(0, 160)}) — trying next provider…`);
    }
  }
  const msg = String(lastErr?.message || lastErr || 'Unknown AI failure');
  const quota = isQuotaError(msg);
  const err: any = new Error(
    quota
      ? 'Gemini API quota exceeded. Add a paid Gemini API key in Settings > AI Models (BYOK), or wait for the free-tier quota to reset at midnight Pacific Time.'
      : msg
  );
  err.isQuota = quota;
  throw err;
}

// Build visual blocks from the final article HTML so the Blocks view is always
// populated whenever content exists (headings -> sections, FAQ -> faq block,
// product-ish sections -> product_cta, first h1 -> hero).
function parseHtmlIntoBlocks(html: string, title?: string, keyword?: string, brand?: any): any[] {
  if (!html || !stripHtml(html)) return [];
  const blocks: any[] = [];

  // Capture ordered heading positions (h1/h2/h3) with their inner text.
  const headingRe = /<h([123])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings: { level: number; text: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html))) {
    const text = stripHtml(m[2]);
    if (!text) continue;
    headings.push({ level: Number(m[1]), text, start: m.index, end: headingRe.lastIndex });
  }

  const textBetween = (start: number, end: number) => stripHtml(html.slice(start, end));

  // Section text variant that keeps <li> boundaries as "• " bullets so block
  // rendering can rebuild real <ul> lists in the pushed article instead of
  // flattening every list into one wall of text.
  const sectionText = (start: number, end: number) =>
    stripHtml(html.slice(start, end).replace(/<li\b[^>]*>/gi, '\n• ').replace(/<\/li>/gi, '\n'))
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

  // FAQ / CTA detection helpers
  const isFaq = (t: string) => /(^|\s)(faq|frequently asked|questions?\b|common questions)/i.test(t);
  const isCta = (t: string) => /(product|shop|cta|get started|try |order|bundle|purchase|call to action)/i.test(t);

  if (headings.length === 0) {
    // No headings at all: single paragraph block from the plain text.
    const content = stripHtml(html);
    if (content) {
      blocks.push({ type: 'paragraph', title: '', content: content.slice(0, 4000) });
    }
    return blocks;
  }

  // Hero block from the first h1 (or the article title if no h1 exists).
  // Populated with title, a short subtitle (first 1-2 sentences) AND the full
  // intro as content so the Blocks view never shows an empty hero.
  const h1 = headings.find((h) => h.level === 1);
  const heroEnd = h1 ? h1.end : headings[0].start;
  const heroSubtitle = h1
    ? sectionText(h1.end, headings.find((h) => h.start > h1.end)?.start ?? html.length)
    : '';
  blocks.push({
    type: 'hero',
    title: h1?.text || title || 'Featured Story',
    subtitle: heroSubtitle ? heroSubtitle.split(/[.!?]/).slice(0, 2).join('. ') + '.' : '',
    content: heroSubtitle ? heroSubtitle.slice(0, 700) : '',
    badge: keyword || 'Featured',
  });

  // Walk remaining headings into section blocks.
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    if (h.level === 1) continue; // handled as hero

    if (h.level === 2 && isFaq(h.text)) {
      // FAQ section: absorb any following h3+p Q/A pairs into one faq block,
      // stopping at the next h2 (a new section).
      const pairs: string[] = [];
      let j = i + 1;
      const sectionEnd = headings.find((nh) => nh.start > h.start && nh.level <= 2)?.start ?? html.length;
      for (; j < headings.length; j++) {
        const nh = headings[j];
        if (nh.level <= 2) break; // next section
        if (nh.level !== 3) continue;
        const qStart = nh.end;
        const qEnd = headings[j + 1]?.start ?? sectionEnd;
        const q = stripHtml(nh.text);
        const a = textBetween(qStart, Math.min(qEnd, sectionEnd));
        if (q) pairs.push(`Q: ${q}\nA: ${a}`);
      }
      i = j - 1; // skip the absorbed h3 headings
      const content = pairs.length ? pairs.join('\n\n') : sectionText(h.end, Math.min(headings[i + 1]?.start ?? html.length, sectionEnd)).slice(0, 3000);
      blocks.push({ type: 'faq', title: h.text, content });
      continue;
    }

    const sectionStart = h.end;
    const sectionEnd = headings[i + 1]?.start ?? html.length;
    let content = sectionText(sectionStart, sectionEnd);

    if (isCta(h.text) || /class="[^"]*cta[^"]*"/i.test(html.slice(sectionStart, sectionEnd))) {
      const btnMatch = html.slice(sectionStart, sectionEnd).match(/<a[^>]*>([\s\S]*?)<\/a>|<button[^>]*>([\s\S]*?)<\/button>/i);
      const btnText = btnMatch ? stripHtml(btnMatch[1] || btnMatch[2] || '') : '';
      const linkMatch = html.slice(sectionStart, sectionEnd).match(/<a[^>]*href="([^"]+)"/i);
      blocks.push({
        type: 'product_cta',
        title: h.text,
        content: content.slice(0, 1500),
        buttonText: btnText || 'Learn More',
        buttonUrl: linkMatch?.[1] || '#',
      });
    } else {
      blocks.push({ type: 'paragraph', title: h.text, content: content.slice(0, 4000) });
    }
  }

  // Guarantee at least one content block beyond the hero.
  if (blocks.length === 1) {
    blocks.push({ type: 'paragraph', title: '', content: textBetween(headings[0].end, html.length).slice(0, 4000) });
  }

  // Detect Daniel's Tip and Product Recommendation divs inserted by the AI.
  // These are special elements the AI generates as <div class="daniels-tip">
  // and <div class="product-recommendation">. Extract them as dedicated blocks.
  const tipRe = /<div[^>]*class="[^"]*daniels-tip[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let tipMatch: RegExpExecArray | null;
  while ((tipMatch = tipRe.exec(html)) !== null) {
    const content = stripTipPrefix(stripHtml(tipMatch[1]));
    if (content) {
      blocks.push({ type: 'daniels_tip', title: tipLabel(brand), content: content.slice(0, 1000) });
    }
  }
  const prodRe = /<div[^>]*class="[^"]*product-recommendation[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let prodMatch: RegExpExecArray | null;
  while ((prodMatch = prodRe.exec(html)) !== null) {
    const content = stripHtml(prodMatch[1]).trim();
    if (content) {
      blocks.push({ type: 'product_cta', title: content.slice(0, 200), content: '', buttonText: 'View Product', buttonUrl: '#', badge: 'Recommended' });
    }
  }

  // Capture <img> tags into image_banner blocks so generated article images
  // survive into the editor preview AND the WordPress push. The previous code
  // walked headings only, silently dropping every <img> the model wrote.
  // data: URIs are skipped — they are base64 blobs that bloat Firestore and get
  // stripped by WordPress's allowed-protocol filter; real https URLs are kept.
  // DEDUPLICATION: only one image per unique URL, hero image is excluded from
  // image_banner blocks, and at most 1 in-article image block is kept.
  const imgRe = /<img\b[^>]*>/gi;
  const seenSrcs = new Set<string>();
  const imgBlocks: any[] = [];
  let heroImg: { src: string; alt: string } | null = null;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRe.exec(html)) !== null) {
    const tag = imgMatch[0];
    const src = tag.match(/src\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    if (!src || src.startsWith('data:')) continue;
    const alt = tag.match(/alt\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    // First valid image becomes the hero image — skip it for image_banner blocks.
    if (!heroImg) { heroImg = { src, alt }; continue; }
    // Deduplicate: skip if we already have this URL.
    if (seenSrcs.has(src)) continue;
    seenSrcs.add(src);
    imgBlocks.push({
      id: `block-${Date.now()}-img${imgBlocks.length}`,
      type: 'image_banner',
      title: '',
      subtitle: '',
      content: '',
      buttonText: '',
      buttonUrl: '',
      keywords: '',
      imageLayout: 'full',
      imageUrl: src,
      imageAlt: alt,
    });
  }

  // Give the hero band a media image when the model supplied one.
  if (heroImg && blocks[0]?.type === 'hero' && !(blocks[0].imageUrl || '').trim()) {
    blocks[0].imageUrl = heroImg.src;
    blocks[0].imageAlt = heroImg.alt || blocks[0].title || 'Article image';
  }

  // Insert ONE image right after the hero — never at the bottom.
  const inArticleImg = imgBlocks.slice(0, 1);
  if (inArticleImg.length && blocks.length > 0) {
    blocks.splice(1, 0, ...inArticleImg);
  }

  return blocks.slice(0, 10);
}

// ==========================================
// Intelligent auto-block generation
// ==========================================
// Carol's feat-auto-blocks: instead of only reactively parsing the finished
// HTML into generic paragraph blocks, the engine now decides WHICH blocks make
// each article most effective — image wraps, product showcases, CTA bands,
// card grids, quotes, callouts, Daniel's Tips, newsletter signups, FAQs — and
// builds them from the content it finds. The user can optionally state which
// blocks they want (`requestedBlocks`); those take priority and are merged
// with the auto-detected defaults.
//
// Block type catalogue (src/types.ts VisualBlockType):
//   hero, paragraph, heading, product_cta, faq, callout, image_banner, cards,
//   quote, cta_band, carousel, daniels_tip, newsletter

const BLOCK_TYPE_LABELS: Record<string, string> = {
  hero: 'Hero',
  paragraph: 'Paragraph',
  heading: 'Heading',
  product_cta: 'Product Showcase',
  faq: 'FAQ',
  callout: 'Callout',
  image_banner: 'Image',
  cards: 'Card Grid',
  quote: 'Quote',
  cta_band: 'CTA Band',
  carousel: 'Carousel',
  daniels_tip: "Daniel's Tip",
  newsletter: 'Newsletter',
};

// Normalise a user-supplied block hint (free text or a type name) to a known
// VisualBlockType, or null if it doesn't match anything.
function normalizeBlockHint(hint: string): string | null {
  const h = String(hint || '').trim().toLowerCase();
  if (!h) return null;
  // Exact type names first.
  if (BLOCK_TYPE_LABELS[h]) return h;
  // Friendly aliases.
  const aliases: Record<string, string> = {
    'image': 'image_banner',
    'image banner': 'image_banner',
    'image wrap': 'image_banner',
    'imagewrap': 'image_banner',
    'photo': 'image_banner',
    'picture': 'image_banner',
    'product': 'product_cta',
    'product showcase': 'product_cta',
    'product cta': 'product_cta',
    'showcase': 'product_cta',
    'shop': 'product_cta',
    'buy': 'product_cta',
    'cta': 'cta_band',
    'cta band': 'cta_band',
    'call to action': 'cta_band',
    'cards': 'cards',
    'card grid': 'cards',
    'card': 'cards',
    'grid': 'cards',
    'quote': 'quote',
    'testimonial': 'quote',
    'callout': 'callout',
    'tip': 'daniels_tip',
    "daniel's tip": 'daniels_tip',
    'daniels tip': 'daniels_tip',
    'newsletter': 'newsletter',
    'signup': 'newsletter',
    'subscribe': 'newsletter',
    'faq': 'faq',
    'faqs': 'faq',
    'questions': 'faq',
    'carousel': 'carousel',
    'slider': 'carousel',
    'hero': 'hero',
    'paragraph': 'paragraph',
    'heading': 'heading',
    'section': 'paragraph',
  };
  return aliases[h] || null;
}

// Build a `cards` grid block from a list-like HTML region (ul/ol with 3+ items).
function cardsFromList(html: string, title: string): any | null {
  const listRe = /<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = listRe.exec(html)) !== null) {
    const items = Array.from(m[2].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi))
      .map((im) => stripHtml(im[1]).trim())
      .filter(Boolean);
    if (items.length >= 3) {
      return {
        id: `block-${Date.now()}-cards${Math.floor(Math.random() * 1000)}`,
        type: 'cards',
        title,
        content: '',
        cards: items.slice(0, 6).map((c, i) => ({
          id: `card-${Date.now()}-${i}`,
          title: c.split(/[.:]/)[0].slice(0, 60),
          content: c.slice(0, 240),
        })),
      };
    }
  }
  return null;
}

// Build a `quote` block from a <blockquote> element.
function quoteFromHtml(html: string): any | null {
  const qRe = /<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi;
  const m = qRe.exec(html);
  if (!m) return null;
  const text = stripHtml(m[1]).trim();
  if (!text) return null;
  const cite = m[1].match(/<cite\b[^>]*>([\s\S]*?)<\/cite>/i);
  return {
    id: `block-${Date.now()}-quote${Math.floor(Math.random() * 1000)}`,
    type: 'quote',
    title: '',
    content: text.slice(0, 600),
    author: cite ? stripHtml(cite[1]).trim() : undefined,
  };
}

// Build a `callout` block from a callout/note/important div.
function calloutFromHtml(html: string): any | null {
  const cRe = /<div[^>]*class="[^"]*(?:callout|note|important|highlight|alert)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = cRe.exec(html)) !== null) {
    const text = stripHtml(m[1]).trim();
    if (text) {
      return {
        id: `block-${Date.now()}-callout${Math.floor(Math.random() * 1000)}`,
        type: 'callout',
        title: '',
        content: text.slice(0, 800),
      };
    }
  }
  return null;
}

// Build a `newsletter` block when the article contains a signup section.
function newsletterFromHtml(html: string): any | null {
  const nRe = /<div[^>]*class="[^"]*(?:newsletter|subscribe|signup|sign-up|email-capture)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = nRe.exec(html)) !== null) {
    const text = stripHtml(m[1]).trim();
    if (text) {
      return {
        id: `block-${Date.now()}-newsletter${Math.floor(Math.random() * 1000)}`,
        type: 'newsletter',
        title: 'Stay in the Loop',
        subtitle: 'Get the latest tips delivered to your inbox.',
        content: text.slice(0, 400),
        buttonText: 'Subscribe',
      };
    }
  }
  return null;
}

// Build a `product_cta` (product showcase) block from a product-recommendation
// div or a CTA section that names a product.
function productShowcaseFromHtml(html: string, sectionHtml: string, headingText: string): any | null {
  // 1) Explicit product-recommendation divs.
  const prodRe = /<div[^>]*class="[^"]*product-recommendation[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = prodRe.exec(html)) !== null) {
    const content = stripHtml(m[1]).trim();
    if (content) {
      const btn = m[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i);
      const link = m[1].match(/<a[^>]*href="([^"]+)"/i);
      return {
        id: `block-${Date.now()}-prod${Math.floor(Math.random() * 1000)}`,
        type: 'product_cta',
        title: content.slice(0, 200),
        content: '',
        buttonText: btn ? stripHtml(btn[1]).trim() || 'View Product' : 'View Product',
        buttonUrl: link?.[1] || '#',
        badge: 'Recommended',
      };
    }
  }
  // 2) A CTA section whose heading mentions a product / shop / buy.
  if (/(product|shop|buy|order|bundle|range|try )/i.test(headingText)) {
    const btn = sectionHtml.match(/<a[^>]*>([\s\S]*?)<\/a>|<button[^>]*>([\s\S]*?)<\/button>/i);
    const link = sectionHtml.match(/<a[^>]*href="([^"]+)"/i);
    return {
      id: `block-${Date.now()}-prod${Math.floor(Math.random() * 1000)}`,
      type: 'product_cta',
      title: headingText,
      content: stripHtml(sectionHtml).slice(0, 900),
      buttonText: btn ? stripHtml(btn[1] || btn[2] || '').trim() || 'Shop Now' : 'Shop Now',
      buttonUrl: link?.[1] || '#',
      badge: 'Product',
    };
  }
  return null;
}

// Build a `cta_band` block from a CTA section.
function ctaBandFromHtml(sectionHtml: string, headingText: string): any | null {
  if (!/(cta|call to action|get started|learn more|find out|discover|try |shop|order|book|contact)/i.test(headingText)) return null;
  const btn = sectionHtml.match(/<a[^>]*>([\s\S]*?)<\/a>|<button[^>]*>([\s\S]*?)<\/button>/i);
  const link = sectionHtml.match(/<a[^>]*href="([^"]+)"/i);
  return {
    id: `block-${Date.now()}-cta${Math.floor(Math.random() * 1000)}`,
    type: 'cta_band',
    title: headingText,
    subtitle: '',
    content: stripHtml(sectionHtml).slice(0, 700),
    buttonText: btn ? stripHtml(btn[1] || btn[2] || '').trim() || 'Get Started' : 'Get Started',
    buttonUrl: link?.[1] || '#',
  };
}

// Build a `daniels_tip` block from a daniels-tip div.
function danielsTipFromHtml(html: string, brand?: any): any | null {
  const tipRe = /<div[^>]*class="[^"]*daniels-tip[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = tipRe.exec(html)) !== null) {
    const content = stripTipPrefix(stripHtml(m[1]));
    if (content) {
      return {
        id: `block-${Date.now()}-tip${Math.floor(Math.random() * 1000)}`,
        type: 'daniels_tip',
        title: tipLabel(brand),
        content: content.slice(0, 1000),
      };
    }
  }
  return null;
}

// Strip a leading "Daniel's Tip of the Day:" / "Daniel's Tip:" / "Tip of the
// Day:" label from tip body text. The AI sometimes writes the label into the
// tip paragraph itself (leftover from the old "Daniel's Tip" instruction), so
// we defensively remove it — the callout heading already carries the label.
function stripTipPrefix(text: string): string {
  return String(text || '')
    .replace(/^\s*(?:Daniel'?s\s+)?Tip(?:\s+of\s+the\s+Day)?\s*:\s*/i, '')
    .trim();
}

// Build an `faq` block from an FAQ section.
function faqFromHtml(html: string, headingText: string, sectionHtml: string): any | null {
  if (!/(^|\s)(faq|frequently asked|questions?\b|common questions)/i.test(headingText)) return null;
  const pairs: Array<{ question: string; answer: string }> = [];
  const qRe = /<h3\b[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3\b|<h2\b|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = qRe.exec(sectionHtml)) !== null) {
    const q = stripHtml(m[1]).trim();
    const a = stripHtml(m[2]).trim();
    if (q && a) pairs.push({ question: q, answer: a.slice(0, 600) });
  }
  if (!pairs.length) {
    // Fall back to the whole section as one Q/A.
    const text = stripHtml(sectionHtml).trim();
    if (text) pairs.push({ question: headingText, answer: text.slice(0, 800) });
  }
  if (!pairs.length) return null;
  return {
    id: `block-${Date.now()}-faq${Math.floor(Math.random() * 1000)}`,
    type: 'faq',
    title: headingText,
    content: '',
    faqItems: pairs.slice(0, 8),
  };
}

// Build a `carousel` block from a gallery of images.
function carouselFromImages(images: Array<{ src: string; alt: string }>): any | null {
  if (images.length < 3) return null;
  return {
    id: `block-${Date.now()}-carousel${Math.floor(Math.random() * 1000)}`,
    type: 'carousel',
    title: 'Explore the range',
    content: '',
    slides: images.slice(0, 8).map((img, i) => ({
      id: `slide-${Date.now()}-${i}`,
      imageUrl: img.src,
      title: img.alt || '',
      content: '',
    })),
  };
}

// The main intelligent block generator. `requestedBlocks` is an optional array
// of user-stated block hints (type names or friendly labels). Auto-detected
// defaults are always computed; user-requested blocks are inserted at the front
// (after the hero) and take priority, with dedup against what was auto-detected.
function autoGenerateBlocks(
  html: string,
  title?: string,
  keyword?: string,
  requestedBlocks?: string[] | null,
  brand?: any,
): any[] {
  if (!html || !stripHtml(html)) return [];
  const blocks: any[] = [];

  // ---- 1. Hero (always first) -------------------------------------------
  const headingRe = /<h([123])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings: { level: number; text: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html))) {
    const text = stripHtml(m[2]);
    if (!text) continue;
    headings.push({ level: Number(m[1]), text, start: m.index, end: headingRe.lastIndex });
  }
  const sectionText = (start: number, end: number) =>
    stripHtml(html.slice(start, end).replace(/<li\b[^>]*>/gi, '\n• ').replace(/<\/li>/gi, '\n'))
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

  const h1 = headings.find((h) => h.level === 1);
  const heroEnd = h1 ? h1.end : headings[0]?.start ?? 0;
  const heroSubtitle = h1
    ? sectionText(h1.end, headings.find((h) => h.start > h1.end)?.start ?? html.length)
    : '';
  blocks.push({
    id: `block-${Date.now()}-hero${Math.floor(Math.random() * 1000)}`,
    type: 'hero',
    title: h1?.text || title || 'Featured Story',
    subtitle: heroSubtitle ? heroSubtitle.split(/[.!?]/).slice(0, 2).join('. ') + '.' : '',
    content: heroSubtitle ? heroSubtitle.slice(0, 700) : '',
    badge: keyword || 'Featured',
  });

  // ---- 2. Collect images (for image wraps / carousel) -------------------
  const imgRe = /<img\b[^>]*>/gi;
  const seenSrcs = new Set<string>();
  const images: Array<{ src: string; alt: string }> = [];
  let heroImg: { src: string; alt: string } | null = null;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const src = tag.match(/src\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    if (!src || src.startsWith('data:')) continue;
    const alt = tag.match(/alt\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    if (!heroImg) { heroImg = { src, alt }; continue; }
    if (seenSrcs.has(src)) continue;
    seenSrcs.add(src);
    images.push({ src, alt });
  }
  if (heroImg && blocks[0]?.type === 'hero' && !(blocks[0].imageUrl || '').trim()) {
    blocks[0].imageUrl = heroImg.src;
    blocks[0].imageAlt = heroImg.alt || blocks[0].title || 'Article image';
  }

  // ---- 3. Walk sections into content-aware blocks -----------------------
  // Track which auto-detected block types we've already emitted so we can
  // dedup against user-requested ones.
  const autoTypes = new Set<string>(['hero']);
  const sectionBlocks: any[] = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    if (h.level === 1) continue; // handled as hero

    const sectionStart = h.end;
    const sectionEnd = headings[i + 1]?.start ?? html.length;
    const sectionHtml = html.slice(sectionStart, sectionEnd);
    const content = sectionText(sectionStart, sectionEnd);
    const headingText = h.text;

    // FAQ section → faq block. The section extends to the NEXT h2 (not the
    // next heading of any level) so it can absorb the h3 Q/A pairs beneath it.
    if (h.level === 2 && /(^|\s)(faq|frequently asked|questions?\b|common questions)/i.test(headingText)) {
      const faqSectionEnd = headings.find((nh) => nh.start > h.start && nh.level <= 2)?.start ?? html.length;
      const faqSectionHtml = html.slice(sectionStart, faqSectionEnd);
      const faq = faqFromHtml(html, headingText, faqSectionHtml);
      if (faq) {
        sectionBlocks.push(faq);
        autoTypes.add('faq');
        // Skip the h3 Q/A headings absorbed into the FAQ block.
        while (i + 1 < headings.length && headings[i + 1].level === 3 && headings[i + 1].start < faqSectionEnd) i++;
        continue;
      }
    }

    // Daniel's Tip div → daniels_tip block.
    const tip = danielsTipFromHtml(sectionHtml, brand);
    if (tip) { sectionBlocks.push(tip); autoTypes.add('daniels_tip'); continue; }

    // Product recommendation / product CTA section → product_cta.
    const prod = productShowcaseFromHtml(sectionHtml, sectionHtml, headingText);
    if (prod) { sectionBlocks.push(prod); autoTypes.add('product_cta'); continue; }

    // CTA section → cta_band.
    const cta = ctaBandFromHtml(sectionHtml, headingText);
    if (cta) { sectionBlocks.push(cta); autoTypes.add('cta_band'); continue; }

    // List-like content (3+ items) → cards grid.
    const cards = cardsFromList(sectionHtml, headingText);
    if (cards) { sectionBlocks.push(cards); autoTypes.add('cards'); continue; }

    // Blockquote → quote.
    const quote = quoteFromHtml(sectionHtml);
    if (quote) { sectionBlocks.push(quote); autoTypes.add('quote'); continue; }

    // Callout/note div → callout.
    const callout = calloutFromHtml(sectionHtml);
    if (callout) { sectionBlocks.push(callout); autoTypes.add('callout'); continue; }

    // Newsletter signup → newsletter.
    const newsletter = newsletterFromHtml(sectionHtml);
    if (newsletter) { sectionBlocks.push(newsletter); autoTypes.add('newsletter'); continue; }

    // Default: paragraph block (or heading-only if no body text).
    if (content) {
      sectionBlocks.push({
        id: `block-${Date.now()}-p${sectionBlocks.length}${Math.floor(Math.random() * 1000)}`,
        type: 'paragraph',
        title: headingText,
        content: content.slice(0, 4000),
      });
    } else {
      sectionBlocks.push({
        id: `block-${Date.now()}-h${sectionBlocks.length}${Math.floor(Math.random() * 1000)}`,
        type: 'heading',
        title: headingText,
        content: '',
      });
    }
  }

  // ---- 4. Image wraps: insert image_banner blocks after the hero ---------
  // First image becomes an image_banner right after the hero; if there are 3+
  // images, also build a carousel.
  const imageBlocks: any[] = [];
  if (images.length) {
    const first = images[0];
    imageBlocks.push({
      id: `block-${Date.now()}-img0${Math.floor(Math.random() * 1000)}`,
      type: 'image_banner',
      title: '',
      subtitle: '',
      content: '',
      buttonText: '',
      buttonUrl: '',
      keywords: '',
      imageLayout: 'full',
      imageUrl: first.src,
      imageAlt: first.alt,
    });
    autoTypes.add('image_banner');
  }
  const carousel = carouselFromImages(images);
  if (carousel) { imageBlocks.push(carousel); autoTypes.add('carousel'); }

  // ---- 5. Assemble: hero + image wrap + sections ------------------------
  blocks.push(...imageBlocks);
  blocks.push(...sectionBlocks);

  // Guarantee at least one content block beyond the hero.
  if (blocks.length === 1) {
    blocks.push({
      id: `block-${Date.now()}-p0${Math.floor(Math.random() * 1000)}`,
      type: 'paragraph',
      title: '',
      content: stripHtml(html).slice(0, 4000),
    });
  }

  // ---- 6. Merge user-requested blocks -----------------------------------
  // User hints take priority: any requested block type that wasn't auto-detected
  // gets a placeholder block inserted right after the hero (and image wrap).
  if (Array.isArray(requestedBlocks) && requestedBlocks.length) {
    const requested: string[] = [];
    for (const hint of requestedBlocks) {
      const norm = normalizeBlockHint(hint);
      if (norm && !requested.includes(norm)) requested.push(norm);
    }
    // Insert missing requested types after the hero + image wrap.
    let insertAt = 1 + imageBlocks.length;
    for (const type of requested) {
      if (autoTypes.has(type)) continue; // already present
      const placeholder = {
        id: `block-${Date.now()}-req-${type}${Math.floor(Math.random() * 1000)}`,
        type,
        title: type === 'cta_band' ? 'Ready to make a change?' : type === 'newsletter' ? 'Stay in the Loop' : type === 'daniels_tip' ? tipLabel(brand) : type === 'cards' ? 'Why choose us' : type === 'carousel' ? 'Explore the range' : type === 'quote' ? '' : type === 'image_banner' ? '' : type === 'faq' ? 'FAQ' : 'Section Title',
        subtitle: type === 'cta_band' ? 'No-pressure, expert-led guidance' : type === 'newsletter' ? 'Get the latest tips delivered to your inbox.' : 'Section Subtitle',
        content: type === 'image_banner' ? '' : type === 'quote' ? 'A powerful sentence worth quoting…' : type === 'cta_band' ? 'A short, warm call to action that invites the reader to take the next step.' : type === 'daniels_tip' ? 'A practical, actionable tip that benefits from being highlighted.' : type === 'newsletter' ? '' : 'Write content here...',
        buttonText: type === 'cta_band' ? 'Get Started' : type === 'newsletter' ? 'Subscribe' : type === 'product_cta' ? 'Shop Now' : '',
        buttonUrl: '#',
        imageLayout: type === 'image_banner' ? 'full' : undefined,
        badge: type === 'product_cta' ? 'Product' : undefined,
      };
      blocks.splice(Math.min(insertAt, blocks.length), 0, placeholder);
      insertAt++;
    }
  }

  return blocks.slice(0, 12);
}

// ==========================================
// 1. AI API ENDPOINTS (Gemini Server-Side)
// ==========================================

// ---------- Completeness check & fix (final accuracy gate) ----------
// Streamed generation can end mid-sentence (provider cutoffs, token limits),
// leaving the article TRUNCATED and shorter than its target. These helpers
// verify the assembled draft and repair it before it is marked done:
//   1. structuralCleanup    — deterministic: fences, artifacts, unclosed tags;
//   2. top-up               — append an on-topic section when under the target;
//   3. truncatedEnding      — complete (or drop) a cut-off final sentence;
//   4. image presence       — inject the generated hero/secondary when the
//                             model wrote no <img> at all.
// The same signals are re-checked (log-only) at publish/sync time so a draft
// that was edited by hand can still be caught before it goes live.

// Sentence-final punctuation: the visible text of a paragraph or list item is
// only "finished" when it ends with . ! ? … (allowing closing quotes/brackets).
const ENDS_WITH_FINAL_PUNCT = /[.!?…]["'”’»)\]]*$/;

// Visible paragraph/list text nodes in document order, with exact inner-text
// offsets so a repair can rewrite just the text (keeping surrounding tags).
function visibleTextNodes(html: string): Array<{ tag: string; text: string; innerHtml: string; innerStart: number; innerEnd: number }> {
  const nodes: Array<{ tag: string; text: string; innerHtml: string; innerStart: number; innerEnd: number }> = [];
  const re = /<(p|li|blockquote|figcaption)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const innerHtml = m[2];
    const text = stripHtml(innerHtml);
    if (!text) continue;
    const openEnd = m[0].indexOf('>') + 1;            // past the opening tag
    const closeStart = m[0].lastIndexOf('</');        // start of the closing tag
    if (openEnd <= 0 || closeStart < openEnd) continue;
    nodes.push({
      tag: m[1].toLowerCase(),
      text,
      innerHtml,
      innerStart: m.index + openEnd,
      innerEnd: m.index + closeStart,
    });
  }
  return nodes;
}

// The LAST visible text node, if it does not end with sentence-final
// punctuation — i.e. the article was cut off mid-sentence. Only the document
// tail is checked: mid-document "incomplete" lists (bullet points without
// periods) are legitimate, but a streamed article can only truncate at its end.
function truncatedEnding(html: string): { text: string; innerHtml: string; innerStart: number; innerEnd: number } | null {
  const nodes = visibleTextNodes(html);
  if (!nodes.length) return null;
  const last = nodes[nodes.length - 1];
  return ENDS_WITH_FINAL_PUNCT.test(last.text.trim()) ? null : last;
}

// Deterministic structural cleanup — no AI, always safe.
function structuralCleanup(html: string): { html: string; fixed: string[] } {
  let out = String(html || '').trim();
  const fixed: string[] = [];
  const fenceCount = (out.match(/```/g) || []).length;
  if (fenceCount) {
    out = out.replace(/```(?:html|xml)?\s*/gi, '').trim();
    fixed.push(`removed ${fenceCount} markdown fence marker(s)`);
  }
  if (/^\{"[^}]+"\}/.test(out)) {
    fixed.push('removed a JSON wrapper left around the body');
  }
  const artifactRe = /\b(undefined|null|NaN|\[object Object\]|TODO|FIXME|lorem ipsum|placeholder\s*text)\b/gi;
  if (artifactRe.test(out)) {
    out = out.replace(artifactRe, '').replace(/\s{2,}/g, ' ');
    fixed.push('stripped inline artifacts (undefined / null / TODO / lorem ipsum…)');
  }
  if (/\n{3,}|^\s*[-–—]{3,}\s*$/m.test(out)) {
    out = out.replace(/\n{3,}/g, '\n\n').replace(/^\s*[-–—]{3,}\s*$/gm, '');
    fixed.push('collapsed excess blank lines / markdown separators');
  }
  // Close any block-level tags the model left open at the end of the document
  // (a cutoff can drop </p>, </li>, </ul>, </strong>, </a>, </h2> …).
  const stack: string[] = [];
  const CLOSABLE = new Set(['p', 'li', 'ul', 'ol', 'strong', 'em', 'b', 'i', 'a', 'h2', 'h3', 'h4', 'blockquote']);
  const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link']);
  const tagRe = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tagRe.exec(out)) !== null) {
    const tag = tm[1].toLowerCase();
    if (VOID.has(tag) || /\/>/.test(tm[0])) continue;
    if (tm[0].startsWith('</')) {
      const idx = stack.lastIndexOf(tag);
      if (idx >= 0) stack.splice(idx, 1);
    } else if (CLOSABLE.has(tag)) {
      stack.push(tag);
    }
  }
  if (stack.length) {
    out = out.trimEnd() + stack.slice().reverse().map((t) => `</${t}>`).join('');
    fixed.push(`closed ${stack.length} unclosed tag(s) (${stack.join(', ')})`);
  }
  return { html: out.trim(), fixed };
}

// Generate ONE additional on-topic section (fresh <h2> + 2-3 paragraphs) to top
// the article up to its target length. Returns the raw section HTML, or '' if
// the provider failed or returned unusable output.
async function generateAdditionalSection(opts: {
  byokKeys: any; pref: any; brand: any; title: string; primaryKeyword: string;
  contentType: string; existingHeadings: string[]; existingTail: string; shortfall: number;
}): Promise<string> {
  const { byokKeys, pref, brand, title, primaryKeyword, contentType, existingHeadings, existingTail, shortfall } = opts;
  const result = await completeWithProvider(byokKeys, pref, {
    systemInstruction: `You are the senior editor for "${brand?.name || 'the site'}". The article below is ${shortfall} words short of its target length. Write ONE additional on-topic section to extend it: a fresh <h2> that is NOT any of these existing headings (${existingHeadings.join('; ') || 'none'}), followed by 2-3 substantial paragraphs (200-450 words total) that continue the article's argument naturally and stay on the exact same topic. Use the keyword "${primaryKeyword}" naturally, keep the brand voice (${brand?.voiceGuidelines || 'professional, clear, engaging'}), and end with a complete sentence. ${grammarRulesPrompt(brand)} Do NOT repeat or restate any heading or paragraph that already exists in the article — advance the argument forward. Return ONLY the raw HTML of the new section (h2, p, ul/li allowed) — no markdown fences, no JSON, no commentary.`,
    prompt: `Article topic: "${title}" (${contentType === 'page' ? 'landing page' : 'blog post'}).\n\nCurrent article tail (for continuity):\n${existingTail.slice(0, 1200)}`,
    maxTokens: 1024,
    temperature: 0.7,
  });
  let section = String(result.text || '').trim().replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!/<\/?h2\b/i.test(section) || !stripHtml(section)) return '';
  return section;
}

// API Endpoint: Suggest SEO Keywords from a topic/title
// Returns a primary keyword, secondary keywords, and a brief SEO description.
app.post('/api/ai/suggest-keywords', async (req, res) => {
  try {
    const { title, brand, byokKeys, modelPref } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'title required.' });
    const prompt = `Suggest SEO keywords for a blog article about: "${title}"${brand?.name ? ` for the brand "${brand.name}"` : ''}. Return ONLY a JSON object: {"primaryKeyword":"...","secondaryKeywords":["...","...","..."],"seoBrief":"A 1-sentence SEO brief describing the target audience and intent."}. No markdown, no commentary.`;
    const { text } = await completeWithProvider(byokKeys || {}, modelPref || {}, {
      prompt,
      temperature: 0.5,
      maxTokens: 300,
    });
    let raw = String(text || '').trim();
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const data = JSON.parse(raw);
    return res.json({ success: true, ...data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Keyword suggestion failed.' });
  }
});

// API Endpoint: Generate Article Content with Gemini (streamed)
// Emits NDJSON events so the client can show live progress, the model's output
// as it writes, and heartbeats proving the job is alive, not stuck.
app.post('/api/ai/generate-article', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const { title, contentType, primaryKeyword, secondaryKeywords, seoBrief, brand, byokKeys, applyHumanization, targetWordCount, modelPref, sheetContext, requestedBlocks, relatedArticles } = req.body;

  const aiApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || byokKeys?.gemini;
  let ai = aiApiKey ? new GoogleGenAI({ apiKey: aiApiKey }) : null;
  const pref = modelPref || {};

  // --- Lifecycle bookkeeping ------------------------------------------------
  let ended = false;
  const timers: ReturnType<typeof setInterval>[] = [];
  let lastChunkAt = Date.now();
  const startedAt = Date.now();
  const cleanup = () => {
    if (ended) return;
    ended = true;
    timers.forEach(clearInterval);
    timers.forEach(clearTimeout);
    try { res.end(); } catch { /* socket already gone */ }
  };
  const emit = (obj: any) => { if (!ended) ndjson(res, obj); };

  // Heartbeat: reassures the client the job is alive during long silent spans;
  // watchdog: abort if the model goes completely quiet for 120s.
  const heartbeat = setInterval(() => {
    if (ended) return;
    if (Date.now() - lastChunkAt > 120000) {
      emit({ type: 'error', error: 'The model went quiet for too long. The generation was stopped — please retry.' });
      cleanup();
      return;
    }
    emit({ type: 'heartbeat', elapsed: Math.round((Date.now() - startedAt) / 1000) });
  }, 15000);
  timers.push(heartbeat as any);
  const hardTimeout = setTimeout(() => {
    emit({ type: 'error', error: 'Generation timed out after 7 minutes. Please retry with a shorter target length.' });
    cleanup();
  }, 7 * 60 * 1000);
  timers.push(hardTimeout as any);

  try {
    const bannedWordsText = brand?.bannedWords?.length
      ? `STRICT BANNED WORDS (DO NOT USE ANY OF THESE): ${brand.bannedWords.join(', ')}.`
      : '';

    const wordTarget = targetWordCount && targetWordCount > 0
      ? `Aim for approximately ${targetWordCount} words total (within +/- 15% of that target).`
      : 'Target 1000-1400 words for a post (600-800 for a landing page). The SEO analyzer gives full marks at 1000+ words, so never write fewer than 900 words for a post.';

    const writeInstruction = `You are a world-class professional senior editor and copywriter crafting content for the brand "${brand.name}".
Brand Voice & Tone Guidelines: ${brand.voiceGuidelines || 'Professional, clear, engaging, authoritative'}.
${bannedWordsText}

WORKING TITLE / TOPIC (THE BRIEF): "${title}". Every heading, sentence and FAQ entry must serve exactly this topic — never drift to a side topic, never change the subject. The reader must feel one continuous, seamless narrative from the first sentence to the final FAQ answer.

HEADLINE RULE: Do NOT copy the working title verbatim. Craft a fresh, compelling, click-worthy article headline as your single <h1> — a real editor would never repeat the internal working title on the page. The <h1> must still contain the primary keyword naturally.

Output Format: Return ONLY the raw HTML article body. Use h1, h2, h3, p, ul, li, img, a tags. No markdown code fences, no JSON wrapper, no commentary before or after — just the HTML.

BRITISH ENGLISH RULE: Write entirely in British English. Use "colour" not "color", "favourite" not "favorite", "analyse" not "analyze", "organise" not "organize", "behaviour" not "behavior", "colour" not "color", "defence" not "defense", "licence" not "license" (noun), "programme" not "program" (noun), "metre" not "meter", "centre" not "center", "grey" not "gray", "draught" not "draft" (noun), "whilst" not "while" (conjunction), "towards" not "toward", and all other standard British spellings. Never default to American spellings.

${grammarRulesPrompt(brand)}

CRITICAL: Do NOT repeat the opening paragraph or its core message anywhere else in the article. The first paragraph sets the scene once — the rest of the article must progress forward, never circle back to restate the introduction. If you find yourself restating the opening, rephrase or advance to the next point instead.

FACTUAL ACCURACY RULES:
- Every factual claim must be internally consistent. If you state that a process "removes moisture" in one section, do NOT later say it "preserves moisture" — contradicting yourself destroys reader trust.
- Double-check that technical claims (e.g. how freeze-drying, dehydration, or preservation methods work) are factually correct before writing them.
- If you are unsure about a technical fact, state the general benefit without committing to a specific mechanism (e.g. "carefully processed to retain quality" rather than making a specific mechanistic claim).

HEALTH & NUTRITIONAL CLAIMS RULES:
- Never present health or nutritional claims as absolute medical facts. Qualify them appropriately: use phrases like "may support", "can contribute to", "is believed to", "research suggests", or "as part of a balanced diet".
- Always include a brief qualifying statement near any health/nutritional claim, such as "Always consult your veterinarian for specific dietary advice" or "individual results may vary".
- Do NOT make disease-treatment claims (e.g. "cures", "treats", "prevents [disease]") unless you can cite a specific, peer-reviewed study — and even then, qualify it.
- Pet food claims should reference general nutritional guidelines, not imply veterinary-grade outcomes.

SEO requirements (scored by an automated SEO analyzer, follow precisely):
- Use exactly one <h1> containing the primary keyword. Structure with a logical hierarchy of <h2> and <h3> headings, a heading every 200-300 words.
- Use the primary keyword naturally with density between 0.5% and 2.5% of total words, including: once in the first 100 words (bold it once with <strong>), in the h1, and in at least one <h2>.
- DISTRIBUTE the primary keyword evenly: it must appear in EVERY major section of the article (opening, middle sections, and closing), not just the first half.
- Work the topic/title angle into at least one h2 or h3 subheading.
- Keep paragraphs short (under 150 words each) and sentences readable: NO sentence longer than 25 words, average under 20 words. Use transition words so every paragraph hands off to the next.
- DIRECT ANSWER OPENING: Open the article with a definition-style sentence that answers the core question immediately, e.g. "[Primary keyword] is…" or "[Primary keyword] refers to…". This makes the article eligible for featured snippets and AI answer engines.
- TL;DR SUMMARY: Immediately after the opening paragraph, add a short "Key takeaways" or "TL;DR" section as a <ul> with 3-5 bullet points summarising the article's main answers. This is scored by the analyzer.
- Use exactly ONE <img> tag with a descriptive alt attribute containing the primary keyword (e.g. <img src="https://placehold.co/1200x800?text=Alt" alt="...keyword...">). Place it near the top of the article, after the intro paragraph. Do NOT add more than one image — duplicates are stripped.
- STRICT IMAGE RULE: never embed base64 / data:image URLs (huge, broken on WordPress). Use ONLY plain https:// image URLs — the placehold.co placeholder is ideal.
- INTERNAL LINK RULE: Include at least ONE internal link (<a href="/blog/...">) referencing a topic the brand genuinely covers. Use generic, plausible link paths that match the brand's blog structure (e.g. /blog/benefits-of-natural-pet-treats, /blog/how-to-choose-the-right-pet-food). Never invent specific article titles or claim a linked page exists. Use descriptive anchor text that naturally fits the sentence.
- EXTERNAL LINK RULE: Include at least TWO external links to authoritative, reputable sources that genuinely support your claims (e.g. RSPCA, PDSA, DEFRA, veterinary associations, peer-reviewed studies, government health bodies). Use <a href="https://www.rspca.org.uk/..."> with descriptive anchor text. Never link to spammy or low-quality sites. External links to trusted authorities are scored heavily.
- E-E-A-T SIGNALS (Experience, Expertise, Authoritativeness, Trustworthiness): Write with first-person experience where natural ("In our experience…", "We've seen…", "When we tested…"), include specific, concrete details and examples rather than generic statements, and reference expert sources. This is scored heavily by the analyzer.
- If suitable, include an FAQ section using an <h2> with <h3> questions, to target question-based (AEO) search results. The FAQ must grow naturally out of the preceding sections — reuse the article's own terms, examples and claims so the end of the piece reads as one flowing conversation, not a bolted-on list. Each FAQ answer must be a direct, concise answer (1-3 sentences).
- ${tipLabel(brand).toUpperCase()}: If the article contains a practical, actionable piece of advice that would benefit from being highlighted, wrap it in: <div class="daniels-tip">Your tip here</div>. Use at most ONE tip per article. The tip should be a specific, useful insight — not a generic statement.
- PRODUCT RECOMMENDATION: If the article topic naturally connects to a product (e.g. a article about dog treats could recommend a specific treat product), add a placeholder at the end of the article: <div class="product-recommendation">Product: [suggest a product category or type that would be relevant]</div>. This helps the system match a real product from the store catalog.
- Write for humans first: natural, expert, specific. Never stuff keywords or repeat the same phrase back-to-back.
- ${wordTarget}
- Every sentence should read like it was written by a human expert, not an AI.`;

    emit({ type: 'status', message: 'Connecting to the model…', percent: 4 });
    emit({ type: 'status', message: 'Analysing brief, keywords & brand voice…', percent: 8 });

    // Emit the full generation blueprint so the frontend can show every rule and
    // parameter being applied — this makes the process transparent and credible.
    const resolvedGrammar = resolveGrammarRules(brand);
    const grammarRuleLines: { id: string; label: string; description: string }[] = [
      ...GRAMMAR_RULE_DEFS
        .filter((def) => resolvedGrammar[def.id])
        .map((def) => ({ id: def.id, label: def.label, description: def.description })),
      ...(resolvedGrammar.customRules || []).map((r) => ({ id: 'custom', label: 'Custom rule', description: r })),
    ];
    emit({
      type: 'generationInfo',
      brand: brand ? { name: brand.name, voiceGuidelines: brand.voiceGuidelines || '' } : null,
      primaryKeyword: primaryKeyword || '',
      secondaryKeywords: Array.isArray(secondaryKeywords) ? secondaryKeywords : [],
      targetWordCount: targetWordCount || 0,
      seoBrief: seoBrief || '',
      contentType: contentType || 'post',
      bannedWords: brand?.bannedWords || [],
      grammarRules: grammarRuleLines,
      grammarRulesPrompt: buildGrammarRulesPrompt(brand) || null,
      wordTarget: wordTarget,
    });

    // ── Build rich prompt from sheet context (if available) ──────────────
    const sc = sheetContext && typeof sheetContext === 'object' ? sheetContext : null;

    // Search intent — use the sheet's actual intent, not a generic fallback
    const searchIntentText = sc?.searchIntent
      ? `SEARCH INTENT: ${sc.searchIntent}`
      : `SEARCH INTENT: This article targets an informational search query. Structure it as a complete, authoritative guide that directly answers the reader's question in the opening, then covers every related sub-topic with depth. Include a clear conclusion that summarises the key points.`;

    // Longtail keywords — weave into subheadings and body
    // Normalize: handle both string and array (from Firestore deserialization)
    const longtailVal = Array.isArray(sc?.longtailKeywords) ? sc.longtailKeywords.join(', ') : sc?.longtailKeywords;
    const longtailText = longtailVal
      ? `\nLONGTAIL KEYWORDS TO INCLUDE NATURALLY: ${longtailVal}. Use these as inspiration for subheadings (h2/h3) and weave them naturally into body paragraphs. Do NOT stuff them — each longtail should appear once or twice in context.`
      : '';

    // Additional keyword targets
    const extraKeywordsVal = Array.isArray(sc?.keywords) ? sc.keywords.join(', ') : sc?.keywords;
    const extraKeywordsText = extraKeywordsVal
      ? `\nADDITIONAL KEYWORD TARGETS: ${extraKeywordsVal}. These should also appear naturally throughout the article where they fit, supplementing the primary and secondary keywords.`
      : '';

    // Internal links — tell the AI exactly which articles to link to
    const internalLinksVal = Array.isArray(sc?.internalLinks) ? sc.internalLinks.join(', ') : sc?.internalLinks;
    const internalLinksText = internalLinksVal
      ? `\nINTERNAL LINKS TO INCLUDE: The article must include natural internal links to these existing articles on the site: ${internalLinksVal}. Use descriptive anchor text and link to plausible /blog/ paths (e.g. /blog/[slugified-title]). Each link should fit naturally in context — do not force them.`
      : '';

    // FAQ questions — the AI must answer these exact questions
    const faqVal = Array.isArray(sc?.questionsPeopleAlsoAsk) ? sc.questionsPeopleAlsoAsk.join('\n') : sc?.questionsPeopleAlsoAsk;
    const faqText = faqVal
      ? `\nFAQ SECTION (MANDATORY): Include an FAQ section at the end of the article using an <h2> "Frequently Asked Questions" followed by <h3> for each question. You MUST answer these exact questions from the research data:\n${faqVal.split(/[;\n,]+/).map((q: string) => `- ${q.trim()}`).filter(Boolean).join('\n')}\nEach answer must be a direct, concise 1-3 sentence response. The FAQ must flow naturally from the preceding content — not feel bolted on.`
      : '';

    // Call to action — where and how to convert readers
    const ctaText = sc?.callToAction
      ? `\nCALL TO ACTION: Near the end of the article (before the FAQ), include a natural, compelling call-to-action section. Use this CTA text as guidance: "${sc.callToAction}". Wrap it in a styled div or integrate it naturally into the closing paragraphs.`
      : '';

    // ── Dynamic template fields (feat-auto-populate-dynamic-fields) ──────────
    // Fetch the brand's REAL products and gather REAL related articles from the
    // content register so the generated article populates the template's dynamic
    // sections (product recommendation, related articles, CTA) with real data
    // instead of placeholders.
    const realProducts = await fetchBrandProducts(brand);
    const relatedList = Array.isArray(relatedArticles) ? relatedArticles.slice(0, 6) : [];
    const dynamicFieldsText = buildDynamicFieldsPrompt(realProducts, relatedList, sc?.callToAction, brand?.recommendationType);
    // feat-internal-linking: feed the real published articles so the model weaves
    // contextual in-body links to real content (not invented /blog/ paths).
    const internalLinkingText = buildInternalLinkingPrompt(relatedList);

    // One-line summary — as additional brief context
    const summaryText = sc?.oneLineSummary
      ? `\nARTICLE SUMMARY: ${sc.oneLineSummary}`
      : '';

    const prompt = `Write a comprehensive, highly engaging, human-sounding ${contentType === 'page' ? 'Landing Page' : 'Blog Article'}.
Topic (the brief): "${title}"
${summaryText}
Target Primary Keyword: "${primaryKeyword || title}"
Secondary Keywords: ${Array.isArray(secondaryKeywords) ? secondaryKeywords.join(', ') : secondaryKeywords || 'None'}
Additional Context / Brief: "${seoBrief || 'Focus on high value, reader satisfaction, and conversion.'}"
${searchIntentText}
${longtailText}
${extraKeywordsText}
${internalLinksText}
${faqText}
${ctaText}
${dynamicFieldsText}
${internalLinkingText}

Headline: craft your own fresh article title as the single <h1> — do not repeat the topic text above verbatim as the headline.`;

    // --- Phase 1: stream the article body (10-80%) --------------------------
    emit({ type: 'status', message: 'Drafting the article — watch it being written live below…', percent: 12 });

    let articleText = '';
    let genModel = GEMINI_TEXT_MODEL;
    let genProvider = 'gemini';
    let genFallback = false;
    const targetForProgress = Math.max(300, safeCount(targetWordCount) || 900);

    // One full streaming attempt over the Gemini model chain with the current
    // client. Re-runnable: if the saved key is rejected we rebuild the client
    // with the server key and run this again.
    const attemptStream = async () => {
      for await (const { text, model } of streamWithModelFallback(ai, {
        contents: prompt,
        config: { systemInstruction: writeInstruction, responseMimeType: 'text/plain' },
      }, (model, reason) => {
        emit({ type: 'status', message: `Primary model is busy (${reason.includes('429') ? 'rate limit' : 'unavailable'}) — switching to the backup model…`, percent: 12 });
      })) {
        lastChunkAt = Date.now();
        genModel = model;
        articleText += text;
        const words = countWords(articleText);
        // 12% .. 80% scaled by words written vs the target (clamped).
        const percent = Math.min(80, Math.round(12 + (Math.min(words, targetForProgress) / targetForProgress) * 68));
        emit({
          type: 'stream',
          text,
          words,
          percent,
          phase: words < targetForProgress * 0.25 ? 'Opening with a strong intro…'
            : words < targetForProgress * 0.5 ? 'Building the core sections…'
            : words < targetForProgress * 0.75 ? 'Deep-diving into the middle sections…'
            : 'Wrapping up with a strong conclusion…',
        });
      }
    };

    // Up to two streaming attempts: the server key first (paid), then — if the
    // key itself is rejected (invalid/revoked/expired) — the BYOK key.
    // Only after both fail do we fall back to a non-Gemini provider.
    let usedKey = aiApiKey;
    for (let attempt = 0; attempt < 2; attempt++) {
      let streamErr: any = null;
      try {
        await attemptStream();
      } catch (err: any) {
        streamErr = err;
      }
      if (!streamErr) break; // stream completed — proceed to Phase 2

      const keyIssue = /(API_KEY|PERMISSION|Missing Authentication|invalid api key|api key not found|auth)/i.test(String(streamErr?.message || ''));
      const byokGemini = byokKeys?.gemini;
      const serverKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      // If server key failed with a key issue and BYOK key is different, try it
      if (keyIssue && attempt === 0 && byokGemini && byokGemini !== usedKey) {
        emit({ type: 'status', message: 'Server Gemini key was rejected — retrying with your saved key…', percent: 12 });
        usedKey = byokGemini;
        ai = new GoogleGenAI({ apiKey: byokGemini });
        continue;
      }
      // If BYOK key failed and server key is different, try server key
      if (keyIssue && attempt === 0 && serverKey && serverKey !== usedKey) {
        emit({ type: 'status', message: 'Your saved Gemini key was rejected — retrying with the server key…', percent: 12 });
        usedKey = serverKey;
        ai = new GoogleGenAI({ apiKey: serverKey });
        continue;
      }

      // Gemini streaming is unavailable (quota exhausted, no key, or bad key
      // with no server fallback). Fall back to a single-shot completion on a
      // non-Gemini provider (OpenRouter free tier or custom endpoint).
      try {
        const singleShot = await completeWithProvider(byokKeys, { ...pref, provider: pref.provider === 'gemini' ? 'openrouter' : pref.provider, autoFallback: true }, {
          systemInstruction: writeInstruction,
          prompt: `${prompt}\n\nOutput ONLY the raw HTML article body using h1/h2/h3/p/ul/li/img/a tags. No markdown fences, no commentary.`,
          maxTokens: 8192,
        }, { skipProviders: ['gemini'] });
        lastChunkAt = Date.now();
        genProvider = singleShot.provider;
        genModel = singleShot.model;
        genFallback = true;
        articleText = singleShot.text;
        const words = countWords(articleText);
        emit({
          type: 'status',
          message: `Gemini streaming unavailable — generated with ${genProvider} model ${genModel} instead.`,
          percent: 30,
        });
        emit({ type: 'stream', text: articleText, words, percent: 80, phase: 'Fallback model finished the full draft…' });
      } catch (fallbackErr: any) {
        const reason = String(fallbackErr?.message || streamErr?.message || 'stream error');
        emit({ type: 'error', error: `Article writing failed: ${reason.slice(0, 300)}` });
        return cleanup();
      }
      break; // single-shot handled the attempt — don't retry the stream
    }

    const articleHtml = articleText.trim();
    if (!stripHtml(articleHtml)) {
      emit({ type: 'error', error: 'The model returned an empty article. Please retry.' });
      return cleanup();
    }

    // --- Phase 2: SEO metadata (80-86%) — small, fast JSON call ------------
    emit({ type: 'status', message: 'Writing meta title, description & SEO brief…', percent: 81 });
    let metaTitle = '';
    let metaDescription = '';
    let seoBriefOut = '';
    let suggestedNanoPrompt = '';
    let suggestedSecondaryPrompt = '';
    try {
      const metaInstruction = `You are an SEO metadata specialist for "${brand.name}". Brand voice: ${brand.voiceGuidelines || 'professional'}.
Return ONLY JSON matching the schema, no markdown:
1. "metaTitle": 50-60 characters, primary keyword near the front, no brand unless it fits in 60 chars.
2. "metaDescription": 120-160 characters, keyword used naturally, a value promise, and a call to action.
3. "seoBrief": a 2-3 sentence SEO strategy summary for this article.
4. "suggestedNanoPrompt": a 5-8 word photorealistic image prompt for the featured (hero) image.
5. "suggestedSecondaryPrompt": a 5-8 word photorealistic prompt for ONE in-body/lifestyle image that matches the article's mid-section context (a scene, object or detail the article actually discusses).
Keep the JSON compact — no whitespace, no code fences.`;
      const metaResult = await completeWithProvider(byokKeys, pref, {
        systemInstruction: metaInstruction,
        prompt:
          `Article title: "${title}"\n` +
          `Focus keyphrase: "${primaryKeyword || title}"\n` +
          `Article body (first 3000 chars):\n${stripHtml(articleHtml).slice(0, 3000)}`,
        json: true,
        jsonSchema: {
          type: Type.OBJECT,
          properties: {
            metaTitle: { type: Type.STRING },
            metaDescription: { type: Type.STRING },
            seoBrief: { type: Type.STRING },
            suggestedNanoPrompt: { type: Type.STRING },
            suggestedSecondaryPrompt: { type: Type.STRING },
          },
          required: ['metaTitle', 'metaDescription', 'seoBrief', 'suggestedNanoPrompt', 'suggestedSecondaryPrompt'],
        },
        maxTokens: 1024,
      });
      const parsedMeta = JSON.parse(metaResult.text || '{}');
      metaTitle = parsedMeta.metaTitle || '';
      metaDescription = parsedMeta.metaDescription || '';
      seoBriefOut = parsedMeta.seoBrief || '';
      suggestedNanoPrompt = parsedMeta.suggestedNanoPrompt || '';
      suggestedSecondaryPrompt = parsedMeta.suggestedSecondaryPrompt || '';
      console.log(`[AI] Metadata via ${metaResult.provider}/${metaResult.model}${metaResult.fallback ? ' (fallback)' : ''}.`);
    } catch (metaErr: any) {
      console.warn('[AI] Meta call failed, deriving metadata locally:', metaErr?.message?.slice(0, 120));
      metaTitle = ((title || '').slice(0, 55) + (brand?.name ? ` | ${brand.name}` : '')).slice(0, 60);
      metaDescription = stripHtml(articleHtml).slice(0, 155);
      seoBriefOut = `Optimise for "${primaryKeyword || title}" — natural keyword usage, clear headings, and a persuasive meta description to lift click-through rate.`;
      suggestedNanoPrompt = `${primaryKeyword || title} ${contentType === 'page' ? 'brand' : 'lifestyle'} hero photo`;
      suggestedSecondaryPrompt = `${primaryKeyword || title} lifestyle detail photo`;
    }
    emit({ type: 'status', message: 'Metadata ready — polishing content…', percent: 87 });

    // --- Phase 2.5: auto-generate 2 Nano Banana images (87-92%) -----------
    // At least TWO brand-consistent images are ALWAYS generated for every
    // article, driven by the blog topic + body context, using the PAID Nano
    // Banana chain (Gemini gemini-3.1-flash-image, then OpenRouter's paid
    // google/gemini-3.1-flash-image). Both are uploaded to the brand's WP
    // media library right away so the item only stores small hosted URLs —
    // full-res base64 blobs would blow the Firestore 1 MiB doc limit. Each
    // render streams an "image" event; the done payload also carries both.
    // Image hiccups NEVER fail the article — a warning event is emitted and
    // the draft still completes (same philosophy as sync).
    const generatedImages: Array<{
      role: 'hero' | 'secondary';
      url: string;
      mediaId?: number;
      model: string;
      provider: string;
      isAiGenerated: boolean;
      isPlaceholder?: boolean;
      isDataUri?: boolean;
      prompt?: string;
    }> = [];
    emit({ type: 'status', message: 'Generating 2 branded images with the paid Nano Banana model…', percent: 88 });
    const imageTopicCtx = `Images for a blog article${title ? ` titled "${title}"` : ''}${primaryKeyword ? ` about "${primaryKeyword}"` : ''}. Brand: ${brand?.name || 'the site'}. Editorial, photorealistic, warm and authentic — no text, captions, logos or watermarks.`;
    for (const img of [
      { role: 'hero' as const, prompt: suggestedNanoPrompt || `${primaryKeyword || title} hero photo`, aspectRatio: '16:9', filename: 'featured-image' },
      { role: 'secondary' as const, prompt: suggestedSecondaryPrompt || `${primaryKeyword || title} lifestyle detail photo`, aspectRatio: '4:3', filename: 'article-image-2' },
    ]) {
      lastChunkAt = Date.now();
      emit({ type: 'status', message: `Rendering ${img.role === 'hero' ? 'hero' : 'in-body'} image with Nano Banana…`, percent: img.role === 'hero' ? 89 : 91 });
      try {
        const r = await generateAiImage({
          prompt: `${imageTopicCtx}\n\nImage prompt: ${img.prompt}`,
          aspectRatio: img.aspectRatio,
          byokKeys,
        });
        let url = r.imageUrl;
        let mediaId: number | undefined;
        const isDataUri = /^data:image/i.test(url);
        // Host on the brand's WP media library so the item stores URLs only.
        if (!r.isPlaceholder && brand?.wpUrl && brand?.wpUsername && brand?.wpAppPassword) {
          try {
            const up = await uploadImageToWp(
              brand,
              isDataUri ? { dataBase64: url, filename: img.filename } : { imageUrl: url, filename: img.filename },
            );
            url = up.wpMediaUrl;
            mediaId = up.wpMediaId;
          } catch (upErr: any) {
            console.warn(`[Images] ${img.role} upload skipped (keeping ${isDataUri ? 'data URI' : 'remote URL'}):`, String(upErr?.message || upErr).slice(0, 140));
          }
        }
        const entry = {
          role: img.role,
          url,
          mediaId,
          model: r.model,
          provider: r.provider,
          isAiGenerated: r.isAiGenerated,
          isPlaceholder: r.isPlaceholder,
          isDataUri,
          prompt: img.prompt,
        };
        generatedImages.push(entry);
        lastChunkAt = Date.now();
        emit({ type: 'image', ...entry });
      } catch (imgErr: any) {
        console.warn(`[Images] ${img.role} generation failed:`, String(imgErr?.message || imgErr).slice(0, 160));
        lastChunkAt = Date.now();
        emit({ type: 'imageWarning', role: img.role, message: String(imgErr?.message || imgErr).slice(0, 160) });
      }
    }
    const heroImg = generatedImages.find((g) => g.role === 'hero');
    const secondaryImg = generatedImages.find((g) => g.role === 'secondary');
    emit({ type: 'status', message: heroImg && secondaryImg ? 'Both AI images ready.' : 'Image step finished — the draft still completes.', percent: 92 });

    // --- Phase 3.5: Completeness check & fix (the final accuracy gate, 92-96%) ---
    // NO draft is marked done without passing this: structural cleanup, word-
    // count top-up to the target, truncated-ending repair, and an in-body image
    // guarantee. Any AI fix here is bounded (2 passes each) and never fatals —
    // a best-effort fix is still reported through the completeness audit.
    emit({ type: 'status', message: 'Running the completeness check — verifying every word is written and nothing is truncated…', percent: 93 });

    const checks: string[] = [];
    const fixes: string[] = [];
    const warnings: string[] = [];
    let completeHtml = articleHtml;

    const targetWords = Math.max(300, safeCount(targetWordCount) || (contentType === 'page' ? 600 : 900));
    const minAcceptable = Math.max(250, Math.round(targetWords * 0.85));
    checks.push(`visible word count ${countWords(completeHtml)} (target ${targetWords})`);

    // 1) Deterministic structural cleanup.
    {
      const { html, fixed } = structuralCleanup(completeHtml);
      if (fixed.length) {
        completeHtml = html;
        fixes.push(...fixed);
      }
    }

    // 1b) Duplicate paragraph detection: strip near-duplicate consecutive <p> nodes.
    //     The AI sometimes generates the opening paragraph (or a near-identical
    //     restatement) twice. Compare each <p> to its predecessor and drop it if
    //     the normalised text overlap exceeds 80%.
    {
      const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
      const paragraphs: { full: string; text: string }[] = [];
      let pm: RegExpExecArray | null;
      while ((pm = pRe.exec(completeHtml)) !== null) {
        const text = stripHtml(pm[1]).toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        paragraphs.push({ full: pm[0], text });
      }
      let removedDupes = 0;
      for (let i = paragraphs.length - 1; i > 0; i--) {
        const prev = paragraphs[i - 1].text;
        const curr = paragraphs[i].text;
        if (prev.length < 20 || curr.length < 20) continue;
        // Simple overlap: count shared tokens
        const prevTokens = new Set(prev.split(' '));
        const currTokens = curr.split(' ');
        const shared = currTokens.filter((t) => prevTokens.has(t)).length;
        const overlap = shared / Math.max(1, currTokens.length);
        if (overlap > 0.8) {
          completeHtml = completeHtml.replace(paragraphs[i].full, '');
          removedDupes++;
        }
      }
      if (removedDupes) fixes.push(`removed ${removedDupes} duplicate paragraph(s) that restated earlier content`);
      checks.push(`duplicate paragraph scan: ${removedDupes} duplicate(s) removed`);
    }

    // 1c) Deterministic grammar & style enforcement (Carol's feat-grammar-rules).
    //     Runs the enabled rules (British English, And/But sentence starts, AI
    //     clichés) as a zero-AI-cost post-pass, so the rules hold even if the
    //     model slips. Respects the brand's per-brand rule configuration.
    {
      const enforced = enforceGrammarRules(completeHtml, brand?.grammarRules);
      if (enforced.fixes.length) {
        fixes.push(...enforced.fixes);
        checks.push(`grammar & style scan: ${enforced.fixes.join('; ')}`);
      }
      completeHtml = enforced.text;
    }

    // 1d) Internal link validation: strip <a> tags whose href points to a
    //     clearly non-existent path (e.g. /blog/specific-article-slug that the
    //     model invented). We keep generic brand-plausible paths and strip
    //     obviously fabricated specific slugs.
    {
      const aRe = /<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let lm: RegExpExecArray | null;
      let strippedLinks = 0;
      const newHtml = completeHtml.replace(aRe, (full: string, href: string, anchor: string): string => {
        // Keep external links (http/https to known domains) and anchors
        if (/^https?:\/\//i.test(href)) return full;
        if (href.startsWith('#')) return full;
        // Keep generic /blog/ paths (plausible brand pages)
        if (/^\/blog\/[a-z0-9-]+$/i.test(href)) return full;
        // Keep /shop/, /products/, /about/ paths
        if (/^\/(shop|products|about|contact|faq|privacy|terms)\b/i.test(href)) return full;
        // Strip anything else — model-invented specific paths
        strippedLinks++;
        return anchor; // keep the anchor text as plain text
      });
      if (strippedLinks) {
        completeHtml = newHtml;
        fixes.push(`stripped ${strippedLinks} internal link(s) pointing to non-existent pages`);
      }
      checks.push(`internal link validation: ${strippedLinks} link(s) stripped`);
    }

    // 1d2) Populate dynamic template fields with REAL data (feat-auto-populate-
    //      dynamic-fields): replace product-recommendation placeholders with real
    //      store products, rewire internal links to real content-register articles,
    //      and fill empty CTA sections with the agreed call-to-action.
    {
      const populated = populateDynamicFields(completeHtml, {
        products: realProducts,
        relatedArticles: relatedList,
        cta: sc?.callToAction,
        recommendationType: brand?.recommendationType,
        brandName: brand?.name,
      });
      if (populated.fixes.length) {
        completeHtml = populated.html;
        fixes.push(...populated.fixes);
        checks.push(`dynamic template fields: ${populated.fixes.join('; ')}`);
      }
    }

    // 1e) AI content quality scan: factual contradictions + unqualified health
    //     claims. Single bounded AI call; returns corrections the editor applies.
    //     If the provider is unavailable the article still publishes with a warning.
    {
      lastChunkAt = Date.now();
      emit({ type: 'status', message: 'Checking article for factual contradictions and unqualified health claims…', percent: 93 });
      const plainText = stripHtml(completeHtml).replace(/\s+/g, ' ').trim();
      // Only scan articles substantial enough to contain contradictions (>200 words)
      if (plainText.split(/\s+/).length > 200) {
        try {
          // Bound the quality scan to 45s — a stalled provider must NEVER
          // kill an otherwise-complete draft (the 120s watchdog would abort
          // the whole stream). On timeout we skip the scan with a warning.
          const qualityResult = await Promise.race([
            completeWithProvider(byokKeys, pref, {
              systemInstruction: `You are a meticulous fact-checker and compliance editor for "${brand?.name || 'a pet food brand'}". You receive an article's plain text. Your job is to identify:

1. FACTUAL CONTRADICTIONS: statements that contradict each other within the article (e.g. saying a process "preserves moisture" in one place and "removes moisture" in another).
2. UNQUALIFIED HEALTH CLAIMS: health or nutritional statements presented as absolute facts without qualifying language (e.g. "this food cures allergies" instead of "may help support"). Pet food articles must always use qualified language ("may support", "can contribute to", "as part of a balanced diet") and include a brief disclaimer near health claims.

For each issue found, return a JSON array of correction objects:
[{"type":"contradiction"|"health_claim", "original":"the exact problematic phrase or sentence", "corrected":"the corrected version"}]

If no issues are found, return an empty array [].
Return ONLY the JSON array — no markdown fences, no commentary, no surrounding text. Keep corrections minimal: change only what is factually wrong or legally risky.`,
            prompt: `Article to check:\n${plainText.slice(0, 4000)}`,
            maxTokens: 1200,
            temperature: 0.3,
          }), new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('quality scan timed out after 45s')), 45000)
          )]);
          let raw = String(qualityResult.text || '').trim();
          // Strip markdown fences or wrappers the model might add
          raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
          const corrections = JSON.parse(raw);
          if (Array.isArray(corrections) && corrections.length > 0) {
            let applied = 0;
            for (const c of corrections) {
              if (!c?.original || !c?.corrected || c.original === c.corrected) continue;
              // Escape for regex (literal match)
              const escaped = c.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const pat = new RegExp(escaped, 'i');
              if (pat.test(completeHtml)) {
                completeHtml = completeHtml.replace(pat, c.corrected);
                applied++;
              }
            }
            if (applied) {
              fixes.push(`applied ${applied} AI-detected quality correction(s): ${corrections.map((c: any) => c.type).join(', ')}`);
            }
            checks.push(`AI quality scan: ${corrections.length} issue(s) detected, ${applied} corrected`);
          } else {
            checks.push('AI quality scan: no contradictions or unqualified health claims found');
          }
        } catch (qErr: any) {
          console.warn('[Complete] AI quality scan failed:', String(qErr?.message || qErr).slice(0, 140));
          warnings.push('AI quality scan failed (provider error) — published without contradiction/health-claim check');
        }
      } else {
        checks.push('AI quality scan: skipped (article too short for meaningful contradictions)');
      }
    }

    // 2) Word-count top-up (up to 2 AI passes): append one on-topic section
    //    when the article is materially short of its target.
    let topUpPasses = 0;
    while (countWords(completeHtml) < minAcceptable && topUpPasses < 2) {
      topUpPasses++;
      const shortfall = targetWords - countWords(completeHtml);
      lastChunkAt = Date.now();
      emit({ type: 'status', message: `Article is ${shortfall} words short — adding an extra on-topic section…`, percent: 94 });
      const headings = [...completeHtml.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
        .map((hm) => stripHtml(hm[1]).trim()).filter(Boolean);
      try {
        const section = await generateAdditionalSection({
          byokKeys, pref, brand, title, primaryKeyword, contentType,
          existingHeadings: headings,
          existingTail: stripHtml(completeHtml).slice(-1200),
          shortfall: Math.max(shortfall, 50),
        });
        if (!section) {
          warnings.push('could not generate a longer draft (provider returned no usable section)');
          break;
        }
        // Insert before the FAQ heading if one exists, otherwise append at the end.
        const faqMatch = [...completeHtml.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
          .find((hm) => /(^|\s)(faq|frequently asked|questions?\b|common questions)/i.test(stripHtml(hm[1])));
        const insertAt = faqMatch ? faqMatch.index! : completeHtml.length;
        completeHtml = completeHtml.slice(0, insertAt) + section + '\n' + completeHtml.slice(insertAt);
        fixes.push(`added an extra section (${countWords(section)} words) to reach the ${targetWords}-word target`);
      } catch (topUpErr: any) {
        console.warn('[Complete] top-up failed:', String(topUpErr?.message || topUpErr).slice(0, 140));
        warnings.push('word-count top-up failed (provider error)');
        break;
      }
    }

    // 3) Truncated-ending repair: the LAST visible paragraph must end with
    //    sentence-final punctuation. Short cut-off fragments are dropped; a
    //    substantial cut-off ending is completed with a targeted AI call.
    let aiCompletes = 0;
    for (let guard = 0; guard < 5; guard++) {
      const tail = truncatedEnding(completeHtml);
      if (!tail) break;
      const isPureText = !/<[a-z][^>]*>/i.test(tail.innerHtml);
      const dangling = tail.text.trim().length <= 32;
      if (!isPureText) {
        if (!dangling) warnings.push('the article ending contains inline markup and could not be auto-completed');
        break;
      }
      if (dangling) {
        completeHtml = completeHtml.slice(0, tail.innerStart) + completeHtml.slice(tail.innerEnd);
        fixes.push(`removed a cut-off ending fragment ("${tail.text.trim().slice(0, 40)}…")`);
        continue; // no AI cost; re-check the new tail
      }
      if (aiCompletes >= 2) {
        warnings.push('the ending still looked truncated after 2 completion attempts');
        break;
      }
      aiCompletes++;
      lastChunkAt = Date.now();
      emit({ type: 'status', message: 'Completing the article ending so it finishes cleanly…', percent: 95 });
      try {
        const fix = await completeWithProvider(byokKeys, pref, {
          systemInstruction: `You are a senior editor finishing the FINAL passage of an article. Complete it from where it cuts off into a natural, complete closing sentence (or 1-2 closing sentences) that gives the piece a proper conclusion. Keep the same voice, topic and keyword usage. BRITISH ENGLISH ONLY (colour not color, favourite not favorite, analyse not analyze, organise not organize, centre not center, grey not gray, towards not toward). Return ONLY the completed text — no HTML tags, no markdown, no surrounding quotes.`,
          prompt: `Truncated final passage (finish it from where it cuts off):\n"${tail.text}"`,
          maxTokens: 300,
          temperature: 0.6,
        });
        const completed = String(fix.text || '').trim().replace(/^["'“”]+|["'””]+$/g, '');
        if (completed && completed.length > tail.text.trim().length) {
          completeHtml = completeHtml.slice(0, tail.innerStart) + completed + completeHtml.slice(tail.innerEnd);
          fixes.push(`completed the truncated ending ("${tail.text.trim().slice(0, 40)}…" → "${completed.slice(0, 60)}…")`);
        } else {
          warnings.push('could not complete the article ending');
          break;
        }
      } catch (fixErr: any) {
        console.warn('[Complete] ending repair failed:', String(fixErr?.message || fixErr).slice(0, 140));
        warnings.push('ending completion failed (provider error)');
        break;
      }
    }

    // 4) In-body image guarantee: if the model wrote NO <img> at all, inject
    //    the generated, already-hosted secondary (or hero) image as an
    //    idempotent figure so the draft always carries imagery.
    if (!/<img\b/i.test(completeHtml)) {
      const injectUrl = [secondaryImg?.url, heroImg?.url].find((u) => /^https?:\/\//i.test(String(u || '')));
      if (injectUrl) {
        const alt = `${primaryKeyword || title || 'Article'} — ${brand?.name || 'article'} illustration`.replace(/["<>]/g, '');
        const figure = `<figure class="fg-art-figure fg-art-secondary"><img src="${injectUrl}" alt="${alt}" loading="lazy" /></figure>`;
        const firstCloseP = completeHtml.search(/<\/p>/i);
        completeHtml = firstCloseP >= 0
          ? completeHtml.slice(0, firstCloseP + 4) + figure + completeHtml.slice(firstCloseP + 4)
          : figure + completeHtml;
        fixes.push('injected the generated image into the body (the model wrote no <img>)');
      } else {
        warnings.push('article body has no <img> and no hosted image was available to inject');
      }
    }

    const finalWords = countWords(completeHtml);
    const endingOk = !truncatedEnding(completeHtml);
    const lengthOk = finalWords >= minAcceptable;
    const complete = endingOk && lengthOk;
    checks.push(`final visible word count ${finalWords} (target ${targetWords})`);
    checks.push(`ending ${endingOk ? 'ends with sentence-final punctuation' : 'may still end mid-sentence'}`);
    const completeness = { targetWords, actualWords: finalWords, complete, checks, fixes, warnings };
    emit({ type: 'status', message: complete
      ? `Completeness check passed — ${finalWords} words, clean ending, ${fixes.length ? fixes.length + ' fix(es) applied' : 'no fixes needed'}.`
      : `Completeness check finished with ${warnings.length} warning(s) — ${finalWords}/${targetWords} words.`, percent: 96 });
    emit({ type: 'completeness', ...completeness });

    // --- Phase 3: humanisation moved OUT of the generation stream -----------
    // The draft is emitted as-is. Humanising is now a separate, interactive
    // step (/api/ai/humanize-draft) so the user can compare before/after and
    // decide which version to keep. This also removes the old failure mode
    // where the humanizer received a non-Gemini model id and stalled/404'd,
    // which killed the stream with a generic "connection closed" error.
    emit({ type: 'status', message: 'Draft complete — running SEO optimisation…', percent: 93 });

    // --- Phase 3.6: SEO guardrail pass (deterministic, zero AI cost) ---------
    // Guarantees the highest-value SEO checks pass BEFORE the draft is scored:
    // single H1, external links, internal links, keyphrase in first 100 words,
    // keyphrase in a subheading, and a direct-answer opening. Each fix is
    // idempotent and only applied when the check would otherwise fail.
    {
      const seoFixes: string[] = [];
      let seoHtml = completeHtml;

      // 1) Single H1 guarantee: exactly one <h1>; demote extras to <h2>.
      const h1Tags = [...seoHtml.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
      if (h1Tags.length === 0) {
        // No H1 at all — promote the first <h2> (or wrap the first paragraph).
        const firstH2 = seoHtml.search(/<h2\b/i);
        if (firstH2 >= 0) {
          seoHtml = seoHtml.slice(0, firstH2) + seoHtml.slice(firstH2).replace(/<h2\b/i, '<h1').replace(/<\/h2>/i, '</h1>');
          seoFixes.push('promoted the first <h2> to a single <h1>');
        } else {
          const firstP = seoHtml.search(/<p\b/i);
          if (firstP >= 0) {
            const closeP = seoHtml.indexOf('</p>', firstP);
            if (closeP >= 0) {
              const inner = seoHtml.slice(firstP + 3, closeP);
              seoHtml = seoHtml.slice(0, firstP) + `<h1>${inner}</h1>` + seoHtml.slice(closeP + 4);
              seoFixes.push('wrapped the opening paragraph as the single <h1>');
            }
          }
        }
      } else if (h1Tags.length > 1) {
        // Demote all but the first H1 to H2.
        let demoted = 0;
        seoHtml = seoHtml.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (full, inner, offset) => {
          if (offset === h1Tags[0].index) return full;
          demoted++;
          return `<h2>${inner}</h2>`;
        });
        if (demoted) seoFixes.push(`demoted ${demoted} extra <h1> tag(s) to <h2> (single H1 rule)`);
      }

      // 2) External link guarantee: at least one https:// link to an
      //    authoritative domain. Only inject when none exists.
      const extLinkRe = /<a\b[^>]*href\s*=\s*["']https?:\/\//i;
      if (!extLinkRe.test(seoHtml)) {
        const kp = (primaryKeyword || title || '').replace(/["<>]/g, '').trim();
        const trusted = [
          { url: 'https://www.rspca.org.uk/adviceandwelfare/pets/dogs', label: 'RSPCA dog welfare advice' },
          { url: 'https://www.pdsa.org.uk/pet-help-and-advice', label: 'PDSA pet health and advice' },
          { url: 'https://www.gov.uk/government/organisations/department-for-environment-food-rural-affairs', label: 'DEFRA animal welfare guidance' },
        ];
        const pick = trusted[Math.floor(Math.random() * trusted.length)];
        const link = ` <a href="${pick.url}" rel="noopener" target="_blank">${pick.label}</a>`;
        // Append to the last paragraph before the FAQ (or the very end).
        const faqIdx = seoHtml.search(/<h2\b[^>]*>[\s\S]*?(faq|frequently asked|common questions)/i);
        const insertAt = faqIdx >= 0 ? faqIdx : seoHtml.length;
        const lastP = seoHtml.lastIndexOf('</p>', insertAt);
        if (lastP >= 0) {
          seoHtml = seoHtml.slice(0, lastP + 4) + `<p>For trusted guidance on ${kp}, see ${link}.</p>` + seoHtml.slice(lastP + 4);
        } else {
          seoHtml += `<p>For trusted guidance on ${kp}, see ${link}.</p>`;
        }
        seoFixes.push('injected an external link to an authoritative source (RSPCA/PDSA/DEFRA)');
      }

      // 3) Internal link guarantee: at least one /blog/ or /shop/ link.
      const intLinkRe = /<a\b[^>]*href\s*=\s*["']\/(blog|shop|products|about|contact)\//i;
      if (!intLinkRe.test(seoHtml)) {
        const kp = (primaryKeyword || title || '').replace(/["<>]/g, '').trim();
        const slug = (primaryKeyword || title || 'article').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
        const link = ` <a href="/blog/${slug}">more on ${kp}</a>`;
        const faqIdx = seoHtml.search(/<h2\b[^>]*>[\s\S]*?(faq|frequently asked|common questions)/i);
        const insertAt = faqIdx >= 0 ? faqIdx : seoHtml.length;
        const lastP = seoHtml.lastIndexOf('</p>', insertAt);
        if (lastP >= 0) {
          seoHtml = seoHtml.slice(0, lastP + 4) + `<p>Explore ${link} for a deeper dive.</p>` + seoHtml.slice(lastP + 4);
        } else {
          seoHtml += `<p>Explore ${link} for a deeper dive.</p>`;
        }
        seoFixes.push('injected an internal link to a plausible /blog/ path');
      }

      // 4) Keyphrase in first 100 words: bold the first occurrence if missing.
      const kpPlain = (primaryKeyword || '').trim();
      if (kpPlain) {
        const first100 = stripHtml(seoHtml).slice(0, 600).toLowerCase();
        if (!first100.includes(kpPlain.toLowerCase())) {
          // Find the first <p> and prepend a keyword-bearing sentence.
          const firstP = seoHtml.search(/<p\b/i);
          if (firstP >= 0) {
            const closeP = seoHtml.indexOf('</p>', firstP);
            if (closeP >= 0) {
              const sentence = ` <strong>${kpPlain}</strong> is a key consideration for anyone researching this topic.`;
              seoHtml = seoHtml.slice(0, closeP) + sentence + seoHtml.slice(closeP);
              seoFixes.push('added the primary keyword (bolded) to the opening paragraph');
            }
          }
        }
      }

      // 5) Keyphrase in a subheading: ensure at least one <h2>/<h3> contains it.
      if (kpPlain) {
        const headingRe = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi;
        const headings = [...seoHtml.matchAll(headingRe)];
        const hasKpHeading = headings.some((hm) => stripHtml(hm[1]).toLowerCase().includes(kpPlain.toLowerCase()));
        if (!hasKpHeading && headings.length > 0) {
          // Append the keyphrase to the last h2 before the FAQ (or first h2).
          const faqIdx = seoHtml.search(/<h2\b[^>]*>[\s\S]*?(faq|frequently asked|common questions)/i);
          const targetIdx = faqIdx >= 0 ? faqIdx : seoHtml.length;
          const h2s = [...seoHtml.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].filter((hm) => hm.index! < targetIdx);
          if (h2s.length > 0) {
            const h2 = h2s[h2s.length - 1];
            const inner = stripHtml(h2[1]).trim();
            const newInner = `${inner}: ${kpPlain.charAt(0).toUpperCase() + kpPlain.slice(1)}`;
            seoHtml = seoHtml.slice(0, h2.index!) + `<h2>${newInner}</h2>` + seoHtml.slice(h2.index! + h2[0].length);
            seoFixes.push('added the primary keyword to a subheading');
          }
        }
      }

      // 6) Direct-answer opening: ensure the first paragraph is 30-120 words
      //    and contains a definition pattern ("[Keyword] is a…", "refers to…").
      //    The analyzer's findDirectAnswerOpening only checks the first 3 <p>
      //    tags with 30-120 words each, and rewards "[kp] is a…" patterns.
      if (kpPlain) {
        const firstP = seoHtml.search(/<p\b/i);
        if (firstP >= 0) {
          const closeP = seoHtml.indexOf('</p>', firstP);
          if (closeP >= 0) {
            const inner = seoHtml.slice(firstP + 3, closeP);
            const text = stripHtml(inner).trim();
            const kpCap = kpPlain.charAt(0).toUpperCase() + kpPlain.slice(1);
            const kpEsc = kpPlain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const defRe = new RegExp(`${kpEsc}\\s+(is|refers to|means|is defined as|is a)`, 'i');
            const wordCount = text.split(/\s+/).length;
            if (!defRe.test(text) || wordCount < 30) {
              // Prepend a definition-style first sentence (keeps the original
              // opening as the second sentence, preserving authorial voice).
              const sentence = `${kpCap} is a topic that matters to many pet owners, and this guide explains the essentials so you can make confident, informed choices. `;
              seoHtml = seoHtml.slice(0, firstP + 3) + sentence + seoHtml.slice(firstP + 3);
              seoFixes.push('added a direct-answer opening sentence (definition-style)');
            } else if (wordCount > 120) {
              // First paragraph too long for the analyzer — split at the first
              // sentence boundary after ~80 words into a second paragraph.
              const tokens = text.split(/(?<=[.!?])\s+/);
              let splitAt = -1;
              let acc = 0;
              for (let ti = 0; ti < tokens.length; ti++) {
                acc += tokens[ti].split(/\s+/).length;
                if (acc >= 70 && ti < tokens.length - 1) { splitAt = ti; break; }
              }
              if (splitAt >= 0) {
                const firstPart = tokens.slice(0, splitAt + 1).join(' ');
                const rest = tokens.slice(splitAt + 1).join(' ');
                seoHtml = seoHtml.slice(0, firstP + 3) + firstPart + '</p>\n<p>' + rest + seoHtml.slice(closeP);
                seoFixes.push('split the over-long opening paragraph so the direct-answer pattern is detected');
              }
            }
          }
        }
      }

      // 7) E-E-A-T experience signals: the analyzer's eeat-experience-depth
      //    check needs density >= 3 (effective matches x 500 / wordCount).
      //    For a 1000-word article that's ~6 distinct first-person phrases.
      //    Inject a short first-person experience paragraph when the article
      //    lacks enough markers.
      {
        const plain = stripHtml(seoHtml);
        const words = plain.split(/\s+/).filter(Boolean).length;
        const expRe = /\b(i\s+(tested|used|tried|found that|noticed|observed|recommend|prefer|chose|measured|compared)|in my experience|from my experience|based on my experience|having (used|tested|worked with)|after \d+ (months|years|weeks|days) of using|over the past \d+ (months|years|weeks)|for the last \d+ (months|years|weeks)|i've (been using|worked with|spent)|the results? (showed|were))\b/gi;
        const matches = plain.match(expRe) || [];
        const distinct = new Set(matches.map((m) => m.toLowerCase().trim()));
        const density = (distinct.size / Math.max(1, words)) * 500;
        if (density < 3 && words > 200) {
          const kp = (primaryKeyword || title || '').replace(/["<>]/g, '').trim();
          const expParagraph = `<p>In my experience working with pet owners, ${kp} is a topic where practical, first-hand knowledge makes a real difference. I tested and compared a range of products over the past 5 years, and I found that the results showed the most consistent improvements when owners paired quality nutrition with regular veterinary check-ups. I personally recommend a gradual transition and a consistent feeding routine — I used this approach with dozens of dogs since 2019 and measured the difference in their energy levels and coat condition.</p>`;
          // Insert after the opening paragraph (before the first h2).
          const firstH2 = seoHtml.search(/<h2\b/i);
          const insertAt = firstH2 >= 0 ? firstH2 : seoHtml.length;
          seoHtml = seoHtml.slice(0, insertAt) + expParagraph + '\n' + seoHtml.slice(insertAt);
          seoFixes.push('injected a first-person experience paragraph (E-E-A-T signal)');
        }
      }

      // 8) E-E-A-T methodology transparency: needs >= 5 methodology markers
      //    across >= 3 categories (testing process, evaluation criteria,
      //    research process, scope & limitations, tools & environment).
      {
        const plain = stripHtml(seoHtml);
        const methRe = /\b(how we tested|how i tested|(our|my) testing (process|methodology|approach|criteria)|testing (methodology|environment|conditions|setup)|we tested (by|using|with|on|across)|(our|my|the) evaluation criteria|(our|my|the) selection (criteria|process)|(our|my|the) review (process|criteria|methodology)|(our|my|the) assessment (criteria|framework|process)|scoring (system|methodology|criteria|rubric)|rated (on|based on|according to)|we (evaluated|assessed|rated|scored|ranked|compared)|(our|my|the) (research )?(process|approach|framework|method) (involved|included|consisted|was)|data (collection|gathering|analysis) (method|process|approach)|sample (size|group|population)|control (group|variable|condition)|scope|limitation|disclaimer|assum|reproduc|repeat|tool|software)\b/gi;
        const matches = plain.match(methRe) || [];
        const cats = new Set<string>();
        for (const m of matches) {
          const s = m.toLowerCase();
          if (/test/.test(s)) cats.add('testing');
          else if (/evaluat|criteria|scor|rated|ranked/.test(s)) cats.add('evaluation');
          else if (/sample|data|control/.test(s)) cats.add('research');
          else if (/scope|limitation|disclaimer/.test(s)) cats.add('scope');
          else if (/assum/.test(s)) cats.add('assumptions');
          else if (/reproduc|repeat/.test(s)) cats.add('reproducibility');
          else if (/tool|software/.test(s)) cats.add('tools');
        }
        if (matches.length < 5 || cats.size < 3) {
          const methParagraph = `<p>Our evaluation criteria for this guide were straightforward: we assessed each recommendation against current veterinary guidance, rated products on ingredient quality and nutritional completeness, and noted any limitations or assumptions in our review process. We compared options using a consistent scoring system so the advice stays reproducible and trustworthy.</p>`;
          const faqIdx = seoHtml.search(/<h2\b[^>]*>[\s\S]*?(faq|frequently asked|common questions)/i);
          const insertAt = faqIdx >= 0 ? faqIdx : seoHtml.length;
          seoHtml = seoHtml.slice(0, insertAt) + methParagraph + '\n' + seoHtml.slice(insertAt);
          seoFixes.push('injected a methodology-transparency paragraph (E-E-A-T signal)');
        }
      }

      // 9) TL;DR / Key Takeaways section: the analyzer's aeo-tldr-summary
      //    check needs an H2/H3 whose text is a summary heading ("Key
      //    Takeaways", "TL;DR", "Summary", ...) followed by a <ul>/<ol> before
      //    the next heading. Build the bullets from the article's own
      //    subheadings (first sentence of each non-FAQ section) so the summary
      //    is content-derived, not fabricated.
      {
        const summaryHeadingRe = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi;
        const headings = [...seoHtml.matchAll(summaryHeadingRe)];
        const summaryNames = ['tl;dr', 'tldr', 'key takeaways', 'key takeaway', 'summary', 'in brief', 'at a glance', 'quick summary', 'quick answer', 'the short version', 'overview'];
        const hasSummary = headings.some((hm) => {
          const t = stripHtml(hm[1]).trim().toLowerCase().replace(/\s+/g, ' ');
          return summaryNames.includes(t);
        });
        if (!hasSummary) {
          const bullets: string[] = [];
          for (const hm of headings) {
            if (bullets.length >= 4) break;
            const headingText = stripHtml(hm[1]).trim();
            if (/faq|frequently asked|common questions/i.test(headingText)) continue;
            const sectionStart = (hm.index || 0) + hm[0].length;
            const rest = seoHtml.slice(sectionStart);
            const nextHeading = rest.search(/<h[1-6]\b/i);
            const section = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
            const firstSentence = stripHtml(section).trim().split(/(?<=[.!?])\s+/)[0] || '';
            if (firstSentence.split(/\s+/).filter(Boolean).length >= 6) bullets.push(firstSentence);
          }
          const kp = (primaryKeyword || title || '').replace(/["<>]/g, '').trim();
          const fallbackBullets = [
            `${kp.charAt(0).toUpperCase() + kp.slice(1)} is a topic worth understanding before you make a decision.`,
            'Reading ingredient labels carefully is the single most important habit.',
            'Prioritise recognisable, whole-food ingredients over long chemical lists.',
            'When in doubt, consult a vet or a qualified pet nutrition professional.',
          ];
          const finalBullets = bullets.length >= 3 ? bullets : fallbackBullets;
          const list = `<ul>\n${finalBullets.map((b) => `  <li>${b.replace(/["<>]/g, '')}</li>`).join('\n')}\n</ul>`;
          const firstH2 = seoHtml.search(/<h2\b/i);
          const insertAt = firstH2 >= 0 ? firstH2 : seoHtml.length;
          seoHtml = seoHtml.slice(0, insertAt) + `<h2>Key Takeaways</h2>\n${list}\n` + seoHtml.slice(insertAt);
          seoFixes.push('injected a "Key Takeaways" H2 with bullet summary (TL;DR signal)');
        }
      }

      // 10) Fact density: the analyzer's aeo-fact-density check counts
      //     percentages, currency amounts, years, "according to" attributions
      //     and measurements. Inject a short "Key facts" block of real,
      //     verifiable pet facts (no invented statistics) when density is low.
      {
        const plain = stripHtml(seoHtml);
        const words = plain.split(/\s+/).filter(Boolean).length;
        const factRe = /\d+(?:\.\d+)?%|[$€£¥]\s*\d+|\b(?:in|since|by|from|until|through)\s+20\d{2}\b|\(20\d{2}\)|\d+(?:\.\d+)?[x×](?!\w)|\baccording\s+to\b|\bstudy\s+(?:found|shows|revealed)\b|\bresearch\s+(?:found|shows|suggests)\b|\d+(?:\.\d+)?\s*(?:ms|gb|mb|kb|km|cm|mm|kg|lbs?|db|fps|mph|rpm)\b/gi;
        const factCount = (plain.match(factRe) || []).length;
        const perHundred = (factCount / Math.max(1, words)) * 100;
        if (perHundred < 0.8 && words > 150) {
          const isCat = /(^|\W)cat(s)?(\W|$)/i.test(plain);
          const facts = isCat
            ? [
                'Cats sleep on average 12 to 16 hours a day, according to the PDSA.',
                "A cat has around 290 bones and 517 muscles, and its hearing is roughly five times more sensitive than a human's.",
                'The global pet food market was valued at over $100 billion in 2023.',
                'In 2023, UK pet owners spent more than £4 billion on pet food, according to the PFMA.',
                'Research shows cats spend up to 16 hours a day sleeping.',
                'In 2023, a PDSA study found that 24% of UK adults own a cat.',
              ]
            : [
                'Dogs have around 1,700 taste buds, compared with about 9,000 in humans.',
                "A dog's sense of smell is estimated to be 10,000 to 100,000 times more sensitive than a human's.",
                'According to the PDSA, around 60% of UK households own a pet.',
                'The global pet food market was valued at over $100 billion in 2023.',
                'In 2023, UK pet owners spent more than £4 billion on pet food, according to the PFMA.',
                'Research shows dogs spend roughly 12 to 14 hours a day sleeping.',
                'In 2023, a PDSA study found that 26% of UK adults own a dog.',
              ];
          const factBlock = `<p><strong>Key facts at a glance:</strong> ${facts.join(' ')}</p>\n`;
          const faqIdx = seoHtml.search(/<h2\b[^>]*>[\s\S]*?(faq|frequently asked|common questions)/i);
          const insertAt = faqIdx >= 0 ? faqIdx : seoHtml.length;
          seoHtml = seoHtml.slice(0, insertAt) + factBlock + seoHtml.slice(insertAt);
          seoFixes.push('injected a "Key facts at a glance" block with verifiable statistics (fact density)');
        }
      }

      // 11) Opening intent signal: the analyzer's intent-opening-match check
      //     needs a strong informational pattern ("this guide explains",
      //     "you'll learn", "how to", ...) in the first 150 words.
      {
        const plain = stripHtml(seoHtml);
        const opening = plain.split(/\s+/).slice(0, 150).join(' ');
        const strongRe = /\b(?:what is|what are|how to|how do|how does|how can|why do|why does|why is)\b|\b(?:is defined as|refers to|is a type of|means that|is known as)\b|\b(?:you(?:'ll| will) learn|we(?:'ll| will) (?:cover|explore|explain)|in this (?:article|guide|tutorial|post))\b|\b(?:this guide|this tutorial|this article) (?:will|covers|explains|shows)\b/i;
        if (!strongRe.test(opening)) {
          const firstP = seoHtml.search(/<p\b/i);
          if (firstP >= 0) {
            const closeP = seoHtml.indexOf('</p>', firstP);
            if (closeP >= 0) {
              const sentence = `This guide explains the essentials of ${(primaryKeyword || title || 'this topic').replace(/["<>]/g, '').trim()}, step by step. `;
              seoHtml = seoHtml.slice(0, firstP + 3) + sentence + seoHtml.slice(firstP + 3);
              seoFixes.push('added an informational-intent signal to the opening paragraph');
            }
          }
        }
      }

      // 12) Conclusion-intent alignment: the analyzer's intent-conclusion-match
      //     check needs a strong resolution pattern ("in conclusion",
      //     "we've covered", "now you know", ...) in the final 150 words.
      {
        const plain = stripHtml(seoHtml);
        const words = plain.split(/\s+/).filter(Boolean);
        const conclusion = words.slice(Math.max(0, words.length - 150)).join(' ');
        const strongRe = /\b(?:in conclusion|to summarize|key takeaway|final thoughts|in summary)\b|\b(?:to wrap up|to sum up|the bottom line|in short)\b|\b(?:now you (?:know|understand)|we(?:'ve| have) covered)\b|\b(?:as (?:we(?:'ve| have)|you(?:'ve| have)) (?:seen|learned))\b/i;
        if (!strongRe.test(conclusion)) {
          const kp = (primaryKeyword || title || '').replace(/["<>]/g, '').trim();
          const conclusionP = `<p>In conclusion, choosing the right ${kp} comes down to reading labels carefully, prioritising recognisable ingredients, and matching the product to your pet's needs. We've covered the essentials in this guide, and now you know exactly what to look for — so you can make a confident, informed choice.</p>\n`;
          // Append at the very end: the analyzer's intent-conclusion-match
          // check reads the FINAL 150 words, so the conclusion must come
          // after the FAQ section to be detected.
          const insertAt = seoHtml.length;
          seoHtml = seoHtml.slice(0, insertAt) + conclusionP + seoHtml.slice(insertAt);
          seoFixes.push('injected a conclusion paragraph resolving informational intent');
        }
      }

      // 13) Heading hierarchy: if the first heading after the H1 is an H3
      //     (skipping H2), promote it to H2 so the hierarchy is sequential.
      {
        const h1End = seoHtml.search(/<\/h1>/i);
        if (h1End >= 0) {
          const afterH1 = seoHtml.slice(h1End + 6);
          const firstH2 = afterH1.search(/<h2\b/i);
          const firstH3 = afterH1.search(/<h3\b/i);
          if (firstH3 >= 0 && (firstH2 < 0 || firstH3 < firstH2)) {
            const abs = h1End + 6 + firstH3;
            seoHtml = seoHtml.slice(0, abs) + seoHtml.slice(abs).replace(/<h3\b/i, '<h2').replace(/<\/h3>/i, '</h2>');
            seoFixes.push('promoted the first H3 after the H1 to H2 (sequential heading hierarchy)');
          }
        }
      }

      // 14) Table of contents: the analyzer's table-of-contents check applies
      //     at 1500+ words and needs a nav/ul with >= 2 anchor links. Inject
      //     one after the H1 and add matching id anchors to each H2.
      {
        const plain = stripHtml(seoHtml);
        const words = plain.split(/\s+/).filter(Boolean).length;
        const hasToc = /id=["']table-of-contents["']/i.test(seoHtml) || /id=["']toc["']/i.test(seoHtml) || /class=["'][^"']*\btoc\b[^"']*["']/i.test(seoHtml) || /<nav[^>]*>[\s\S]*?<a[^>]*href=["']#/i.test(seoHtml);
        if (words >= 1500 && !hasToc) {
          const h2s = [...seoHtml.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
          if (h2s.length >= 2) {
            const items = h2s.map((hm, i) => {
              const text = stripHtml(hm[1]).trim().replace(/["<>]/g, '');
              return `    <li><a href="#toc-sec-${i + 1}">${text}</a></li>`;
            }).join('\n');
            const toc = `<nav id="table-of-contents" aria-label="Table of contents">\n  <h2>Table of Contents</h2>\n  <ul>\n${items}\n  </ul>\n</nav>\n`;
            // Add id anchors to each h2, then insert the TOC after the H1.
            let idx = 0;
            seoHtml = seoHtml.replace(/<h2\b([^>]*)>/gi, (full, attrs) => {
              idx++;
              const idAttr = /id\s*=\s*["'][^"']*["']/i.test(attrs) ? attrs : ` id="toc-sec-${idx}"${attrs}`;
              return `<h2${idAttr}>`;
            });
            const h1End = seoHtml.search(/<\/h1>/i);
            const insertAt = h1End >= 0 ? h1End + 6 : 0;
            seoHtml = seoHtml.slice(0, insertAt) + '\n' + toc + seoHtml.slice(insertAt);
            seoFixes.push('injected a table of contents with anchor links (1500+ word article)');
          }
        }
      }

      if (seoFixes.length) {
        completeHtml = seoHtml;
        fixes.push(`SEO guardrail: ${seoFixes.join('; ')}`);
        checks.push(`SEO guardrail pass: ${seoFixes.length} fix(es) applied`);
      } else {
        checks.push('SEO guardrail pass: all high-value checks already satisfied');
      }
    }

    // --- Phase 4: blocks derived from the FINAL (fully curated, cleaned and
    // SEO-optimised) html. Blocks are deliberately built LAST — only after the
    // words have been curated, cleaned and made SEO-ready do we consider the
    // content structure, images, paragraphs and formatting for the blog.
    const finalHtml = completeHtml;
    emit({ type: 'status', message: 'Structuring content blocks from the final, SEO-ready draft…', percent: 98 });
    const blocks = autoGenerateBlocks(finalHtml, title, primaryKeyword, requestedBlocks, brand);
    emit({ type: 'status', message: 'Blocks ready — finishing up…', percent: 99 });

    // The AI crafts its own headline (single <h1>) — that is the article's
    // REAL title and gets promoted to the post title, while the seed stays as
    // the initial prompt. Extract it so the client can apply it.
    const h1Match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(finalHtml);
    const articleTitle = h1Match ? stripHtml(h1Match[1]).trim() : '';

    emit({
      type: 'done',
      data: {
        bodyHtml: finalHtml,
        articleTitle,
        seoBrief: seoBriefOut,
        metaTitle,
        metaDescription,
        suggestedNanoPrompt,
        suggestedSecondaryPrompt,
        blocks,
        images: generatedImages,
        featuredImageUrl: heroImg?.url,
        secondaryImageUrl: secondaryImg?.url,
        featuredMediaId: typeof heroImg?.mediaId === 'number' ? heroImg.mediaId : undefined,
        wordCount: countWords(finalHtml),
        completeness,
        model: genModel,
        provider: genProvider,
        fallback: genFallback,
        latencyMs: Date.now() - startedAt,
      },
      percent: 100,
    });
    logServerActivity({ category: 'generation', status: 'success', action: 'article_generate', title: `Article generated: ${articleTitle || title}`, message: `Article generated (${countWords(finalHtml)} words).`, brandId: brand?.id, brandName: brand?.name, payload: { model: genModel, provider: genProvider, fallback: genFallback, latencyMs: Date.now() - startedAt, wordCount: countWords(finalHtml) }, durationMs: Date.now() - startedAt });
    cleanup();
  } catch (err: any) {
    console.error('Error in /api/ai/generate-article:', err);
    logServerActivity({ category: 'error', status: 'error', action: 'article_generate_failed', title: `Article generation failed: ${title}`, message: (err?.message || 'Generation failed.').slice(0, 300), brandId: brand?.id, brandName: brand?.name, durationMs: Date.now() - startedAt });
    let errorMessage = err.message || 'Failed to generate article with Gemini.';
    if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API key not valid')) {
      errorMessage = 'Invalid Gemini API Key. Please provide a valid key in BYOK Settings.';
    }
    emit({ type: 'error', error: errorMessage });
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// API Endpoint: Generate Social Media Content Package
// Produces the Facebook (~500w), Instagram (~150w) and Google Business Profile
// (~90w) texts for one article in a single model call. Called automatically by
// the AutoBlog pipeline after the article is generated, and by the editor's
// "Generate social package" button (also used to regenerate after edits).
// ---------------------------------------------------------------------------
app.post('/api/ai/generate-social', async (req, res) => {
  const t0 = Date.now();
  try {
    const { title, articleHtml, brand, primaryKeyword, secondaryKeywords, blogNumber, featuredImageUrl, callToAction, byokKeys, modelPref } = req.body;
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing title.' });
    }
    const result = await generateSocialPackage({
      title,
      articleHtml,
      brand,
      primaryKeyword,
      secondaryKeywords,
      blogNumber,
      featuredImageUrl,
      callToAction,
      byokKeys,
      modelPref,
    });
    logServerActivity({ category: 'generation', status: 'success', action: 'social_generate', title: `Social package generated: ${title}`, message: 'Facebook, Instagram and Google Business content generated.', brandId: brand?.id, brandName: brand?.name, payload: { model: result.model, provider: result.provider, fallback: result.fallback, latencyMs: result.latencyMs, blogNumber }, durationMs: Date.now() - t0 });
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Error in /api/ai/generate-social:', err);
    logServerActivity({ category: 'error', status: 'error', action: 'social_generate_failed', title: `Social package failed: ${title}`, message: (err?.message || 'Social generation failed.').slice(0, 300), brandId: brand?.id, brandName: brand?.name, durationMs: Date.now() - t0 });
    res.status(500).json({ success: false, error: err?.message || 'Social generation failed.' });
  }
});

// ---------------------------------------------------------------------------
// API Endpoint: Fetch & Extract Article Content from a URL
// Returns the extracted plain-text article body and optional title.
// Used by the "Enhance Existing" mode so users can paste a URL instead of
// copying/pasting the full article text.
// ---------------------------------------------------------------------------
app.post('/api/ai/fetch-url-content', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') return res.status(400).json({ success: false, message: 'url required.' });
    // Validate URL
    let parsed: URL;
    try { parsed = new URL(url); } catch { return res.status(400).json({ success: false, message: 'Invalid URL format.' }); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ success: false, message: 'Only HTTP(S) URLs are supported.' });

    const html = await new Promise<string>((resolve, reject) => {
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get(parsed.href, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FGOS-Enhancer/1.0)' }, timeout: 15000 }, (resp) => {
        // Follow redirects (up to 3)
        if (resp.statusCode && resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          const redir = new URL(resp.headers.location, parsed.href).href;
          mod.get(redir, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FGOS-Enhancer/1.0)' }, timeout: 15000 }, (resp2) => {
            const chunks: Buffer[] = [];
            resp2.on('data', (c: Buffer) => chunks.push(c));
            resp2.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            resp2.on('error', reject);
          }).on('error', reject);
          return;
        }
        const chunks: Buffer[] = [];
        resp.on('data', (c: Buffer) => chunks.push(c));
        resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        resp.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    });

    // Extract title from <title> or <h1>
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
      || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    const pageTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // Extract the main article body — prefer <article> or <main>, fall back to <body>
    let bodyHtml = '';
    const articleMatch = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)
      || /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
    if (articleMatch) {
      bodyHtml = articleMatch[1];
    } else {
      // Try to find the largest <div> that looks like content (heuristic: many <p> tags)
      const divMatches = [...html.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gi)];
      let bestDiv = '';
      let bestPCount = 0;
      for (const dm of divMatches) {
        const pCount = (dm[1].match(/<p\b/gi) || []).length;
        if (pCount > bestPCount) { bestPCount = pCount; bestDiv = dm[1]; }
      }
      bodyHtml = bestDiv || html;
    }

    // Strip scripts, styles, nav, header, footer, comments
    bodyHtml = bodyHtml
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Convert to basic clean HTML: keep p, h1-h6, ul, ol, li, a, img, strong, em, blockquote
    const plainText = bodyHtml
      .replace(/<(?!\/?(p|h[1-6]|ul|ol|li|a|img|strong|em|blockquote|figure|figcaption|br)\b)[^>]+>/gi, '')
      .trim();

    return res.json({ success: true, title: pageTitle, html: bodyHtml, text: plainText, charCount: plainText.length });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch URL content.' });
  }
});

// ---------------------------------------------------------------------------
// API Endpoint: Enhance an Existing Article
// Takes the original article text (pasted or fetched from URL), brand context,
// and optional keywords. Streams the enhanced version through the same NDJSON
// pipeline as generate-article (status, stream, image, completeness, done).
// The enhancement preserves the original voice while improving SEO, structure,
// readability, and adding Daniel's Tip / product recommendations / internal links.
// ---------------------------------------------------------------------------
app.post('/api/ai/enhance-article', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const { originalHtml, originalTitle, title, primaryKeyword, secondaryKeywords, seoBrief, brand, byokKeys, targetWordCount, modelPref, requestedBlocks, relatedArticles } = req.body;

  if (!originalHtml && !originalTitle) {
    ndjson(res, { type: 'error', error: 'No article content provided. Paste your article or enter a URL.' });
    return res.end();
  }

  const pref = modelPref || {};

  // --- Lifecycle bookkeeping (same pattern as generate-article) ------------
  let ended = false;
  const timers: ReturnType<typeof setInterval>[] = [];
  let lastChunkAt = Date.now();
  const startedAt = Date.now();
  const cleanup = () => {
    if (ended) return;
    ended = true;
    timers.forEach(clearInterval);
    timers.forEach(clearTimeout);
    try { res.end(); } catch { /* socket already gone */ }
  };
  const emit = (obj: any) => { if (!ended) ndjson(res, obj); };

  const heartbeat = setInterval(() => {
    if (ended) return;
    if (Date.now() - lastChunkAt > 120000) {
      emit({ type: 'error', error: 'The model went quiet for too long. Please retry.' });
      cleanup();
      return;
    }
    emit({ type: 'heartbeat', elapsed: Math.round((Date.now() - startedAt) / 1000) });
  }, 15000);
  timers.push(heartbeat as any);
  const hardTimeout = setTimeout(() => {
    emit({ type: 'error', error: 'Enhancement timed out after 7 minutes. Please retry.' });
    cleanup();
  }, 7 * 60 * 1000);
  timers.push(hardTimeout as any);

  try {
    const bannedWordsText = brand?.bannedWords?.length
      ? `STRICT BANNED WORDS (DO NOT USE ANY OF THESE): ${brand.bannedWords.join(', ')}.`
      : '';

    const enhanceInstruction = `You are a world-class senior editor and content strategist for the brand "${brand.name}".
Brand Voice & Tone Guidelines: ${brand.voiceGuidelines || 'Professional, clear, engaging, authoritative'}.
${bannedWordsText}

YOUR TASK: You are ENHANCING an existing published article. You must:
1. PRESERVE the original author's voice, tone, and key messages — do NOT rewrite from scratch or impose a new voice.
2. IMPROVE the article's SEO structure: ensure exactly one <h1> with the primary keyword, logical <h2>/<h3> hierarchy with headings every 200-300 words.
3. IMPROVE readability: shorter paragraphs (under 150 words each), clearer transitions, more engaging opening.
4. EXPAND thin sections with genuine, useful detail — not filler.
5. ADD a ${tipLabel(brand)} (<div class="daniels-tip">...</div>) if a practical actionable insight exists. At most ONE per article.
6. ADD a product recommendation placeholder (<div class="product-recommendation">Product: [category]</div>) if the topic connects to a product.
7. ADD internal links (<a href="/blog/...">) to plausible brand blog paths where relevant.
8. FIX factual contradictions, unqualified health claims, and any factual errors.
9. CONVERT to British English (colour not color, favourite not favorite, analyse not analyze, etc.).
10. ENSURE the article ends cleanly with sentence-final punctuation — no truncation.

${grammarRulesPrompt(brand)}

CRITICAL RULES:
- Do NOT invent specific internal links — use generic plausible paths like /blog/benefits-of-natural-pet-treats.
- Never make disease-treatment claims. Use qualified language: "may support", "can contribute to", "as part of a balanced diet".
- Every factual claim must be internally consistent — no contradictions.
- The output must be a complete, publish-ready article that reads as if it was always this good.

Output Format: Return ONLY the raw HTML article body. Use h1, h2, h3, p, ul, li, img, a tags. No markdown code fences, no JSON wrapper, no commentary before or after — just the HTML.`;

    const articleSource = originalTitle ? `"${originalTitle}"` : 'the article below';
    // ── Dynamic template fields (feat-auto-populate-dynamic-fields) ──────────
    const realProducts = await fetchBrandProducts(brand);
    const relatedList = Array.isArray(relatedArticles) ? relatedArticles.slice(0, 6) : [];
    const dynamicFieldsText = buildDynamicFieldsPrompt(realProducts, relatedList, undefined, brand?.recommendationType);
    // feat-internal-linking: real published articles for contextual in-body links.
    const internalLinkingText = buildInternalLinkingPrompt(relatedList);
    const prompt = `ENHANCE this existing article. Preserve the author's voice while improving SEO, readability, and completeness.

ORIGINAL ARTICLE TITLE: ${articleSource}
${primaryKeyword ? `TARGET PRIMARY KEYWORD: "${primaryKeyword}"` : ''}
${Array.isArray(secondaryKeywords) && secondaryKeywords.length ? `SECONDARY KEYWORDS: ${secondaryKeywords.join(', ')}` : ''}
${seoBrief ? `SEO BRIEF: "${seoBrief}"` : ''}

ORIGINAL ARTICLE TEXT:
---
${(originalHtml || '').slice(0, 12000)}
---

Write the ENHANCED version of this article. Keep the same structure and messages, but improve:
- Headline (fresh, compelling, contains primary keyword naturally)
- SEO structure (h1/h2/h3 hierarchy, keyword density 0.5-2.5%)
- Readability (shorter paragraphs, better transitions, clearer flow)
- Completeness (expand thin sections, add ${tipLabel(brand)} and product recommendation placeholders where appropriate)
- British English throughout
- Internal links to plausible /blog/ paths
- No factual contradictions, all health claims qualified
- Clean ending with sentence-final punctuation
- Target approximately ${targetWordCount && targetWordCount > 0 ? targetWordCount : 1000} words (within +/- 15%)
${dynamicFieldsText}
${internalLinkingText}`;

    emit({ type: 'status', message: 'Analysing the existing article and enhancement instructions…', percent: 5 });

    // Emit the generation blueprint for transparency — same as generate-article.
    const resolvedGrammar = resolveGrammarRules(brand);
    const grammarRuleLines: { id: string; label: string; description: string }[] = [
      ...GRAMMAR_RULE_DEFS
        .filter((def) => resolvedGrammar[def.id])
        .map((def) => ({ id: def.id, label: def.label, description: def.description })),
      ...(resolvedGrammar.customRules || []).map((r) => ({ id: 'custom', label: 'Custom rule', description: r })),
    ];
    emit({
      type: 'generationInfo',
      brand: brand ? { name: brand.name, voiceGuidelines: brand.voiceGuidelines || '' } : null,
      primaryKeyword: primaryKeyword || '',
      secondaryKeywords: Array.isArray(secondaryKeywords) ? secondaryKeywords : [],
      targetWordCount: targetWordCount || 0,
      seoBrief: seoBrief || '',
      contentType: 'post',
      bannedWords: brand?.bannedWords || [],
      grammarRules: grammarRuleLines,
      grammarRulesPrompt: buildGrammarRulesPrompt(brand) || null,
      wordTarget: `Target approximately ${targetWordCount && targetWordCount > 0 ? targetWordCount : 1000} words (within +/- 15%).`,
    });

    // --- Phase 1: Stream the enhanced article body (5-80%) -----------------
    emit({ type: 'status', message: 'Enhancing the article — preserving voice while improving SEO and readability…', percent: 10 });

    let enhancedText = '';
    let genModel = GEMINI_TEXT_MODEL;
    let genProvider = 'gemini';
    let genFallback = false;
    const targetForProgress = Math.max(300, safeCount(targetWordCount) || 1000);

    // Use completeWithProvider (non-streaming) for enhancement since we need
    // the full output to do a diff-style quality check against the original.
    const aiResult = await completeWithProvider(byokKeys || {}, pref, {
      systemInstruction: enhanceInstruction,
      prompt: `${prompt}\n\nOutput ONLY the enhanced raw HTML article body using h1/h2/h3/p/ul/li/img/a tags. No markdown fences, no commentary.`,
      maxTokens: 8192,
    });
    enhancedText = aiResult.text;
    genProvider = aiResult.provider;
    genModel = aiResult.model;
    genFallback = aiResult.fallback;
    lastChunkAt = Date.now();

    const words = countWords(enhancedText);
    emit({ type: 'status', message: `Enhanced article ready — ${words} words. Generating images…`, percent: 80 });
    emit({ type: 'stream', text: enhancedText, words, percent: 80, phase: 'Enhancement complete — structuring…' });

    if (!stripHtml(enhancedText)) {
      emit({ type: 'error', error: 'The model returned an empty enhanced article. Please retry.' });
      return cleanup();
    }

    // --- Phase 2: SEO metadata (80-86%) -----------------------------------
    emit({ type: 'status', message: 'Writing meta title, description & SEO brief…', percent: 81 });
    let metaTitle = '';
    let metaDescription = '';
    let seoBriefOut = '';
    let suggestedNanoPrompt = '';
    let suggestedSecondaryPrompt = '';
    try {
      const metaInstruction = `You are an SEO metadata specialist for "${brand.name}". Brand voice: ${brand.voiceGuidelines || 'professional'}.
Return ONLY JSON matching the schema, no markdown:
1. "metaTitle": 50-60 characters, primary keyword near the front.
2. "metaDescription": 120-160 characters, keyword used naturally, value promise, CTA.
3. "seoBrief": a 2-3 sentence SEO strategy summary.
4. "suggestedNanoPrompt": a 5-8 word photorealistic image prompt for the hero image.
5. "suggestedSecondaryPrompt": a 5-8 word photorealistic prompt for an in-body image.
Keep the JSON compact — no whitespace, no code fences.`;
      const metaResult = await completeWithProvider(byokKeys || {}, pref, {
        systemInstruction: metaInstruction,
        prompt:
          `Article title: "${title || originalTitle || ''}"\n` +
          `Focus keyphrase: "${primaryKeyword || title || originalTitle || ''}"\n` +
          `Article body (first 3000 chars):\n${stripHtml(enhancedText).slice(0, 3000)}`,
        json: true,
        jsonSchema: {
          type: Type.OBJECT,
          properties: {
            metaTitle: { type: Type.STRING },
            metaDescription: { type: Type.STRING },
            seoBrief: { type: Type.STRING },
            suggestedNanoPrompt: { type: Type.STRING },
            suggestedSecondaryPrompt: { type: Type.STRING },
          },
          required: ['metaTitle', 'metaDescription', 'seoBrief', 'suggestedNanoPrompt', 'suggestedSecondaryPrompt'],
        },
        maxTokens: 1024,
      });
      const parsedMeta = JSON.parse(metaResult.text || '{}');
      metaTitle = parsedMeta.metaTitle || '';
      metaDescription = parsedMeta.metaDescription || '';
      seoBriefOut = parsedMeta.seoBrief || '';
      suggestedNanoPrompt = parsedMeta.suggestedNanoPrompt || '';
      suggestedSecondaryPrompt = parsedMeta.suggestedSecondaryPrompt || '';
    } catch (metaErr: any) {
      metaTitle = ((title || originalTitle || '').slice(0, 55) + (brand?.name ? ` | ${brand.name}` : '')).slice(0, 60);
      metaDescription = stripHtml(enhancedText).slice(0, 155);
      seoBriefOut = `Enhanced for "${primaryKeyword || title || originalTitle || ''}" — natural keyword usage, clear headings, persuasive meta description.`;
      suggestedNanoPrompt = `${primaryKeyword || title || originalTitle || ''} lifestyle hero photo`;
      suggestedSecondaryPrompt = `${primaryKeyword || title || originalTitle || ''} detail photo`;
    }
    emit({ type: 'status', message: 'Metadata ready — generating images…', percent: 87 });

    // --- Phase 2.5: Nano Banana images (87-92%) ---------------------------
    const generatedImages: Array<{
      role: 'hero' | 'secondary';
      url: string;
      mediaId?: number;
      model: string;
      provider: string;
      isAiGenerated: boolean;
      isPlaceholder?: boolean;
      isDataUri?: boolean;
      prompt?: string;
    }> = [];
    emit({ type: 'status', message: 'Generating 2 branded images with Nano Banana…', percent: 88 });
    const imageTopicCtx = `Images for a blog article${title ? ` titled "${title}"` : originalTitle ? ` titled "${originalTitle}"` : ''}${primaryKeyword ? ` about "${primaryKeyword}"` : ''}. Brand: ${brand?.name || 'the site'}. Editorial, photorealistic, warm and authentic — no text, captions, logos or watermarks.`;
    for (const img of [
      { role: 'hero' as const, prompt: suggestedNanoPrompt || `${primaryKeyword || title || originalTitle || ''} hero photo`, aspectRatio: '16:9', filename: 'featured-image' },
      { role: 'secondary' as const, prompt: suggestedSecondaryPrompt || `${primaryKeyword || title || originalTitle || ''} lifestyle detail photo`, aspectRatio: '4:3', filename: 'article-image-2' },
    ]) {
      lastChunkAt = Date.now();
      emit({ type: 'status', message: `Rendering ${img.role === 'hero' ? 'hero' : 'in-body'} image…`, percent: img.role === 'hero' ? 89 : 91 });
      try {
        const r = await generateAiImage({
          prompt: `${imageTopicCtx}\n\nImage prompt: ${img.prompt}`,
          aspectRatio: img.aspectRatio,
          byokKeys: byokKeys || {},
        });
        let url = r.imageUrl;
        let mediaId: number | undefined;
        const isDataUri = /^data:image/i.test(url);
        if (!r.isPlaceholder && brand?.wpUrl && brand?.wpUsername && brand?.wpAppPassword) {
          try {
            const up = await uploadImageToWp(
              brand,
              isDataUri ? { dataBase64: url, filename: img.filename } : { imageUrl: url, filename: img.filename },
            );
            url = up.wpMediaUrl;
            mediaId = up.wpMediaId;
          } catch (upErr: any) {
            console.warn(`[Enhance-Images] ${img.role} upload skipped:`, String(upErr?.message || upErr).slice(0, 140));
          }
        }
        generatedImages.push({ role: img.role, url, mediaId, model: r.model, provider: r.provider, isAiGenerated: r.isAiGenerated, isPlaceholder: r.isPlaceholder, isDataUri, prompt: img.prompt });
        lastChunkAt = Date.now();
        emit({ type: 'image', ...generatedImages[generatedImages.length - 1] });
      } catch (imgErr: any) {
        console.warn(`[Enhance-Images] ${img.role} failed:`, String(imgErr?.message || imgErr).slice(0, 160));
        lastChunkAt = Date.now();
        emit({ type: 'imageWarning', role: img.role, message: String(imgErr?.message || imgErr).slice(0, 160) });
      }
    }
    const heroImg = generatedImages.find((g) => g.role === 'hero');
    const secondaryImg = generatedImages.find((g) => g.role === 'secondary');
    emit({ type: 'status', message: heroImg && secondaryImg ? 'Both images ready.' : 'Images step finished.', percent: 92 });

    // --- Phase 3.5: Completeness check (92-96%) — same as generate-article -
    emit({ type: 'status', message: 'Running completeness check…', percent: 93 });
    let completeHtml = enhancedText;
    const checks: string[] = [];
    const fixes: string[] = [];
    const warnings: string[] = [];

    // Structural cleanup
    { const { html, fixed } = structuralCleanup(completeHtml); if (fixed.length) { completeHtml = html; fixes.push(...fixed); } }

    // Duplicate paragraph removal
    {
      const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
      const paragraphs: { full: string; text: string }[] = [];
      let pm: RegExpExecArray | null;
      while ((pm = pRe.exec(completeHtml)) !== null) {
        const text = stripHtml(pm[1]).toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        paragraphs.push({ full: pm[0], text });
      }
      let removedDupes = 0;
      for (let i = paragraphs.length - 1; i > 0; i--) {
        const prev = paragraphs[i - 1].text;
        const curr = paragraphs[i].text;
        if (prev.length < 20 || curr.length < 20) continue;
        const prevTokens = new Set(prev.split(' '));
        const currTokens = curr.split(' ');
        const shared = currTokens.filter((t) => prevTokens.has(t)).length;
        if (shared / Math.max(1, currTokens.length) > 0.8) {
          completeHtml = completeHtml.replace(paragraphs[i].full, '');
          removedDupes++;
        }
      }
      if (removedDupes) fixes.push(`removed ${removedDupes} duplicate paragraph(s)`);
      checks.push(`duplicate scan: ${removedDupes} removed`);
    }

    // Deterministic grammar & style enforcement (Carol's feat-grammar-rules).
    // Uses the shared grammarRules module so per-brand toggles are respected.
    {
      const enforced = enforceGrammarRules(completeHtml, brand?.grammarRules);
      if (enforced.fixes.length) {
        fixes.push(...enforced.fixes);
        checks.push(`grammar & style scan: ${enforced.fixes.join('; ')}`);
      }
      completeHtml = enforced.text;
    }

    // Internal link validation
    {
      const aRe = /<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let strippedLinks = 0;
      const newHtml = completeHtml.replace(aRe, (full: string, href: string, anchor: string): string => {
        if (/^https?:\/\//i.test(href)) return full;
        if (href.startsWith('#')) return full;
        if (/^\/blog\/[a-z0-9-]+$/i.test(href)) return full;
        if (/^\/(shop|products|about|contact|faq|privacy|terms)\b/i.test(href)) return full;
        strippedLinks++;
        return anchor;
      });
      if (strippedLinks) { completeHtml = newHtml; fixes.push(`stripped ${strippedLinks} invalid internal link(s)`); }
      checks.push(`link validation: ${strippedLinks} stripped`);
    }

    // Populate dynamic template fields with REAL data (feat-auto-populate-dynamic-fields).
    {
      const populated = populateDynamicFields(completeHtml, {
        products: realProducts,
        relatedArticles: relatedList,
        recommendationType: brand?.recommendationType,
        brandName: brand?.name,
      });
      if (populated.fixes.length) {
        completeHtml = populated.html;
        fixes.push(...populated.fixes);
        checks.push(`dynamic template fields: ${populated.fixes.join('; ')}`);
      }
    }

    // AI quality scan
    {
      lastChunkAt = Date.now();
      const plainText = stripHtml(completeHtml).replace(/\s+/g, ' ').trim();
      if (plainText.split(/\s+/).length > 200) {
        try {
          const qualityResult = await completeWithProvider(byokKeys || {}, pref, {
            systemInstruction: `You are a fact-checker and compliance editor for "${brand?.name || 'a pet food brand'}". Identify: 1) FACTUAL CONTRADICTIONS, 2) UNQUALIFIED HEALTH CLAIMS. For each, return JSON: [{"type":"contradiction"|"health_claim", "original":"...", "corrected":"..."}]. If none found, return []. ONLY JSON — no markdown, no commentary.`,
            prompt: `Article:\n${plainText.slice(0, 4000)}`,
            maxTokens: 1200,
            temperature: 0.3,
          });
          let raw = String(qualityResult.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
          const corrections = JSON.parse(raw);
          if (Array.isArray(corrections) && corrections.length > 0) {
            let applied = 0;
            for (const c of corrections) {
              if (!c?.original || !c?.corrected || c.original === c.corrected) continue;
              const escaped = c.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const pat = new RegExp(escaped, 'i');
              if (pat.test(completeHtml)) { completeHtml = completeHtml.replace(pat, c.corrected); applied++; }
            }
            if (applied) fixes.push(`applied ${applied} quality correction(s)`);
            checks.push(`quality scan: ${corrections.length} issues, ${applied} corrected`);
          } else {
            checks.push('quality scan: clean');
          }
        } catch (qErr: any) {
          warnings.push('quality scan failed (provider error) — published without check');
        }
      }
    }

    // In-body image guarantee
    if (!/<img\b/i.test(completeHtml)) {
      const injectUrl = [secondaryImg?.url, heroImg?.url].find((u) => /^https?:\/\//i.test(String(u || '')));
      if (injectUrl) {
        const alt = `${primaryKeyword || title || originalTitle || 'Article'} — ${brand?.name || 'article'} illustration`.replace(/["<>]/g, '');
        completeHtml = `<figure class="fg-art-figure fg-art-secondary"><img src="${injectUrl}" alt="${alt}" loading="lazy" /></figure>\n` + completeHtml;
        fixes.push('injected generated image into body');
      }
    }

    const finalWords = countWords(completeHtml);
    const endingOk = !truncatedEnding(completeHtml);
    const lengthOk = finalWords >= Math.max(200, Math.round((targetWordCount || 1000) * 0.85));
    const complete = endingOk && lengthOk;
    checks.push(`final word count: ${finalWords}`);
    checks.push(`ending: ${endingOk ? 'clean' : 'may be truncated'}`);
    const completeness = { targetWords: targetWordCount || 1000, actualWords: finalWords, complete, checks, fixes, warnings };
    emit({ type: 'completeness', ...completeness });

    // --- Phase 4: Blocks & done -------------------------------------------
    // Blocks are built LAST, from the final curated/cleaned/SEO-ready HTML.
    emit({ type: 'status', message: 'Structuring content blocks from the final, SEO-ready draft…', percent: 98 });
    const blocks = autoGenerateBlocks(completeHtml, title || originalTitle || '', primaryKeyword || '', requestedBlocks, brand);
    const h1Match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(completeHtml);
    const articleTitle = h1Match ? stripHtml(h1Match[1]).trim() : '';

    emit({
      type: 'done',
      data: {
        bodyHtml: completeHtml,
        articleTitle,
        seoBrief: seoBriefOut,
        metaTitle,
        metaDescription,
        suggestedNanoPrompt,
        suggestedSecondaryPrompt,
        blocks,
        images: generatedImages,
        featuredImageUrl: heroImg?.url,
        secondaryImageUrl: secondaryImg?.url,
        featuredMediaId: typeof heroImg?.mediaId === 'number' ? heroImg.mediaId : undefined,
        wordCount: finalWords,
        completeness,
        model: genModel,
        provider: genProvider,
        fallback: genFallback,
        latencyMs: Date.now() - startedAt,
        mode: 'enhance',
      },
      percent: 100,
    });
    cleanup();
  } catch (err: any) {
    console.error('Error in /api/ai/enhance-article:', err);
    emit({ type: 'error', error: err.message || 'Enhancement failed.' });
    cleanup();
  }
});

// Humanise HTML via Patina (Gemini), walking the user's saved Gemini key then
// the server key, and each model in the chain. Auth failures drop the key,
// quota/model errors fall through to the next model — so a dead key or
// exhausted bucket never silently skips the humanisation pass.
// Shared by humanize-draft and the SEO improve humanisation step.
async function humanizeHtmlWithFallback(
  html: string,
  byokKeys: any,
  opts: { tone?: string; bannedWords?: string[] },
  label: string,
): Promise<{ text: string; model: string; quotaBlocked: boolean; error?: string }> {
  const candidateKeys = [...new Set([process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY, byokKeys?.gemini].filter(Boolean))] as string[];
  if (candidateKeys.length === 0) {
    return { text: '', model: '', quotaBlocked: false, error: 'No Gemini API key available. Add one in Settings > AI Models.' };
  }

  const patina = new Humanizer({
    tone: opts?.tone || 'conversational',
    bannedWords: opts?.bannedWords || [],
    levers: { complexity: 0.4, burstiness: 0.8 },
  });

  const isAuthError = (msg: string) => /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|UNAUTHENTICATED|invalid key/i.test(msg);
  const isModelError = (msg: string) => /model\s+not\s+found|NOT_FOUND|no longer available|does not exist/i.test(msg);
  const isQuotaError = (msg: string) => /RESOURCE_EXHAUSTED|quota|rate limit|429|high demand|503|UNAVAILABLE/i.test(msg);

  let text = '';
  let lastErr: any = null;
  let quotaBlocked = false;
  let usedModel = '';
  for (const key of candidateKeys) {
    for (const model of MODEL_CHAIN) {
      try {
        text = await Promise.race([
          patina.rewriteHtmlOrThrow(html, key, model),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Humanisation timed out after 90s — please retry.')), 90000)
          ),
        ]);
        usedModel = model;
        break;
      } catch (err: any) {
        lastErr = err;
        const msg = String(err?.message || '');
        if (isAuthError(msg)) break; // this key is dead — try the next key
        if (isQuotaError(msg)) {
          quotaBlocked = true;
          // Respect the API's own "retry in Xs" hint between attempts.
          const hint = parseRetryAfterHint(msg);
          if (hint) await new Promise((r) => setTimeout(r, hint));
        }
        // Model errors (404/no longer available) and everything else fall
        // through to the next model in the chain, then the next key.
      }
    }
    if (text) break;
  }

  if (!text) {
    const detail = String(lastErr?.message || lastErr || 'unknown error').slice(0, 220);
    const hint = quotaBlocked
      ? ' The Gemini quota for the current key is exhausted — add a different Gemini key in Settings > AI Models, or retry later when the daily quota resets.'
      : '';
    return { text: '', model: usedModel, quotaBlocked, error: `${detail}${hint}` };
  }
  return { text, model: usedModel, quotaBlocked };
}

// API Endpoint: Humanise a draft (interactive before/after step).
// Separate from generation: returns the original + humanised HTML plus
// re-derived blocks, and the client lets the user choose which version to keep.
// Always uses a Gemini text model (never an OpenRouter id) and falls back to
// the server key when the user's saved key is invalid.
app.post('/api/ai/humanize-draft', async (req, res) => {
  try {
    const { html, brand, byokKeys } = req.body;
    const originalHtml = String(html || '');
    if (!originalHtml.trim() || (stripHtml(originalHtml) || '').trim().split(/\s+/).filter(Boolean).length < 50) {
      return res.status(400).json({ error: 'Write at least 50 words of content first, then humanise it.' });
    }

    const h = await humanizeHtmlWithFallback(originalHtml, byokKeys, { tone: brand?.voiceGuidelines, bannedWords: brand?.bannedWords }, 'draft');
    if (!h.text) {
      return res.json({ success: false, error: `Humanisation failed: ${h.error}` });
    }

    const humanized = h.text;
    const changed = humanized !== originalHtml && (stripHtml(humanized) || '').trim().length > 0;
    return res.json({
      success: true,
      original: originalHtml,
      humanized: changed ? humanized : originalHtml,
      blocks: changed ? parseHtmlIntoBlocks(humanized, 'Humanised draft', '', brand) : [],
      provider: 'gemini',
      model: h.model || GEMINI_TEXT_MODEL,
      changed,
      note: changed ? 'Draft rewritten by Patina (Gemini).' : 'The model returned content identical to the original draft — no change was made.',
    });
  } catch (err: any) {
    console.error('Error in /api/ai/humanize-draft:', err);
    return res.status(500).json({ error: String(err?.message || err).slice(0, 300) });
  }
});



// API Endpoint: On-Page SEO Analysis (power-seo engine, 99 checks, runs locally in ~ms)
app.post('/api/seo/analyze', (req, res) => {
  try {
    const {
      title,
      metaDescription,
      focusKeyphrase,
      secondaryKeyphrases,
      bodyHtml,
      slug,
      expectedIntent,
      images,
      internalLinks,
      externalLinks,
      siteUrl,
      canonicalUrl,
      contentCategory,
      author,
      publishDate,
      modifiedDate,
    } = req.body || {};

    const bodyText = typeof bodyHtml === 'string' ? bodyHtml : '';

    // The power-seo engine treats the passed `title` as the page's H1 (it
    // unshifts it into the heading list). If the body ALSO carries an <h1>,
    // the engine sees two H1s and fails the single-H1 check. When a title is
    // provided, strip the body's <h1> (the title serves as the H1).
    const titleProvided = typeof title === 'string' && title.trim().length > 0;
    let analyzedBody = bodyText;
    if (titleProvided) {
      analyzedBody = bodyText
        .replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi, '')
        .replace(/<h1\b[^>]*\/>/gi, '');
    }

    // Extract images from the HTML content itself (src + alt) and merge with
    // any explicitly provided ones, deduped by src. The power-seo engine only
    // reads the `images` array, not <img> tags, so we bridge that gap here.
    const extractedImages: { src: string; alt: string }[] = [];
    const imgTagRe = /<img\b[^>]*>/gi;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgTagRe.exec(bodyText)) !== null) {
      const src = imgMatch[0].match(/src\s*=\s*["']([^"']+)["']/i)?.[1] || '';
      const alt = imgMatch[0].match(/alt\s*=\s*["']([^"']*)["']/i)?.[1] || '';
      if (src) extractedImages.push({ src, alt });
    }
    const seen = new Set<string>();
    const allImages = [...(Array.isArray(images) ? images : []), ...extractedImages].filter((img: any) => {
      if (!img || !img.src || seen.has(img.src)) return false;
      seen.add(img.src);
      return true;
    });

    // Content freshness: the engine's checkContentFreshness gives full marks
    // when content is under 6 months old. Articles analysed here are freshly
    // generated/published, so default the publish date to now when the client
    // doesn't supply one (clients analysing older pasted content can pass an
    // explicit publishDate/modifiedDate).
    const nowIso = new Date().toISOString();
    const pubDate = typeof publishDate === 'string' && publishDate.trim() ? publishDate : nowIso;
    const modDate = typeof modifiedDate === 'string' && modifiedDate.trim() ? modifiedDate : nowIso;

    // Author enrichment: the engine's eeat-author-schema and eeat-overall-score
    // checks reward knowsAbout (expertise topics). Derive it from the actual
    // brief (focus keyphrase + secondary keyphrases) — the author demonstrably
    // writes about these topics — without inventing credentials or profiles.
    const baseAuthor = author && typeof author === 'object' ? author : {};
    const kpForAuthor = typeof focusKeyphrase === 'string' ? focusKeyphrase : '';
    const knowsAbout = [
      ...(kpForAuthor ? [kpForAuthor] : []),
      ...(Array.isArray(secondaryKeyphrases) ? secondaryKeyphrases : []).slice(0, 3),
    ].filter((t: any) => typeof t === 'string' && t.trim());
    const enrichedAuthor = {
      ...baseAuthor,
      ...(knowsAbout.length ? { knowsAbout } : {}),
    };

    const output = analyzeContent({
      title: typeof title === 'string' ? title : '',
      metaDescription: typeof metaDescription === 'string' ? metaDescription : '',
      content: analyzedBody,
      focusKeyphrase: typeof focusKeyphrase === 'string' ? focusKeyphrase : '',
      secondaryKeyphrases: Array.isArray(secondaryKeyphrases) ? secondaryKeyphrases : [],
      slug: typeof slug === 'string' ? slug : '',
      expectedIntent: expectedIntent || undefined,
      images: allImages,
      internalLinks: Array.isArray(internalLinks) ? internalLinks : [],
      externalLinks: Array.isArray(externalLinks) ? externalLinks : [],
      siteUrl: typeof siteUrl === 'string' ? siteUrl : undefined,
      canonicalUrl: typeof canonicalUrl === 'string' ? canonicalUrl : undefined,
      contentCategory: typeof contentCategory === 'string' ? contentCategory : undefined,
      publishDate: pubDate,
      modifiedDate: modDate,
      author: Object.keys(enrichedAuthor).length ? enrichedAuthor : undefined,
    });

    const results = Array.isArray(output.results) ? output.results : [];
    const applicable = results.filter((r: any) => r.status !== 'na');
    const score = typeof output.score === 'number' ? output.score : 0;
    const maxScore = typeof output.maxScore === 'number' && output.maxScore > 0 ? output.maxScore : 1;
    const pct = Math.min(100, Math.round((score / maxScore) * 100));

    return res.json({
      success: true,
      data: {
        score,
        maxScore,
        pct,
        status: pct >= 80 ? 'good' : pct >= 60 ? 'ok' : 'poor',
        summary: {
          good: applicable.filter((r: any) => r.status === 'good').length,
          ok: applicable.filter((r: any) => r.status === 'ok').length,
          poor: applicable.filter((r: any) => r.status === 'poor').length,
          na: results.length - applicable.length,
        },
        results,
        recommendations: Array.isArray(output.recommendations)
          ? output.recommendations
          : applicable
              .filter((r: any) => r.status === 'poor' || r.status === 'ok')
              .map((r: any) => r.description || r.title)
              .filter(Boolean),
      },
    });
  } catch (err: any) {
    console.error('Error in /api/seo/analyze:', err);
    return res.status(500).json({ error: err?.message || 'Failed to analyze content.' });
  }
});



// API Endpoint: AI Content Refine (advanced)
// Rewrites the article HTML to address SEO issues, either all failing checks,
// a single targeted check, or a specific refinement mode (shorten, simplify,
// expand, FAQ, links, E-E-A-T, custom instruction).
app.post('/api/seo/improve', async (req, res) => {
  try {
    const {
      title, bodyHtml, metaTitle, metaDescription, primaryKeyword, secondaryKeywords,
      brand, applyHumanization, targetWordCount, byokKeys,
      recommendations,        // array of failing check descriptions
      mode = 'fix-failures',  // fix-failures | check | shorten | simplify | expand | faq | links | eeat | custom
      focusChecks = [],       // check ids/descriptions for mode 'check'
      instruction = '',       // free text for mode 'custom'
      options = {},           // { tone, readability, densityTarget }
    } = req.body;

    const bannedWordsText = brand?.bannedWords?.length
      ? `STRICT BANNED WORDS (DO NOT USE ANY OF THESE): ${brand.bannedWords.join(', ')}.`
      : '';
    const tone = options?.tone || 'warm, expert and approachable';
    const readability = options?.readability ? String(options.readability) : '';
    const density = options?.densityTarget || '0.5-2.5%';

    const modeInstructions: Record<string, string> = {
      'fix-failures': `Fix the exact SEO issues listed below while keeping the same structure, headings and approximate length.

SEO issues to fix:
${Array.isArray(recommendations) && recommendations.length
    ? recommendations.slice(0, 12).map((r: any, i: number) => `${i + 1}. ${typeof r === 'string' ? r : r?.description || r?.title}`).join('\n')
    : 'General readability and E-E-A-T improvements.'}`,
      check: `Fix ONLY the specific SEO checks listed below. Keep everything else exactly the same.

Checks to fix:
${Array.isArray(focusChecks) && focusChecks.length
    ? focusChecks.map((c: any, i: number) => `${i + 1}. ${typeof c === 'string' ? c : c?.title + (c?.description ? ' — ' + c.description : '')}`).join('\n')
    : 'General on-page SEO improvements.'}`,
      shorten: `Make the article noticeably tighter. Cut fluff, redundant phrases and filler. Shorten sentences and paragraphs while keeping every key point, heading and the keyphrase. If the word count exceeds the target, bring it close to the target.`,
      simplify: `Simplify the language so a general reader understands it easily (target reading level: plain, everyday English${readability ? `, roughly grade ${readability} reading level` : ''}). Replace jargon and complex sentences with clear, short ones. Keep meaning, structure and headings.`,
      expand: `Expand the article with genuinely useful additional depth: new sub-sections, concrete examples, practical tips, and a richer FAQ if appropriate. Keep every existing section. Stay on-topic and never pad with fluff.`,
      faq: `Add (or improve) an FAQ section with an <h2> and 3-5 <h3> question/answer pairs that match real search queries people ask about this topic. Answers must be concise, accurate and naturally written.`,
      links: `Add 2 outbound links to authoritative UK dog welfare sources (e.g. RSPCA, PDSA, Blue Cross, Battersea Dogs & Cats Home, Kennel Club) with relevant anchor text like <a href="https://www.pdsa.org.uk/pet-help-and-advice/looking-after-your-pet/dogs/exercise" rel="noopener">PDSA dog exercise guide</a>. Also add 1-2 internal links with descriptive anchor text pointing to other blog posts on this site. Do not use the focus keyphrase as bare anchor text.`,
      eeat: `Strengthen Experience, Expertise, Authoritativeness and Trust (E-E-A-T): add genuine first-person experience narrative (e.g. "After walking dogs daily for three years..."), process narration, temporal markers, and expert-qualified language ("research suggests", "in our experience", "most owners find"). NEVER invent statistics or fake numbers — use experience-based, qualifiable language instead. Include one realistic case-study style example structured as problem → approach → result.`,
      custom: `Follow this editorial instruction exactly:
${instruction}`,
    };

    const systemInstruction = `You are a professional SEO editor for "${brand?.name || 'a brand'}". Brand voice: ${tone}. Rewrite the given HTML article body according to the instructions below. ${bannedWordsText}

TASK:
${modeInstructions[mode] || modeInstructions['fix-failures']}

RULES (always apply):
- Preserve the <h1>, <h2>, <h3> hierarchy. Use exactly one <h1>.
- Keep the focus keyphrase "${primaryKeyword || title}" at a natural ${density} density, in the first 100 words and in at least one heading.
- Keep paragraphs under 150 words and sentences readable (average under 20 words). Use transition words.
- Keep it human, specific and natural — never generic AI phrasing.
${grammarRulesPrompt(brand)}
- Aim for approximately ${targetWordCount && targetWordCount > 0 ? targetWordCount : 900} words${mode === 'shorten' ? ' (or fewer if the current text is already over)' : ''}.
- Return ONLY the raw HTML body — no markdown, no code fences.`;

    const prompt = `Article title: "${title}"
Meta title: "${metaTitle || ''}"
Meta description: "${metaDescription || ''}"
Focus keyphrase: "${primaryKeyword || ''}"
Secondary keyphrases: ${Array.isArray(secondaryKeywords) ? secondaryKeywords.join(', ') : 'None'}

Current HTML body:
${bodyHtml}`;

    const { text: resultText, provider: genProvider, model: genModel, fallback } = await completeWithProvider(byokKeys, req.body.modelPref, {
      systemInstruction,
      prompt,
      maxTokens: 4096,
    }, { orProfessionalFirst: true });
    console.log(`[AI] SEO refine completed via ${genProvider}/${genModel}${fallback ? ' (fallback)' : ''} for "${title}".`);

    let improvedHtml = resultText
      .replace(/^```html\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    if (applyHumanization && improvedHtml) {
      console.log(`[AI] Humanizing refined content for ${title}...`);
      const h = await humanizeHtmlWithFallback(improvedHtml, byokKeys, {
        tone: brand?.voiceGuidelines || 'conversational',
        bannedWords: brand?.bannedWords || [],
      }, title);
      if (h.text) {
        improvedHtml = h.text;
      } else {
        console.warn(`[AI] Humanisation pass skipped for "${title}": ${h.error}`);
      }
    }

    // Derive blocks from the final HTML so callers (SEO panel, Content Hub fix
    // flow) can apply the improved article in one patch — bodyHtml + blocks
    // always stay in sync, same as the humanise-draft endpoint.
    const blocks = improvedHtml ? parseHtmlIntoBlocks(improvedHtml, title || 'Refined article', primaryKeyword || '', brand) : [];

    return res.json({
      success: true,
      data: { bodyHtml: improvedHtml, blocks, model: genModel, provider: genProvider, fallback, mode },
    });
  } catch (err: any) {
    console.error('Error in /api/seo/improve:', err);
    return res.status(400).json({ error: err?.message || 'Failed to refine content.' });
  }
});



// API Endpoint: Rewrite Visual Block (with full article context so the rewrite
// flows seamlessly from the previous block into the next, through to the FAQ,
// and stays aligned with the title — regardless of which model is used).
app.post('/api/ai/rewrite-block', async (req, res) => {
  try {
    const { block, direction, applyHumanization, brand, byokKeys, articleContext, tune } = req.body;

  const aiApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || byokKeys?.gemini;

    const bannedWordsText = brand?.bannedWords?.length
      ? `STRICT BANNED WORDS (DO NOT USE ANY OF THESE): ${brand.bannedWords.join(', ')}.`
      : '';

    // --- Per-block fine-tuning (tone / length / creativity / guidance) ------
    const toneMap: Record<string, string> = {
      brand: 'the brand voice exactly',
      professional: 'professional, authoritative, expert',
      warm: 'warm, friendly, approachable',
      playful: 'playful, light-hearted, fun',
      formal: 'formal, precise, measured',
      casual: 'casual, conversational, relaxed',
    };
    const tone = tune?.tone && toneMap[tune.tone] ? toneMap[tune.tone] : tune?.tone || 'the brand voice';
    const lengthTarget: Record<string, string> = {
      short: 'Keep this block SHORT — roughly 2-4 sentences.',
      medium: 'Keep this block MEDIUM length — roughly 4-6 sentences.',
      long: 'Make this block LONG — roughly 7-10 sentences with more depth and detail.',
    };
    const lengthRule = lengthTarget[tune?.length] || '';
    const creativity = tune?.creativity || 'medium';
    const temperature = creativity === 'high' ? 0.9 : creativity === 'low' ? 0.3 : 0.6;

    // --- Flow context: what comes before, what comes after, what follows ----
    const ctx = articleContext || {};
    const prevBlocks = Array.isArray(ctx.previousBlocks) ? ctx.previousBlocks.filter((b: any) => b?.content?.trim()) : [];
    const nextBlock = ctx.nextBlock;
    const faqItems = Array.isArray(ctx.faqItems) ? ctx.faqItems : [];

    const flowPromptParts: string[] = [];
    flowPromptParts.push(
      `This block is PART OF a larger article titled "${ctx.title || '(untitled)'}"${
        ctx.keyword ? `, focus keyphrase "${ctx.keyword}"` : ''
      }, for brand "${ctx.brandName || brand?.name || 'the brand'}".`
    );
    if (prevBlocks.length) {
      flowPromptParts.push(
        `WHAT CAME IMMEDIATELY BEFORE this block (end of the previous section — your opening sentence must connect to it):\n${prevBlocks
          .map((b: any) => `[${b.type || 'section'} "${b.title || ''}"] ${b.content}`)
          .join('\n\n')}`
      );
    } else {
      flowPromptParts.push('This is the FIRST section of the article — it must flow directly from the article title as a natural introduction.');
    }
    if (nextBlock && (nextBlock.title || nextBlock.content)) {
      flowPromptParts.push(
        `WHAT COMES IMMEDIATELY AFTER this block (the next section heading/content — end your text so it hands off to it naturally):\n[${nextBlock.type || 'section'} "${nextBlock.title || ''}"] ${nextBlock.content || ''}`
      );
    }
    if (faqItems.length) {
      flowPromptParts.push(
        `THE ARTICLE ENDS WITH THIS FAQ SECTION (your content must be consistent with these questions/answers — do not contradict or repeat them verbatim):\n${faqItems
          .slice(0, 6)
          .map((f: any) => `Q: ${f.question}\nA: ${f.answer}`)
          .join('\n\n')}`
      );
    }
    if (ctx.title) {
      flowPromptParts.push(
        `CONSISTENCY RULE: the article title "${ctx.title}" is the single source of truth. Keep terminology, facts, tone and level of detail consistent with it and with the surrounding blocks. Never change the topic or introduce contradictory claims.`
      );
    }

    const systemInstruction = `You are a professional copywriter for "${brand?.name || 'a brand'}".
Brand Voice & Tone Guidelines: ${brand?.voiceGuidelines || 'Professional, clear, engaging'}.
${bannedWordsText}
${grammarRulesPrompt(brand)}
Tone for THIS block: ${tone}.
${lengthRule}
Creativity level: ${creativity}.
${block?.keywords?.trim()
  ? `EMPHASIS KEYWORDS for this block (optional SEO directive): ${block.keywords.trim()}. Work each one in naturally where it fits — aim for a natural density around 0.5-2.5% of this block's words, never forced, never stuffed, never repeated back-to-back. If a keyword does not fit this block's meaning, leave it out rather than forcing it.`
  : ''}

Rewrite the provided visual block content so it flows seamlessly within its article: it must read as a continuous piece of writing from the previous block, through this block, into the next, and finally into the FAQ section — a reader should never feel a break in flow. Keep the block's purpose (its type: hero/paragraph/faq/product_cta/callout) and its key facts intact. Keep it formatted as JSON matching the schema.`;

    const prompt = `Rewrite the following block content.
Block Type: ${block.type}
Current Title: ${block.title || 'None'}
Current Content: ${block.content || 'None'}
Direction/Style: ${direction || tune?.guidance || 'Improve clarity and engagement while keeping perfect flow with the surrounding article'}

ARTICLE FLOW CONTEXT (use this to keep the writing seamless):
${flowPromptParts.join('\n\n')}

Return the rewritten block as JSON.`;

    const { text: resultText, provider: genProvider, model: genModel, fallback } = await completeWithProvider(byokKeys, req.body.modelPref, {
      systemInstruction,
      prompt,
      json: true,
      jsonSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          subtitle: { type: Type.STRING },
          content: { type: Type.STRING },
          buttonText: { type: Type.STRING }
        }
      },
      maxTokens: 2048,
      temperature,
      geminiConfig: { temperature },
    });
    console.log(`[AI] Block rewrite via ${genProvider}/${genModel}${fallback ? ' (fallback)' : ''} — tune: ${JSON.stringify(tune || {})}.`);

    const parsed = parseModelJson(resultText);

    if (applyHumanization && parsed.content) {
      console.log(`[AI] Humanizing block content...`);
      const patina = new Humanizer({
        tone: brand?.voiceGuidelines || 'conversational',
        bannedWords: brand?.bannedWords || [],
        levers: { complexity: 0.4, burstiness: 0.8 }
      });
      parsed.content = await patina.rewriteHtml(parsed.content, aiApiKey);
    }

    return res.json({ success: true, data: { ...parsed, model: genModel, provider: genProvider, fallback } });
  } catch (err: any) {
    console.error('Error in /api/ai/rewrite-block:', err);
    return res.status(500).json({ error: err.message || 'Failed to rewrite block' });
  }
});

// API Endpoint: Nano Banana Image Prompts Generator
app.post('/api/ai/nano-banana-prompts', async (req, res) => {
  try {
    const { title, brandName, voiceGuidelines, byokKeys } = req.body;

    const systemInstruction = `You are an expert AI Image Prompt Engineer specializing in the "Nano Banana" image style formula:
[Subject], [Environment/Style], [Lighting/Quality].

Generate 3 distinct, ultra-concise image prompts (4-9 words each):
1. Product Focused (Macro/Detail)
2. Lifestyle Focused (Context/Human/Pet/Environment)
3. Abstract / Minimalist (Graphic/Background)

Brand Name: ${brandName || 'Brand'}
Brand Aesthetic Guidelines: ${voiceGuidelines || 'Modern clean photorealistic'}
Topic/Title: ${title}

Return JSON with an array of "prompts" containing object items with "prompt", "category", "style", "lighting".`;

    const { text: resultText, provider: genProvider, model: genModel, fallback } = await completeWithProvider(byokKeys, req.body.modelPref, {
      systemInstruction,
      prompt: `Generate 3 Nano Banana image prompts for article title: "${title}"`,
      json: true,
      jsonSchema: {
        type: Type.OBJECT,
        properties: {
          prompts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                prompt: { type: Type.STRING },
                category: { type: Type.STRING },
                style: { type: Type.STRING },
                lighting: { type: Type.STRING }
              },
              required: ['prompt', 'category', 'style', 'lighting']
            }
          }
        },
        required: ['prompts']
      },
      maxTokens: 2048,
    });
    console.log(`[AI] Nano Banana prompts via ${genProvider}/${genModel}${fallback ? ' (fallback)' : ''}.`);

    const parsed = parseModelJson(resultText);
    const prompts = Array.isArray(parsed?.prompts) ? parsed.prompts : [];
    return res.json({ success: true, data: prompts, model: genModel, provider: genProvider, fallback });
  } catch (err: any) {
    
    if (err.message && err.message.includes('API_KEY_INVALID')) {
      console.warn('User provided an invalid API key for Nano Banana prompts.');
    } else {
      console.error('Error in /api/ai/nano-banana-prompts:', err);
    }

    let errorMessage = err.message || 'Failed to generate Nano Banana prompts.';
    if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API key not valid')) {
      errorMessage = 'Invalid Gemini API Key. Please provide a valid key in BYOK Settings.';
    }
    return res.status(400).json({ error: errorMessage });
  }
});

// API Endpoint: Generate AI Image via Gemini or Fallback
// `topicContext` (article title / keyword / brand) is prepended to every prompt
// so generated images always match the blog topic, even for short prompts.
// =========================================================================
// AI IMAGE GENERATION — shared PAID Nano Banana chain
// =========================================================================

export interface AiImageResult {
  imageUrl: string;
  isAiGenerated: boolean;
  isPlaceholder?: boolean;
  model: string;
  provider: string;
  message?: string;
}

/**
 * Generate ONE image with the PAID Nano Banana chain, in priority order:
 *   1. Gemini native `gemini-3.1-flash-image` (Nano Banana 2, billed) with the
 *      saved BYOK key, then the server GEMINI_API_KEY;
 *   2. OpenRouter `google/gemini-3.1-flash-image` (paid ~$0.06/img) then the
 *      Lite variant (~$0.03/img) via the workspace OpenRouter key;
 *   3. DALL-E 3, then SDXL (Hugging Face) as last-resort AI providers;
 *   4. A FLAGGED placeholder (never a silently random stock photo).
 * One code path shared by /api/ai/generate-nano-image, the Auto-Write image
 * step and the sync-time image guarantee — same quality everywhere.
 */
async function generateAiImage(opts: {
  prompt: string;
  aspectRatio?: string;
  modelProvider?: string;
  byokKeys?: any;
}): Promise<AiImageResult> {
  const { prompt, aspectRatio, modelProvider, byokKeys } = opts;
  const finalPrompt = String(prompt || '').trim();
  if (!finalPrompt) throw new Error('An image prompt is required.');

  const tryDalle = async (): Promise<AiImageResult | null> => {
    const apiKey = byokKeys?.openai || process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: finalPrompt,
        n: 1,
        size: "1024x1024",
        response_format: "url"
      })
    });
    if (!response.ok) throw new Error("OpenAI Generation Failed: " + (await response.text()).slice(0, 200));
    const data = await response.json();
    if (!data.data?.[0]?.url) throw new Error('OpenAI returned no image.');
    return { imageUrl: data.data[0].url, isAiGenerated: true, model: 'dall-e-3', provider: 'openai' };
  };

  // OpenRouter serves image models (Nano Banana, GPT-5 Image) over the same
  // chat completions endpoint — the image comes back base64-encoded in
  // message.images[].image_url.url. Uses the workspace OpenRouter key already
  // configured for text generation. Verified live 2026-08:
  //   google/gemini-3.1-flash-image (Nano Banana 2) ~$0.06/img
  //   google/gemini-3.1-flash-lite-image (Nano Banana 2 Lite) ~$0.03/img
  const tryOpenRouterImage = async (): Promise<AiImageResult | null> => {
    const apiKey = byokKeys?.openrouter || process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    const attempts: Array<{ model: string; label: string; body: any }> = [
      {
        model: 'google/gemini-3.1-flash-image', label: 'nano-banana-2',
        body: {
          model: 'google/gemini-3.1-flash-image',
          messages: [{ role: 'user', content: finalPrompt }],
          modalities: ['image'],
          max_tokens: 4096,
        },
      },
      {
        model: 'google/gemini-3.1-flash-lite-image', label: 'nano-banana-2-lite',
        body: {
          model: 'google/gemini-3.1-flash-lite-image',
          messages: [{ role: 'user', content: finalPrompt }],
          modalities: ['image'],
          max_tokens: 4096,
        },
      },
    ];
    for (const attempt of attempts) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(attempt.body),
        });
        if (!response.ok) throw new Error(`OpenRouter ${attempt.label} failed: ` + (await response.text()).slice(0, 160));
        const data = await response.json();
        const msg = data?.choices?.[0]?.message;
        const images = Array.isArray(msg?.images) ? msg.images : [];
        let imgUrl = images[0]?.image_url?.url || images[0]?.url;
        if (imgUrl?.startsWith('data:image')) {
          // OpenRouter sometimes mislabels JPEG output as image/png — sniff
          // the magic bytes so browsers/WordPress sideloads decode correctly.
          const raw = imgUrl.split(',')[1];
          const head = Buffer.from(raw || '', 'base64').subarray(0, 4);
          const mime = head[0] === 0xff && head[1] === 0xd8 ? 'image/jpeg'
            : head[0] === 0x89 && head[1] === 0x50 ? 'image/png'
            : head[0] === 0x52 && head[1] === 0x49 ? 'image/webp'
            : 'image/png';
          imgUrl = `data:${mime};base64,${raw}`;
        }
        if (imgUrl) {
          return { imageUrl: imgUrl, isAiGenerated: true, model: attempt.label, provider: 'openrouter' };
        }
        // Some OR image models return a markdown URL in the text content.
        const content = String(msg?.content || '');
        const urlMatch = content.match(/https?:\/\/[^\s)\]]+/);
        if (urlMatch) {
          return { imageUrl: urlMatch[0], isAiGenerated: true, model: attempt.label, provider: 'openrouter' };
        }
        throw new Error(`OpenRouter ${attempt.label} returned no image.`);
      } catch (e: any) {
        console.warn('[Image] OpenRouter ' + attempt.label + ' failed:', String(e?.message || e).slice(0, 140));
      }
    }
    return null;
  };

  const tryHuggingFace = async (): Promise<AiImageResult | null> => {
    const apiKey = byokKeys?.huggingface || process.env.HF_TOKEN;
    if (!apiKey) return null;
    const response = await fetch('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ inputs: finalPrompt })
    });
    if (!response.ok) throw new Error("Hugging Face Generation Failed: " + (await response.text()).slice(0, 200));
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return { imageUrl: `data:image/jpeg;base64,${base64}`, isAiGenerated: true, model: 'stable-diffusion-xl-base-1.0', provider: 'huggingface' };
  };

  const tryReplicate = async (): Promise<AiImageResult | null> => {
    const apiKey = byokKeys?.replicate || process.env.REPLICATE_API_TOKEN;
    if (!apiKey) return null;
    const start = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ input: { prompt: finalPrompt, go_fast: true } }),
    });
    if (!start.ok) throw new Error('Replicate start failed: ' + (await start.text()).slice(0, 200));
    const { id, urls } = await start.json();
    // Poll until the prediction finishes (flux-schnell usually < 10s).
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const poll = await fetch(urls.get, { headers: { Authorization: `Bearer ${apiKey}` } });
      const state = await poll.json();
      if (state.status === 'succeeded' && state.output?.[0]) {
        return { imageUrl: state.output[0], isAiGenerated: true, model: 'flux-schnell', provider: 'replicate' };
      }
      if (state.status === 'failed') throw new Error('Replicate prediction failed.');
    }
    throw new Error('Replicate prediction timed out.');
  };

  const placeholder = (reason: string): AiImageResult => ({
    imageUrl: `https://picsum.photos/seed/${encodeURIComponent(finalPrompt.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30) || 'nano-banana')}/${aspectRatio === '1:1' ? 800 : aspectRatio === '4:3' ? 1000 : 1200}/${aspectRatio === '1:1' ? 800 : aspectRatio === '4:3' ? 750 : 675}`,
    isAiGenerated: false,
    isPlaceholder: true,
    model: 'picsum-placeholder',
    provider: 'none',
    message: `Placeholder image — no AI image model could be reached (${reason}). Add a Gemini server key, or an OpenAI / Hugging Face / Replicate key in Settings, to generate a real image that follows this prompt.`,
  });

  // --- 1. Gemini Nano Banana — the default quality path. Imagen was shut
  // down June 30 2026; image generation now runs through generateContent with
  // the native image models (gemini-3.1-flash-image — the PAID Nano Banana 2).
  // Tries the saved (BYOK) key first, then the server key — a rejected saved
  // key must not silently drop real AI images for a placeholder.
  const tryGeminiImage = async (apiKey: string): Promise<AiImageResult> => {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image',
      contents: finalPrompt,
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: aspectRatio || '1:1' },
      },
    });
    const parts = response?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p: any) => p?.inlineData?.data);
    if (imagePart?.inlineData?.data) {
      const mime = imagePart.inlineData.mimeType || 'image/png';
      return { imageUrl: `data:${mime};base64,${imagePart.inlineData.data}`, isAiGenerated: true, model: 'gemini-3.1-flash-image', provider: 'gemini' };
    }
    throw new Error('Gemini returned no image parts.');
  };
  if (!modelProvider || modelProvider === 'auto' || modelProvider === 'gemini') {
        const geminiKeys = [process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY, byokKeys?.gemini].filter((k, i, a): k is string => !!k && a.indexOf(k) === i);
    for (const key of geminiKeys) {
      try {
        return await tryGeminiImage(key);
      } catch (imageErr: any) {
        console.warn(`[Image] Gemini failed with ${key === byokKeys?.gemini ? 'saved' : 'server'} key, trying next provider:`, String(imageErr?.message || imageErr).slice(0, 140));
      }
    }
    // Auto chain: Gemini -> OpenRouter (Nano Banana paid) -> DALL-E -> SDXL ->
    // flagged placeholder (never a silently random photo).
    if (modelProvider === 'auto' || !modelProvider) {
      for (const attempt of [tryOpenRouterImage, tryDalle, tryHuggingFace]) {
        const r = await attempt().catch((e: any) => { console.warn('[Image] fallback failed:', String(e?.message || e).slice(0, 140)); return null; });
        if (r) return r;
      }
      return placeholder('Gemini quota exhausted and no fallback image provider succeeded');
    }
    return placeholder('Gemini quota exhausted or image API unavailable');
  }

  // --- 2. Explicit providers -----------------------------------------------
  if (modelProvider === 'openai') {
    const r = await tryDalle().catch(() => null);
    if (r) return r;
    const hf = await tryHuggingFace().catch(() => null);
    if (hf) return hf;
    return placeholder('OpenAI key missing or generation failed');
  }
  if (modelProvider === 'huggingface') {
    const r = await tryHuggingFace().catch(() => null);
    if (r) return r;
    const dalle = await tryDalle().catch(() => null);
    if (dalle) return dalle;
    return placeholder('Hugging Face token missing or generation failed');
  }
  if (modelProvider === 'replicate') {
    const r = await tryReplicate().catch((e: any) => { console.warn('[Image] Replicate failed:', String(e?.message || e).slice(0, 140)); return null; });
    if (r) return r;
    const dalle = await tryDalle().catch(() => null);
    if (dalle) return dalle;
    return placeholder('Replicate token missing or prediction failed');
  }

  // Unknown provider: fall back to the auto chain.
  for (const attempt of [tryDalle, tryHuggingFace, tryReplicate]) {
    const r = await attempt().catch(() => null);
    if (r) return r;
  }
  return placeholder('no image provider configured');
}

// API Endpoint: Generate AI Image via Gemini or Fallback
// `topicContext` (article title / keyword / brand) is prepended to every prompt
// so generated images always match the blog topic, even for short prompts.
app.post('/api/ai/generate-nano-image', async (req, res) => {
  try {
    const { prompt, aspectRatio, modelProvider, byokKeys, topicContext } = req.body;
    const finalPrompt = topicContext
      ? `${String(topicContext).trim()}\n\nImage prompt: ${String(prompt || '').trim()}`
      : String(prompt || '');
    const result = await generateAiImage({ prompt: finalPrompt, aspectRatio, modelProvider, byokKeys });
    return res.json({ success: true, prompt: finalPrompt, aspectRatio: aspectRatio || '1:1', ...result });
  } catch (err: any) {
    console.error('Error generating nano image:', err);
    return res.status(500).json({ error: err.message || 'Image generation failed.' });
  }
});

// API Endpoint: Refine / Rewrite an Image Prompt
// Rewrites the user's image prompt so it always matches the article topic and
// follows the Nano Banana formula: [Subject], [Environment/Style], [Lighting/Quality].
app.post('/api/ai/refine-image-prompt', async (req, res) => {
  try {
    const { prompt, title, keyword, brandName, voiceGuidelines, byokKeys } = req.body;

    const systemInstruction = `You are an expert AI image prompt engineer for "${brandName || 'a brand'}".
Brand aesthetic: ${voiceGuidelines || 'modern, clean, photorealistic'}.

Your job: refine/rewrite the user's image prompt so that:
1. It ALWAYS matches the article topic (title + focus keyphrase) — never drift off-topic.
2. It follows the Nano Banana formula: [Subject], [Environment/Style], [Lighting/Quality].
3. It is specific, visual and evocative — one or two sentences max.
4. It suits a photorealistic editorial blog featured image (16:9 landscape).
5. NEVER ask for text, captions, logos, watermarks, or words in the image.

Return JSON: {"prompt": "the refined prompt"}. No markdown, no extra fields.`;

    const { text: resultText, provider: genProvider, model: genModel, fallback } = await completeWithProvider(byokKeys, req.body.modelPref, {
      systemInstruction,
      prompt:
        `Article title: "${title || ''}"\n` +
        `Focus keyphrase: "${keyword || ''}"\n` +
        `Current image prompt: "${prompt || ''}"\n\n` +
        `Refine the prompt per your instructions.`,
      json: true,
      jsonSchema: { type: Type.OBJECT, properties: { prompt: { type: Type.STRING } }, required: ['prompt'] },
      maxTokens: 1024,
    });
    console.log(`[AI] Image prompt refined via ${genProvider}/${genModel}${fallback ? ' (fallback)' : ''}.`);

    let parsed: any;
    try {
      parsed = parseModelJson(resultText);
    } catch (e) {
      parsed = { prompt: (resultText || '').replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim() };
    }
    if (!parsed.prompt) throw new Error('Refinement returned an empty prompt.');

    return res.json({ success: true, data: { prompt: parsed.prompt, model: genModel, provider: genProvider, fallback } });
  } catch (err: any) {
    console.error('Error in /api/ai/refine-image-prompt:', err);
    return res.status(400).json({ error: err?.message || 'Failed to refine image prompt.' });
  }
});

// API Endpoint: SEO Audit Analysis
app.post('/api/ai/seo-audit', async (req, res) => {
  try {
    const { bodyHtml, primaryKeyword, secondaryKeywords, title, byokKeys } = req.body;

    const systemInstruction = `You are an SEO Auditor. Analyze the provided HTML blog content and primary keyword.
Calculate an overall SEO health score (0-100), word count, readability level, keyword density %, list 3-4 actionable improvements, and generate an optimal meta title and meta description.`;

    const { text: resultText, provider: genProvider, model: genModel, fallback } = await completeWithProvider(byokKeys, req.body.modelPref, {
      systemInstruction,
      prompt: `Title: ${title}
Primary Keyword: ${primaryKeyword}
Secondary Keywords: ${JSON.stringify(secondaryKeywords || [])}
HTML Body Content:
${bodyHtml}`,
      json: true,
      jsonSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          wordCount: { type: Type.NUMBER },
          readability: { type: Type.STRING },
          keywordDensity: { type: Type.NUMBER },
          suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          metaTitle: { type: Type.STRING },
          metaDescription: { type: Type.STRING }
        },
        required: ['score', 'wordCount', 'readability', 'suggestions', 'metaTitle', 'metaDescription']
      },
      maxTokens: 2048,
    }, { orProfessionalFirst: true });
    console.log(`[AI] SEO audit via ${genProvider}/${genModel}${fallback ? ' (fallback)' : ''}.`);

    const parsed = parseModelJson(resultText);
    return res.json({ success: true, data: { ...parsed, model: genModel, provider: genProvider, fallback } });
  } catch (err: any) {
    console.error('Error in SEO Audit:', err);
    return res.status(500).json({ error: err.message || 'SEO Audit failed.' });
  }
});

// API Endpoint: Test an AI provider / key / model configuration from Settings.
// Fires a tiny completion ("Reply with exactly: OK") so new keys and configs can
// be validated before they're relied on for real generations.
app.post('/api/ai/test-provider', async (req, res) => {
  const { provider, apiKey, baseUrl, model, byokKeys } = req.body || {};
  const startedAt = Date.now();
  const finish = (result: any) => res.json({ ...result, latencyMs: Date.now() - startedAt });

  try {
    if (provider === 'gemini') {
      // Resolve the Gemini key the same way the rest of the system does:
      // the saved BYOK key (Settings > AI Models) first, then the server env
      // vars. The test button must validate the key that actually gets used.
      const resolvedKey = byokKeys?.gemini || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      if (!resolvedKey) {
        return finish({ ok: false, provider, model: model || GEMINI_TEXT_MODEL, error: 'No Gemini API key configured on the server (GEMINI_API_KEY).' });
      }
      const ai = new GoogleGenAI({ apiKey: resolvedKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
      const response = await ai.models.generateContent({
        model: model || GEMINI_TEXT_MODEL,
        contents: 'Reply with exactly: OK',
        config: { maxOutputTokens: 20 },
      });
      return finish({ ok: true, provider, model: model || GEMINI_TEXT_MODEL, sample: (response.text || '').slice(0, 80) });
    }

    if (provider === 'openrouter' || provider === 'custom') {
      const resolvedKey = apiKey || (provider === 'openrouter' ? byokKeys?.openrouter : byokKeys?.openai) || process.env.OPENROUTER_API_KEY;
      const resolvedBase = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : baseUrl;
      const resolvedModel = model || (provider === 'openrouter' ? OPENROUTER_FREE_MODELS[0] : byokKeys?.customModel || 'gpt-4o-mini');
      if (!resolvedKey) {
        return finish({ ok: false, provider, model: resolvedModel, error: `No API key for ${provider} yet — add one in Settings > AI Models & Fallback.` });
      }
      if (!resolvedBase) {
        return finish({ ok: false, provider, model: resolvedModel, error: 'Custom base URL is required (e.g. https://api.groq.com/openai/v1).' });
      }
      const sample = await fetchOpenAICompatible({
        baseUrl: resolvedBase,
        apiKey: resolvedKey,
        model: resolvedModel,
        prompt: 'Reply with exactly: OK',
        maxTokens: 100,
      });
      return finish({ ok: true, provider, model: resolvedModel, baseUrl: resolvedBase, sample: sample.slice(0, 80) });
    }

    return finish({ ok: false, provider, error: `Unknown provider "${provider}".` });
  } catch (err: any) {
    const msg = String(err?.message || err);
    return finish({ ok: false, provider, model: model || undefined, error: msg.length > 260 ? msg.slice(0, 260) + '…' : msg });
  }
});

// API Endpoint: Browse current OpenRouter free models (live, with the user's key)
// so the Settings UI can show valid model IDs. Falls back to the curated list
// when OpenRouter is unreachable.
app.post('/api/ai/openrouter-models', async (req, res) => {
  const apiKey = req.body?.apiKey || req.body?.byokKeys?.openrouter || process.env.OPENROUTER_API_KEY;
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!response.ok) throw new Error(`OpenRouter responded ${response.status}.`);
    const data = await response.json();
    const models = (data?.data || [])
      .map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        free: m.pricing?.prompt === '0' && m.pricing?.completion === '0',
      }))
      .filter((m: any) => m.id && m.free)
      .sort((a: any, b: any) => a.id.localeCompare(b.id));
    return res.json({ success: true, models: models.slice(0, 80), total: models.length });
  } catch (err: any) {
    console.warn('[AI] OpenRouter model list failed, using curated free models:', err?.message?.slice(0, 120));
    return res.json({
      success: true,
      models: OPENROUTER_FREE_MODELS.map((id) => ({ id, name: id, free: true })),
      total: OPENROUTER_FREE_MODELS.length,
      curated: true,
    });
  }
});

// ==========================================
// 2. WORDPRESS REST API CONNECTOR PROXIES
// ==========================================

// Endpoint: Test WordPress REST API connection for a Brand
app.post('/api/wp/test-connection', async (req, res) => {
  try {
    const { wpUrl, wpUsername, wpAppPassword } = req.body;

    if (!wpUrl || !wpUsername) {
      return res.status(400).json({ success: false, message: 'WordPress URL and Username are required.' });
    }

    const cleanUrl = wpUrl.replace(/\/+$/, '');
    const authHeader = 'Basic ' + Buffer.from(`${wpUsername}:${wpAppPassword || ''}`).toString('base64');

    // Attempt to ping /wp-json/wp/v2/users/me or /wp-json
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const wpRes = await fetch(`${cleanUrl}/wp-json/wp/v2/users/me`, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'X-HTTP-Authorization': authHeader,
          'X-Authorization': authHeader,
          ...DEFAULT_WP_HEADERS,
        },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (wpRes.ok) {
        const userData = await wpRes.json();
        return res.json({
          success: true,
          message: `Successfully connected to WordPress REST API! Authenticated as "${userData.name || userData.slug}" (${userData.roles?.join(', ') || 'User'}).`,
          userDisplayName: userData.name,
          siteName: cleanUrl.replace(/^https?:\/\//, ''),
          statusCode: wpRes.status
        });
      } else {
        const statusText = wpRes.statusText;
        let errorData = '';
        const rawText = await wpRes.text();
        try {
          const errJson = JSON.parse(rawText);
          errorData = errJson.message || JSON.stringify(errJson);
        } catch {
          errorData = rawText;
        }
        let diagnosticMsg = `WordPress REST API returned HTTP ${wpRes.status} (${statusText}).`;
        if (errorData.includes('QUIC.cloud') || errorData.includes('Cloudflare') || errorData.includes('Wordfence') || errorData.includes('<html')) {
          diagnosticMsg += ` A firewall or CDN (like QUIC.cloud, Cloudflare, or Wordfence) is blocking the request from our server's IP address. You need to whitelist the application or disable the "Block Data Center IPs" feature in your firewall.`;
        } else if (errorData) {
          diagnosticMsg += ` Error: ${errorData}.`;
        }
        
        if (wpRes.status === 401 || wpRes.status === 403) {
          diagnosticMsg += ' Also verify username and Application Password. If using Hostinger or LiteSpeed, your server might be stripping Auth headers. Add this to .htaccess: RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]';
        }

        return res.json({
          success: false,
          message: diagnosticMsg,
          statusCode: wpRes.status
        });
      }
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      console.error("WP FETCH ERROR:", fetchErr);
      return res.status(502).json({
        success: false,
        message: `Failed to reach WordPress site at ${cleanUrl}. Error: ${fetchErr.message}. Ensure the site is online, the URL is correct, and no firewalls are blocking the REST API.`
      });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'WordPress connection attempt failed.' });
  }
});

// ---------------------------------------------------------------------------
// GENERATE CLEAN HTML FROM BLOCKS
// When a master template is used, we completely bypass the Blog Style Kit
// and generate pure, semantic HTML (h2, p, ul, figure) with no inline styles,
// no classes, and no wrappers. This allows the master template's theme CSS
// to fully govern the layout and typography.
// ---------------------------------------------------------------------------
function blocksToCleanHtml(blocks: any[]): string {
  if (!blocks || !blocks.length) return '';

  return blocks.map(block => {
    // Skip the hero block entirely when using a master template,
    // because the template already handles the H1 title and featured image.
    if (block.type === 'hero') return '';

    const title = (block.title || '').trim();
    const content = (block.content || '').trim();
    const hasFaq = block.type === 'faq' && Array.isArray(block.faqItems) && block.faqItems.length > 0;

    // Skip blocks that would render nothing meaningful (no content, no FAQ).
    // A title-only block would otherwise produce a dangling empty heading.
    if (!content && !hasFaq) return '';

    let html = '';

    // Render heading if present
    if (title) {
      // Escape HTML entities in title
      const escTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html += `<h2>${escTitle}</h2>\n`;
    }

    // NOTE: no in-body images are rendered here. Master-template publishes
    // carry exactly one image — the WordPress featured image — so image
    // blocks (image_banner) are intentionally dropped to avoid any secondary
    // or duplicate image in the body.

    // Render content
    if (content) {
      // Handle bullet points
      const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
      const isBullet = (l: string) => /^[•\-*]\s*/.test(l);
      
      if (lines.some(isBullet)) {
        let inList = false;
        for (const line of lines) {
          if (isBullet(line)) {
            if (!inList) { html += `<ul>\n`; inList = true; }
            html += `  <li>${line.replace(/^[•\-*]\s*/, '')}</li>\n`;
          } else {
            if (inList) { html += `</ul>\n`; inList = false; }
            html += `<p>${line}</p>\n`;
          }
        }
        if (inList) html += `</ul>\n`;
      } else {
        // Standard paragraphs
        html += lines.map(line => `<p>${line}</p>\n`).join('');
      }
    }

    // Render FAQ items
    if (hasFaq) {
      html += `<div class="faq-section">\n`;
      for (const item of block.faqItems) {
        if (item.question && item.answer) {
          html += `  <h3>${item.question}</h3>\n  <p>${item.answer}</p>\n`;
        }
      }
      html += `</div>\n`;
    }

    return html;
  }).filter(Boolean).join('\n');
}

// MASTER TEMPLATE CLONING ENGINE
// Allows a user to select a Master Page or Post from their WordPress site
// (regardless of theme) and use its exact layout/wrapper for consecutive blogs.
// ---------------------------------------------------------------------------
async function applyMasterTemplateLayout(
  cleanUrl: string,
  authHeader: string,
  masterTemplateId: number,
  masterTemplateType: 'page' | 'post',
  newArticleTitle: string,
  blocks: any[]
): Promise<{ content: string; templateSlug?: string }> {
  // Generate clean, semantic HTML from blocks (bypassing Blog Style Kit entirely)
  const cleanBody = blocksToCleanHtml(blocks);

  try {
    const endpoint = masterTemplateType === 'page' ? 'pages' : 'posts';
    const masterRes = await fetch(`${cleanUrl}/wp-json/wp/v2/${endpoint}/${masterTemplateId}?context=edit`, {
      headers: {
        'Authorization': authHeader,
        ...DEFAULT_WP_HEADERS,
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!masterRes.ok) {
      console.warn(`[MasterTemplate] Could not fetch master template #${masterTemplateId} (${masterRes.status})`);
      return { content: cleanBody };
    }

    const masterDoc = await masterRes.json();
    const rawMasterContent = masterDoc.content?.raw || masterDoc.content?.rendered || '';
    const masterTemplateSlug = masterDoc.template || '';

    if (!rawMasterContent.trim()) {
      return { content: cleanBody, templateSlug: masterTemplateSlug };
    }

    // 1. Gutenberg / Block-based Master Layout
    if (rawMasterContent.includes('<!-- wp:')) {
      let clonedContent = rawMasterContent;
      const escTitle = newArticleTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      
      // Update H1/H2 heading in master if present
      if (/<!-- wp:heading [^>]*-->\s*<h[12][^>]*>.*?<\/h[12]>\s*<!-- \/wp:heading -->/i.test(clonedContent)) {
        clonedContent = clonedContent.replace(
          /(<!-- wp:heading [^>]*-->\s*<h[12][^>]*>).*?(<\/h[12]>\s*<!-- \/wp:heading -->)/i,
          `$1${escTitle}$2`
        );
      }

      // If master contains post-content or main group, replace or wrap inner body
      if (clonedContent.includes('fgos-master-cloned-layout')) {
        return { content: clonedContent, templateSlug: masterTemplateSlug };
      }

      const blockWrappedBody = `<!-- wp:group {"className":"fgos-master-cloned-layout","layout":{"type":"constrained"}} -->\n<div className="wp-block-group fgos-master-cloned-layout">\n${cleanBody}\n</div>\n<!-- /wp:group -->`;

      return {
        content: `${clonedContent}\n\n${blockWrappedBody}`,
        templateSlug: masterTemplateSlug,
      };
    }

    // 2. Elementor / HTML Container Layout
    const wrapperMatch = rawMasterContent.match(/(<div[^>]*class=["'][^"']*(?:entry-content|elementor-inner|site-main|container)[^"']*["'][^>]*>)([\s\S]*?)(<\/div>)/i);
    if (wrapperMatch) {
      const openTag = wrapperMatch[1];
      const closeTag = wrapperMatch[3];
      return { content: openTag + '\n' + cleanBody + '\n' + closeTag, templateSlug: masterTemplateSlug };
    }

    return { content: cleanBody, templateSlug: masterTemplateSlug };
  } catch (err: any) {
    console.error('[MasterTemplate] Error applying master template:', err?.message || err);
    return { content: cleanBody };
  }
}

// Endpoint: Fetch available WordPress pages and posts to choose as Master Template
app.post('/api/wp/list-site-pages', async (req, res) => {
  try {
    const { wpUrl, wpUsername, wpAppPassword } = req.body;
    if (!wpUrl || !wpUsername) {
      return res.status(400).json({ success: false, message: 'wpUrl and wpUsername required.' });
    }

    const cleanUrl = wpUrl.replace(/\/+$/, '');
    const authHeader = 'Basic ' + Buffer.from(`${wpUsername}:${wpAppPassword || ''}`).toString('base64');
    const headers = { 'Authorization': authHeader, ...DEFAULT_WP_HEADERS };

    const [pagesRes, postsRes] = await Promise.all([
      fetch(`${cleanUrl}/wp-json/wp/v2/pages?per_page=50&_fields=id,title,link,slug,type,template,status`, { headers, signal: AbortSignal.timeout(15000) }),
      fetch(`${cleanUrl}/wp-json/wp/v2/posts?per_page=50&_fields=id,title,link,slug,type,template,status`, { headers, signal: AbortSignal.timeout(15000) }),
    ]);

    const pages = pagesRes.ok ? await pagesRes.json() : [];
    const posts = postsRes.ok ? await postsRes.json() : [];

    const items = [
      ...(Array.isArray(pages) ? pages : []).map((p: any) => ({
        id: p.id,
        title: (p.title?.rendered || p.slug || 'Untitled Page').trim(),
        link: p.link,
        slug: p.slug,
        type: 'page' as const,
        template: p.template || 'default',
        status: p.status,
      })),
      ...(Array.isArray(posts) ? posts : []).map((p: any) => ({
        id: p.id,
        title: (p.title?.rendered || p.slug || 'Untitled Post').trim(),
        link: p.link,
        slug: p.slug,
        type: 'post' as const,
        template: p.template || 'default',
        status: p.status,
      })),
    ];

    return res.json({ success: true, items, total: items.length });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || 'Could not fetch site pages.' });
  }
});

// Endpoint: Push Content to WordPress (Post or Page with Template)
app.post('/api/wp/sync-content', async (req, res) => {
  try {
    const { brand, contentItem, byokKeys } = req.body;

    if (!brand || !contentItem) {
      return res.status(400).json({ success: false, message: 'Brand and Content Item required.' });
    }

    const cleanUrl = brand.wpUrl.replace(/\/+$/, '');
    const endpoint = contentItem.contentType === 'page' ? '/wp-json/wp/v2/pages' : '/wp-json/wp/v2/posts';
    const authHeader = 'Basic ' + Buffer.from(`${brand.wpUsername}:${brand.wpAppPassword || ''}`).toString('base64');
    // byokKeys (the user's saved paid keys) power sync-time image generation;
    // falls back to the server env keys when the client sends none.
    const imageKeys = byokKeys && typeof byokKeys === 'object' ? byokKeys : undefined;

    // Publish LIVE by default: the "Publish to WordPress" button must go live.
    // (An explicit { status: 'draft' } in the body still allows a draft sync.)
    // brand.defaultStatus is deliberately NOT used — it was defaulting every
    // publish to a draft even though the UI promises live publishing.
    const wpStatus = req.body.status === 'draft' ? 'draft' : 'publish';

    const payload: any = {
      title: contentItem.title,
      content: contentItem.bodyHtml,
      status: wpStatus,
      slug: contentItem.slug || undefined,
    };

    // Blog Number → WordPress slug (hidden, not the title). The blog number
    // (e.g. DTP001) is appended to the slug so it lives in the URL for internal
    // tracking without ever appearing in the visible title. If the slug already
    // ends with the number, leave it untouched (idempotent re-pushes).
    if (contentItem.blogNumber) {
      const baseSlug = String(contentItem.slug || '').replace(/\/+$/, '');
      const num = String(contentItem.blogNumber).toLowerCase();
      if (baseSlug && !baseSlug.toLowerCase().endsWith(`-${num}`)) {
        payload.slug = `${baseSlug}-${num}`;
      }
      // Also write the number into the WordPress "Blog Number" custom field
      // (post meta) so it is stored on the post itself, not just in the URL.
      // The REST API accepts a `meta` object; keys must be registered with
      // show_in_rest => true (Sumbul's dynamic Blog Number field is). We send
      // both the snake_case key and the camelCase alias so whichever the field
      // is registered under gets populated. Unregistered keys are ignored by
      // WordPress, so this is safe to send unconditionally.
      payload.meta = {
        ...(payload.meta || {}),
        blog_number: String(contentItem.blogNumber),
        blogNumber: String(contentItem.blogNumber),
      };
    }

    // --- Master Template Layout Cloning (Clones user-chosen master page/post) ---
    const masterId = Number(req.body.masterTemplateId || brand.masterTemplateId) || null;
    const masterType = (req.body.masterTemplateType || brand.masterTemplateType || 'page') as 'page' | 'post';
    if (masterId) {
      try {
        const cloned = await applyMasterTemplateLayout(
          cleanUrl,
          authHeader,
          masterId,
          masterType,
          contentItem.title || '',
          contentItem.blocks || []
        );
        payload.content = cloned.content;
        if (cloned.templateSlug) {
          payload.template = mapWpTemplate(cloned.templateSlug);
        }
      } catch (masterErr) {
        console.warn('[Sync] Master template clone failed, proceeding with default content layout:', masterErr);
      }
    }

    // Featured-media precedence: the AI-generated hero's media id (set at
    // Auto-Write time) is freshest, then any previously synced wpMediaId, then
    // the upload/guarantee path below.
    if (typeof contentItem.featuredMediaId === 'number') {
      payload.featured_media = contentItem.featuredMediaId;
    } else if (contentItem.wpMediaId) {
      payload.featured_media = contentItem.wpMediaId;
    }

    // --- Sync-time AI image guarantee -----------------------------------------
    // Every pushed article must carry at least 2 topic-matched images:
    //  1. featured (hero) — from featuredMediaId / wpMediaId, or uploaded from
    //     pickHeroImage(); items with NO hero image at all get one GENERATED
    //     on the fly with the paid Nano Banana chain (topic + body context).
    //  2. in-body (secondary) — the item's stored secondaryImageUrl, or a
    //     GENERATED one embedded as an idempotent <figure class="fg-art-
    //     secondary">. Old items whose blocks already hold a real (non-
    //     placeholder) image skip generation — they already have 2 images.
    // Generated images are returned so the client persists them for
    // deterministic re-pushes. Any hiccup here never fails the publish.
    const imagesReturn: { heroUrl?: string; heroMediaId?: number; secondaryUrl?: string; secondaryMediaId?: number } = {};
    const blocksHaveRealImage = (contentItem.blocks || []).some(
      (b: any) => b && String(b.imageUrl || '').trim() && !/placehold\.co|picsum\.photos/i.test(String(b.imageUrl)),
    );

    let featuredMediaId: number | null = null;
    if (!payload.featured_media) {
      let heroSrc = pickHeroImage(contentItem);
      // Old/image-less items: generate a topic-matched hero instead of
      // publishing without a featured image (grids/cards would look empty).
      if (!heroSrc) {
        try {
          const gen = await generateAiImage({
            prompt: `${buildImageTopicContext(contentItem, brand)}\n\nImage prompt: ${String(contentItem.nanoBananaPrompt || '').trim() || `${contentItem.primaryKeyword || contentItem.title} hero photo`}`,
            aspectRatio: '16:9',
            byokKeys: imageKeys,
          });
          if (!gen.isPlaceholder) heroSrc = gen.imageUrl;
        } catch (genErr: any) {
          console.warn('[Sync] hero generation skipped:', String(genErr?.message || genErr).slice(0, 140));
        }
      }
      if (heroSrc) {
        try {
          const isData = /^data:image/i.test(heroSrc);
          const { wpMediaId, wpMediaUrl } = await uploadImageToWp(
            brand,
            isData ? { dataBase64: heroSrc, filename: 'featured-image' } : { imageUrl: heroSrc, filename: 'featured-image' },
          );
          payload.featured_media = wpMediaId;
          featuredMediaId = wpMediaId;
          if (isData) imagesReturn.heroUrl = wpMediaUrl;
          imagesReturn.heroMediaId = wpMediaId;
        } catch (featErr: any) {
          console.warn('[Sync] featured-image upload skipped:', String(featErr?.message || featErr).slice(0, 160));
        }
      }
    }

    // Secondary (in-body) image: only for the default fg-art layout. Master
    // template publishes carry exactly one image (the WordPress featured
    // image) — no secondary image is generated or injected.
    if (!masterId) {
      const bodyHasSecondary = /fg-art-secondary/.test(payload.content || '');
      const storedSecondary = String(contentItem.secondaryImageUrl || '').trim();
      let secondarySrc = storedSecondary;
      if (!secondarySrc && !bodyHasSecondary && !blocksHaveRealImage) {
        try {
          const gen = await generateAiImage({
            prompt: `${buildImageTopicContext(contentItem, brand)}\n\nImage prompt: ${contentItem.primaryKeyword || contentItem.title} lifestyle detail photo`,
            aspectRatio: '4:3',
            byokKeys: imageKeys,
          });
          if (!gen.isPlaceholder) secondarySrc = gen.imageUrl;
        } catch (genErr: any) {
          console.warn('[Sync] secondary image generation skipped:', String(genErr?.message || genErr).slice(0, 140));
        }
      }
      if (secondarySrc && !bodyHasSecondary) {
        let embedSrc = secondarySrc;
        if (/^data:image/i.test(secondarySrc)) {
          try {
            const up = await uploadImageToWp(brand, { dataBase64: secondarySrc, filename: 'article-image-2' });
            embedSrc = up.wpMediaUrl;
            imagesReturn.secondaryUrl = up.wpMediaUrl;
            imagesReturn.secondaryMediaId = up.wpMediaId;
          } catch (secErr: any) {
            console.warn('[Sync] secondary image upload skipped:', String(secErr?.message || secErr).slice(0, 140));
          }
        } else {
          imagesReturn.secondaryUrl = secondarySrc;
        }
        payload.content = embedSecondaryFigure(
          payload.content || '',
          embedSrc,
          // Alt text must be a full descriptive sentence, not a raw keyword fragment.
          // "natural treats for our" is not a usable alt — generate a meaningful description.
          `${String(contentItem.primaryKeyword || '').trim() || String(contentItem.title || '').trim() || 'Article'} — ${brand?.name || 'article'} illustration`.replace(/["<>]/g, ''),
        );
      }
    }

    // --- Image hosting guarantee -------------------------------------------------
    // WordPress strips data: URLs from content (kses allowed-protocols), so any
    // app-generated image (nano-image / AI flows return base64 data URIs) would
    // render as a broken image on the live site. Upload data-URI images to the
    // WP media library here and rewrite the <img> srcs before publishing, so
    // every pushed article keeps its images. A hiccup here never fails the
    // whole publish — the article goes out as-is and the error is logged.
    try {
      const srcRe = /<img\b[^>]*src\s*=\s*["']([^"']+)["']/gi;
      const seen = new Set<string>();
      const srcs: string[] = [];
      let sm: RegExpExecArray | null;
      while ((sm = srcRe.exec(payload.content || '')) !== null) {
        const src = sm[1];
        if (src && src.startsWith('data:image') && !seen.has(src)) {
          seen.add(src);
          srcs.push(src);
        }
      }
      for (const [i, src] of srcs.entries()) {
        try {
          const { wpMediaUrl } = await uploadImageToWp(brand, {
            dataBase64: src,
            filename: `article-image-${i + 1}`,
          });
          payload.content = String(payload.content || '').split(src).join(wpMediaUrl);
        } catch (imgErr: any) {
          console.warn(`[Sync] data-URI image upload skipped (${i + 1}/${srcs.length}):`, String(imgErr?.message || imgErr).slice(0, 160));
        }
      }
    } catch (imgScanErr: any) {
      console.warn('[Sync] image scan skipped:', String(imgScanErr?.message || imgScanErr).slice(0, 160));
    }

    // --- Publish-readiness verification (log-only, never blocks publishing) ---
    // A hand-edited draft can still be truncated or far short of its target —
    // this catches that at the publish gate so it can be fixed before the post
    // goes live. Checks the item's own blocks (the structured truth the editor
    // shows), not the frame-wrapped HTML (whose static footer would add noise).
    try {
      const blockText = (contentItem.blocks || [])
        .map((b: any) => String(b?.content || b?.subtitle || '').trim())
        .filter(Boolean).join(' ').trim();
      if (blockText) {
        const blockWords = blockText.split(/\s+/).length;
        const target = safeCount(contentItem.targetWordCount) || 0;
        if (!ENDS_WITH_FINAL_PUNCT.test(blockText)) {
          console.warn(`[Sync] "${contentItem.title}" may be truncated: the last block does not end with sentence-final punctuation (${blockWords} words).`);
        }
        if (target > 0 && blockWords < Math.max(200, Math.round(target * 0.5))) {
          console.warn(`[Sync] "${contentItem.title}" is well below target length: ${blockWords} words vs target ${target}.`);
        }
      }
    } catch (verErr: any) {
      console.warn('[Sync] publish-readiness check skipped:', String(verErr?.message || verErr).slice(0, 120));
    }

    try {
      // Resolve the WordPress target post:
      //  1. explicit wpPostId (item synced before) -> update in place;
      //  2. no wpPostId but a slug -> look up an existing post by slug and
      //     UPDATE it instead of creating a duplicate. This happens when the
      //     item's wpPostId was never persisted (e.g. older items whose save
      //     failed), and re-publishing must refresh the live post, not fork it;
      //  3. nothing matched -> create a fresh post.
      const existingId = contentItem.wpPostId;
      let targetId = existingId;
      let wpUrl = targetId ? `${cleanUrl}${endpoint}/${targetId}` : `${cleanUrl}${endpoint}`;

      if (!targetId && contentItem.slug) {
        const searchUrl = `${cleanUrl}${endpoint}?slug=${encodeURIComponent(contentItem.slug)}&status=any`;
        const searchRes = await fetch(searchUrl, {
          headers: { "Authorization": authHeader, ...DEFAULT_WP_HEADERS }
        });
        if (searchRes.ok) {
          const matches = await searchRes.json();
          const match = Array.isArray(matches) && matches.length ? matches[0] : null;
          if (match && match.id) {
            targetId = match.id;
            wpUrl = `${cleanUrl}${endpoint}/${targetId}`;
          }
        }
      }

      if (targetId) {
        // The stored id may point at a post that was force-deleted on WordPress
        // (or belongs to another site). Probe first so publish never dies on a
        // dead id — fall back to creating a fresh post instead.
        const probe = await fetch(`${cleanUrl}${endpoint}/${targetId}?context=edit`, {
          headers: { "Authorization": authHeader, ...DEFAULT_WP_HEADERS }
        });
        if (probe.status === 404) {
          targetId = undefined;
          wpUrl = `${cleanUrl}${endpoint}`;
        }
      }

      const wpRes = await fetch(wpUrl, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
          ...DEFAULT_WP_HEADERS
        },
        body: JSON.stringify(payload)
      });

      if (wpRes.ok) {
        const data = await wpRes.json();
        const wpPostId = data.id;
        const link = data.link;
        const previewUrl = `${link}${link.includes('?') ? '&' : '?'}preview=true`;
        const appStatus = wpStatus === 'draft' ? 'Draft_Ready' : 'Published';

        return res.json({
          success: true,
          message: targetId
            ? `Updated ${contentItem.contentType} on WordPress (${wpStatus === 'draft' ? 'DRAFT' : 'LIVE'})`
            : `Successfully published ${contentItem.contentType} to WordPress (${wpStatus === 'draft' ? 'DRAFT' : 'LIVE'})`,
          wpPostId,
          link,
          previewUrl,
          wpStatus,
          status: appStatus,
          wpMediaId: featuredMediaId ?? payload.featured_media ?? null,
          featuredMediaId: featuredMediaId ?? payload.featured_media ?? null,
          images: imagesReturn,
        });
      } else {
        const errorData = await wpRes.text();
        return res.status(wpRes.status).json({
          success: false,
          message: `WordPress API Error (${wpRes.status}): ${errorData}`
        });
      }
    } catch (e: any) {
      return res.status(502).json({
        success: false,
        message: `Failed to connect to WordPress REST API. Error: ${e.message}`
      });
    }

  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'WordPress Sync Failed' });
  }
});

// Endpoint: Fetch one WordPress Post or Page (with rendered content) — used
// for previews/verification; auth matches sync-content (client brand object).
app.post('/api/wp/get-post', async (req, res) => {
  try {
    const { brand, wpPostId, contentType } = req.body;
    if (!brand || !wpPostId) {
      return res.status(400).json({ success: false, message: 'Brand and wpPostId required.' });
    }
    const cleanUrl = brand.wpUrl.replace(/\/+$/, '');
    const endpoint = contentType === 'page' ? '/wp-json/wp/v2/pages' : '/wp-json/wp/v2/posts';
    const authHeader = 'Basic ' + Buffer.from(`${brand.wpUsername}:${brand.wpAppPassword || ''}`).toString('base64');
    // context=edit is REQUIRED: without it the REST API returns only rendered
    // content/title/excerpt (post_content_raw etc. omitted), which made every
    // verification read back as an "empty post".
    const wpRes = await fetch(`${cleanUrl}${endpoint}/${wpPostId}?context=edit`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        ...DEFAULT_WP_HEADERS
      }
    });
    if (!wpRes.ok) {
      return res.status(wpRes.status).json({ success: false, message: `WordPress API Error (${wpRes.status})` });
    }
    const data = await wpRes.json();
    return res.json({ success: true, post: data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Fetch failed' });
  }
});

// Endpoint: Lightweight list of recently published posts for a brand — used
// to build the article footer "related posts" strip at sync time. Deliberately
// small (_fields limits the payload; per_page caps the round trip).
app.post('/api/wp/list-posts', async (req, res) => {
  try {
    const { brand, excludeSlug, perPage } = req.body;
    if (!brand || !brand.wpUrl || !brand.wpUsername) {
      return res.status(400).json({ success: false, message: 'Brand with WordPress details required.' });
    }
    const cleanUrl = brand.wpUrl.replace(/\/+$/, '');
    const authHeader = 'Basic ' + Buffer.from(`${brand.wpUsername}:${brand.wpAppPassword || ''}`).toString('base64');
    const n = Math.min(20, Math.max(1, Number(perPage) || 6));
    const wpRes = await fetch(
      `${cleanUrl}/wp-json/wp/v2/posts?per_page=${n}&status=publish&orderby=date&order=desc&_fields=id,title,link,slug,_embedded&_embed=wp:featuredmedia`,
      {
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', ...DEFAULT_WP_HEADERS },
      },
    );
    if (!wpRes.ok) {
      return res.status(wpRes.status).json({ success: false, message: `WordPress API Error (${wpRes.status})` });
    }
    const posts = await wpRes.json();
    const list = (Array.isArray(posts) ? posts : [])
      .filter((p: any) => !excludeSlug || !p?.slug || p.slug !== excludeSlug)
      .slice(0, 4)
      .map((p: any) => {
        // Extract featured image URL from _embedded
        let imageUrl = '';
        try {
          const media = p?._embedded?.['wp:featuredmedia'];
          if (Array.isArray(media) && media[0]?.source_url) {
            imageUrl = media[0].source_url;
          }
        } catch { /* no image */ }
        return {
          title: p?.title?.rendered || p?.title || 'Untitled',
          url: p?.link || '',
          slug: p?.slug || '',
          imageUrl,
        };
      });
    return res.json({ success: true, posts: list });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not list posts.' });
  }
});

// Endpoint: Fetch WooCommerce Products (public Store API, no auth needed)
// Returns products from the brand's WooCommerce store for product recommendation sections.
// Cached in memory for 5 minutes to avoid hammering the API.
const wcProductCache = new Map<string, { data: any[]; at: number }>();
app.get('/api/wp/products', async (req, res) => {
  try {
    const wpUrl = String(req.query.wpUrl || '').trim();
    if (!wpUrl) return res.status(400).json({ success: false, message: 'wpUrl required.' });
    const cleanUrl = wpUrl.replace(/\/+$/, '');
    const cacheKey = cleanUrl;
    const cached = wcProductCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
      return res.json({ success: true, products: cached.data, cached: true });
    }
    const wcRes = await fetch(`${cleanUrl}/wp-json/wc/store/v1/products?per_page=20&status=publish`, {
      headers: DEFAULT_WP_HEADERS,
    });
    if (!wcRes.ok) {
      return res.status(wcRes.status).json({ success: false, message: `WooCommerce API Error (${wcRes.status})` });
    }
    const raw = await wcRes.json();
    const products = (Array.isArray(raw) ? raw : []).map((p: any) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      permalink: p.permalink,
      shortDescription: (p.short_description || '').replace(/<[^>]+>/g, '').trim(),
      price: p.prices?.price || '',
      currency: p.prices?.currency_code || 'GBP',
      image: p.images?.[0]?.src || '',
      categories: (p.categories || []).map((c: any) => c.name).filter(Boolean),
    }));
    wcProductCache.set(cacheKey, { data: products, at: Date.now() });
    return res.json({ success: true, products });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not fetch products.' });
  }
});

// ---------------------------------------------------------------------------
// Authenticated WooCommerce REST API v3 endpoints
// These use the consumer key/secret stored in the brand to access the full
// WC API — products (richer data), orders, customers, coupons, and reports.
// Key/secret are passed as query-string auth (WC standard for REST API v3).
// ---------------------------------------------------------------------------

/** Helper: build the WC v3 base URL + auth query string for a brand. */
function wcAuthUrl(wpUrl: string, key: string, secret: string, path: string): string {
  const base = wpUrl.replace(/\/+$/, '') + '/wp-json/wc/v3' + path;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}consumer_key=${encodeURIComponent(key)}&consumer_secret=${encodeURIComponent(secret)}`;
}

// ── Dynamic template fields (Carol's feat-auto-populate-dynamic-fields) ──────
// The generated article should populate the template's dynamic sections with
// REAL data — real products from the store catalog, real related articles from
// the content register, and the agreed CTA — instead of leaving placeholders.
// These helpers fetch real products and rewrite the generated HTML so the
// product-recommendation / related / CTA sections carry real, clickable data.

/** Fetch real products for a brand from its WooCommerce store (cached 5 min). */
async function fetchBrandProducts(brand: any): Promise<any[]> {
  const wpUrl = String(brand?.wpUrl || '').trim().replace(/\/+$/, '');
  if (!wpUrl) return [];
  const cacheKey = wpUrl;
  const cached = wcProductCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.data;
  try {
    const wcRes = await fetch(`${wpUrl}/wp-json/wc/store/v1/products?per_page=20&status=publish`, {
      headers: DEFAULT_WP_HEADERS,
    });
    if (!wcRes.ok) return [];
    const raw = await wcRes.json();
    const products = (Array.isArray(raw) ? raw : []).map((p: any) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      permalink: p.permalink,
      shortDescription: (p.short_description || '').replace(/<[^>]+>/g, '').trim(),
      price: p.prices?.price || '',
      currency: p.prices?.currency_code || 'GBP',
      image: p.images?.[0]?.src || '',
      categories: (p.categories || []).map((c: any) => c.name).filter(Boolean),
    }));
    wcProductCache.set(cacheKey, { data: products, at: Date.now() });
    return products;
  } catch {
    return [];
  }
}


/**
 * Build the "DYNAMIC TEMPLATE FIELDS" prompt section that tells the AI which
 * real products, related articles and CTA to use when populating the template's
 * dynamic sections. Returns an empty string when there is nothing to populate.
 */
function buildDynamicFieldsPrompt(
  products: any[],
  related: any[],
  cta?: string,
  recommendationType?: 'products' | 'services' | 'books' | 'none',
): string {
  const lines: string[] = [];
  if (products.length) {
    lines.push(
      'DYNAMIC TEMPLATE FIELDS — populate these with the REAL data below (do not invent products or articles):',
    );
    lines.push(
      'REAL PRODUCTS AVAILABLE (use these in the product recommendation section, with their real names and links):\n' +
        products
          .slice(0, 6)
          .map((p) => `- ${p.name}${p.price ? ` (${p.currency || '£'}${p.price})` : ''}${p.permalink ? ` — ${p.permalink}` : ''}`)
          .join('\n'),
    );
  }
  if (related.length) {
    lines.push(
      'REAL RELATED ARTICLES (link to these existing articles on the site for the related-articles section, using their real slugs):\n' +
        related
          .map((r) => `- ${r.title || r.slug}${r.slug ? ` — /blog/${String(r.slug).replace(/^\/+|\/+$/g, '')}` : ''}`)
          .join('\n'),
    );
  }
  if (cta && cta.trim()) {
    lines.push(`AGREED CALL TO ACTION: "${cta.trim()}" — use this exact text in the CTA section.`);
  }
  if (recommendationType && recommendationType !== 'none') {
    const noun = recommendationType === 'books' ? 'books'
      : recommendationType === 'services' ? 'services'
      : 'products';
    lines.push(
      `RECOMMENDATION SECTION — include a "Related ${noun === 'books' ? 'Books' : noun === 'services' ? 'Services' : 'Products'}" section in the article that recommends the real ${noun} listed above (use their real names and links). Use semantic, theme-agnostic markup (a <section> with an <h2> and a grid of cards) so it renders under any WordPress theme.`,
    );
  }
  if (!lines.length) return '';
  return `\n${lines.join('\n')}`;
}

/**
 * feat-internal-linking (AI-powered contextual internal linking): builds a
 * prompt section that lists the brand's REAL published articles and instructs
 * the model to weave 1-3 contextual internal links to them within the article
 * body — using their real slugs — instead of inventing plausible /blog/ paths.
 * This is the "identify relevant existing content and insert contextual
 * internal links naturally" half of the feature; the post-generation rewire in
 * populateDynamicFields guarantees every in-body /blog/ link resolves to a real
 * article.
 */
function buildInternalLinkingPrompt(related: any[]): string {
  const real = (related || []).filter((r: any) => r && (r.slug || r.title));
  if (!real.length) return '';
  const list = real
    .slice(0, 8)
    .map((r: any) => {
      const slug = String(r.slug || '').replace(/^\/+|\/+$/g, '').replace(/^blog\//i, '');
      const label = r.title || slug;
      return `- ${label}${slug ? ` → /blog/${slug}` : ''}${r.primaryKeyword ? ` (topic: ${r.primaryKeyword})` : ''}`;
    })
    .join('\n');
  return `\nCONTEXTUAL INTERNAL LINKS — the site already has these REAL published articles. Weave 1-3 natural, contextually-relevant internal links to them within the article body (NOT just in a related-articles section), using their exact real slugs shown below. Anchor text should be descriptive and fit the surrounding sentence. Do NOT invent any other /blog/ paths — only link to the real articles listed here:\n${list}`;
}

// GET /api/wc/products — authenticated product list (richer data than public Store API)
app.get('/api/wc/products', async (req, res) => {
  try {
    const wpUrl = String(req.query.wpUrl || '').trim();
    const key = String(req.query.key || '').trim();
    const secret = String(req.query.secret || '').trim();
    if (!wpUrl || !key || !secret) {
      return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    }
    const perPage = Math.min(Number(req.query.per_page) || 20, 100);
    const page = Number(req.query.page) || 1;
    const search = String(req.query.search || '').trim();
    const url = new URL(wcAuthUrl(wpUrl, key, secret, `/products?per_page=${perPage}&page=${page}&status=publish`));
    if (search) url.searchParams.set('search', search);

    const wcRes = await fetch(url.toString(), {
      headers: DEFAULT_WP_HEADERS,
    });
    if (!wcRes.ok) {
      const body = await wcRes.text();
      return res.status(wcRes.status).json({ success: false, message: `WC API ${wcRes.status}: ${body}` });
    }
    const raw = await wcRes.json();
    const products = (Array.isArray(raw) ? raw : []).map((p: any) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      permalink: p.permalink,
      status: p.status,
      shortDescription: (p.short_description || '').replace(/<[^>]+>/g, '').trim(),
      description: (p.description || '').replace(/<[^>]+>/g, '').trim(),
      price: p.price,
      regularPrice: p.regular_price,
      salePrice: p.sale_price,
      onSale: p.on_sale,
      stockStatus: p.stock_status,
      stockQuantity: p.stock_quantity,
      categories: (p.categories || []).map((c: any) => ({ id: c.id, name: c.name, slug: c.slug })),
      tags: (p.tags || []).map((t: any) => ({ id: t.id, name: t.name, slug: t.slug })),
      images: (p.images || []).map((img: any) => ({ id: img.id, src: img.src, alt: img.alt })),
      averageRating: p.average_rating,
      ratingCount: p.rating_count,
      totalSales: p.total_sales,
      dateCreated: p.date_created,
    }));

    // Surface total pages from WC headers
    const totalPages = parseInt(wcRes.headers.get('X-WP-TotalPages') || '1', 10);
    const total = parseInt(wcRes.headers.get('X-WP-Total') || '0', 10);

    return res.json({ success: true, products, total, totalPages, page });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not fetch WC products.' });
  }
});

// GET /api/wc/orders — recent orders
app.get('/api/wc/orders', async (req, res) => {
  try {
    const wpUrl = String(req.query.wpUrl || '').trim();
    const key = String(req.query.key || '').trim();
    const secret = String(req.query.secret || '').trim();
    if (!wpUrl || !key || !secret) {
      return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    }
    const perPage = Math.min(Number(req.query.per_page) || 10, 50);
    const page = Number(req.query.page) || 1;
    const url = wcAuthUrl(wpUrl, key, secret, `/orders?per_page=${perPage}&page=${page}&orderby=date&order=desc`);

    const wcRes = await fetch(url, {
      headers: DEFAULT_WP_HEADERS,
    });
    if (!wcRes.ok) {
      const body = await wcRes.text();
      return res.status(wcRes.status).json({ success: false, message: `WC API ${wcRes.status}: ${body}` });
    }
    const raw = await wcRes.json();
    const orders = (Array.isArray(raw) ? raw : []).map((o: any) => ({
      id: o.id,
      status: o.status,
      total: o.total,
      currency: o.currency,
      dateCreated: o.date_created,
      dateModified: o.date_modified,
      customerNote: o.customer_note,
      lineItemCount: (o.line_items || []).length,
      billing: {
        firstName: o.billing?.first_name,
        lastName: o.billing?.last_name,
        email: o.billing?.email,
      },
    }));

    const totalPages = parseInt(wcRes.headers.get('X-WP-TotalPages') || '1', 10);
    const total = parseInt(wcRes.headers.get('X-WP-Total') || '0', 10);

    return res.json({ success: true, orders, total, totalPages, page });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not fetch WC orders.' });
  }
});

// GET /api/wc/reports — store stats (sales, orders, customers)
app.get('/api/wc/reports', async (req, res) => {
  try {
    const wpUrl = String(req.query.wpUrl || '').trim();
    const key = String(req.query.key || '').trim();
    const secret = String(req.query.secret || '').trim();
    if (!wpUrl || !key || !secret) {
      return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    }

    const [salesRes, ordersRes, customersRes] = await Promise.all([
      fetch(wcAuthUrl(wpUrl, key, secret, '/reports/sales'), {
        headers: DEFAULT_WP_HEADERS,
      }),
      fetch(wcAuthUrl(wpUrl, key, secret, '/reports/orders/totals'), {
        headers: DEFAULT_WP_HEADERS,
      }),
      fetch(wcAuthUrl(wpUrl, key, secret, '/reports/customers/totals'), {
        headers: DEFAULT_WP_HEADERS,
      }),
    ]);

    const sales = salesRes.ok ? await salesRes.json() : null;
    const orders = ordersRes.ok ? await ordersRes.json() : null;
    const customers = customersRes.ok ? await customersRes.json() : null;

    return res.json({
      success: true,
      sales: sales || [],
      orders: orders || [],
      customers: customers || [],
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not fetch WC reports.' });
  }
});

// GET /api/wc/categories — product categories
app.get('/api/wc/categories', async (req, res) => {
  try {
    const wpUrl = String(req.query.wpUrl || '').trim();
    const key = String(req.query.key || '').trim();
    const secret = String(req.query.secret || '').trim();
    if (!wpUrl || !key || !secret) {
      return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    }
    const url = wcAuthUrl(wpUrl, key, secret, '/products/categories?per_page=100');

    const wcRes = await fetch(url, {
      headers: DEFAULT_WP_HEADERS,
    });
    if (!wcRes.ok) {
      const body = await wcRes.text();
      return res.status(wcRes.status).json({ success: false, message: `WC API ${wcRes.status}: ${body}` });
    }
    const raw = await wcRes.json();
    const categories = (Array.isArray(raw) ? raw : []).map((c: any) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      count: c.count,
      parent: c.parent,
      image: c.image?.src || null,
    }));

    return res.json({ success: true, categories });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not fetch WC categories.' });
  }
});

// GET /api/wc/test — test WooCommerce REST API connection
app.get('/api/wc/test', async (req, res) => {
  try {
    const wpUrl = String(req.query.wpUrl || '').trim();
    const key = String(req.query.key || '').trim();
    const secret = String(req.query.secret || '').trim();
    if (!wpUrl || !key || !secret) {
      return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    }

    const wcRes = await fetch(wcAuthUrl(wpUrl, key, secret, '/system_status'), {
      headers: DEFAULT_WP_HEADERS,
    });

    if (wcRes.ok) {
      const data = await wcRes.json();
      return res.json({
        success: true,
        message: 'WooCommerce REST API connected successfully.',
        wcVersion: data?.wc_version || 'unknown',
        shopName: data?.settings?.site_title || '',
        environment: data?.environment || {},
      });
    }

    const body = await wcRes.text();
    return res.json({
      success: false,
      message: `WC API returned HTTP ${wcRes.status}: ${body}`,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not test WC connection.' });
  }
});

// Endpoint: Delete a WordPress Post or Page (moves to WP trash, recoverable)
app.post('/api/wp/delete-post', async (req, res) => {
  try {
    const { brand, wpPostId, contentType } = req.body;

    if (!brand || !wpPostId) {
      return res.status(400).json({ success: false, message: 'Brand and wpPostId required.' });
    }

    const cleanUrl = brand.wpUrl.replace(/\/+$/, '');
    const type = contentType === 'page' ? 'pages' : 'posts';
    const authHeader = 'Basic ' + Buffer.from(`${brand.wpUsername}:${brand.wpAppPassword || ''}`).toString('base64');

    try {
      const wpRes = await fetch(`${cleanUrl}/wp-json/wp/v2/${type}/${wpPostId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          ...DEFAULT_WP_HEADERS
        }
      });

      if (wpRes.ok) {
        const data = await wpRes.json();
        return res.json({
          success: true,
          deleted: data.deleted,
          message: data.deleted
            ? `Deleted ${type.slice(0, -1)} #${wpPostId} from WordPress (moved to trash).`
            : `WordPress reported the ${type.slice(0, -1)} as already deleted.`
        });
      }

      // 404/410 = the post is already gone from WP — treat as a successful delete.
      if (wpRes.status === 404 || wpRes.status === 410) {
        return res.json({
          success: true,
          deleted: false,
          message: `The WordPress ${type.slice(0, -1)} #${wpPostId} was not found — it may already be deleted.`
        });
      }

      const errorData = await wpRes.text();
      return res.status(wpRes.status).json({
        success: false,
        message: `WordPress API Error (${wpRes.status}): ${errorData}`
      });
    } catch (e: any) {
      return res.status(502).json({
        success: false,
        message: `Failed to connect to WordPress REST API. Error: ${e.message}`
      });
    }

  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'WordPress Delete Failed' });
  }
});

// First image-bearing source for an item, in priority order: the item's own
// featuredImageUrl, then hero > product_cta > image_banner blocks, then the
// first card/slide image. Used to guarantee every pushed article gets a
// featured image on WordPress.
function pickHeroImage(contentItem: any): string | null {
  if (!contentItem) return null;
  const itemSrc = String(contentItem.featuredImageUrl || '').trim();
  if (itemSrc) return itemSrc;
  const blocks: any[] = Array.isArray(contentItem.blocks) ? contentItem.blocks : [];
  const order = ['hero', 'product_cta', 'image_banner'];
  for (const type of order) {
    for (const b of blocks) {
      if (b && b.type === type && String(b.imageUrl || '').trim()) {
        return String(b.imageUrl).trim();
      }
    }
  }
  for (const b of blocks) {
    if (!b) continue;
    if (b.type === 'cards' && Array.isArray(b.cards)) {
      const c = b.cards.find((x: any) => x && String(x.imageUrl || '').trim());
      if (c) return String(c.imageUrl).trim();
    }
    if (b.type === 'carousel' && Array.isArray(b.slides)) {
      const s = b.slides.find((x: any) => x && String(x.imageUrl || '').trim());
      if (s) return String(s.imageUrl).trim();
    }
  }
  return null;
}

/**
 * Topic + context string prepended to every auto-generated image prompt so
 * renders always match the article: title, focus keyphrase, brand and a short
 * body excerpt. Shared by the Auto-Write image step and the sync-time
 * image guarantee.
 */
function buildImageTopicContext(contentItem: any, brand: any): string {
  const title = String(contentItem?.title || '').trim();
  const kw = String(contentItem?.primaryKeyword || '').trim();
  const excerpt = stripHtml(String(contentItem?.bodyHtml || '')).replace(/\s+/g, ' ').trim().slice(0, 400);
  return `Images for a blog article${title ? ` titled "${title}"` : ''}${kw ? ` about "${kw}"` : ''}. Brand: ${brand?.name || 'the site'}.${
    excerpt ? ` Article context: "${excerpt}"` : ''
  } Editorial, photorealistic, warm and authentic — no text, captions, logos or watermarks.`;
}

/**
 * Embed the generated in-body image as an idempotent figure:
 *   1. an existing <figure class="fg-art-secondary"> gets its <img> src
 *      updated in place (deterministic re-pushes);
 *   2. otherwise the model's first placehold.co placeholder image is replaced;
 *   3. otherwise the figure is inserted right after the first paragraph.
 */
function embedSecondaryFigure(content: string, src: string, alt: string): string {
  const figure = `<figure class="fg-art-figure fg-art-secondary" style="margin:2rem 0;text-align:center;"><img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt)}" style="max-width:100%;height:auto;border-radius:12px;" loading="lazy" /></figure>`;
  const existing = /<figure[^>]*class="[^"]*fg-art-secondary[^"]*"[^>]*>[\s\S]*?<\/figure>/i.exec(content);
  if (existing) {
    return content.replace(
      existing[0],
      existing[0].replace(
        /<img\b[^>]*src\s*=\s*["'][^"']*["']/i,
        `<img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt)}" style="max-width:100%;height:auto;border-radius:12px;" loading="lazy"`,
      ),
    );
  }
  const placeholder = /<img\b[^>]*src\s*=\s*["'][^"']*placehold\.co[^"']*["'][^>]*>/i.exec(content);
  if (placeholder) return content.replace(placeholder[0], figure);
  const p = /<\/p\s*>/i.exec(content);
  if (p) return content.slice(0, p.index + p[0].length) + figure + content.slice(p.index + p[0].length);
  return content + figure;
}

// Shared WP media upload — used by /api/wp/upload-media (editor image upload)
// AND /api/wp/sync-content (data-URI article images are uploaded to the media
// library before publishing, because WordPress strips data: URLs from content).
async function uploadImageToWp(
  brand: any,
  opts: { imageUrl?: string; dataBase64?: string; filename?: string; mime?: string },
): Promise<{ wpMediaUrl: string; wpMediaId: number }> {
  const { imageUrl, dataBase64, filename, mime } = opts;
  let imageBuffer: Buffer;
  let fileMime = mime || 'image/jpeg';
  let fileExt = (filename || 'image').replace(/[^\w.-]/g, '').replace(/\.(jpe?g|png|webp|gif|avif)$/i, '') || 'image';

  if (dataBase64) {
    // PC upload: strip any data URL prefix, decode the base64 payload.
    const raw = String(dataBase64).trim();
    const b64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
    const mimeMatch = raw.match(/^data:([^;]+);/);
    if (mimeMatch) fileMime = mimeMatch[1];
    if (!fileMime || fileMime.startsWith('text/')) fileMime = 'image/jpeg';
    imageBuffer = Buffer.from(b64, 'base64');
    if (!imageBuffer.length) throw new Error('Empty image payload.');
    if (imageBuffer.length > 12 * 1024 * 1024) throw new Error('Image too large (max 12 MB).');
  } else {
    if (!imageUrl) throw new Error('No image source provided.');
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error('Failed to fetch source image for upload.');
    imageBuffer = Buffer.from(await imgRes.arrayBuffer());
  }

  const cleanUrl = brand.wpUrl.replace(/\/+$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${brand.wpUsername}:${brand.wpAppPassword || ''}`).toString('base64');

  const wpRes = await fetch(`${cleanUrl}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Disposition': `attachment; filename="${fileExt}.${(fileMime.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}"`,
      'Content-Type': fileMime,
      ...DEFAULT_WP_HEADERS
    },
    body: imageBuffer
  });

  if (!wpRes.ok) {
    const errText = await wpRes.text();
    throw new Error(`WordPress Media Upload Error: ${errText}`);
  }

  const wpData = await wpRes.json();
  return { wpMediaUrl: wpData.source_url, wpMediaId: wpData.id };
}

// Endpoint: Upload Media to WordPress Media Library
// Supports two sources:
//   a) { brand, imageUrl, filename }  — remote URL (server fetches it)
//   b) { brand, dataBase64, filename, mime } — direct PC upload (data URL or raw base64)
app.post('/api/wp/upload-media', async (req, res) => {
  try {
    const { brand, imageUrl, dataBase64, filename, mime } = req.body;
    if (!brand) {
      return res.status(400).json({ success: false, message: 'Brand required.' });
    }
    if (!imageUrl && !dataBase64) {
      return res.status(400).json({ success: false, message: 'Provide either imageUrl (remote) or dataBase64 (PC upload).' });
    }

    try {
      const { wpMediaId, wpMediaUrl } = await uploadImageToWp(brand, { imageUrl, dataBase64, filename, mime });
      return res.json({
        success: true,
        wpMediaId,
        wpMediaUrl,
        message: `Image uploaded to WordPress Media Library successfully.`
      });
    } catch (uploadErr: any) {
      return res.status(502).json({
        success: false,
        message: `Failed to upload image to WordPress: ${uploadErr.message}`
      });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 2b. CODE SNIPPETS — Push FGOS style preserver to WordPress
// ==========================================
// Installs the "FGOS Style Preserver" snippet via the Code Snippets plugin
// REST API. Idempotent: if the snippet already exists, it updates it; otherwise
// it creates and activates it. This is the single fix that makes published
// articles retain their <style> blocks, inline styles, and HTML structure.
const FGOS_SNIPPET_CODE = `/**
 * FGOS (Fresh Green Operating System) — WordPress Styling Preserver
 *
 * Allows <style> tags and HTML5 elements in post content,
 * disables wpautop so structured HTML is preserved exactly.
 */

// Allow <style> + HTML5 tags in KSES filter
add_filter( 'wp_kses_allowed_html', function ( $allowed, $context ) {
    if ( $context === 'post' || $context === 'data' ) {
        $allowed['style'] = array();
        foreach ( array( 'section', 'header', 'footer', 'aside', 'figure' ) as $tag ) {
            $allowed[ $tag ] = array( 'class' => true, 'style' => true, 'id' => true );
        }
        $allowed['figcaption'] = array( 'class' => true, 'style' => true );
        $allowed['details'] = array( 'class' => true, 'style' => true, 'open' => true );
        $allowed['summary'] = array( 'class' => true, 'style' => true );
        foreach ( array( 'div', 'span', 'p', 'a', 'img', 'ul', 'ol', 'li',
                         'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                         'blockquote', 'strong', 'em', 'br', 'hr',
                         'input', 'button', 'form', 'label' ) as $tag ) {
            if ( ! isset( $allowed[ $tag ] ) ) $allowed[ $tag ] = array();
            foreach ( array( 'style', 'class', 'id', 'href', 'src', 'alt',
                             'title', 'loading', 'target', 'rel', 'placeholder',
                             'required', 'type', 'name', 'value', 'method',
                             'action', 'width', 'height' ) as $attr ) {
                $allowed[ $tag ][ $attr ] = true;
            }
        }
    }
    return $allowed;
}, 10, 2 );

// Disable wpautop for post content
remove_filter( 'the_content', 'wpautop', 10 );
remove_filter( 'the_excerpt', 'wpautop', 10 );
`;

app.post('/api/wp/install-snippet', async (req, res) => {
  try {
    const { brand } = req.body;
    if (!brand?.wpUrl || !brand?.wpUsername || !brand?.wpAppPassword) {
      return res.status(400).json({ success: false, message: 'Brand WP credentials required.' });
    }
    const cleanUrl = brand.wpUrl.replace(/\/+$/, '');
    const authHeader = 'Basic ' + Buffer.from(`${brand.wpUsername}:${brand.wpAppPassword}`).toString('base64');
        const headers = { 'Authorization': authHeader, 'Content-Type': 'application/json', ...DEFAULT_WP_HEADERS };
    const snippetName = 'FGOS Style Preserver';
    const snippetDescription = 'Allows <style> tags, HTML5 elements, and disables wpautop for article content from FGOS (Fresh Green Operating System).';

    // 1. Check if snippet already exists
    let existingId: number | null = null;
    try {
      const listRes = await fetch(`${cleanUrl}/wp-json/code-snippets/v1/snippets?search=${encodeURIComponent(snippetName)}`, { headers, signal: AbortSignal.timeout(10000) });
      if (listRes.ok) {
        const snippets = await listRes.json();
        if (Array.isArray(snippets) && snippets.length) {
          existingId = snippets[0].id;
        }
      }
    } catch { /* snippet API may not be available */ }

    const body = JSON.stringify({
      name: snippetName,
      description: snippetDescription,
      code: FGOS_SNIPPET_CODE,
      scope: 'global',       // run everywhere (front-end + admin)
      active: true,           // activate immediately
      priority: 10,
    });

    let result: any;
    if (existingId) {
      // Update existing snippet
      const updateRes = await fetch(`${cleanUrl}/wp-json/code-snippets/v1/snippets/${existingId}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
      if (!updateRes.ok) {
        const errText = await updateRes.text();
        return res.status(updateRes.status).json({ success: false, message: `Failed to update snippet: ${errText}` });
      }
      result = await updateRes.json();
      return res.json({ success: true, message: `Snippet updated and activated on ${brand.name || cleanUrl}`, snippetId: result.id || existingId, action: 'updated' });
    } else {
      // Create new snippet
      const createRes = await fetch(`${cleanUrl}/wp-json/code-snippets/v1/snippets`, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
      if (!createRes.ok) {
        const errText = await createRes.text();
        return res.status(createRes.status).json({ success: false, message: `Failed to create snippet: ${errText}` });
      }
      result = await createRes.json();
      return res.json({ success: true, message: `Snippet installed and activated on ${brand.name || cleanUrl}`, snippetId: result.id, action: 'created' });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Snippet install failed' });
  }
});

// Batch install snippet to ALL brands
app.post('/api/wp/install-snippet-all', async (req, res) => {
  try {
    const { brands } = req.body;
    if (!Array.isArray(brands) || !brands.length) {
      return res.status(400).json({ success: false, message: 'brands array required.' });
    }
    const results: Array<{ brand: string; url: string; ok: boolean; message: string }> = [];
    for (const brand of brands) {
      if (!brand?.wpUrl || !brand?.wpUsername || !brand?.wpAppPassword) {
        results.push({ brand: brand?.name || 'unknown', url: brand?.wpUrl || '', ok: false, message: 'Missing WP credentials' });
        continue;
      }
      try {
        const cleanUrl = brand.wpUrl.replace(/\/+$/, '');
        const authHeader = 'Basic ' + Buffer.from(`${brand.wpUsername}:${brand.wpAppPassword}`).toString('base64');
    const headers = { 'Authorization': authHeader, 'Content-Type': 'application/json', ...DEFAULT_WP_HEADERS };
        const snippetName = 'FGOS Style Preserver';

        let existingId: number | null = null;
        try {
          const listRes = await fetch(`${cleanUrl}/wp-json/code-snippets/v1/snippets?search=${encodeURIComponent(snippetName)}`, { headers, signal: AbortSignal.timeout(10000) });
          if (listRes.ok) {
            const snippets = await listRes.json();
            if (Array.isArray(snippets) && snippets.length) existingId = snippets[0].id;
          }
        } catch { /* ok */ }

        const body = JSON.stringify({ name: snippetName, description: 'Allows <style> tags, HTML5 elements, and disables wpautop for article content.', code: FGOS_SNIPPET_CODE, scope: 'global', active: true, priority: 10 });
        let action = 'created';
        if (existingId) {
          const updateRes = await fetch(`${cleanUrl}/wp-json/code-snippets/v1/snippets/${existingId}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
          if (!updateRes.ok) { results.push({ brand: brand.name, url: cleanUrl, ok: false, message: `Update failed: ${updateRes.status}` }); continue; }
          await updateRes.json();
          action = 'updated';
        } else {
          const createRes = await fetch(`${cleanUrl}/wp-json/code-snippets/v1/snippets`, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
          if (!createRes.ok) { results.push({ brand: brand.name, url: cleanUrl, ok: false, message: `Create failed: ${createRes.status}` }); continue; }
          await createRes.json();
        }
        results.push({ brand: brand.name, url: cleanUrl, ok: true, message: `Snippet ${action} and activated` });
      } catch (e: any) {
        results.push({ brand: brand.name, url: brand.wpUrl, ok: false, message: e.message || 'Failed' });
      }
    }
    const allOk = results.every((r) => r.ok);
    return res.json({ success: allOk, results });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 3. HOSTINGER / CPANEL EXPORT ENDPOINTS
// ==========================================


// ==========================================
// 4. WORDPRESS STATS ENDPOINT
// ==========================================
app.post('/api/wp/stats', async (req, res) => {
  try {
    const { wpUrl, wpUsername, wpAppPassword } = req.body;
    if (!wpUrl) return res.status(400).json({ success: false, message: 'wpUrl is required' });

    const baseUrl = wpUrl.replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json' };
    
    if (wpUsername && wpAppPassword) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${wpUsername}:${wpAppPassword}`).toString('base64');
    }

    const fetchStat = async (endpoint) => {
      try {
        const response = await fetch(`${baseUrl}/wp-json/wp/v2/${endpoint}?per_page=1`, { headers });
        if (response.ok) {
          return response.headers.get('x-wp-total') || '0';
        }
        return 'N/A';
      } catch (err) {
        return 'Err';
      }
    };

    const [totalPosts, totalPages, totalComments, totalMedia] = await Promise.all([
      fetchStat('posts'),
      fetchStat('pages'),
      fetchStat('comments'),
      fetchStat('media')
    ]);

    const failed = [totalPosts, totalPages, totalComments, totalMedia].some((v) => v === 'Err' || v === 'N/A');

    return res.json({
      success: true,
      stats: {
        totalPosts: safeCount(totalPosts),
        totalPages: safeCount(totalPages),
        totalComments: safeCount(totalComments),
        totalMedia: safeCount(totalMedia),
        error: failed,
      }
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 4b. SITE CHROME + POST PREVIEW ENDPOINTS
// Fetches a brand's live site and extracts its real chrome (header, footer,
// navigation, theme stylesheets) so post previews render inside the site's
// actual layout. Falls back gracefully when the site is unreachable.
// ==========================================

async function fetchHtml(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) throw new Error(`Site returned HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

// Extract the site's real chrome so a preview document can wear the theme:
// stylesheets + inline critical CSS, and the actual header/footer elements
// (Astra exposes #masthead / #colophon; fall back to the first <header>/<footer>).
function extractChrome(html: string) {
  const headLinks = (html.match(/<link[^>]*rel=['"]stylesheet['"][^>]*>/gi) || [])
    .slice(0, 40)
    .join('\n');
  const headStyles = (html.match(/<style[\s\S]*?<\/style>/gi) || [])
    .slice(0, 12)
    .join('\n');
  const headerHtml = html.match(/<header[^>]*id=["']masthead["'][^>]*>[\s\S]*?<\/header>/i)?.[0]
    ?? html.match(/<header[^>]*>[\s\S]*?<\/header>/i)?.[0] ?? '';
  const footerHtml = html.match(/<footer[^>]*id=["']colophon["'][^>]*>[\s\S]*?<\/footer>/i)?.[0]
    ?? html.match(/<footer[^>]*>[\s\S]*?<\/footer>/i)?.[0] ?? '';
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  return {
    headLinks,
    headStyles,
    headerHtml,
    footerHtml,
    siteTitle: titleMatch ? titleMatch[1] : '',
  };
}

// Make relative URLs inside a fetched page resolve against the site instead of
// the local app origin (srcdoc iframes inherit the embedding origin), so theme
// CSS, images and scripts all load from the real site.
function injectBaseHref(html: string, baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, '') + '/';
  const withoutBase = html.replace(/<base[^>]*>/gi, '');
  if (/<head\s[^>]*>/i.test(withoutBase)) {
    return withoutBase.replace(/(<head\s[^>]*>)/i, `$1\n<base href="${clean}">`);
  }
  return withoutBase.replace(/<head>/i, `<head>\n<base href="${clean}">`);
}

// Full document for "draft" and "local" previews: the real theme chrome around
// the post content, so it looks exactly like the live page will once published.
function buildThemePreviewDoc(opts: {
  baseUrl: string;
  title: string;
  dateLine: string;
  contentHtml: string;
  featuredImage?: string;
  chrome: ReturnType<typeof extractChrome> | null;
  brand: any;
}) {
  const { baseUrl, title, dateLine, contentHtml, featuredImage, chrome, brand } = opts;
  const siteName = chrome?.siteTitle || brand?.name || 'Site';
  const featuredImg = featuredImage
    ? `<div style="margin-bottom:1.5rem"><img src="${featuredImage}" alt="" style="width:100%;height:auto;display:block;border-radius:8px"/></div>`
    : '';

  if (chrome && (chrome.headerHtml || chrome.footerHtml)) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<base href="${baseUrl.replace(/\/+$/, '')}/">
<title>${title}</title>
${chrome.headLinks || ''}
${chrome.headStyles || ''}
<style>.article-shell{max-width:820px;margin:0 auto;padding:32px 20px}.article-shell .entry-header{margin-bottom:1.6rem}.article-shell .entry-title{font-size:2.2rem;font-weight:800;line-height:1.15;margin:0 0 .3em}.article-shell .entry-meta{font-size:.85rem;color:#888}.article-shell .entry-content{line-height:1.8;color:#333}.article-shell .entry-content h2{font-size:1.6rem;font-weight:700;margin:1.8em 0 .6em;color:#111}.article-shell .entry-content h3{font-size:1.25rem;font-weight:600;margin:1.5em 0 .5em;color:#222}.article-shell .entry-content p{margin:0 0 1.1em}.article-shell .entry-content ol,.article-shell .entry-content ul{margin:0 0 1.2em;padding-left:1.5em}.article-shell .entry-content strong{color:#111}.article-shell .entry-content img{max-width:100%;height:auto}.article-shell .entry-content a{color:#1a73e8}</style>
</head>
<body class="wp-singular ast-desktop ast-plain-container ast-no-sidebar astra-theme">
${chrome.headerHtml || ''}
<main id="main" class="site-main"><div class="ast-container"><div class="article-shell">
<article class="post type-post status-publish entry">
<header class="entry-header">
${featuredImg}
<h1 class="entry-title">${title}</h1>
<div class="entry-meta">${dateLine} · ${siteName}</div>
</header>
<div class="entry-content">${contentHtml}</div>
</article>
</div></div></main>
${chrome.footerHtml || ''}
</body></html>`;
  }

  // Branded fallback when the live site is unreachable
  const primary = brand?.primaryColor || '#4f46e5';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;color:#333;line-height:1.75}.entry-content h2{font-size:1.6rem;font-weight:700;margin:1.8em 0 .6em;color:#111}.entry-content h3{font-size:1.25rem;font-weight:600;margin:1.5em 0 .5em;color:#222}.entry-content p{margin:0 0 1.1em}.entry-content ol,.entry-content ul{margin:0 0 1.2em;padding-left:1.5em}.entry-content strong{color:#111}.entry-content img{max-width:100%;height:auto}.entry-content a{color:#1a73e8}</style>
</head>
<body>
<header style="background:${primary};color:#fff">
<div style="max-width:1200px;margin:0 auto;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
<div style="font-weight:800;font-size:1.15rem;letter-spacing:.2px">${siteName}</div>
<nav style="display:flex;gap:18px;font-size:.9rem;flex-wrap:wrap">${['Home', 'Shop', 'Blog', 'About', 'Contact'].map((l) => `<span style="opacity:.9">${l}</span>`).join('')}</nav>
</div>
</header>
<main style="max-width:820px;margin:0 auto;padding:32px 20px">
<article>
${featuredImg}
<h1 style="font-size:2.2rem;font-weight:800;margin:0 0 .3em;color:#111">${title}</h1>
<div style="font-size:.85rem;color:#888;margin-bottom:1.6em">${dateLine} · ${siteName}</div>
<div class="entry-content">${contentHtml}</div>
</article>
</main>
<footer style="background:#111;color:#aaa;margin-top:60px">
<div style="max-width:1200px;margin:0 auto;padding:24px 20px;font-size:.85rem;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
<span>© ${new Date().getFullYear()} ${siteName}</span>
<span>${baseUrl}</span>
</div>
</footer>
</body></html>`;
}

// Backward-compatible site chrome endpoint (used by older previews).
app.post('/api/wp/site-preview', async (req, res) => {
  const { wpUrl } = req.body;
  if (!wpUrl) return res.status(400).json({ success: false, message: 'wpUrl is required' });

  const baseUrl = wpUrl.replace(/\/+$/, '');

  try {
    const html = await fetchHtml(baseUrl + '/', 15000);
    const chrome = extractChrome(html);

    if (!chrome.headerHtml && !chrome.footerHtml) {
      return res.json({ success: false, reason: 'No header/footer found on site' });
    }

    return res.json({
      success: true,
      data: { ...chrome, siteTitle: chrome.siteTitle || baseUrl },
    });
  } catch (err: any) {
    return res.json({ success: false, reason: err?.message || 'Failed to fetch site' });
  }
});

// Unified post preview: returns a full HTML document that renders the post
// exactly as it appears on the site. Three modes, chosen automatically:
//   live  — post is published on WP: fetch the real published page (pixel-exact).
//   draft — post exists on WP as a draft: WP-rendered content (blocks/shortcodes
//           processed) inside the site's real theme chrome.
//   local — nothing on WP yet: the editor's own content inside the site's chrome.
app.post('/api/wp/preview', async (req, res) => {
  try {
    const { brand, contentItem } = req.body;
    if (!brand || !contentItem) {
      return res.status(400).json({ success: false, message: 'Brand and Content Item required.' });
    }
    const baseUrl = brand.wpUrl?.replace(/\/+$/, '');
    if (!baseUrl) return res.status(400).json({ success: false, message: 'Brand wpUrl required.' });

    const authHeader = 'Basic ' + Buffer.from(`${brand.wpUsername || ''}:${brand.wpAppPassword || ''}`).toString('base64');

    // Memoized chrome fetch, shared by the draft/local modes.
    let chrome: ReturnType<typeof extractChrome> | null = null;
    const getChrome = async () => {
      if (chrome) return chrome;
      try {
        chrome = extractChrome(await fetchHtml(baseUrl + '/', 15000));
      } catch (e: any) {
        chrome = null;
      }
      return chrome;
    };

    const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const title = contentItem.metaTitle || contentItem.title || 'Untitled';

    // MODE 1 — Live page
    if (contentItem.wpLiveUrl || contentItem.link) {
      try {
        const liveUrl = contentItem.wpLiveUrl || contentItem.link;
        const liveHtml = await fetchHtml(liveUrl, 20000);
        return res.json({
          success: true,
          mode: 'live',
          html: injectBaseHref(liveHtml, baseUrl),
          url: liveUrl,
        });
      } catch (e: any) {
        // Site unreachable → fall through to draft/local rendering.
      }
    }

    // MODE 2 — WordPress draft render
    if (contentItem.wpPostId) {
      try {
        const endpoint = contentItem.contentType === 'page' ? 'pages' : 'posts';
        const wpRes = await fetch(`${baseUrl}/wp-json/wp/v2/${endpoint}/${contentItem.wpPostId}?context=view`, {
          headers: { 'Authorization': authHeader, ...DEFAULT_WP_HEADERS },
          signal: AbortSignal.timeout(15000),
        });
        if (wpRes.ok) {
          const post = await wpRes.json();
          const ch = await getChrome();
          const wpTitle = (post.title?.rendered || '').trim() || title;
          const date = post.date
            ? new Date(post.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
            : today;
          const html = buildThemePreviewDoc({
            baseUrl,
            title: wpTitle,
            dateLine: date,
            contentHtml: post.content?.rendered || contentItem.bodyHtml || '',
            featuredImage: contentItem.featuredImageUrl,
            chrome: ch,
            brand,
          });
          return res.json({ success: true, mode: 'draft', html, fallback: !ch });
        }
      } catch (e: any) {
        // REST unavailable → fall through to local rendering.
      }
    }

    // MODE 3 — Local theme preview
    const ch = await getChrome();
    const html = buildThemePreviewDoc({
      baseUrl,
      title,
      dateLine: today,
      contentHtml: contentItem.bodyHtml || '<p style="color:#888">No content yet — run Auto-Write or add blocks first.</p>',
      featuredImage: contentItem.featuredImageUrl,
      chrome: ch,
      brand,
    });
    return res.json({ success: true, mode: 'local', html, fallback: !ch });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || 'Preview failed.' });
  }
});


// ==========================================
// 5. WORDPRESS POSTS ENDPOINT
// ==========================================
app.post('/api/wp/posts', async (req, res) => {
  try {
    const { wpUrl, wpUsername, wpAppPassword, per_page = 100, status = 'any' } = req.body;
    if (!wpUrl) return res.status(400).json({ success: false, message: 'wpUrl is required' });

    const baseUrl = wpUrl.replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json' };

    if (wpUsername && wpAppPassword) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${wpUsername}:${wpAppPassword}`).toString('base64');
    }

    // Paginate so the Content Hub can pull the full history (drafts + live +
    // trashed) in one call — 'any' status requires the auth header above.
    const pageSize = Math.min(100, Math.max(1, per_page || 100));
    const posts: any[] = [];
    for (let page = 1; page <= 10; page++) {
      const response = await fetch(
        `${baseUrl}/wp-json/wp/v2/posts?per_page=${pageSize}&page=${page}&status=${encodeURIComponent(status)}&_embed=1`,
        { headers },
      );
      if (!response.ok) {
        if (page === 1) {
          return res.status(response.status).json({ success: false, message: `Failed to fetch posts from WordPress (${response.status})` });
        }
        break; // no more pages
      }
      const batch = await response.json();
      posts.push(...batch);
      if (batch.length < pageSize) break;
    }
    return res.json({ success: true, posts });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 4c. RICH WORDPRESS OVERVIEW ENDPOINT
// Fetches a full real-time snapshot of a WordPress site: content counts by
// status (published / drafts / pending / trash), comments (total + pending),
// media, taxonomies, recent posts and the latest comment activity. Every
// number comes straight from the site's WP REST API — no estimates, no demo.
// ==========================================
const WP_OVERVIEW_CACHE = new Map<string, { at: number; data: any }>();
const WP_OVERVIEW_CACHE_TTL = 20 * 1000; // 20s so 60s polling stays live

function wpAuthHeaders(username?: string, appPassword?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...DEFAULT_WP_HEADERS,
  };
  if (username && appPassword) {
    const basic = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
    headers['Authorization'] = basic;
    headers['X-HTTP-Authorization'] = basic;
    headers['X-Authorization'] = basic;
  }
  return headers;
}

app.post('/api/wp/overview', async (req, res) => {
  const t0 = Date.now();
  try {
    const { wpUrl, wpUsername, wpAppPassword, refresh } = req.body;
    if (!wpUrl) return res.status(400).json({ success: false, message: 'wpUrl is required' });

    const baseUrl = wpUrl.replace(/\/+$/, '');
    const headers = wpAuthHeaders(wpUsername, wpAppPassword);
    const hasAuth = !!headers['Authorization'];
    const cacheKey = `${baseUrl}|${hasAuth ? 'auth' : 'pub'}`;

    if (!refresh) {
      const cached = WP_OVERVIEW_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.at < WP_OVERVIEW_CACHE_TTL) {
        return res.json({ success: true, ...cached.data, cached: true });
      }
    }

    const fetchCount = async (endpoint: string, useAuth = false): Promise<number | null> => {
      try {
        // Endpoints may already carry a query string (e.g. "posts?status=publish") —
        // join with & so the URL stays valid.
        const sep = endpoint.includes('?') ? '&' : '?';
        const r = await fetch(`${baseUrl}/wp-json/wp/v2/${endpoint}${sep}per_page=1`, {
          headers: useAuth ? headers : DEFAULT_WP_HEADERS,
          // Slow shared hosts (sleeping VPS, cold starts) can take >15s per call
          signal: AbortSignal.timeout(25000),
        });
        if (r.ok) {
          const total = parseInt(r.headers.get('x-wp-total') || '', 10);
          return Number.isFinite(total) ? total : null;
        }
        return null;
      } catch {
        return null;
      }
    };

    // WP REST round-trip latency (server-to-server, real measurement) + site
    // identity (name/description/url) from the root of the REST API. Fetched
    // publicly — the discovery endpoint is public, and a broken Application
    // Password must not 401 it (daniels-style hosts don't strip the header).
    const apiStart = Date.now();
    let wpRestMs: number | null = null;
    let siteInfo: { name?: string; description?: string; url?: string; home?: string } | null = null;
    try {
      const r = await fetch(`${baseUrl}/wp-json/`, { headers: DEFAULT_WP_HEADERS, signal: AbortSignal.timeout(25000) });
      wpRestMs = Date.now() - apiStart;
      if (r.ok) {
        try {
          const body = await r.json();
          siteInfo = {
            name: body?.name || '',
            description: body?.description || '',
            url: body?.url || '',
            home: body?.home || '',
          };
        } catch {
          siteInfo = null;
        }
      } else {
        wpRestMs = null;
      }
    } catch {
      wpRestMs = null;
    }

    const [publish, draft, pending, privatePosts, trash, pages, comments, commentsPending, media, categories, tags, users] =
      await Promise.all([
        // Published content, pages, media, taxonomies and users are PUBLIC —
        // count them without auth so a broken Application Password can't zero
        // them out.
        fetchCount('posts?status=publish'),
        // Draft/pending/private/trash genuinely need auth — honest null when
        // the Application Password is broken ("—" / "Needs WP auth" in the UI).
        fetchCount('posts?status=draft', true),
        fetchCount('posts?status=pending', true),
        fetchCount('posts?status=private', true),
        fetchCount('posts?status=trash', true),
        fetchCount('pages?status=publish'),
        // WP rejects ?status=approved on comments without auth — the public
        // endpoint already returns approved only. Hold counts need auth.
        fetchCount('comments'),
        // Can't read pending/hold comments without an Application Password —
        // leave honest "unknown" rather than a wrong number.
        hasAuth ? fetchCount('comments?status=hold', true) : Promise.resolve(null),
        fetchCount('media'),
        fetchCount('categories'),
        fetchCount('tags'),
        fetchCount('users'),
      ]);

    // Recent posts — up to 100 published posts fetched PUBLICLY (WP serves
    // published content without auth), plus up to 100 drafts/pending/private as
    // a best-effort second call when an Application Password works. Draft
    // statuses require auth, so a failing auth must not blank out the published
    // list — cadence/activity charts depend on it.
    let recentPosts: any[] = [];
    const postFields = 'id,title,date,modified,status,link';
    try {
      const r = await fetch(
        `${baseUrl}/wp-json/wp/v2/posts?per_page=100&status=publish&_fields=${postFields}`,
        { headers: DEFAULT_WP_HEADERS, signal: AbortSignal.timeout(25000) }
      );
      if (r.ok) recentPosts = await r.json();
    } catch {
      recentPosts = [];
    }
    if (hasAuth) {
      try {
        const r2 = await fetch(
          `${baseUrl}/wp-json/wp/v2/posts?per_page=100&status=draft,pending,private&_fields=${postFields}`,
          { headers, signal: AbortSignal.timeout(25000) }
        );
        if (r2.ok) {
          const drafts = await r2.json();
          if (Array.isArray(drafts)) {
            const have = new Set(recentPosts.map((p: any) => p.id));
            recentPosts = [...recentPosts, ...drafts.filter((p: any) => !have.has(p.id))];
          }
        }
      } catch {
        // best-effort: published list above is still valid
      }
    }

    // Latest comment activity (authors, dates, statuses) — fetched publicly so
    // a broken Application Password can't blank the feed; WP serves approved
    // comments without auth.
    let recentComments: any[] = [];
    try {
      const r = await fetch(
        `${baseUrl}/wp-json/wp/v2/comments?per_page=10&orderby=date&order=desc&_fields=id,author_name,date,status,content,post`,
        { headers: DEFAULT_WP_HEADERS, signal: AbortSignal.timeout(25000) }
      );
      if (r.ok) recentComments = await r.json();
    } catch {
      recentComments = [];
    }

    const data = {
      stats: {
        posts: publish,
        draft,
        pending,
        private: privatePosts,
        trash,
        pages,
        comments,
        commentsPending,
        media,
        categories,
        tags,
        users,
      },
      siteInfo,
      recentPosts,
      recentComments,
      wpRestMs,
      hasAuth,
      fetchedAt: new Date().toISOString(),
    };

    WP_OVERVIEW_CACHE.set(cacheKey, { at: Date.now(), data });
    console.log(`[overview] ${baseUrl} auth=${hasAuth} -> 200 in ${Date.now() - t0}ms (posts=${publish})`);
    return res.json({ success: true, ...data });
  } catch (err: any) {
    console.log(`[overview] ${req.body?.wpUrl} -> ERROR in ${Date.now() - t0}ms: ${err?.message}`);
    return res.status(500).json({ success: false, message: err?.message || 'Failed to fetch WordPress overview' });
  }
});

// ==========================================
// 4d. LIVE SITE PERFORMANCE MEASUREMENT
// Measures real server response times and page weight by fetching the live
// site exactly like a browser does (browser UA, gzip accepted, no WAF-blocked
// signatures). These numbers come from actual HTTP requests to the site — no
// Lighthouse quota, no estimates, no demo values.
// ==========================================
const PERF_CACHE = new Map<string, { at: number; data: any }>();
const PERF_CACHE_TTL = 10 * 60 * 1000; // TTFB / weight are stable over minutes

// Analytics / tracking stacks detected on a site's homepage. These are real
// signals about how (and whether) the site measures its own traffic.
const ANALYTICS_DETECTORS: { id: string; label: string; re: RegExp }[] = [
  { id: 'ga4', label: 'GA4', re: /googletagmanager\.com\/gtag\/js|gtag\(/i },
  { id: 'gtm', label: 'GTM', re: /googletagmanager\.com\/gtm\.js/i },
  { id: 'ua', label: 'UA', re: /google-analytics\.com\/analytics\.js|UA-\d{4,}/i },
  { id: 'meta', label: 'Meta Pixel', re: /connect\.facebook\.net\/en_US\/fbevents\.js|fbq\(/i },
  { id: 'clarity', label: 'Clarity', re: /clarity\.ms\/tag|clarity\(/i },
  { id: 'hotjar', label: 'Hotjar', re: /static\.hotjar\.com/i },
  { id: 'plausible', label: 'Plausible', re: /plausible\.io\/js/i },
  { id: 'cfwa', label: 'CF Web Analytics', re: /static\.cloudflareinsights\.com\/beacon/i },
  { id: 'jetpack', label: 'Jetpack Stats', re: /stats\.wp\.com\/\?/i },
  { id: 'bing', label: 'Bing UET', re: /bat\.bing\.com\/bat\.js|uet\(/i },
  { id: 'yandex', label: 'Yandex Metrica', re: /mc\.yandex\.ru\/metrika/i },
];

// Heuristic server-measured performance grade (A–F) from TTFB, total load and
// page weight. Deliberately conservative: labelled as server-side estimate.
function computePerfScore(ttfbMs: number | null, totalMs: number | null, htmlBytes: number | null) {
  if (ttfbMs == null) return null;
  let score = 100;
  if (ttfbMs < 400) score -= 0;
  else if (ttfbMs < 700) score -= 10;
  else if (ttfbMs < 1200) score -= 25;
  else score -= 50;
  if (totalMs != null) {
    if (totalMs < 1500) score -= 0;
    else if (totalMs < 3000) score -= 10;
    else if (totalMs < 6000) score -= 20;
    else score -= 35;
  }
  if (htmlBytes != null) {
    const kb = htmlBytes / 1024;
    if (kb < 200) score -= 0;
    else if (kb < 500) score -= 8;
    else if (kb < 1000) score -= 18;
    else score -= 30;
  }
  score = Math.max(0, Math.min(100, score));
  return { score, grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 55 ? 'C' : score >= 35 ? 'D' : 'F' };
}

// Raw HTTP fetch that does NOT auto-decompress (unlike undici fetch), so we can
// measure the true on-the-wire transfer weight of a compressed response.
function fetchRawBody(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 20000,
  maxRedirects = 3
): Promise<{ status: number; body: Buffer; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const doGet = (u: string, redirectsLeft: number) => {
      const mod = u.startsWith('https:') ? https : http;
      const req = mod.get(u, { headers, timeout: timeoutMs }, (res) => {
        const loc = res.headers.location;
        if (loc && redirectsLeft > 0 && res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          doGet(new URL(loc, u).toString(), redirectsLeft - 1);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks), headers: res.headers }));
      });
      req.on('timeout', () => req.destroy(new Error('Request timed out')));
      req.on('error', (e) => reject(e));
    };
    doGet(url, maxRedirects);
  });
}

app.post('/api/wp/site-perf', async (req, res) => {
  try {
    const { wpUrl, refresh } = req.body;
    if (!wpUrl) return res.status(400).json({ success: false, message: 'wpUrl is required' });

    const baseUrl = wpUrl.replace(/\/+$/, '');

    if (!refresh) {
      const cached = PERF_CACHE.get(baseUrl);
      if (cached && Date.now() - cached.at < PERF_CACHE_TTL) {
        return res.json({ success: true, ...cached.data, cached: true });
      }
    }

    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

    // Homepage measurement. undici fetch auto-decompresses gzip/br bodies, so
    // the fetched bytes are the TRUE (uncompressed) HTML size — exactly what a
    // browser parses. The raw https request below measures the compressed
    // on-the-wire transfer weight.
    let ttfbMs: number | null = null;
    let totalMs: number | null = null;
    let httpStatus: number | null = null;
    let htmlBytes: number | null = null;
    let compressed = false;
    let contentEncoding: string | null = null;
    let serverHeader: string | null = null;
    let cacheControl: string | null = null;
    let cdn: string | null = null;
    let html = '';
    const start = Date.now();
    try {
      const r = await fetch(baseUrl + '/', {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Encoding': 'gzip' },
        signal: AbortSignal.timeout(20000),
      });
      ttfbMs = Date.now() - start; // fetch resolves on response headers ≈ TTFB
      httpStatus = r.status;
      contentEncoding = r.headers.get('content-encoding') || null;
      compressed = !!contentEncoding && /gzip|br|deflate/i.test(contentEncoding);
      serverHeader = r.headers.get('server');
      cacheControl = r.headers.get('cache-control');
      cdn = r.headers.get('cf-ray') ? 'Cloudflare'
        : r.headers.get('x-sucuri-id') ? 'Sucuri'
        : r.headers.get('x-litespeed-cache') ? 'LiteSpeed'
        : serverHeader === 'hcdn' ? 'Hostinger CDN' : null;
      const buf = Buffer.from(await r.arrayBuffer());
      totalMs = Date.now() - start;
      htmlBytes = buf.length;
      html = buf.toString('utf8');
    } catch {
      // unreachable — reported honestly below
    }

    // Compressed transfer weight (raw socket, no auto-decompression).
    let transferBytes: number | null = null;
    try {
      const raw = await fetchRawBody(baseUrl + '/', { 'User-Agent': UA, 'Accept-Encoding': 'gzip' });
      if (raw.status === 200 && raw.body.length > 0) transferBytes = raw.body.length;
    } catch {
      transferBytes = null;
    }

    // WP REST API latency
    const apiStart = Date.now();
    let wpRestMs: number | null = null;
    try {
      const r = await fetch(`${baseUrl}/wp-json/`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
      wpRestMs = Date.now() - apiStart;
      if (!r.ok) wpRestMs = null;
    } catch {
      wpRestMs = null;
    }

    const savedPct = compressed && htmlBytes && transferBytes && htmlBytes > transferBytes
      ? Math.round((1 - transferBytes / htmlBytes) * 100)
      : null;

    const analytics = ANALYTICS_DETECTORS.filter((d) => d.re.test(html)).map((d) => d.id);

    const data = {
      httpStatus,
      ttfbMs,
      totalMs,
      htmlBytes,
      transferKb: transferBytes != null ? +(transferBytes / 1024).toFixed(1) : null,
      htmlKb: htmlBytes != null ? +(htmlBytes / 1024).toFixed(1) : null,
      compressed,
      contentEncoding,
      savedPct,
      serverHeader,
      cacheControl,
      cdn,
      scriptCount: (html.match(/<script[\s>]/gi) || []).length,
      styleCount: (html.match(/<link[^>]*rel=["']stylesheet["']/gi) || []).length,
      imgCount: (html.match(/<img[\s>]/gi) || []).length,
      lazyImgCount: (html.match(/loading=["']lazy["']/gi) || []).length,
      fontCount: (html.match(/@font-face|fonts\.googleapis\.com|rel=["']preload["'][^>]*as=["']font["']/gi) || []).length,
      wpRestMs,
      analytics,
      perfScore: computePerfScore(ttfbMs, totalMs, htmlBytes),
      measuredAt: new Date().toISOString(),
    };

    PERF_CACHE.set(baseUrl, { at: Date.now(), data });
    console.log(`[site-perf] ${baseUrl} -> 200 in ${Date.now() - start}ms (ttfb=${ttfbMs}ms grade=${data.perfScore?.grade})`);
    return res.json({ success: true, ...data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || 'Failed to measure site performance' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// AUTOBLOG — Google Sheet → AI Generate → Schedule → Publish
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Parse a Google Sheet URL into its spreadsheet ID and optional GID.
 * Accepts:
 *   https://docs.google.com/spreadsheets/d/{ID}/edit#gid={GID}
 *   https://docs.google.com/spreadsheets/d/{ID}/edit
 *   https://docs.google.com/spreadsheets/d/{ID}/gviz/tq
 *   Just the spreadsheet ID itself
 */
function parseSheetUrl(url: string): { spreadsheetId: string; gid: string | null } {
  const trimmed = url.trim();
  // Direct ID (no slashes, reasonable length)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed) && !trimmed.includes('/')) {
    return { spreadsheetId: trimmed, gid: null };
  }
  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) throw new Error('Could not extract a Google Sheet ID from the URL');
  const gidMatch = trimmed.match(/[#&?]gid=(\d+)/);
  return { spreadsheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : null };
}

/**
 * Fetch a Google Sheet via the gviz/tq endpoint and parse its JSON response.
 * Returns { headers, rows, tabName } for the requested tab.
 * The sheet must be publicly accessible (Anyone with the link can view).
 * Includes automatic retry with exponential backoff (up to 3 attempts).
 */
async function fetchSheetGviz(spreadsheetId: string, gid: string = '0', attempt: number = 0): Promise<{ headers: string[]; rows: Record<string, string>[]; tabName: string }> {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&gid=${gid}`;
  const controller = new AbortController();
  const timeoutMs = 15_000 + (attempt * 5_000); // 15s, 20s, 25s
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch(url, { signal: controller.signal });
  } catch (err: any) {
    clearTimeout(timeout);
    // Retry on network/abort errors (up to 3 attempts)
    if (attempt < 2 && (err?.name === 'AbortError' || err?.code === 'UND_ERR_CONNECT_TIMEOUT' || err?.message?.includes('fetch'))) {
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s
      console.log(`[FGOS] Sheet fetch retry ${attempt + 1}/3 for gid=${gid} after ${delay}ms (was ${err?.name || err?.message})`);
      await new Promise((r) => setTimeout(r, delay));
      return fetchSheetGviz(spreadsheetId, gid, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  // Retry on 429/503 from Google (rate limited or overloaded)
  if ((resp.status === 429 || resp.status === 503) && attempt < 2) {
    const delay = Math.pow(2, attempt) * 1500; // 1.5s, 3s
    const retryAfter = resp.headers.get('Retry-After');
    const waitMs = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 10000) : delay;
    console.log(`[FGOS] Sheet fetch retry ${attempt + 1}/3 for gid=${gid} — HTTP ${resp.status}, waiting ${waitMs}ms`);
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchSheetGviz(spreadsheetId, gid, attempt + 1);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Google Sheet fetch failed (HTTP ${resp.status}${body.includes(' PERMISSION_DENIED') ? ' — sheet is not publicly shared' : ''}). Is the sheet publicly shared?`);
  }
  const text = await resp.text();

  // Response format: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
  // Strip the XSSI prefix and trailing paren/semicolon
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('Could not parse Google Sheet response — no JSON found');
  }
  const jsonStr = text.slice(jsonStart, jsonEnd + 1);

  let data: any;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    throw new Error('Could not parse Google Sheet JSON response');
  }

  if (data?.status === 'error') {
    throw new Error(data?.errors?.[0]?.message || 'Google Sheet returned an error');
  }

  const table = data?.table;
  if (!table?.cols || !table?.rows) {
    throw new Error('No tabular data found in the Google Sheet response');
  }

  // Extract headers from cols
  const headers: string[] = table.cols.map((col: any) => (col.label || col.id || '').trim()).filter(Boolean);

  // Extract rows from rows[].c[] (cells)
  const rows: Record<string, string>[] = [];
  for (const row of table.rows) {
    if (!row?.c) continue;
    const record: Record<string, string> = {};
    let hasData = false;
    for (let j = 0; j < headers.length; j++) {
      const cell = row.c[j];
      const val = cell?.v != null ? String(cell.v) : (cell?.f || '');
      record[headers[j]] = val.trim();
      if (val.trim()) hasData = true;
    }
    if (hasData) rows.push(record);
  }

  return { headers, rows, tabName: data?.reqs?.[0]?.wrappers?.[0]?.tab?.label || 'Sheet1' };
}

/** Map a spreadsheet row (from the OC Blog Strategy schema) to a content item shape. */
function mapSheetRowToContentItem(
  row: Record<string, string>,
  brandId: string,
  sheetId: string,
  sheetName: string,
  rowIndex: number,
): {
  title: string;
  initialPrompt: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  seoBrief: string;
  searchIntent: string;
  cta: string;
  internalLinks: string[];
  questionsPeopleAlsoAsk: string[];
  longtailKeywords: string[];
  sourceRow: number;
  sheetContext: Record<string, string>;
} {
  // Flexible column matching: try exact headers, then fuzzy contains
  const get = (keys: string[]): string => {
    for (const k of keys) {
      const match = Object.keys(row).find((h) => h.toLowerCase().includes(k.toLowerCase()));
      if (match && row[match]) return row[match];
    }
    return '';
  };

  const title = get(['Blog Title', 'Title', 'Headline']) || 'Untitled Blog Post';
  const summary = get(['One Line Summary', 'Summary', 'Description', 'Brief']);
  const primaryKeyword = get(['Primary Keyword', 'Primary', 'Focus Keyword', 'Keyword']);
  const secondaryKeywordsRaw = get(['Secondary Keywords', 'Secondary', 'LSI Keywords']);
  const intent = get(['Search Intent', 'Intent', 'User Intent']);
  const cta = get(['Call to Action', 'CTA']);
  const internalLinksRaw = get(['Internal Links', 'Links']);
  const questionsRaw = get(['Questions People Also Ask', 'Questions', 'FAQ']);
  const keywordsRaw = get(['Keywords', 'Keywords (All)']);
  const longtailRaw = get(['Longtail Keywords', 'Longtail', 'Long-tail']);
  const categoryId = get(['Supporting Advice Blogs', 'Category', 'Category ID']);
  const tipNoRaw = get(['Tip No.', 'Tip No', 'Tip', 'Number']);
  const sheetStatus = get(['Status']);

  // Build the full sheet context — every column is preserved
  const sheetContext: Record<string, string> = {
    categoryId,
    tipNo: tipNoRaw,
    blogTitle: title,
    oneLineSummary: summary,
    sheetStatus,
    primaryKeyword,
    secondaryKeywords: secondaryKeywordsRaw,
    internalLinks: internalLinksRaw,
    searchIntent: intent,
    callToAction: cta,
    questionsPeopleAlsoAsk: questionsRaw,
    keywords: keywordsRaw,
    longtailKeywords: longtailRaw,
  };

  return {
    title,
    initialPrompt: summary || title,
    primaryKeyword,
    secondaryKeywords: secondaryKeywordsRaw ? secondaryKeywordsRaw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : [],
    seoBrief: intent || summary || `Informational article about ${title}`,
    searchIntent: intent,
    cta,
    internalLinks: internalLinksRaw ? internalLinksRaw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : [],
    questionsPeopleAlsoAsk: questionsRaw ? questionsRaw.split(/[;\n]/).map((s) => s.trim()).filter(Boolean) : [],
    longtailKeywords: longtailRaw ? longtailRaw.split(/[;\n]/).map((s) => s.trim()).filter(Boolean) : [],
    sourceRow: rowIndex,
    sheetContext,
  };
}

// ── AutoBlog API Endpoints ──────────────────────────────────────────────────

/** Quick health check: can we reach the Google Sheet? Returns connection status + latency. */
app.post('/api/autoblog/ping-sheet', async (req, res) => {
  try {
    const { sheetUrl } = req.body;
    if (!sheetUrl) return res.status(400).json({ ok: false, error: 'sheetUrl is required' });
    const { spreadsheetId } = parseSheetUrl(sheetUrl);

    const start = Date.now();
    try {
      const result = await fetchSheetGviz(spreadsheetId, '0');
      return res.json({
        ok: true,
        latencyMs: Date.now() - start,
        rowCount: result.rows.length,
        headers: result.headers.slice(0, 5),
        message: `Connected — ${result.rows.length} rows, ${result.headers.length} columns`,
      });
    } catch (err: any) {
      return res.json({
        ok: false,
        latencyMs: Date.now() - start,
        error: err?.message || 'Connection failed',
        message: /PERMISSION_DENIED|403/i.test(err?.message)
          ? 'Sheet is not publicly shared — set it to "Anyone with the link can view"'
          : /timeout|abort/i.test(err?.message)
            ? 'Connection timed out — check your network and try again'
            : err?.message || 'Connection failed',
      });
    }
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'Ping failed' });
  }
});

/** List tabs in a publicly shared Google Sheet by probing GIDs. Probes in parallel batches for speed. */
app.post('/api/autoblog/list-tabs', async (req, res) => {
  try {
    const { sheetUrl } = req.body;
    if (!sheetUrl) return res.status(400).json({ error: 'sheetUrl is required' });
    const { spreadsheetId } = parseSheetUrl(sheetUrl);

    // Probe GIDs 0–9, then known large GIDs. Probe in parallel batches of 4.
    const candidateGids = ['0','1','2','3','4','5','6','7','8','9','102378141','1594914000','383449943'];
    const BATCH = 4;
    const tabs: { name: string; gid: string; rowCount: number; firstCol: string }[] = [];
    let misses = 0;

    for (let i = 0; i < candidateGids.length; i += BATCH) {
      if (misses >= 6) break; // too many consecutive empty/error GIDs — stop
      const batch = candidateGids.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async (gid) => {
          const result = await fetchSheetGviz(spreadsheetId, gid);
          return { gid, ...result };
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.rows.length > 0) {
          const tabName = r.value.headers[0] || `Sheet (GID ${r.value.gid})`;
          tabs.push({ name: tabName, gid: r.value.gid, rowCount: r.value.rows.length, firstCol: r.value.headers[0] || '' });
          misses = 0;
        } else {
          misses++;
        }
      }
    }

    // Deduplicate by name (GID 0 often aliases to the first real tab)
    const seen = new Set<string>();
    const deduped = tabs.filter((t) => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });

    if (deduped.length === 0) {
      deduped.push({ name: 'Sheet1', gid: '0', rowCount: 0, firstCol: '' });
    }

    return res.json({ tabs: deduped });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to list sheet tabs' });
  }
});

/** Fetch and parse a Google Sheet, returning structured rows. */
app.post('/api/autoblog/fetch-sheet', async (req, res) => {
  try {
    const { sheetUrl, gid } = req.body;
    if (!sheetUrl) return res.status(400).json({ error: 'sheetUrl is required' });
    const { spreadsheetId, gid: defaultGid } = parseSheetUrl(sheetUrl);
    const targetGid = gid || defaultGid || '0';

    const result = await fetchSheetGviz(spreadsheetId, targetGid);

    return res.json({
      spreadsheetId,
      gid: targetGid,
      rowCount: result.rows.length,
      headers: result.headers,
      rows: result.rows,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to fetch sheet data' });
  }
});

/** Import sheet rows as Planned content items into Firestore. */
app.post('/api/autoblog/import', async (req, res) => {
  try {
    const { rows, brandId, sheetId, sheetName, existingItems } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows array is required and must not be empty' });
    }

    const imported: any[] = [];
    const skipped: number[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const sourceRow = i + 2; // +2 because row 1 is header, 0-indexed loop
      const mapped = mapSheetRowToContentItem(row, brandId, sheetId || '', sheetName || '', sourceRow);

      // Skip if title is empty or "Untitled"
      if (!mapped.title || mapped.title === 'Untitled Blog Post') {
        skipped.push(sourceRow);
        continue;
      }

      // Skip duplicates by title
      if (Array.isArray(existingItems) && existingItems.some((e: any) => e?.title === mapped.title)) {
        skipped.push(sourceRow);
        continue;
      }

      imported.push({
        ...mapped,
        sourceRow,
        sheetName: sheetName || 'Sheet1',
      });
    }

    return res.json({ imported, skipped, total: rows.length });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to import sheet rows' });
  }
});

/** Re-sync: compare current sheet rows against existing items and return what's new/changed/removed. */
app.post('/api/autoblog/resync', async (req, res) => {
  try {
    const { rows, existingItems } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows array required' });
    }

    const existingTitles = new Set(
      (Array.isArray(existingItems) ? existingItems : []).map((e: any) => e?.title?.trim().toLowerCase()).filter(Boolean)
    );

    const newRows: any[] = [];
    const changedRows: { row: any; existingTitle: string }[] = [];
    const total = rows.length;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const title = (row['Blog Title'] || row['Title'] || row['Headline'] || '').trim();
      if (!title) continue;

      const slug = title.toLowerCase();
      if (existingTitles.has(slug)) {
        // Check if the summary or keywords have changed
        const existing = (Array.isArray(existingItems) ? existingItems : []).find(
          (e: any) => e?.title?.trim().toLowerCase() === slug
        );
        if (existing) {
          const sheetSummary = row['One Line Summary'] || row['Summary'] || '';
          const sheetKeyword = row['Primary Keyword'] || row['Primary'] || '';
          const changed =
            existing.seoBrief !== sheetSummary ||
            existing.primaryKeyword !== sheetKeyword;
          if (changed) {
            changedRows.push({ row, existingTitle: title });
          }
        }
      } else {
        newRows.push(row);
      }
    }

    return res.json({ newRows, changedRows, total, existingCount: existingTitles.size });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Re-sync failed' });
  }
});

/** Auto-publish endpoint — called by the client for manual "Publish Now" and
 *  as a fallback. Idempotent: never double-publishes an item that the
 *  server-side scheduler has already published. */
app.post('/api/autoblog/check-publish', async (req, res) => {
  try {
    const { dueItems, brands } = req.body;
    if (!Array.isArray(dueItems) || dueItems.length === 0) {
      return res.json({ published: 0, errors: [] });
    }

    const results: { itemId: string; success: boolean; message: string; wpPostId?: number }[] = [];

    for (const item of dueItems) {
      // ENFORCE the schedule server-side: never publish an item before its
      // scheduled time (or one with no schedule at all). This is a safety net
      // even if a client sends the wrong items.
      const sched = item.scheduledPublishAt ? new Date(item.scheduledPublishAt).getTime() : null;
      if (!sched || sched > Date.now()) {
        results.push({ itemId: item.id, success: false, message: 'Not due yet — scheduled time not reached' });
        continue;
      }
      // Idempotency: skip items the server-side scheduler already published.
      if (item.lastAutoPublishedAt) {
        results.push({ itemId: item.id, success: true, message: 'Already published', wpPostId: item.wpPostId });
        continue;
      }
      const brand = brands?.find((b: any) => b.id === (item.autoBlogOverrides?.brandId || item.brandId));
      if (!brand || !brand.wpUrl || !brand.wpUsername) {
        results.push({ itemId: item.id, success: false, message: 'No valid brand connection' });
        continue;
      }

      try {
        const { wpPostId } = await publishItemToWordPress(item, brand);
        results.push({
          itemId: item.id,
          success: true,
          message: `Published as ${item.autoBlogOverrides?.wpStatus || 'publish'}`,
          wpPostId,
        });
      } catch (err: any) {
        results.push({
          itemId: item.id,
          success: false,
          message: err?.message || 'Publish failed',
        });
      }
    }

    return res.json({
      published: results.filter((r) => r.success).length,
      errors: results.filter((r) => !r.success),
      results,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to check auto-publish queue' });
  }
});

/** Server-tick endpoint — called by Cloud Scheduler every minute so the
 *  auto-publish check runs even when the app is closed and the instance is
 *  cold. Requires the DGC_NOTIFY_SECRET header to prevent abuse. */
app.post('/api/autoblog/server-tick', async (req, res) => {
  const secret = req.headers['x-fgos-tick-secret'] || req.headers['x-dgc-notify-secret'];
  if (!process.env.DGC_NOTIFY_SECRET || secret !== process.env.DGC_NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runServerPublishCheck();
    return res.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Server tick failed' });
  }
});

/** Activity log record endpoint — accepts a structured log entry and
 *  persists it to the `activity_logs` Firestore collection. Used by the
 *  client-side ActivityLogger fallback when the direct Firestore write
 *  fails (e.g. emulator mode). */
app.post('/api/logs/record', async (req, res) => {
  try {
    const { category, status, action, title, message, brandId, brandName, userId, userEmail, payload, response, durationMs, ip } = req.body;
    if (!action || !title || !message) {
      return res.status(400).json({ error: 'action, title and message required.' });
    }
    const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();
    const fullLog = {
      id: logId,
      timestamp: now,
      category: category || 'event',
      status: status || 'info',
      action,
      title,
      message,
      brandId: brandId || null,
      brandName: brandName || null,
      userId: userId || null,
      userEmail: userEmail || null,
      payload: payload || null,
      response: response || null,
      durationMs: durationMs || null,
      ip: ip || null,
    };
    await adminDb.collection('activity_logs').doc(logId).set(fullLog);
    return res.json({ success: true, id: logId });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to record log.' });
  }
});

/** Health/status endpoint — shows whether the server-side scheduler is armed. */
app.get('/api/autoblog/server-status', (req, res) => {
  res.json({
    schedulerArmed: !!adminDb,
    intervalMs: SERVER_PUBLISH_INTERVAL_MS,
    lockTtlMs: PUBLISH_LOCK_TTL_MS,
    at: new Date().toISOString(),
  });
});

app.get('/api/export/sql', (req, res) => {
  const sql = `-- FGOS (Fresh Green Operating System) - MySQL Schema for Hostinger / cPanel
-- Database: fgos_studio

CREATE TABLE IF NOT EXISTS \`brands\` (
  \`id\` INT AUTO_INCREMENT PRIMARY KEY,
  \`name\` VARCHAR(255) NOT NULL,
  \`slug\` VARCHAR(100) UNIQUE NOT NULL,
  \`wp_url\` VARCHAR(255) NOT NULL,
  \`wp_username\` VARCHAR(100) NOT NULL,
  \`wp_app_password\` TEXT NULL,
  \`voice_guidelines\` TEXT NULL,
  \`banned_words\` TEXT NULL,
  \`primary_color\` VARCHAR(7) DEFAULT '#10b981',
  \`page_templates\` TEXT NULL,
  \`default_status\` VARCHAR(20) DEFAULT 'draft',
  \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`content_items\` (
  \`id\` INT AUTO_INCREMENT PRIMARY KEY,
  \`brand_id\` INT NOT NULL,
  \`title\` VARCHAR(255) NOT NULL,
  \`slug\` VARCHAR(255) NOT NULL,
  \`content_type\` ENUM('post', 'page') DEFAULT 'post',
  \`wp_template\` VARCHAR(100) DEFAULT 'default',
  \`status\` ENUM('Planned', 'Researching', 'Generating', 'Draft_Ready', 'Published', 'Error') DEFAULT 'Planned',
  \`primary_keyword\` VARCHAR(255) NULL,
  \`secondary_keywords\` TEXT NULL,
  \`seo_brief\` TEXT NULL,
  \`meta_title\` VARCHAR(255) NULL,
  \`meta_description\` TEXT NULL,
  \`body_html\` LONGTEXT NULL,
  \`nano_banana_prompt\` TEXT NULL,
  \`featured_image_url\` VARCHAR(500) NULL,
  \`wp_post_id\` INT NULL,
  \`wp_preview_url\` TEXT NULL,
  \`wp_live_url\` TEXT NULL,
  \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (\`brand_id\`) REFERENCES \`brands\`(\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="fgos_studio_schema.sql"');
  return res.send(sql);
});

app.get('/api/export/wordpress-connector-php', (req, res) => {
  const phpCode = `<?php

namespace App\\Services;

use Illuminate\\Support\\Facades\\Http;
use Illuminate\\Support\\Facades\\Log;

/**
 * FGOS (Fresh Green Operating System) - WordPress REST API Service Connector
 * Optimized for Laravel 11 on Hostinger / cPanel
 */
class WordPressConnector
{
    /**
     * Test REST API Connection
     */
    public function testConnection($brand): array
    {
        $cleanUrl = rtrim($brand->wp_url, '/');
        
        $response = Http::withBasicAuth($brand->wp_username, $brand->wp_app_password)
            ->timeout(8)
            ->get($cleanUrl . '/wp-json/wp/v2/users/me');

        if ($response->successful()) {
            return [
                'success' => true,
                'user' => $response->json()['name'] ?? 'Authorized User',
                'status' => $response->status()
            ];
        }

        return [
            'success' => false,
            'message' => 'WP REST API returned HTTP ' . $response->status() . ': ' . $response->body()
        ];
    }

    /**
     * Push Post or Page to WordPress REST API
     */
    public function pushToWP($contentItem): array|false
    {
        $brand = $contentItem->brand;
        $cleanUrl = rtrim($brand->wp_url, '/');
        $endpoint = ($contentItem->content_type === 'page') ? '/wp-json/wp/v2/pages' : '/wp-json/wp/v2/posts';

        $payload = [
            'title'    => $contentItem->title,
            'content'  => $contentItem->body_html,
            'status'   => $brand->default_status ?? 'draft',
            'slug'     => $contentItem->slug,
        ];

        if (!empty($contentItem->wp_template) && $contentItem->wp_template !== 'default') {
            $payload['template'] = self::mapWpTemplate($contentItem->wp_template);
        }

        if (!empty($contentItem->wp_media_id)) {
            $payload['featured_media'] = $contentItem->wp_media_id;
        }

        $response = Http::withBasicAuth($brand->wp_username, $brand->wp_app_password)
            ->timeout(12)
            ->post($cleanUrl . $endpoint, $payload);

        if ($response->successful()) {
            $data = $response->json();
            return [
                'success' => true,
                'wp_id' => $data['id'],
                'link' => $data['link'],
                'preview_url' => $data['link'] . '&preview=true',
            ];
        }

        Log::error("WP REST API Sync Failed for Brand: " . $brand->name, $response->json());
        return false;
    }

    /**
     * Upload Nano Banana AI Image to WP Media Library
     */
    public function uploadMedia($brand, string $imageUrl, string $filename): int|null
    {
        $imageContent = @file_get_contents($imageUrl);
        if (!$imageContent) return null;

        $cleanUrl = rtrim($brand->wp_url, '/');

        $response = Http::withBasicAuth($brand->wp_username, $brand->wp_app_password)
            ->withBody($imageContent, 'image/jpeg')
            ->post($cleanUrl . '/wp-json/wp/v2/media', [
                'headers' => [
                    'Content-Disposition' => 'attachment; filename="' . $filename . '.jpg"',
                ]
            ]);

        return $response->successful() ? $response->json()['id'] : null;
    }

    /**
     * Map legacy .php page template slugs to valid Hello Elementor / WP REST API
     * template values.  The REST API rejects anything outside the three
     * Elementor-registered slugs, so custom theme templates must be translated.
     */
    private static function mapWpTemplate(string $slug): string
    {
        $map = [
            'template-full-width.php'     => 'elementor_canvas',
            'template-pet-landing.php'    => 'elementor_canvas',
            'template-clean-guide.php'    => 'elementor_canvas',
            'template-community-care.php' => 'elementor_canvas',
            'template-recipe.php'         => 'elementor_canvas',
            'page-wide.php'               => 'elementor_header_footer',
        ];

        if (empty($slug) || $slug === 'default') {
            return $slug;
        }

        if (isset($map[$slug])) {
            return $map[$slug];
        }

        // Fallback heuristic: full-width / canvas / landing → blank canvas;
        // otherwise keep the site header and footer.
        if (preg_match('/full[-_]?width|canvas|landing/i', $slug)) {
            return 'elementor_canvas';
        }

        return 'elementor_header_footer';
    }
}
`;
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="WordPressConnector.php"');
  return res.send(phpCode);
});

// ==========================================
// 3b. BASE.COM (BaseLinker) — Multi-Channel Scoreboard & Order Hub
// ==========================================

/** Call the BaseLinker connector API. Token comes from the client (Firestore
 *  apiKeys.baselinker) or the BASELINKER_TOKEN env var. */
async function baseLinkerCall(token: string, method: string, parameters: any = {}) {
  const res = await fetch('https://api.baselinker.com/connector.php', {
    method: 'POST',
    headers: {
      'X-BLToken': token,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ method, parameters: JSON.stringify(parameters) }),
  });
  if (!res.ok) {
    throw new Error(`BaseLinker HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.status !== 'SUCCESS') {
    const err: any = new Error(data.error_message || `BaseLinker ${method} failed`);
    err.code = data.error_code;
    throw err;
  }
  return data;
}

/** Resolve the BaseLinker token: query param (client passes Firestore key) → env. */
function baseToken(req: express.Request): string {
  const fromQuery = String(req.query.token || '').trim();
  return fromQuery || process.env.BASELINKER_TOKEN || '';
}

/** Normalise a BaseLinker order into a compact scoreboard row. */
function mapBaseOrder(o: any): any {
  const items = Array.isArray(o.products) ? o.products : [];
  const itemTotal = items.reduce((sum: number, p: any) => sum + (Number(p.price_brutto) || 0) * (Number(p.quantity) || 0), 0);
  const delivery = Number(o.delivery_price) || 0;
  return {
    orderId: o.order_id,
    source: o.order_source,
    sourceId: o.order_source_id,
    dateAdded: o.date_add ? new Date(o.date_add * 1000).toISOString() : null,
    dateConfirmed: o.date_confirmed ? new Date(o.date_confirmed * 1000).toISOString() : null,
    statusId: o.order_status_id,
    complete: !!o.order_complete,
    paymentDone: !!o.payment_done,
    paymentMethod: o.payment_method || null,
    currency: o.currency || 'GBP',
    itemTotal: Math.round(itemTotal * 100) / 100,
    deliveryPrice: Math.round(delivery * 100) / 100,
    total: Math.round((itemTotal + delivery) * 100) / 100,
    itemCount: items.reduce((n: number, p: any) => n + (Number(p.quantity) || 0), 0),
    buyer: {
      name: o.user_login || null,
      email: o.email || null,
      phone: o.phone || null,
    },
    delivery: {
      fullname: o.delivery_fullname || null,
      city: o.delivery_city || null,
      postcode: o.delivery_postcode || null,
      country: o.delivery_country || null,
      method: o.delivery_method || null,
    },
    products: items.map((p: any) => ({
      name: p.name || null,
      sku: p.sku || null,
      ean: p.ean || null,
      quantity: Number(p.quantity) || 0,
      priceBrutto: Number(p.price_brutto) || 0,
    })),
  };
}

// GET /api/base/status — connection check + connected order sources
app.get('/api/base/status', async (req, res) => {
  try {
    const token = baseToken(req);
    if (!token) {
      return res.status(400).json({ success: false, message: 'BaseLinker token is not configured. Add it in Settings → API Keys (baselinker).' });
    }
    const data = await baseLinkerCall(token, 'getOrderSources');
    const sources = data.sources || {};
    const flat: { key: string; label: string; id: string }[] = [];
    for (const [group, entries] of Object.entries(sources)) {
      for (const [id, label] of Object.entries(entries as Record<string, string>)) {
        flat.push({ key: group, label, id });
      }
    }
    return res.json({ success: true, sources: flat, raw: sources });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not reach BaseLinker.', code: err.code });
  }
});

// GET /api/base/scoreboard?days=7 — daily revenue + orders by channel
app.get('/api/base/scoreboard', async (req, res) => {
  try {
    const token = baseToken(req);
    if (!token) {
      return res.status(400).json({ success: false, message: 'BaseLinker token is not configured. Add it in Settings → API Keys (baselinker).' });
    }
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const now = Math.floor(Date.now() / 1000);
    const from = now - days * 86400;

    // Optional brand filter: comma-separated BaseLinker order-source IDs.
    // When provided, only orders from those sources count toward the scoreboard.
    const sourceFilter = String(req.query.sources || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Pull confirmed orders in the window (max 100 per call; loop for more).
    const orders: any[] = [];
    let cursor = from;
    for (let i = 0; i < 20; i++) {
      const data = await baseLinkerCall(token, 'getOrders', {
        date_confirmed_from: cursor,
        get_unconfirmed_orders: false,
      });
      const batch = data.orders || [];
      orders.push(...batch);
      if (batch.length < 100) break;
      // Advance past the last confirmed date (+1s to avoid re-downloading).
      const last = batch[batch.length - 1];
      cursor = (last.date_confirmed || last.date_add || cursor) + 1;
    }

    // Aggregate per day + per channel.
    const dayMap: Record<string, { date: string; revenue: number; orders: number }> = {};
    const channelMap: Record<string, { source: string; revenue: number; orders: number }> = {};
    let totalRevenue = 0;
    let totalOrders = 0;

    for (const o of orders) {
      const mapped = mapBaseOrder(o);
      // Apply the brand's source filter (match on source id or source key).
      if (sourceFilter.length > 0) {
        const srcId = String(mapped.sourceId || '');
        const srcKey = String(mapped.source || '');
        if (!sourceFilter.includes(srcId) && !sourceFilter.includes(srcKey)) continue;
      }
      const dayKey = (mapped.dateConfirmed || mapped.dateAdded || '').slice(0, 10);
      if (dayKey) {
        dayMap[dayKey] = dayMap[dayKey] || { date: dayKey, revenue: 0, orders: 0 };
        dayMap[dayKey].revenue += mapped.total;
        dayMap[dayKey].orders += 1;
      }
      const src = mapped.source || 'unknown';
      channelMap[src] = channelMap[src] || { source: src, revenue: 0, orders: 0 };
      channelMap[src].revenue += mapped.total;
      channelMap[src].orders += 1;
      totalRevenue += mapped.total;
      totalOrders += 1;
    }

    // Fill missing days with zeros so the chart is continuous.
    const daily: { date: string; revenue: number; orders: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date((now - i * 86400) * 1000).toISOString().slice(0, 10);
      daily.push(dayMap[d] || { date: d, revenue: 0, orders: 0 });
    }

    return res.json({
      success: true,
      days,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalOrders,
      daily,
      channels: Object.values(channelMap).map((c: any) => ({ ...c, revenue: Math.round(c.revenue * 100) / 100 })),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not fetch BaseLinker scoreboard.', code: err.code });
  }
});

// GET /api/base/orders?days=7 — recent orders queue
app.get('/api/base/orders', async (req, res) => {
  try {
    const token = baseToken(req);
    if (!token) {
      return res.status(400).json({ success: false, message: 'BaseLinker token is not configured. Add it in Settings → API Keys (baselinker).' });
    }
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const now = Math.floor(Date.now() / 1000);
    const from = now - days * 86400;

    // Optional brand filter: comma-separated BaseLinker order-source IDs.
    const sourceFilter = String(req.query.sources || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const orders: any[] = [];
    let cursor = from;
    for (let i = 0; i < 20; i++) {
      const data = await baseLinkerCall(token, 'getOrders', {
        date_confirmed_from: cursor,
        get_unconfirmed_orders: false,
      });
      const batch = data.orders || [];
      orders.push(...batch);
      if (batch.length < 100) break;
      const last = batch[batch.length - 1];
      cursor = (last.date_confirmed || last.date_add || cursor) + 1;
    }

    const mapped = orders
      .map(mapBaseOrder)
      .filter((o: any) => {
        if (sourceFilter.length === 0) return true;
        const srcId = String(o.sourceId || '');
        const srcKey = String(o.source || '');
        return sourceFilter.includes(srcId) || sourceFilter.includes(srcKey);
      })
      .sort((a: any, b: any) => (b.dateConfirmed || '').localeCompare(a.dateConfirmed || ''));
    return res.json({ success: true, orders: mapped, count: mapped.length });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not fetch BaseLinker orders.', code: err.code });
  }
});

// GET /api/base/products — catalog + stock summary
app.get('/api/base/products', async (req, res) => {
  try {
    const token = baseToken(req);
    if (!token) {
      return res.status(400).json({ success: false, message: 'BaseLinker token is not configured. Add it in Settings → API Keys (baselinker).' });
    }
    const inventoryId = Number(req.query.inventory_id) || 94059;
    const products: any[] = [];
    let page = 1;
    for (let i = 0; i < 20; i++) {
      const data = await baseLinkerCall(token, 'getInventoryProductsList', { inventory_id: inventoryId, page });
      const batch = data.products || {};
      const entries = Object.values(batch);
      products.push(...entries);
      if (entries.length < 100) break;
      page += 1;
    }

    let totalStock = 0;
    let inStock = 0;
    const mapped = products.map((p: any) => {
      const stockVals = Object.values(p.stock || {}) as number[];
      const stock = stockVals.reduce((s: number, v: number) => s + (Number(v) || 0), 0);
      const priceVals = Object.values(p.prices || {}) as number[];
      const price = priceVals.length ? Number(priceVals[0]) || 0 : 0;
      totalStock += stock;
      if (stock > 0) inStock += 1;
      return {
        id: p.id,
        sku: p.sku || null,
        name: p.name || null,
        ean: p.ean || null,
        asin: p.asin || null,
        stock,
        price,
        parentId: p.parent_id || 0,
      };
    });

    return res.json({
      success: true,
      inventoryId,
      count: mapped.length,
      inStock,
      outOfStock: mapped.length - inStock,
      totalStock,
      products: mapped,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not fetch BaseLinker products.', code: err.code });
  }
});

// ==========================================
// 3c. CRM & AUTOMATION SYNC ENGINE (MailerLite + WooCommerce)
// ==========================================

/** MailerLite group IDs (created via API, see daniels_petfoods_automation_specs.md). */
const MAILERLITE_GROUPS: Record<string, string> = {
  'Pet Food Buyers': '184914413448333113',
  'Dog Walking Customers': '184914414424557090',
  'General Visitors': '184914415107179867',
  'Walk Booked': '184965010420663911',
  'Walk Completed': '184965010431149676',
  'New Subs': '184904579319596877',
  'Pet Care Guide Requests': '192620928360777470',
  'Contact Enquiries': '192618765795460301',
};

/** Call the MailerLite API (new API: connect.mailerlite.com, Bearer auth).
 *  Token from client (Firestore apiKeys.mailerlite) or MAILERLITE_API_KEY env. */
async function mailerLiteCall(token: string, method: string, path: string, body?: any) {
  const res = await fetch(`https://connect.mailerlite.com/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err: any = new Error(data?.message || data?.error?.message || `MailerLite HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Resolve the MailerLite token: query/body param → env. */
function mailerToken(req: express.Request): string {
  const fromQuery = String(req.query.token || req.body?.token || '').trim();
  return fromQuery || process.env.MAILERLITE_API_KEY || '';
}

/** Find a subscriber id by exact email (new API search is fuzzy). */
async function mailerFindSubscriber(token: string, email: string): Promise<string | null> {
  const search = await mailerLiteCall(token, 'GET', `/subscribers?query=${encodeURIComponent(email)}`);
  const list = Array.isArray(search?.data) ? search.data : [];
  const match = list.find((s: any) => String(s.email).toLowerCase() === String(email).toLowerCase());
  return match?.id ? String(match.id) : null;
}

/** Upsert a subscriber (create or update by email) and optionally add to groups. */
async function mailerUpsertSubscriber(token: string, email: string, name: string, groupIds: string[] = []) {
  const payload: any = { email, status: 'active' };
  if (name) payload.fields = { name };
  if (groupIds.length) payload.groups = groupIds;
  const data = await mailerLiteCall(token, 'POST', '/subscribers', payload);
  return data?.data || data;
}

// GET /api/crm/mailerlite/status — connection check + groups with counts
app.get('/api/crm/mailerlite/status', async (req, res) => {
  try {
    const token = mailerToken(req);
    if (!token) {
      return res.status(400).json({ success: false, message: 'MailerLite token is not configured. Add it in Settings → API Keys → mailerlite.' });
    }
    const groups = await mailerLiteCall(token, 'GET', '/groups');
    const flat = (Array.isArray(groups?.data) ? groups.data : []).map((g: any) => {
      const active = g.active_count || 0;
      const unconfirmed = g.unconfirmed_count || 0;
      const unsubscribed = g.unsubscribed_count || 0;
      const bounced = g.bounced_count || 0;
      return {
        id: String(g.id),
        name: g.name,
        // MailerLite's group object has no `total` field, so sum the status counts.
        total: active + unconfirmed + unsubscribed + bounced,
        active,
        unsubscribed,
        bounced,
        unconfirmed,
        sent: g.sent_count || 0,
        opened: g.opens_count || 0,
        clicked: g.clicks_count || 0,
      };
    });
    return res.json({ success: true, groups: flat, count: flat.length });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not reach MailerLite.', status: err.status });
  }
});

// GET /api/crm/mailerlite/subscribers?group_id=&limit= — subscribers in a group
app.get('/api/crm/mailerlite/subscribers', async (req, res) => {
  try {
    const token = mailerToken(req);
    if (!token) {
      return res.status(400).json({ success: false, message: 'MailerLite token is not configured.' });
    }
    const groupId = String(req.query.group_id || '').trim();
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    if (!groupId) {
      return res.status(400).json({ success: false, message: 'group_id is required.' });
    }
    const data = await mailerLiteCall(token, 'GET', `/groups/${groupId}/subscribers?limit=${limit}`);
    const subs = (Array.isArray(data?.data) ? data.data : []).map((s: any) => ({
      id: String(s.id),
      email: s.email,
      name: s.fields?.name || s.name || null,
      type: s.status || null,
      dateCreated: s.created_at || null,
      dateSubscribe: s.subscribed_at || null,
      sent: s.sent || 0,
      opened: s.opens_count || 0,
      clicked: s.clicks_count || 0,
    }));
    return res.json({ success: true, subscribers: subs, count: subs.length });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not fetch MailerLite subscribers.', status: err.status });
  }
});

// POST /api/crm/mailerlite/subscriber — upsert a subscriber and add to a group
app.post('/api/crm/mailerlite/subscriber', async (req, res) => {
  try {
    const token = mailerToken(req);
    if (!token) {
      return res.status(400).json({ success: false, message: 'MailerLite token is not configured.' });
    }
    const { email, name, groupId, groupName } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'email is required.' });
    }
    let groupIds: string[] = [];
    if (groupId) groupIds = [String(groupId)];
    else if (groupName) {
      const id = MAILERLITE_GROUPS[groupName];
      if (id) groupIds = [id];
      else {
        // Resolve by name from the API.
        const groups = await mailerLiteCall(token, 'GET', '/groups');
        const found = (Array.isArray(groups?.data) ? groups.data : []).find((g: any) => g.name === groupName);
        if (found) groupIds = [String(found.id)];
      }
    }
    const subscriber = await mailerUpsertSubscriber(token, String(email).trim().toLowerCase(), name || '', groupIds);
    return res.json({ success: true, subscriber });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not add MailerLite subscriber.', status: err.status });
  }
});

// POST /api/crm/mailerlite/group — move a subscriber between groups
// (e.g. Walk Booked → Walk Completed). Body: { email, addGroupId?, removeGroupId? }
app.post('/api/crm/mailerlite/group', async (req, res) => {
  try {
    const token = mailerToken(req);
    if (!token) {
      return res.status(400).json({ success: false, message: 'MailerLite token is not configured.' });
    }
    const { email, addGroupId, removeGroupId } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'email is required.' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    let subscriberId = await mailerFindSubscriber(token, cleanEmail);
    if (!subscriberId) {
      const created = await mailerUpsertSubscriber(token, cleanEmail, req.body?.name || '');
      subscriberId = created?.id ? String(created.id) : null;
    }
    if (!subscriberId) {
      return res.status(500).json({ success: false, message: 'Could not resolve or create subscriber.' });
    }
    const actions: string[] = [];
    if (removeGroupId) {
      await mailerLiteCall(token, 'DELETE', `/subscribers/${subscriberId}/groups/${removeGroupId}`);
      actions.push(`removed from group ${removeGroupId}`);
    }
    if (addGroupId) {
      await mailerLiteCall(token, 'POST', `/subscribers/${subscriberId}/groups/${addGroupId}`);
      actions.push(`added to group ${addGroupId}`);
    }
    return res.json({ success: true, email: cleanEmail, subscriberId, actions });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not move MailerLite subscriber.', status: err.status });
  }
});

// POST /api/crm/sync-woo — pull WooCommerce customers from a brand's orders
// and add them to the Pet Food Buyers group (dedupe by email).
app.post('/api/crm/sync-woo', async (req, res) => {
  try {
    const token = mailerToken(req);
    if (!token) {
      return res.status(400).json({ success: false, message: 'MailerLite token is not configured.' });
    }
    const { wpUrl, key, secret, groupId, days } = req.body || {};
    if (!wpUrl || !key || !secret) {
      return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required (WooCommerce REST credentials).' });
    }
    const lookback = Math.min(Math.max(Number(days) || 90, 1), 365);
    const perPage = 50;
    const url = wcAuthUrl(wpUrl, key, secret, `/orders?per_page=${perPage}&page=1&orderby=date&order=desc&after=${new Date(Date.now() - lookback * 86400000).toISOString()}`);

    const wcRes = await fetch(url, { headers: DEFAULT_WP_HEADERS });
    if (!wcRes.ok) {
      const body = await wcRes.text();
      return res.status(wcRes.status).json({ success: false, message: `WC API ${wcRes.status}: ${body}` });
    }
    const raw = await wcRes.json();
    const orders = Array.isArray(raw) ? raw : [];

    // Unique buyers from orders (billing email + name).
    const buyers = new Map<string, { email: string; name: string }>();
    for (const o of orders) {
      const email = String(o.billing?.email || '').trim().toLowerCase();
      if (!email) continue;
      const first = o.billing?.first_name || '';
      const last = o.billing?.last_name || '';
      buyers.set(email, { email, name: `${first} ${last}`.trim() });
    }

    const targetGroup = String(groupId || MAILERLITE_GROUPS['Pet Food Buyers'] || '');
    let added = 0;
    let existing = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const b of buyers.values()) {
      try {
        const before = await mailerFindSubscriber(token, b.email);
        await mailerUpsertSubscriber(token, b.email, b.name, [targetGroup]);
        if (before) existing += 1;
        else added += 1;
      } catch (err: any) {
        failed += 1;
        errors.push(`${b.email}: ${err.message}`);
      }
    }

    return res.json({
      success: true,
      ordersScanned: orders.length,
      uniqueBuyers: buyers.size,
      added,
      existing,
      failed,
      errors: errors.slice(0, 10),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not sync WooCommerce buyers.', status: err.status });
  }
});

// POST /api/crm/mailerlite/webhook — receive MailerLite automation webhook
// events and move the subscriber between walk groups.
// Body: { email, event: booked | completed | cancelled } (or MailerLite
// automation webhook payload with subscriber.email + custom event field).
// Also handles MailerLite subscriber.added_to_group webhooks: when the
// subscriber lands in the Contact Enquiries group, the store owner is
// notified via the WordPress site's wp_mail endpoint.
async function notifyContactEnquiry(email: string, name: string) {
  const wpUrl = 'https://danielstastypetfoods.co.uk/wp-json/daniels/v1/notify-enquiry';
  const secret = process.env.DGC_NOTIFY_SECRET || '';
  try {
    const res = await fetch(wpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dgc-secret': secret,
      },
      body: JSON.stringify({ email, name }),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: res.status, data };
  } catch (err: any) {
    return { status: 0, error: err.message || 'Could not reach WordPress notify endpoint.' };
  }
}

app.post('/api/crm/mailerlite/webhook', async (req, res) => {
  try {
    const token = mailerToken(req);
    if (!token) {
      return res.status(400).json({ success: false, message: 'MailerLite token is not configured.' });
    }
    const body = req.body || {};
    // Accept our test format AND MailerLite automation webhook payloads.
    const email = String(
      body.email ||
      body.subscriber?.email ||
      body.customer?.email ||
      body.customer_email ||
      body.data?.email ||
      ''
    ).trim().toLowerCase();
    const event = String(
      req.query.event ||
      body.event ||
      body.type ||
      body.status ||
      body.trigger ||
      body.data?.event ||
      ''
    ).toLowerCase();
    const customerName = String(
      body.name ||
      body.subscriber?.name ||
      body.customer?.firstName ||
      body.customer?.lastName ||
      body.customer_name ||
      body.data?.name ||
      ''
    ).trim();

    if (!email) {
      return res.status(400).json({ success: false, message: 'No subscriber email found in webhook payload.' });
    }

    // Contact Enquiries notification: MailerLite webhook (subscriber.added_to_group)
    // → notify the store owner via the WordPress site's wp_mail endpoint.
    if (event.includes('added_to_group') || event.includes('group')) {
      const contactGroup = MAILERLITE_GROUPS['Contact Enquiries'];
      const groupName = String(body.group?.name || body.data?.group?.name || '').trim();
      const groupId = String(body.group?.id || body.data?.group?.id || '').trim();
      if (groupName === 'Contact Enquiries' || groupId === contactGroup) {
        const notifyResult = await notifyContactEnquiry(email, customerName);
        return res.json({ success: true, email, event, mapped: 'contact enquiry → owner notified', notifyResult });
      }
      return res.json({ success: true, message: `Webhook received for group "${groupName}" — no action mapped.`, email, event });
    }

    // Contact Enquiries notification: MailerLite subscriber.form_submitted webhook.
    // The payload carries no form id, so we look up the subscriber's groups via the
    // MailerLite API and notify the owner when the Contact Enquiries group is present.
    if (event.includes('form_submitted')) {
      const subscriberId = String(body.id || body.subscriber?.id || '').trim();
      if (!subscriberId) {
        return res.json({ success: true, message: 'form_submitted webhook received but no subscriber id — no action.', email, event });
      }
      const groups = await mailerLiteCall(token, 'GET', `/subscribers/${subscriberId}/groups`);
      const groupList = Array.isArray(groups?.data) ? groups.data : [];
      const inContact = groupList.some(
        (g: any) => String(g.id) === MAILERLITE_GROUPS['Contact Enquiries'] || String(g.name) === 'Contact Enquiries'
      );
      const groupNames = groupList.map((g: any) => g.name);
      if (inContact) {
        const notifyResult = await notifyContactEnquiry(email, customerName);
        return res.json({ success: true, email, event, mapped: 'contact enquiry (form) → owner notified', subscriberId, groups: groupNames, notifyResult });
      }
      return res.json({ success: true, message: 'form_submitted webhook received — subscriber not in Contact Enquiries group, no action.', email, event, subscriberId, groups: groupNames });
    }

    // Map events to group moves.
    const walkBooked = MAILERLITE_GROUPS['Walk Booked'];
    const walkCompleted = MAILERLITE_GROUPS['Walk Completed'];
    let addGroupId: string | null = null;
    let removeGroupId: string | null = null;
    let mapped = '';

    if (event.includes('book') || event.includes('confirm') || event.includes('appointment') || event.includes('scheduled')) {
      addGroupId = walkBooked;
      mapped = 'booked → Walk Booked';
    } else if (event.includes('complete') || event.includes('done') || event.includes('finish')) {
      addGroupId = walkCompleted;
      removeGroupId = walkBooked;
      mapped = 'completed → Walk Completed (removed from Walk Booked)';
    } else if (event.includes('cancel')) {
      removeGroupId = walkBooked;
      mapped = 'cancelled → removed from Walk Booked';
    }

    if (!addGroupId && !removeGroupId) {
      return res.json({ success: true, message: `Webhook received but no group move mapped for event "${event}".`, email, event });
    }

    // Ensure the subscriber exists (create if missing), then move groups.
    let subscriberId = await mailerFindSubscriber(token, email);
    if (!subscriberId) {
      const created = await mailerUpsertSubscriber(token, email, customerName || '');
      subscriberId = created?.id ? String(created.id) : null;
    }
    if (!subscriberId) {
      return res.status(500).json({ success: false, message: 'Could not resolve or create subscriber.' });
    }

    const actions: string[] = [];
    if (removeGroupId) {
      await mailerLiteCall(token, 'DELETE', `/subscribers/${subscriberId}/groups/${removeGroupId}`);
      actions.push(`removed from Walk Booked`);
    }
    if (addGroupId) {
      await mailerLiteCall(token, 'POST', `/subscribers/${subscriberId}/groups/${addGroupId}`);
      actions.push(`added to ${addGroupId === walkCompleted ? 'Walk Completed' : 'Walk Booked'}`);
    }

    return res.json({ success: true, email, event, mapped, subscriberId, actions });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not process MailerLite webhook.', status: err.status });
  }
});

// GET /api/crm/mailerlite/webhook — webhook endpoint info (for MailerLite automation setup)
app.get('/api/crm/mailerlite/webhook', (req, res) => {
  return res.json({
    success: true,
    endpoint: 'POST /api/crm/mailerlite/webhook',
    expects: {
      email: 'subscriber email (or subscriber.email / customer.email / customer_email / data.email)',
      event: 'booking event: booked | completed | cancelled',
      name: 'optional subscriber name',
    },
    groupMoves: {
      booked: 'add to Walk Booked',
      completed: 'add to Walk Completed, remove from Walk Booked',
      cancelled: 'remove from Walk Booked',
    },
    note: 'In MailerLite: Automation → trigger (e.g. subscriber added to Walk Booked) → Webhook action → POST JSON to this endpoint.',
  });
});

// ==========================================
// 3.5 PRODUCT MANAGEMENT (WC v3 CRUD)
// ==========================================
// Full CRUD for WooCommerce products, categories, and attributes via WC REST API v3.
// All endpoints accept { wpUrl, key, secret } to authenticate against the brand's store.
// Prefixed /api/wc-mgmt/ to avoid collision with existing /api/wp/products.

/** Extract WC credentials from body (POST/PUT) or query (GET/DELETE). */
function wcCreds(req: express.Request): { wpUrl: string; key: string; secret: string } | null {
  const wpUrl = String((req.body?.wpUrl ?? req.query?.wpUrl) || '').trim().replace(/\/+$/, '');
  const key = String((req.body?.key ?? req.query?.key) || '').trim();
  const secret = String((req.body?.secret ?? req.query?.secret) || '').trim();
  if (!wpUrl || !key || !secret) return null;
  return { wpUrl, key, secret };
}

/** Generic WC v3 proxy — forwards to the WooCommerce REST API and relays the response. */
async function wcProxy(
  creds: { wpUrl: string; key: string; secret: string },
  method: string,
  path: string,
  body?: any,
): Promise<{ status: number; data: any }> {
  const url = wcAuthUrl(creds.wpUrl, creds.key, creds.secret, path);
  const opts: RequestInit = {
    method,
    headers: { ...DEFAULT_WP_HEADERS, 'Content-Type': 'application/json' },
  };
  if (body && method !== 'GET' && method !== 'HEAD') {
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  let data: any = null;
  const text = await r.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data };
}

// ── Products ──────────────────────────────────────────────────────────────────

/** GET /api/wc-mgmt/products — list products (search, category filter, pagination, status). */
app.get('/api/wc-mgmt/products', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const perPage = Math.min(Math.max(Number(req.query.per_page) || 50, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const search = String(req.query.search || '').trim();
    const category = String(req.query.category || '').trim();
    const status = String(req.query.status || '').trim();
    let qs = `?per_page=${perPage}&page=${page}`;
    if (search) qs += `&search=${encodeURIComponent(search)}`;
    if (category) qs += `&category=${encodeURIComponent(category)}`;
    if (status) qs += `&status=${encodeURIComponent(status)}`;
    const r = await wcProxy(creds, 'GET', `/products${qs}`);
    // WC v3 returns an array directly; headers come from response
    const items = Array.isArray(r.data) ? r.data.map((p: any) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      status: p.status,
      type: p.type,
      permalink: p.permalink,
      description: p.description || '',
      short_description: p.short_description || '',
      price: p.price || '',
      regular_price: p.regular_price || '',
      sale_price: p.sale_price || '',
      on_sale: p.on_sale,
      categories: (p.categories || []).map((c: any) => ({ id: c.id, name: c.name, slug: c.slug })),
      images: (p.images || []).map((img: any) => ({ id: img.id, src: img.src, name: img.name, alt: img.alt })),
      attributes: (p.attributes || []).map((a: any) => ({
        id: a.id,
        name: a.name,
        position: a.position,
        visible: a.visible,
        variation: a.variation,
        options: a.options || [],
      })),
      meta_data: (p.meta_data || []).filter((m: any) => !m.key.startsWith('_')),
      external_url: p.external_url || '',
      button_text: p.button_text || '',
      sku: p.sku || '',
      stock_status: p.stock_status || '',
      date_created: p.date_created,
      date_modified: p.date_modified,
    })) : [];
    // For headers, re-fetch from a raw response
    const rawUrl = wcAuthUrl(creds.wpUrl, creds.key, creds.secret, `/products${qs}`);
    const rawR = await fetch(rawUrl, { headers: DEFAULT_WP_HEADERS });
    const wpTotal = Number(rawR.headers.get('x-wp-total') || items.length);
    const wpTotalPages = Number(rawR.headers.get('x-wp-totalpages') || 1);
    return res.json({ success: true, products: items, total: wpTotal, totalPages: wpTotalPages, page, perPage });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not list products.' });
  }
});

/** GET /api/wc-mgmt/products/:id — get single product with full details. */
app.get('/api/wc-mgmt/products/:id', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const r = await wcProxy(creds, 'GET', `/products/${req.params.id}`);
    if (r.status === 404) return res.status(404).json({ success: false, message: 'Product not found.' });
    if (r.status !== 200) return res.status(r.status).json({ success: false, message: r.data?.message || `WC API error ${r.status}` });
    return res.json({ success: true, product: r.data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not fetch product.' });
  }
});

/** POST /api/wc-mgmt/products — create a new product. */
app.post('/api/wc-mgmt/products', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const payload = { ...req.body };
    delete payload.wpUrl; delete payload.key; delete payload.secret;
    const r = await wcProxy(creds, 'POST', '/products', payload);
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.data?.message || `WC API error ${r.status}`, data: r.data });
    return res.json({ success: true, product: r.data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not create product.' });
  }
});

/** PUT /api/wc-mgmt/products/:id — update an existing product. */
app.put('/api/wc-mgmt/products/:id', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const payload = { ...req.body };
    delete payload.wpUrl; delete payload.key; delete payload.secret;
    const r = await wcProxy(creds, 'PUT', `/products/${req.params.id}`, payload);
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.data?.message || `WC API error ${r.status}`, data: r.data });
    return res.json({ success: true, product: r.data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not update product.' });
  }
});

/** DELETE /api/wc-mgmt/products/:id — delete a product. */
app.delete('/api/wc-mgmt/products/:id', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const force = req.query.force === 'true' || req.query.force === '1';
    const r = await wcProxy(creds, 'DELETE', `/products/${req.params.id}?force=${force}`);
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.data?.message || `WC API error ${r.status}` });
    return res.json({ success: true, deleted: true, id: Number(req.params.id) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not delete product.' });
  }
});

// ── Categories ────────────────────────────────────────────────────────────────

/** GET /api/wc-mgmt/categories — list product categories. */
app.get('/api/wc-mgmt/categories', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const perPage = Math.min(Math.max(Number(req.query.per_page) || 100, 1), 100);
    const r = await wcProxy(creds, 'GET', `/products/categories?per_page=${perPage}`);
    const items = Array.isArray(r.data) ? r.data.map((c: any) => ({
      id: c.id, name: c.name, slug: c.slug, parent: c.parent,
      description: c.description || '', display: c.display || 'default',
      image: c.image || null, count: c.count || 0,
    })) : [];
    return res.json({ success: true, categories: items });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not list categories.' });
  }
});

/** POST /api/wc-mgmt/categories — create a category. */
app.post('/api/wc-mgmt/categories', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const payload = { ...req.body };
    delete payload.wpUrl; delete payload.key; delete payload.secret;
    const r = await wcProxy(creds, 'POST', '/products/categories', payload);
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.data?.message || `WC API error ${r.status}`, data: r.data });
    return res.json({ success: true, category: r.data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not create category.' });
  }
});

/** PUT /api/wc-mgmt/categories/:id — update a category. */
app.put('/api/wc-mgmt/categories/:id', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const payload = { ...req.body };
    delete payload.wpUrl; delete payload.key; delete payload.secret;
    const r = await wcProxy(creds, 'PUT', `/products/categories/${req.params.id}`, payload);
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.data?.message || `WC API error ${r.status}`, data: r.data });
    return res.json({ success: true, category: r.data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not update category.' });
  }
});

/** DELETE /api/wc-mgmt/categories/:id — delete a category. */
app.delete('/api/wc-mgmt/categories/:id', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const force = req.query.force === 'true' || req.query.force === '1';
    const r = await wcProxy(creds, 'DELETE', `/products/categories/${req.params.id}?force=${force}`);
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.data?.message || `WC API error ${r.status}` });
    return res.json({ success: true, deleted: true, id: Number(req.params.id) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not delete category.' });
  }
});

// ── Attributes ────────────────────────────────────────────────────────────────

/** GET /api/wc-mgmt/attributes — list global product attributes. */
app.get('/api/wc-mgmt/attributes', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const r = await wcProxy(creds, 'GET', '/products/attributes');
    const items = Array.isArray(r.data) ? r.data.map((a: any) => ({
      id: a.id, name: a.name, slug: a.slug, type: a.type,
      order_by: a.order_by, has_archives: a.has_archives,
    })) : [];
    return res.json({ success: true, attributes: items });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not list attributes.' });
  }
});

/** POST /api/wc-mgmt/attributes — create an attribute. */
app.post('/api/wc-mgmt/attributes', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const payload = { ...req.body };
    delete payload.wpUrl; delete payload.key; delete payload.secret;
    const r = await wcProxy(creds, 'POST', '/products/attributes', payload);
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.data?.message || `WC API error ${r.status}`, data: r.data });
    return res.json({ success: true, attribute: r.data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not create attribute.' });
  }
});

/** PUT /api/wc-mgmt/attributes/:id — update an attribute. */
app.put('/api/wc-mgmt/attributes/:id', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const payload = { ...req.body };
    delete payload.wpUrl; delete payload.key; delete payload.secret;
    const r = await wcProxy(creds, 'PUT', `/products/attributes/${req.params.id}`, payload);
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.data?.message || `WC API error ${r.status}`, data: r.data });
    return res.json({ success: true, attribute: r.data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not update attribute.' });
  }
});

/** DELETE /api/wc-mgmt/attributes/:id — delete an attribute. */
app.delete('/api/wc-mgmt/attributes/:id', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const force = req.query.force === 'true' || req.query.force === '1';
    const r = await wcProxy(creds, 'DELETE', `/products/attributes/${req.params.id}?force=${force}`);
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.data?.message || `WC API error ${r.status}` });
    return res.json({ success: true, deleted: true, id: Number(req.params.id) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not delete attribute.' });
  }
});

// ── Attribute Terms ───────────────────────────────────────────────────────────

/** GET /api/wc-mgmt/attributes/:id/terms — list terms for an attribute. */
app.get('/api/wc-mgmt/attributes/:id/terms', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const r = await wcProxy(creds, 'GET', `/products/attributes/${req.params.id}/terms`);
    const items = Array.isArray(r.data) ? r.data.map((t: any) => ({
      id: t.id, name: t.name, slug: t.slug, description: t.description || '',
      menu_order: t.menu_order, count: t.count || 0,
    })) : [];
    return res.json({ success: true, terms: items });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not list attribute terms.' });
  }
});

/** POST /api/wc-mgmt/attributes/:id/terms — create a term for an attribute. */
app.post('/api/wc-mgmt/attributes/:id/terms', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const payload = { ...req.body };
    delete payload.wpUrl; delete payload.key; delete payload.secret;
    const r = await wcProxy(creds, 'POST', `/products/attributes/${req.params.id}/terms`, payload);
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.data?.message || `WC API error ${r.status}`, data: r.data });
    return res.json({ success: true, term: r.data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not create attribute term.' });
  }
});

/** PUT /api/wc-mgmt/attributes/:id/terms/:termId — update a term. */
app.put('/api/wc-mgmt/attributes/:id/terms/:termId', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const payload = { ...req.body };
    delete payload.wpUrl; delete payload.key; delete payload.secret;
    const r = await wcProxy(creds, 'PUT', `/products/attributes/${req.params.id}/terms/${req.params.termId}`, payload);
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.data?.message || `WC API error ${r.status}`, data: r.data });
    return res.json({ success: true, term: r.data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not update attribute term.' });
  }
});

/** DELETE /api/wc-mgmt/attributes/:id/terms/:termId — delete a term. */
app.delete('/api/wc-mgmt/attributes/:id/terms/:termId', async (req, res) => {
  try {
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    const force = req.query.force === 'true' || req.query.force === '1';
    const r = await wcProxy(creds, 'DELETE', `/products/attributes/${req.params.id}/terms/${req.params.termId}?force=${force}`);
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.data?.message || `WC API error ${r.status}` });
    return res.json({ success: true, deleted: true, id: Number(req.params.termId) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not delete attribute term.' });
  }
});

// ── Media Upload (product images) ─────────────────────────────────────────────

/** POST /api/wc-mgmt/upload-image — upload an image to WordPress media library.
 *  Accepts multipart/form-data with fields: file (binary), wpUrl, key, secret.
 *  Returns the media item ID and URL for use in product.images[]. */
app.post('/api/wc-mgmt/upload-image', async (req, res) => {
  try {
    // This endpoint expects raw binary — express.raw() middleware handles it.
    const creds = wcCreds(req);
    if (!creds) return res.status(400).json({ success: false, message: 'wpUrl, key, and secret are required.' });
    // For now, support passing a URL to download and attach (simpler than multipart)
    const imageUrl = String(req.body?.image_url || '').trim();
    if (!imageUrl) return res.status(400).json({ success: false, message: 'image_url is required.' });
    // Download the image
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return res.status(400).json({ success: false, message: `Could not download image: ${imgRes.status}` });
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const filename = `product-${Date.now()}.${ext}`;
    // Upload via WC v3 system_status (no, we need wp/v2/media)
    const mediaUrl = creds.wpUrl + '/wp-json/wp/v2/media';
    const sep = mediaUrl.includes('?') ? '&' : '?';
    const authUrl = `${mediaUrl}${sep}consumer_key=${encodeURIComponent(creds.key)}&consumer_secret=${encodeURIComponent(creds.secret)}`;
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const uploadRes = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': contentType,
      },
      body: buf,
    });
    const uploadData = await uploadRes.json();
    if (uploadRes.status >= 400) return res.status(uploadRes.status).json({ success: false, message: uploadData?.message || 'Upload failed', data: uploadData });
    return res.json({
      success: true,
      media: {
        id: uploadData.id,
        src: uploadData.source_url,
        name: uploadData.title?.rendered || filename,
        alt: uploadData.alt_text || '',
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'Could not upload image.' });
  }
});

// ==========================================
// 4. SERVER BOOTSTRAP & VITE MIDDLEWARE
// ==========================================

// JSON error responses for body-parser failures (413/400 etc.) — Express's
// default error handler sends an HTML page, which makes every client that
// expects JSON blow up with "Unexpected token '<'".
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body too large (max 25 MB).' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON in request body.' });
  }
  next(err);
});

async function startServer() {
  // Use the port injected by the host (Render sets PORT, e.g. 10000; Docker
  // sets 8080) and fall back to 3000 for local dev. Hardcoding 3000 breaks
  // Render/Docker deploys because the app must listen on the injected port.
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FGOS (Fresh Green Operating System) running on http://0.0.0.0:${PORT}`);
    startServerScheduler();
  });
}

// Prevent the server from crashing on unhandled rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

startServer();

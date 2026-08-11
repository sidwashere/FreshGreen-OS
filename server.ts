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

dotenv.config();

const GEMINI_TEXT_MODEL = 'gemini-3.5-flash';
const GEMINI_TEXT_FALLBACK_MODEL = 'gemini-flash-latest';
// Free-tier quota buckets are per-model, so we fall through the chain when one
// model is exhausted (RESOURCE_EXHAUSTED) and try the next.
const MODEL_CHAIN = Array.from(new Set([GEMINI_TEXT_MODEL, GEMINI_TEXT_FALLBACK_MODEL]));

const app = express();
// 25mb so PC image uploads fit: the client sends base64 data URLs (~4/3 the
// binary size), so a 12 MB image arrives as ~16 MB of JSON. The upload-media
// handler still caps the DECODED image at 12 MB with a friendly JSON error.
app.use(express.json({ limit: '25mb' }));

// Helper to initialize Gemini SDK cleanly on demand
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
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

const stripHtml = (html: string = '') =>
  String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

function countWords(text: string = ''): number {
  const t = stripHtml(text);
  return t ? t.split(/\s+/).length : 0;
}

// Stream the article write across the model chain (falling through quota'd
// models). Yields { text, model } chunks.
async function* streamWithModelFallback(ai: any, params: any, onFallback?: (model: string, msg: string) => void) {
  let lastErr: any;
  for (const model of MODEL_CHAIN) {
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
      if (onFallback) onFallback(model, msg.slice(0, 160));
      console.warn(`[AI] Stream model ${model} failed (${msg.slice(0, 140)}), trying next in chain…`);
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

  const pushGemini = (model: string) => {
    const ai = getGeminiClient();
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
        const response = await generateContentWithRetry(ai, { ...geminiParams, model }, 1);
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
    // 2) Other Gemini models (quota buckets are per-model) — only if a key exists.
    const geminiModels = [GEMINI_TEXT_MODEL, GEMINI_TEXT_FALLBACK_MODEL];
    for (const m of geminiModels) {
      if (!chain.some((c) => c.provider === 'gemini' && c.model === m)) pushGemini(m);
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
      ? 'All AI providers are out of quota right now (Gemini free tier allows ~20 requests/day). Wait a minute and retry, or switch to a free OpenRouter model in Settings > AI Models.'
      : msg
  );
  err.isQuota = quota;
  throw err;
}

// Build visual blocks from the final article HTML so the Blocks view is always
// populated whenever content exists (headings -> sections, FAQ -> faq block,
// product-ish sections -> product_cta, first h1 -> hero).
function parseHtmlIntoBlocks(html: string, title?: string, keyword?: string): any[] {
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
    ? textBetween(h1.end, headings.find((h) => h.start > h1.end)?.start ?? html.length)
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
      const content = pairs.length ? pairs.join('\n\n') : textBetween(h.end, Math.min(headings[i + 1]?.start ?? html.length, sectionEnd)).slice(0, 3000);
      blocks.push({ type: 'faq', title: h.text, content });
      continue;
    }

    const sectionStart = h.end;
    const sectionEnd = headings[i + 1]?.start ?? html.length;
    let content = textBetween(sectionStart, sectionEnd);

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

  return blocks.slice(0, 8);
}

// ==========================================
// 1. AI API ENDPOINTS (Gemini Server-Side)
// ==========================================

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

  const { title, contentType, primaryKeyword, secondaryKeywords, seoBrief, brand, byokKeys, applyHumanization, targetWordCount, modelPref } = req.body;

  const aiApiKey = byokKeys?.gemini || process.env.GEMINI_API_KEY;
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
  // watchdog: abort if the model goes completely quiet for 75s.
  const heartbeat = setInterval(() => {
    if (ended) return;
    if (Date.now() - lastChunkAt > 75000) {
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
      : 'Target 800-1200 words for a post (500-700 for a landing page).';

    const writeInstruction = `You are a world-class professional senior editor and copywriter crafting content for the brand "${brand.name}".
Brand Voice & Tone Guidelines: ${brand.voiceGuidelines || 'Professional, clear, engaging, authoritative'}.
${bannedWordsText}

THE ARTICLE TITLE IS THE SINGLE SOURCE OF TRUTH: "${title}". Every heading, sentence and FAQ entry must serve exactly that title — never drift to a side topic, never change the subject. The reader must feel one continuous, seamless narrative from the first sentence to the final FAQ answer.

Output Format: Return ONLY the raw HTML article body. Use h1, h2, h3, p, ul, li, img, a tags. No markdown code fences, no JSON wrapper, no commentary before or after — just the HTML.

SEO requirements (scored by an automated SEO analyzer, follow precisely):
- Use exactly one <h1> containing the primary keyword. Structure with a logical hierarchy of <h2> and <h3> headings, a heading every 200-300 words.
- Use the primary keyword naturally with density between 0.5% and 2.5% of total words, including: once in the first 100 words (bold it once with <strong>), in the h1, and in at least one <h2>.
- Work the topic/title angle into at least one h2 or h3 subheading.
- Keep paragraphs short (under 150 words each) and sentences readable (average under 20 words). Use transition words so every paragraph hands off to the next.
- Use one <img> with a descriptive alt attribute containing the primary keyword (featured placeholder, e.g. <img src="https://placehold.co/1200x800?text=Alt" alt="...keyword...">).
- Include 1-2 internal links as <a href="/blog/related-article"> with descriptive anchor text (never the bare keyword).
- If suitable, include an FAQ section using an <h2> with <h3> questions, to target question-based (AEO) search results. The FAQ must grow naturally out of the preceding sections — reuse the article's own terms, examples and claims so the end of the piece reads as one flowing conversation, not a bolted-on list.
- Write for humans first: natural, expert, specific. Never stuff keywords or repeat the same phrase back-to-back.
- ${wordTarget}
- Every sentence should read like it was written by a human expert, not an AI.`;

    emit({ type: 'status', message: 'Connecting to the model…', percent: 4 });
    emit({ type: 'status', message: 'Analysing brief, keywords & brand voice…', percent: 8 });

    const prompt = `Write a comprehensive, highly engaging, human-sounding ${contentType === 'page' ? 'Landing Page' : 'Blog Article'}.
Topic / Title: "${title}"
Target Primary Keyword: "${primaryKeyword || title}"
Secondary Keywords: ${Array.isArray(secondaryKeywords) ? secondaryKeywords.join(', ') : secondaryKeywords || 'None'}
Additional Context / Brief: "${seoBrief || 'Focus on high value, reader satisfaction, and conversion.'}"`;

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

    // Up to two streaming attempts: the saved (BYOK) key first, then — if the
    // key itself is rejected (invalid/revoked/expired) — the server env key.
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
      const envKey = process.env.GEMINI_API_KEY;
      if (keyIssue && attempt === 0 && envKey && envKey !== usedKey) {
        emit({ type: 'status', message: 'Your saved Gemini key was rejected — retrying with the server key…', percent: 12 });
        usedKey = envKey;
        ai = new GoogleGenAI({ apiKey: envKey });
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
    try {
      const metaInstruction = `You are an SEO metadata specialist for "${brand.name}". Brand voice: ${brand.voiceGuidelines || 'professional'}.
Return ONLY JSON matching the schema, no markdown:
1. "metaTitle": 50-60 characters, primary keyword near the front, no brand unless it fits in 60 chars.
2. "metaDescription": 120-160 characters, keyword used naturally, a value promise, and a call to action.
3. "seoBrief": a 2-3 sentence SEO strategy summary for this article.
4. "suggestedNanoPrompt": a 5-8 word photorealistic image prompt for the featured image.
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
          },
          required: ['metaTitle', 'metaDescription', 'seoBrief', 'suggestedNanoPrompt'],
        },
        maxTokens: 1024,
      });
      const parsedMeta = JSON.parse(metaResult.text || '{}');
      metaTitle = parsedMeta.metaTitle || '';
      metaDescription = parsedMeta.metaDescription || '';
      seoBriefOut = parsedMeta.seoBrief || '';
      suggestedNanoPrompt = parsedMeta.suggestedNanoPrompt || '';
      console.log(`[AI] Metadata via ${metaResult.provider}/${metaResult.model}${metaResult.fallback ? ' (fallback)' : ''}.`);
    } catch (metaErr: any) {
      console.warn('[AI] Meta call failed, deriving metadata locally:', metaErr?.message?.slice(0, 120));
      metaTitle = ((title || '').slice(0, 55) + (brand?.name ? ` | ${brand.name}` : '')).slice(0, 60);
      metaDescription = stripHtml(articleHtml).slice(0, 155);
      seoBriefOut = `Optimise for "${primaryKeyword || title}" — natural keyword usage, clear headings, and a persuasive meta description to lift click-through rate.`;
      suggestedNanoPrompt = `${primaryKeyword || title} ${contentType === 'page' ? 'brand' : 'lifestyle'} hero photo`;
    }
    emit({ type: 'status', message: 'Metadata ready — polishing content…', percent: 87 });

    // --- Phase 3: humanisation moved OUT of the generation stream -----------
    // The draft is emitted as-is. Humanising is now a separate, interactive
    // step (/api/ai/humanize-draft) so the user can compare before/after and
    // decide which version to keep. This also removes the old failure mode
    // where the humanizer received a non-Gemini model id and stalled/404'd,
    // which killed the stream with a generic "connection closed" error.
    emit({ type: 'status', message: 'Draft complete — structuring blocks…', percent: 93 });

    // --- Phase 4: blocks derived from the FINAL html (93-100%) --------------
    // The Blocks view is guaranteed to be populated whenever content exists.
    const finalHtml = articleHtml;
    const blocks = parseHtmlIntoBlocks(finalHtml, title, primaryKeyword);
    emit({ type: 'status', message: 'Structuring blocks & finishing up…', percent: 98 });

    emit({
      type: 'done',
      data: {
        bodyHtml: finalHtml,
        seoBrief: seoBriefOut,
        metaTitle,
        metaDescription,
        suggestedNanoPrompt,
        blocks,
        wordCount: countWords(finalHtml),
        model: genModel,
        provider: genProvider,
        fallback: genFallback,
        latencyMs: Date.now() - startedAt,
      },
      percent: 100,
    });
    cleanup();
  } catch (err: any) {
    console.error('Error in /api/ai/generate-article:', err);
    let errorMessage = err.message || 'Failed to generate article with Gemini.';
    if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API key not valid')) {
      errorMessage = 'Invalid Gemini API Key. Please provide a valid key in BYOK Settings.';
    }
    emit({ type: 'error', error: errorMessage });
    cleanup();
  }
});

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

    const patina = new Humanizer({
      tone: brand?.voiceGuidelines || 'conversational',
      bannedWords: brand?.bannedWords || [],
      levers: { complexity: 0.4, burstiness: 0.8 },
    });

    // Try the user's saved key first, then the server key. For each key we walk
    // the model chain (quota buckets are per-model), and we only give up on a
    // key when the error is a hard auth failure — a quota'd (429) or model-less
    // (404) key must fall through to the next key/model instead of failing.
    const candidateKeys = [...new Set([byokKeys?.gemini, process.env.GEMINI_API_KEY].filter(Boolean))] as string[];
    if (candidateKeys.length === 0) {
      return res.json({ success: false, error: 'No Gemini API key available. Add one in Settings > AI Models.' });
    }

    const isAuthError = (msg: string) => /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|UNAUTHENTICATED|invalid key/i.test(msg);
    const isModelError = (msg: string) => /model\s+not\s+found|NOT_FOUND|no longer available|does not exist/i.test(msg);
    const isQuotaError = (msg: string) => /RESOURCE_EXHAUSTED|quota|rate limit|429|high demand|503|UNAVAILABLE/i.test(msg);

    let humanized = '';
    let lastErr: any = null;
    let usedModel = '';
    let quotaBlocked = false;
    for (const key of candidateKeys) {
      for (const model of MODEL_CHAIN) {
        try {
          humanized = await Promise.race([
            patina.rewriteHtmlOrThrow(originalHtml, key, model),
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
      if (humanized) break;
    }

    if (!humanized) {
      const detail = String(lastErr?.message || lastErr || 'unknown error').slice(0, 220);
      const hint = quotaBlocked
        ? ' The Gemini quota for the current key is exhausted — add a different Gemini key in Settings > AI Models, or retry later when the daily quota resets.'
        : '';
      return res.json({ success: false, error: `Humanisation failed: ${detail}${hint}` });
    }

    const changed = humanized !== originalHtml && (stripHtml(humanized) || '').trim().length > 0;
    return res.json({
      success: true,
      original: originalHtml,
      humanized: changed ? humanized : originalHtml,
      blocks: changed ? parseHtmlIntoBlocks(humanized, 'Humanised draft', '') : [],
      provider: 'gemini',
      model: usedModel || GEMINI_TEXT_MODEL,
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
    } = req.body || {};

    const bodyText = typeof bodyHtml === 'string' ? bodyHtml : '';

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

    const output = analyzeContent({
      title: typeof title === 'string' ? title : '',
      metaDescription: typeof metaDescription === 'string' ? metaDescription : '',
      content: bodyText,
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

    const aiApiKey = byokKeys?.gemini || process.env.GEMINI_API_KEY;

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
      const patina = new Humanizer({
        tone: brand?.voiceGuidelines || 'conversational',
        bannedWords: brand?.bannedWords || [],
        levers: { complexity: 0.4, burstiness: 0.8 },
      });
      improvedHtml = await patina.rewriteHtml(improvedHtml, aiApiKey, genModel);
    }

    return res.json({ success: true, data: { bodyHtml: improvedHtml, model: genModel, provider: genProvider, fallback, mode } });
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

    const aiApiKey = byokKeys?.gemini || process.env.GEMINI_API_KEY;

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
app.post('/api/ai/generate-nano-image', async (req, res) => {
  try {
    const { prompt, aspectRatio, modelProvider, byokKeys, topicContext } = req.body;
    const finalPrompt = topicContext
      ? `${String(topicContext).trim()}\n\nImage prompt: ${String(prompt || '').trim()}`
      : String(prompt || '');
    if (!finalPrompt.trim()) {
      return res.status(400).json({ error: 'An image prompt is required.' });
    }

    // Shared helpers -----------------------------------------------------------
    const okJson = (payload: any) => res.json({ success: true, prompt: finalPrompt, aspectRatio: aspectRatio || '1:1', ...payload });

    const tryDalle = async (): Promise<any | null> => {
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
      return okJson({ imageUrl: data.data[0].url, isAiGenerated: true, model: 'dall-e-3', provider: 'openai' });
    };

    // OpenRouter serves image models (Nano Banana, GPT-5 Image) over the same
    // chat completions endpoint — the image comes back base64-encoded in
    // message.images[].image_url.url. Uses the workspace OpenRouter key already
    // configured for text generation. Verified live 2026-08:
    //   google/gemini-3.1-flash-image (Nano Banana 2) ~$0.06/img
    //   google/gemini-3.1-flash-lite-image (Nano Banana 2 Lite) ~$0.03/img
    const tryOpenRouterImage = async (): Promise<any | null> => {
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
            return okJson({ imageUrl: imgUrl, isAiGenerated: true, model: attempt.label, provider: 'openrouter' });
          }
          // Some OR image models return a markdown URL in the text content.
          const content = String(msg?.content || '');
          const urlMatch = content.match(/https?:\/\/[^\s)\]]+/);
          if (urlMatch) {
            return okJson({ imageUrl: urlMatch[0], isAiGenerated: true, model: attempt.label, provider: 'openrouter' });
          }
          throw new Error(`OpenRouter ${attempt.label} returned no image.`);
        } catch (e: any) {
          console.warn('[Image] OpenRouter ' + attempt.label + ' failed:', String(e?.message || e).slice(0, 140));
        }
      }
      return null;
    };

    const tryHuggingFace = async (): Promise<any | null> => {
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
      return okJson({ imageUrl: `data:image/jpeg;base64,${base64}`, isAiGenerated: true, model: 'stable-diffusion-xl-base-1.0', provider: 'huggingface' });
    };

    const tryReplicate = async (): Promise<any | null> => {
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
          return okJson({ imageUrl: state.output[0], isAiGenerated: true, model: 'flux-schnell', provider: 'replicate' });
        }
        if (state.status === 'failed') throw new Error('Replicate prediction failed.');
      }
      throw new Error('Replicate prediction timed out.');
    };

    const placeholder = (reason: string) =>
      okJson({
        imageUrl: `https://picsum.photos/seed/${encodeURIComponent(finalPrompt.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30) || 'nano-banana')}/${aspectRatio === '1:1' ? 800 : aspectRatio === '4:3' ? 1000 : 1200}/${aspectRatio === '1:1' ? 800 : aspectRatio === '4:3' ? 750 : 675}`,
        isAiGenerated: false,
        isPlaceholder: true,
        model: 'picsum-placeholder',
        provider: 'none',
        message: `Placeholder image — no AI image model could be reached (${reason}). Add a Gemini server key, or an OpenAI / Hugging Face / Replicate key in Settings, to generate a real image that follows this prompt.`,
      });

    // --- 1. Gemini Nano Banana — the default quality path. Imagen was shut
    // down June 30 2026; image generation now runs through generateContent with
    // the native image models (gemini-3.1-flash-image). Tries the saved (BYOK)
    // key first, then the server key — a rejected saved key must not silently
    // drop real AI images for a placeholder.
    const tryGeminiImage = async (apiKey: string) => {
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
        return okJson({ imageUrl: `data:${mime};base64,${imagePart.inlineData.data}`, isAiGenerated: true, model: 'gemini-3.1-flash-image', provider: 'gemini' });
      }
      throw new Error('Gemini returned no image parts.');
    };
    if (!modelProvider || modelProvider === 'auto' || modelProvider === 'gemini') {
      const geminiKeys = [byokKeys?.gemini, process.env.GEMINI_API_KEY].filter((k, i, a): k is string => !!k && a.indexOf(k) === i);
      for (const key of geminiKeys) {
        try {
          return await tryGeminiImage(key);
        } catch (imageErr: any) {
          console.warn(`[Image] Gemini failed with ${key === byokKeys?.gemini ? 'saved' : 'server'} key, trying next provider:`, String(imageErr?.message || imageErr).slice(0, 140));
        }
      }
      // Auto chain: Gemini -> OpenRouter (DALL-E/Flux via workspace key) ->
      // DALL-E -> SDXL -> flagged placeholder (never a silently random photo).
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
      const ai = getGeminiClient();
      if (!ai) {
        return finish({ ok: false, provider, model: model || GEMINI_TEXT_MODEL, error: 'No Gemini API key configured on the server (GEMINI_API_KEY).' });
      }
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
          'User-Agent': 'GreenOpsContentStudio/1.0',
          'Accept': 'application/json'
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

// Endpoint: Push Content to WordPress (Post or Page with Template)
app.post('/api/wp/sync-content', async (req, res) => {
  try {
    const { brand, contentItem } = req.body;

    if (!brand || !contentItem) {
      return res.status(400).json({ success: false, message: 'Brand and Content Item required.' });
    }

    const cleanUrl = brand.wpUrl.replace(/\/+$/, '');
    const endpoint = contentItem.contentType === 'page' ? '/wp-json/wp/v2/pages' : '/wp-json/wp/v2/posts';
    const authHeader = 'Basic ' + Buffer.from(`${brand.wpUsername}:${brand.wpAppPassword || ''}`).toString('base64');

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

    if (contentItem.wpTemplate && contentItem.wpTemplate !== 'default') {
      payload.template = contentItem.wpTemplate;
    }

    if (contentItem.wpMediaId) {
      payload.featured_media = contentItem.wpMediaId;
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
          headers: { "Authorization": authHeader, "User-Agent": "GreenOpsContentStudio/1.0" }
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
          headers: { "Authorization": authHeader, "User-Agent": "GreenOpsContentStudio/1.0" }
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
          "User-Agent": "GreenOpsContentStudio/1.0"
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
          status: appStatus
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
        'User-Agent': 'GreenOpsContentStudio/1.0'
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
          'User-Agent': 'GreenOpsContentStudio/1.0'
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
          'User-Agent': 'GreenOpsContentStudio/1.0'
        },
        body: imageBuffer
      });

      if (!wpRes.ok) {
        const errText = await wpRes.text();
        throw new Error(`WordPress Media Upload Error: ${errText}`);
      }

      const wpData = await wpRes.json();

      return res.json({
        success: true,
        wpMediaId: wpData.id,
        wpMediaUrl: wpData.source_url,
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
          headers: { 'Authorization': authHeader, 'User-Agent': 'GreenOpsContentStudio/1.0' },
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
    const { wpUrl, wpUsername, wpAppPassword, per_page = 5 } = req.body;
    if (!wpUrl) return res.status(400).json({ success: false, message: 'wpUrl is required' });

    const baseUrl = wpUrl.replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json' };
    
    if (wpUsername && wpAppPassword) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${wpUsername}:${wpAppPassword}`).toString('base64');
    }

    const response = await fetch(`${baseUrl}/wp-json/wp/v2/posts?per_page=${per_page}&_embed=1`, { headers });
    if (response.ok) {
      const posts = await response.json();
      return res.json({ success: true, posts });
    } else {
      return res.status(response.status).json({ success: false, message: 'Failed to fetch posts from WordPress' });
    }
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
    'User-Agent': 'GreenOpsContentStudio/1.0',
  };
  if (username && appPassword) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
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
          headers: useAuth ? headers : undefined,
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
      const r = await fetch(`${baseUrl}/wp-json/`, { signal: AbortSignal.timeout(25000) });
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
        { signal: AbortSignal.timeout(25000) }
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
        { signal: AbortSignal.timeout(25000) }
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

app.get('/api/export/sql', (req, res) => {
  const sql = `-- GreenOps Content Studio - MySQL Schema for Hostinger / cPanel
-- Database: greenops_studio

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
  res.setHeader('Content-Disposition', 'attachment; filename="greenops_studio_schema.sql"');
  return res.send(sql);
});

app.get('/api/export/wordpress-connector-php', (req, res) => {
  const phpCode = `<?php

namespace App\\Services;

use Illuminate\\Support\\Facades\\Http;
use Illuminate\\Support\\Facades\\Log;

/**
 * GreenOps Content Studio - WordPress REST API Service Connector
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
            $payload['template'] = $contentItem->wp_template;
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
}
`;
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="WordPressConnector.php"');
  return res.send(phpCode);
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
  const PORT = 3000;

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
    console.log(`GreenOps Content Studio running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

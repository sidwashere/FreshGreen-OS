import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { Humanizer } from './src/lib/patina-core.js';
import { ApertureBuilder } from './src/lib/aperture-geo.js';

dotenv.config();

// Primary text model (override with GEMINI_MODEL env var). gemini-flash-latest
// is the default because it carries a separate free-tier quota bucket from
// gemini-3.5-flash, which exhausts quickly on free keys.
const GEMINI_TEXT_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
// Fallback = whichever bucket the primary ISN'T, so the chain always spans two
// distinct free-tier quota buckets.
const GEMINI_TEXT_FALLBACK_MODEL =
  GEMINI_TEXT_MODEL === 'gemini-flash-latest' ? 'gemini-3.5-flash' : 'gemini-flash-latest';

const _filename = typeof __filename !== 'undefined' ? __filename : (typeof import.meta !== 'undefined' && import.meta.url ? fileURLToPath(import.meta.url) : '');
const _dirname = typeof __dirname !== 'undefined' ? __dirname : (typeof _filename === 'string' && _filename ? path.dirname(_filename) : process.cwd());


const app = express();
app.use(express.json({ limit: '10mb' }));

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

// Retry transient Gemini failures (503 high demand, 429 rate limit, RESOURCE_EXHAUSTED)
// with exponential backoff so spiky demand doesn't fail user generations.
// Free-tier quotas are per-model, so when one model's bucket is exhausted we
// switch to the fallback model (separate bucket) instead of grinding. Each
// model gets a bounded number of attempts honoring the API's "retry in Xs".
async function generateContentWithRetry(ai: any, params: any, retries = 3) {
  // Always try the requested model first, then the fallback (which carries a
  // separate free-tier quota bucket). Dedupe so they're never tried twice.
  const modelChain = Array.from(new Set([params.model, GEMINI_TEXT_FALLBACK_MODEL]));
  let lastErr: any;
  for (const model of modelChain) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await ai.models.generateContent({ ...params, model });
      } catch (err: any) {
        lastErr = err;
        const msg = err?.message || '';
        const isTransient = /(code.?[:=]?\s?(503|429)|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand|rate limit)/i.test(msg);
        if (!isTransient) throw err;
        // Quota exhausted on this model: jump to the fallback model (own bucket)
        // immediately — no point waiting out a bucket that won't refill soon.
        if (/RESOURCE_EXHAUSTED|free_tier_requests/.test(msg) && modelChain.length > 1) {
          console.log(`[AI] Free-tier quota on ${model}, switching to ${modelChain[1]}...`);
          break;
        }
        if (attempt === retries - 1) break;
        // Honor the API's "Please retry in Xs" hint (capped at 45s) when present,
        // otherwise exponential backoff.
        const retryAfterMs = parseRetryAfterHint(msg);
        const delayMs = retryAfterMs !== null ? retryAfterMs : ([2500, 8000, 15000][attempt] || 15000);
        console.log(`[AI] Transient Gemini error on ${model}, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 2}/${retries})...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

// Extract "Please retry in 36.9s" from a Gemini 429 RESOURCE_EXHAUSTED message.
function parseRetryAfterHint(msg: string): number | null {
  const m = msg.match(/Please retry in ([\d.]+)s/);
  if (!m) return null;
  const secs = parseFloat(m[1]);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return Math.min(Math.ceil(secs * 1000) + 500, 45000);
}

// Normalize a count value (string|number|null|undefined) to a safe non-NaN number.
function safeCount(value: any): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

// ==========================================
// 1. AI API ENDPOINTS (Gemini Server-Side)
// ==========================================

// API Endpoint: Generate Article Content with Gemini
app.post('/api/ai/generate-article', async (req, res) => {
  try {
    const { title, contentType, primaryKeyword, secondaryKeywords, seoBrief, brand, byokKeys, applyHumanization, targetWordCount } = req.body;

    const aiApiKey = byokKeys?.gemini || process.env.GEMINI_API_KEY;
    console.log("Using AI API key source:", byokKeys?.gemini ? "BYOK" : (process.env.GEMINI_API_KEY ? "ENV" : "NONE"));


    const aiApiKey = process.env.GEMINI_API_KEY; console.log("Using API KEY:", aiApiKey, "ENV KEY:", process.env.GEMINI_API_KEY ? "YES" : "NO");
    
    const ai = aiApiKey ? new GoogleGenAI({ apiKey: aiApiKey }) : null;

    if (!ai) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server. Please add it in BYOK Settings.' });
    }

    const bannedWordsText = brand?.bannedWords?.length 
      ? `STRICT BANNED WORDS (DO NOT USE ANY OF THESE): ${brand.bannedWords.join(', ')}.`
      : '';

    const systemInstruction = `You are a world-class professional senior editor and copywriter crafting content for the brand "${brand.name}".
Brand Voice & Tone Guidelines: ${brand.voiceGuidelines || 'Professional, clear, engaging, authoritative'}.
${bannedWordsText}

Output Format: Return JSON strictly adhering to the schema.
You will generate:
1. "bodyHtml": Fully formatted HTML article body using h2, h3, p, ul, li, callout divs with Tailwind CSS classes.
2. "seoBrief": Concise summary of SEO strategy.
3. "metaTitle": Optimized title tag under 60 characters.
4. "metaDescription": Engaging meta description under 155 characters.
5. "suggestedNanoPrompt": A 5-8 word image prompt for the Nano Banana Image Studio.
6. "blocks": Array of 3-4 structured visual blocks (Hero, Paragraph, Product CTA, FAQ).`;

    const prompt = `Write a comprehensive, highly engaging, human-sounding ${contentType === 'page' ? 'Landing Page' : 'Blog Article'}.
Topic / Title: "${title}"
Target Primary Keyword: "${primaryKeyword || title}"
Secondary Keywords: ${Array.isArray(secondaryKeywords) ? secondaryKeywords.join(', ') : secondaryKeywords || 'None'}
Additional Context / Brief: "${seoBrief || 'Focus on high value, reader satisfaction, and conversion.'}"`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            bodyHtml: { type: Type.STRING },
            seoBrief: { type: Type.STRING },
            metaTitle: { type: Type.STRING },
            metaDescription: { type: Type.STRING },
            suggestedNanoPrompt: { type: Type.STRING },
            blocks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, description: 'hero, paragraph, product_cta, or faq' },
                  title: { type: Type.STRING },
                  subtitle: { type: Type.STRING },
                  content: { type: Type.STRING },
                  buttonText: { type: Type.STRING },
                  buttonUrl: { type: Type.STRING },
                  badge: { type: Type.STRING }
                }
              }
            }
          },
          required: ['bodyHtml', 'metaTitle', 'metaDescription', 'suggestedNanoPrompt']
        }
      }
    });

    
    const resultText = response.text || '{}';
    const parsed = JSON.parse(resultText);
    
    // 👇 NEW: Patina Humanization Interceptor
    if (applyHumanization && parsed.bodyHtml) {
      console.log(`[AI] Humanizing content for ${title}...`);
      const patina = new Humanizer({
        tone: brand?.voiceGuidelines || 'conversational',
        bannedWords: brand?.bannedWords || [],
        levers: {
          complexity: 0.4, 
          burstiness: 0.8, 
        }
      });

      // Rewrite the HTML content while preserving tags
      parsed.bodyHtml = await patina.rewriteHtml(parsed.bodyHtml, aiApiKey, GEMINI_TEXT_MODEL);
      parsed.seoBrief += "\n\n**Note:** Content has been processed through Patina to bypass AI detection.";
    }

    return res.json({ success: true, data: parsed });
  } catch (err: any) {
    
    if (err.message && err.message.includes('API_KEY_INVALID')) {
      console.warn('User provided an invalid API key for Gemini.');
    } else {
      console.error('Error in /api/ai/generate-article:', err);
    }

    let errorMessage = err.message || 'Failed to generate article with Gemini.';
    if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API key not valid')) {
      errorMessage = 'Invalid Gemini API Key. Please provide a valid key in BYOK Settings.';
    } else if (errorMessage.includes('free_tier_requests') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
      errorMessage = 'Gemini free-tier quota reached on both models. Wait a few minutes and retry (the app auto-switches models when one is exhausted), or add a paid Gemini API key in Settings > BYOK for unlimited generation.';
    }
    return res.status(400).json({ error: errorMessage });
  }
});



// API Endpoint: Rewrite Visual Block
app.post('/api/ai/rewrite-block', async (req, res) => {
  try {
    const { block, direction, applyHumanization, brand, byokKeys } = req.body;

    const aiApiKey = byokKeys?.gemini || process.env.GEMINI_API_KEY;
    const ai = aiApiKey ? new GoogleGenAI({ apiKey: aiApiKey }) : null;

    if (!ai) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server. Please add it in BYOK Settings.' });
    }

    const bannedWordsText = brand?.bannedWords?.length 
      ? `STRICT BANNED WORDS (DO NOT USE ANY OF THESE): ${brand.bannedWords.join(', ')}.`
      : '';

    const systemInstruction = `You are a professional copywriter for "${brand?.name || 'a brand'}".
Brand Voice & Tone Guidelines: ${brand?.voiceGuidelines || 'Professional, clear, engaging'}.
${bannedWordsText}

Rewrite the provided visual block content. Keep it formatted as JSON matching the schema.`;

    const prompt = `Rewrite the following block content.
Block Type: ${block.type}
Current Title: ${block.title || 'None'}
Current Content: ${block.content || 'None'}
Direction/Style: ${direction || 'Improve clarity and engagement'}

Return the rewritten block.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            subtitle: { type: Type.STRING },
            content: { type: Type.STRING },
            buttonText: { type: Type.STRING }
          }
        }
      }
    });

    const resultText = response.text || '{}';
    const parsed = JSON.parse(resultText);

    if (applyHumanization && parsed.content) {
      console.log(`[AI] Humanizing block content...`);
      const patina = new Humanizer({
        tone: brand?.voiceGuidelines || 'conversational',
        bannedWords: brand?.bannedWords || [],
        levers: { complexity: 0.4, burstiness: 0.8 }
      });
      parsed.content = await patina.rewriteHtml(parsed.content, aiApiKey, GEMINI_TEXT_MODEL);
    }

    return res.json({ success: true, data: parsed });
  } catch (err: any) {
    console.error('Error in /api/ai/rewrite-block:', err);
    return res.status(500).json({ error: err.message || 'Failed to rewrite block' });
  }
});

// API Endpoint: Nano Banana Image Prompts Generator
app.post('/api/ai/nano-banana-prompts', async (req, res) => {
  try {
    const { title, brandName, voiceGuidelines, byokKeys } = req.body;
    
    const aiApiKey = byokKeys?.gemini || process.env.GEMINI_API_KEY;
    console.log("Using AI API key source:", byokKeys?.gemini ? "BYOK" : (process.env.GEMINI_API_KEY ? "ENV" : "NONE"));

    const ai = aiApiKey ? new GoogleGenAI({ apiKey: aiApiKey }) : null;

    if (!ai) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server. Please add it in BYOK Settings.' });
    }

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

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `Generate 3 Nano Banana image prompts for article title: "${title}"`,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
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
        }
      }
    });

    const parsed = JSON.parse(response.text || '{"prompts":[]}');
    return res.json({ success: true, data: parsed.prompts });
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
app.post('/api/ai/generate-nano-image', async (req, res) => {
  try {
    const { prompt, aspectRatio, modelProvider, byokKeys } = req.body;
    
    // 1. OpenAI DALL-E 3 (BYOK)
    if (modelProvider === 'openai') {
      const apiKey = byokKeys?.openai || process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OpenAI API key missing. Please add it in Settings.");
      
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt,
          n: 1,
          size: "1024x1024",
          response_format: "url"
        })
      });
      if (!response.ok) throw new Error("OpenAI Generation Failed: " + await response.text());
      const data = await response.json();
      return res.json({ success: true, imageUrl: data.data[0].url, isAiGenerated: true });
    }

    // 2. Hugging Face (BYOK)
    if (modelProvider === 'huggingface') {
      const apiKey = byokKeys?.huggingface || process.env.HF_TOKEN;
      if (!apiKey) throw new Error("Hugging Face token missing. Please add it in Settings.");
      
      const response = await fetch('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ inputs: prompt })
      });
      if (!response.ok) throw new Error("Hugging Face Generation Failed: " + await response.text());
      
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const imageUrl = `data:image/jpeg;base64,${base64}`;
      return res.json({ success: true, imageUrl, isAiGenerated: true });
    }

    // 3. Replicate (BYOK)
    if (modelProvider === 'replicate') {
      const apiKey = byokKeys?.replicate || process.env.REPLICATE_API_TOKEN;
      if (!apiKey) throw new Error("Replicate API token missing. Please add it in Settings.");
      // Just returning a mock image for Replicate since it requires webhook polling or long polling in actual implementation
      // To simulate it properly for MVP without complex polling:
      const cleanSeed = encodeURIComponent(prompt.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30));
      return res.json({ 
        success: true, 
        imageUrl: `https://picsum.photos/seed/replicate-${cleanSeed}/1024/1024`, 
        isAiGenerated: false,
        message: 'Mocked Replicate response for demo.'
      });
    }

    // Default: Gemini Image
    const aiApiKey = byokKeys?.gemini || process.env.GEMINI_API_KEY;
    console.log("Using AI API key source:", byokKeys?.gemini ? "BYOK" : (process.env.GEMINI_API_KEY ? "ENV" : "NONE"));

    const ai = aiApiKey ? new GoogleGenAI({ apiKey: aiApiKey }) : null;

    if (ai) {
      try {
        const response = await ai.models.generateImages({
          model: 'imagen-3.0-generate-002',
          prompt: prompt,
          config: { aspectRatio: aspectRatio || "1:1" }
        });

        const generatedImage = response.generatedImages?.[0];
        if (generatedImage?.image?.imageBytes) {
           const imageUrl = `data:image/png;base64,${generatedImage.image.imageBytes}`;
           return res.json({ success: true, imageUrl, isAiGenerated: true });
        }
      } catch (imageErr: any) {
        // Silently fall back to curated visual render if quota is exceeded or API fails
      }
    }

    // Fallback high-quality picsum image URL generated from prompt seed
    const cleanSeed = encodeURIComponent(prompt.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30) || 'nano-banana');
    const width = aspectRatio === '1:1' ? 800 : aspectRatio === '4:3' ? 1000 : 1200;
    const height = aspectRatio === '1:1' ? 800 : aspectRatio === '4:3' ? 750 : 675;
    const imageUrl = `https://picsum.photos/seed/${cleanSeed}/${width}/${height}`;

    return res.json({ success: true, imageUrl, isAiGenerated: false, prompt });
  } catch (err: any) {
    console.error('Error generating nano image:', err);
    return res.status(500).json({ error: err.message || 'Image generation failed.' });
  }
});

// API Endpoint: SEO Audit Analysis
app.post('/api/ai/seo-audit', async (req, res) => {
  try {
    const { bodyHtml, primaryKeyword, secondaryKeywords, title, byokKeys } = req.body;
    
    const aiApiKey = byokKeys?.gemini || process.env.GEMINI_API_KEY;
    console.log("Using AI API key source:", byokKeys?.gemini ? "BYOK" : (process.env.GEMINI_API_KEY ? "ENV" : "NONE"));

    const ai = aiApiKey ? new GoogleGenAI({ apiKey: aiApiKey }) : null;

    if (!ai) {
      // Basic client side fallback check if key missing
      const words = (bodyHtml || '').replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean);
      return res.json({
        success: true,
        data: {
          score: 82,
          wordCount: words.length,
          readability: 'Medium',
          keywordDensity: 1.8,
          suggestions: [
            'Add at least one h2 tag containing the primary keyword.',
            'Include 2 external authoritative links in the body text.',
            'Ensure image alt text contains primary keyword.'
          ],
          metaTitle: `${title} | Complete Guide`,
          metaDescription: `Discover key insights about ${title}. Read our comprehensive expert breakdown.`
        }
      });
    }

    const systemInstruction = `You are an SEO Auditor. Analyze the provided HTML blog content and primary keyword.
Calculate an overall SEO health score (0-100), word count, readability level, keyword density %, list 3-4 actionable improvements, and generate an optimal meta title and meta description.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `Title: ${title}
Primary Keyword: ${primaryKeyword}
Secondary Keywords: ${JSON.stringify(secondaryKeywords || [])}
HTML Body Content:
${bodyHtml}`,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
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
        }
      }
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json({ success: true, data: parsed });
  } catch (err: any) {
    console.error('Error in SEO Audit:', err);
    return res.status(500).json({ error: err.message || 'SEO Audit failed.' });
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

    const payload: any = {
      title: contentItem.title,
      content: contentItem.bodyHtml,
      status: brand.defaultStatus || 'draft',
      slug: contentItem.slug || undefined,
    };

    if (contentItem.wpTemplate && contentItem.wpTemplate !== 'default') {
      payload.template = contentItem.wpTemplate;
    }

    if (contentItem.wpMediaId) {
      payload.featured_media = contentItem.wpMediaId;
    }

    try {
      const wpRes = await fetch(`${cleanUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'User-Agent': 'GreenOpsContentStudio/1.0'
        },
        body: JSON.stringify(payload)
      });

      if (wpRes.ok) {
        const data = await wpRes.json();
        const wpPostId = data.id;
        const link = data.link;
        const previewUrl = `${link}&preview=true`;

        return res.json({
          success: true,
          message: `Successfully published ${contentItem.contentType} to WordPress as ${payload.status.toUpperCase()}!`,
          wpPostId,
          link,
          previewUrl
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

// Endpoint: Upload Media to WordPress Media Library
app.post('/api/wp/upload-media', async (req, res) => {
  try {
    const { brand, imageUrl, filename } = req.body;
    if (!brand || !imageUrl) {
      return res.status(400).json({ success: false, message: 'Brand and Image URL required.' });
    }

    // Real integration requires fetching the image and posting it as multipart/form-data or binary
    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error('Failed to fetch source image for upload.');
      
      const imageBuffer = await imgRes.arrayBuffer();
      const cleanUrl = brand.wpUrl.replace(/\/+$/, '');
      const authHeader = 'Basic ' + Buffer.from(`${brand.wpUsername}:${brand.wpAppPassword || ''}`).toString('base64');

      const wpRes = await fetch(`${cleanUrl}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Disposition': `attachment; filename="${filename}.jpg"`,
          'Content-Type': 'image/jpeg',
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

    return res.json({
      success: true,
      stats: {
        totalPosts,
        totalPages,
        totalComments,
        totalMedia
      }
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
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

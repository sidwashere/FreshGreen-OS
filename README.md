# 🌿 FGOS — Fresh Green Operating System

> **The AI content studio that writes, scores, and ships on-brand blog posts to WordPress — with the styling intact.**

**FGOS** (Fresh Green Operating System) is a full-stack content operating system built by **Sid** for pet-food brands. It generates SEO-scored, brand-voiced articles with Gemini, lets you fine-tune every block in a visual editor, and publishes to WordPress as rich, self-styled HTML — complete with real WooCommerce product suggestions, generated imagery, and the site's own header/footer templates.

---

## ✨ What it does

| | |
|---|---|
| 🧠 **AI Article Generation** | Full-length, brand-voiced articles via Google Gemini, with deterministic SEO guardrails that push every draft past a **70%+ SEO score** before it ever ships. |
| 📊 **SEO Analyzer & Improver** | Real-time scoring (TL;DR, facts, intent, E-E-A-T, freshness, structure) with one-click improvement passes. |
| 🎨 **ZenEditor** | Visual block editor — heroes, card grids, carousels, quotes, CTA bands, product cards, FAQs, image banners — every block editable, reorderable, rewritable. |
| 📝 **WordPress Publishing** | One-click publish/draft to WP with a fully styled article frame: byline, share bar, author box, related posts, newsletter CTA. Auto full-width template + styled H1 on publish. |
| 🛒 **WooCommerce Integration** | Live product picker for CTA blocks, auto-fill of real product links at publish, plus full product/order/category/attribute management via the WC REST API. |
| 🖼️ **AI Imagery** | Nano Banana prompt studio, prompt refinement, and direct upload to the WordPress media library. |
| 🏷️ **Brand DNA** | Per-brand voice guidelines, banned words, color kits, blog style kits, page templates, and default publish status. |
| 📅 **AutoBlog Scheduler** | Google-Sheets-driven publishing pipeline with server ticks, imports, and publish checks. |
| 📬 **CRM Sync** | MailerLite subscriber/group management + WooCommerce customer sync. |
| 📈 **Scoreboard & Audit** | Live SEO scoreboard, blog register, content hub, activity log, and a full E2E verification harness. |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        FGOS Web App                         │
│   React 19 · Vite · Tailwind 4 · TypeScript · Recharts      │
│                                                             │
│   ZenEditor · SeoPanel · BrandManager · ContentHub          │
│   AutoBlog · CRM · ProductManager · Scoreboard · Wizard     │
└───────────────┬──────────────────────────────┬──────────────┘
                │  /api/*                      │  /api/wp/* · /api/wc/*
┌───────────────▼──────────────────────────────▼──────────────┐
│                      Express Server (Node)                  │
│   Gemini (GenAI) · @power-seo/content-analysis · Firestore  │
│   WordPress REST · WooCommerce REST (v3 + Store API)        │
└───────────────┬──────────────────────────────┬──────────────┘
                │                              │
        ┌───────▼───────┐              ┌───────▼───────┐
        │  WordPress    │              │  WooCommerce  │
        │  (posts,      │              │  (products,   │
        │   media,      │              │   orders,     │
        │   templates)  │              │   reports)    │
        └───────────────┘              └───────────────┘
```

---

## 🚀 Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#    GEMINI_API_KEY — required for AI generation
#    APP_URL        — where the app is hosted (Cloud Run / local)

# 3. Run in development (hot reload)
npm run dev

# 4. Production build + start
npm run build
npm start
```

The app runs on **port 3000** → `http://localhost:3000`

---

## 🧪 Verification

```bash
# Live E2E SEO verification — generates articles and asserts the
# 70%+ score target across the full pipeline
node scripts/e2e-seo-verify.cjs
```

---

## 📁 Project layout

```
server.ts                  Express API — AI, SEO, WP/WC sync, CRM, AutoBlog
src/
  components/              ZenEditor, SeoPanel, BrandManager, ContentHub,
                           AutoBlogScheduler, CrmDashboard, ProductManager…
  lib/
    blogHtml.ts            Branded article emitter (inline styles + scoped CSS)
    wpSync.ts              WordPress sync + product-link auto-fill
    patina-core.ts         SEO guardrail engine
    seoFix.ts              SEO improvement passes
    firebase.ts            Firestore client
  types.ts                 Brand, ContentItem, VisualBlock & friends
scripts/
  e2e-seo-verify.cjs       E2E score verification
  seed-brand-voice.cjs     Brand voice seeding
  populate-production.ts   Production data population
```

---

## 🧰 Tech stack

| Layer | Tools |
|---|---|
| Frontend | React 19 · Vite 6 · Tailwind CSS 4 · Recharts · Motion · Lucide |
| Backend | Node · Express · TypeScript (tsx / esbuild) |
| AI | Google Gemini (`@google/genai`) · Nano Banana image prompts |
| SEO | `@power-seo/content-analysis` scoring engine |
| Data | Firebase Firestore (`firebase-admin`) |
| Integrations | WordPress REST · WooCommerce REST v3 + Store API · MailerLite |
| Deploy | Docker · Cloud Build · Cloud Run |

---

## 📜 Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with hot reload (`tsx server.ts`) |
| `npm run build` | Vite frontend + esbuild server bundle → `dist/` |
| `npm start` | Run the production bundle |
| `npm run lint` | TypeScript type-check |

---

## 👤 Credits

Built with 🧡 by **Sid** — designed to make pet-food content publishing feel like a superpower.

---

*FGOS — Fresh Green Operating System. Write. Score. Ship.*
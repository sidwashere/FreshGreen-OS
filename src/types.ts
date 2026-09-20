export type ContentType = 'post' | 'page';

export type PipelineStatus = 'Planned' | 'Researching' | 'Generating' | 'Draft_Ready' | 'Published' | 'Error';

/** Workspace user profile (username login — no Google account required). */
export interface AppUser {
  id: string; // Firebase auth UID
  username: string;
  role: 'admin' | 'member';
  approved: boolean;
  createdAt?: string;
  userId: string;
}

export interface Brand {
  id: string;
  name: string;
  slug: string;
  wpUrl: string;
  wpUsername: string;
  wpAppPassword?: string;
  voiceGuidelines: string;
  bannedWords: string[];
  primaryColor: string; // Hex e.g. #10b981
  logoUrl?: string;
  pageTemplates: string[]; // e.g. ['default', 'template-full-width.php', 'landing-page.php']
  defaultStatus: 'draft' | 'publish';
  createdAt: string;
  /** Brand "blog style kit" — drives the rich, responsive HTML the editor
   * generates for every live post. Falls back to per-brand defaults derived
   * from `primaryColor` when absent. */
  blogStyle?: Partial<BlogStyleKit>;
  /** When enabled, the blog emitter wraps every published content block in
   * Elementor's standard widget scaffold (`elementor-container` /
   * `elementor-widget`), so Hello Elementor's own CSS aligns the article
   * even though the editor's HTML carries no theme-specific classes. Kadence
   * (and other fully-styled themes) are unaffected. Per-brand DNA/Vault
   * toggle — defaults to OFF. */
  elementorScaffold?: boolean;
  /** WooCommerce REST API credentials — enables authenticated access to
   * products, orders, customers, coupons and other WC endpoints beyond the
   * public Store API.  When absent, the public `/wc/store/v1/` endpoint is
   * used for product listings. */
  wcConsumerKey?: string;
  wcConsumerSecret?: string;
  /** Blog number prefix / brand code, e.g. "DTP", "OC", "HP". Used to build
   * the per-brand blog reference number (e.g. DTP001). User-editable; falls
   * back to a default derived from the brand slug when absent. */
  brandCode?: string;
  /** Per-brand grammar & style rules (Carol's feat-grammar-rules). Each rule is
   * independently toggleable; when absent, the global defaults apply. Custom
   * free-text rules can be appended per brand. */
  grammarRules?: GrammarRules;
  /** Master Layout Template Page/Post ID selected from WordPress to clone and reuse
   * for consecutive blog posts/pages. */
  masterTemplateId?: number;
  masterTemplateType?: 'page' | 'post';
  masterTemplateTitle?: string;
  masterTemplateUrl?: string;
  /** What the "Related Products/Services" section should recommend for this
   *  brand. Universal across themes: 'products' (WooCommerce store), 'services'
   *  (care/consultancy services), 'books' (bookshop), or 'none' (no product
   *  section). Defaults to 'products' when the brand has WooCommerce products,
   *  else 'none'. */
  recommendationType?: 'products' | 'services' | 'books' | 'none';
  /** Multi-Channel Scoreboard & Order Hub (Base.com/BaseLinker) config.
   *  One shared BaseLinker token lives in settings/global -> apiKeys.baselinker;
   *  each brand maps to the order sources + inventory that belong to it so the
   *  scoreboard can show one brand at a time. */
  baseOrderSources?: string[];   // BaseLinker order-source IDs for this brand
  baseInventoryId?: number;      // BaseLinker inventory id (default 94059)
}

/** Per-brand grammar & style rules injected into every content-generation
 * prompt and enforced deterministically after generation. Every field is
 * optional at the Brand level; `resolveGrammarRules` merges stored overrides
 * with the global defaults so a brand can never lose the baseline rules. */
export interface GrammarRules {
  /** Never begin a sentence with "And" or "But". */
  noAndButStarts?: boolean;
  /** Write in British English (colour, favourite, analyse, etc.). */
  britishEnglish?: boolean;
  /** Natural, flowing sentence construction with varied rhythm. */
  naturalFlow?: boolean;
  /** Avoid unnecessary repetition of ideas, phrases and keywords. */
  noRepetition?: boolean;
  /** Avoid obvious AI-style phrasing and clichés. */
  noAiClichés?: boolean;
  /** Keep sentences readable (no sentence over 25 words, average under 20). */
  shortSentences?: boolean;
  /** Output should read as polished, publish-ready prose. */
  publishReady?: boolean;
  /** Additional free-text rules specific to this brand. */
  customRules?: string[];
}

/** Per-brand blog visual identity. Every field is optional at the Brand level;
 * `resolveBlogStyle(brand)` merges stored overrides with deterministic defaults
 * (derived from `primaryColor`), so a brand can never render unstyled. */
export interface BlogStyleKit {
  /** Main action colour — buttons, links, accents, hero band. */
  primary: string;
  /** Secondary tint — soft chips, sub-bands, card borders. */
  secondary: string;
  /** Highlight colour — badges, quotes, callout bars. */
  accent: string;
  /** Card / callout surface background. */
  surface: string;
  /** Band (hero / CTA) background — usually a deep brand tone. */
  band: string;
  /** Body copy colour. */
  text: string;
  /** Muted meta colour (captions, small print). */
  muted: string;
  /** Heading font stack (system-safe — no external font loading). */
  headingFont: string;
  /** Body font stack. */
  bodyFont: string;
  /** Corner radius in px applied to cards, buttons, callouts. */
  radius: number;
  /** Button rendering style for CTAs. */
  buttonStyle: 'solid' | 'outline' | 'soft';
}

export type VisualBlockType = 
  | 'hero'
  | 'paragraph'
  | 'heading'
  | 'product_cta'
  | 'faq'
  | 'callout'
  | 'image_banner'
  | 'cards'
  | 'quote'
  | 'cta_band'
  | 'carousel'
  | 'daniels_tip'
  | 'newsletter';

/** One card inside a `cards` grid block. */
export interface CardItem {
  id: string;
  title: string;
  content: string;
  imageUrl?: string;
  buttonText?: string;
  buttonUrl?: string;
}

/** One slide inside a `carousel` block (horizontal scroll-snap row). */
export interface CarouselSlide {
  id: string;
  imageUrl: string;
  title?: string;
  content?: string;
  buttonText?: string;
  buttonUrl?: string;
}

/** Per-block fine-tuning for AI rewriting on the Write tab. */
export interface BlockTune {
  tone?: 'brand' | 'professional' | 'warm' | 'playful' | 'formal' | 'casual';
  length?: 'short' | 'medium' | 'long';
  creativity?: 'low' | 'medium' | 'high';
  guidance?: string;
}

export interface VisualBlock {
  id: string;
  type: VisualBlockType;
  title?: string;
  content?: string;
  subtitle?: string;
  buttonText?: string;
  buttonUrl?: string;
  imageUrl?: string;
  imageAlt?: string;
  /** Layout variant for image blocks: full width, left/right floated, centred. */
  imageLayout?: 'full' | 'left' | 'right' | 'center';
  imageCaption?: string;
  badge?: string;
  faqItems?: Array<{ question: string; answer: string }>;
  accentColor?: string;
  /** Cards for `cards` blocks (responsive card grid). */
  cards?: CardItem[];
  /** Slides for `carousel` blocks (scroll-snap, swipeable). */
  slides?: CarouselSlide[];
  /** Attribution for `quote` blocks. */
  author?: string;
  /** Per-block AI fine-tuning (tone / length / creativity / guidance). */
  tune?: BlockTune;
  /** Optional keywords this block should emphasise — comma-separated. Fed to AI
   * rewrites so each section can target its own search phrase. */
  keywords?: string;
}

/** One recorded AI generation run (model attribution + history with timestamps). */
export interface GenerationLogEntry {
  at: string;            // ISO timestamp
  action: string;        // e.g. 'Auto-Write', 'SEO Refine · fix-failures', 'Rewrite Block', 'Image Ideas'
  provider: string;      // 'gemini' | 'openrouter' | 'custom'
  model: string;         // e.g. 'gemini-3.5-flash', 'deepseek/deepseek-chat:free'
  fallback?: boolean;    // true when the preferred provider was out of quota
  words?: number;
  durationMs?: number;
  ok: boolean;
  error?: string;
  /** One-line insight shown in the history row, e.g. 'Score 64 → 84 · 12 checks fixed'. */
  insight?: string;
  /** Expanded details for a row (e.g. the list of SEO checks that were fixed). */
  details?: string[];
  /** SEO audit score before/after an SEO action. */
  seoBefore?: number | null;
  seoAfter?: number | null;
  /** True when the action included a humanisation pass. */
  humanized?: boolean;
}

/** Runtime AI model preference — which provider/model runs every AI action. */
export interface AiModelPref {
  provider: 'gemini' | 'openrouter' | 'custom';
  model: string;
  autoFallback: boolean;
}

export interface ContentItem {
  id: string;
  brandId: string;
  title: string;
  /** The original seed/prompt the article was created from. Kept separate from
   *  `title` so the working title never renders as the article's headline —
   *  the published page shows the article's real title only. */
  initialPrompt?: string;
  slug: string;
  contentType: ContentType;
  wpTemplate: string;
  status: PipelineStatus;
  primaryKeyword: string;
  secondaryKeywords: string[];
  seoBrief: string;
  metaTitle?: string;
  metaDescription?: string;
  bodyHtml: string;
  blocks: VisualBlock[];
  nanoBananaPrompt?: string;
  nanoBananaStyle?: string;
  featuredImageUrl?: string;
  /** WP media id of the AI-generated featured image (avoids re-upload on push). */
  featuredMediaId?: number;
  wpPostId?: number;
  wpMediaId?: number;
  wpPreviewUrl?: string;
  wpLiveUrl?: string;
  lastSyncedAt?: string;
  generationLog?: GenerationLogEntry[];
  /** The original article HTML/text before enhancement (Enhance Existing mode). */
  originalHtml?: string;
  /** The original article title before enhancement. */
  originalTitle?: string;
  createdAt: string;
  updatedAt: string;

  // ── AutoBlog: Google Sheet → Generate → Schedule → Publish ──────────
  /** ISO timestamp: when this item should be auto-published to WordPress. */
  scheduledPublishAt?: string;
  /** The Google Sheet ID this item was imported from. */
  sourceSheetId?: string;
  /** The row number in the source sheet (1-indexed, excluding header). */
  sourceRow?: number;
  /** The raw sheet tab name the row came from. */
  sourceSheetName?: string;
  /** Rich context from the Google Sheet row — every column is preserved here
   *  so the AI generation prompt can use search intent, FAQ questions,
   *  longtail keywords, CTA text, internal links, and more. */
  sheetContext?: SheetRowContext;
  /** Per-item overrides for the AI generation pipeline. */
  autoBlogOverrides?: AutoBlogOverrides;
  /** ISO timestamp of the last successful auto-publish attempt. */
  lastAutoPublishedAt?: string;
  /** Error message from the most recent auto-publish attempt. */
  lastAutoPublishError?: string;
  /** Blog reference number, e.g. "DTP001". Assigned automatically per brand
   *  (prefix + 3-digit sequence starting at 001). Never duplicated. Used for
   *  internal tracking and written into the WordPress slug (not the title). */
  blogNumber?: string;
  /** ISO timestamp of the FIRST time this item was published live to WordPress.
   *  Set once and never overwritten — used to detect rehashed/repurposed content
   *  and to distinguish the original publication date from later refreshes. */
  firstPublishedAt?: string;
  /** ISO timestamp of the most recent refresh/repurpose of this item (e.g. a
   *  regeneration or enhancement performed after it was already published). */
  lastRefreshedAt?: string;
  /** How many times this item has been repurposed/refreshed since first publish. */
  repurposeCount?: number;
  /** Auto-generated social media content package (Facebook / Instagram /
   *  Google Business Profile) produced together with the main article. Linked
   *  to the same blog number + featured image so the VA can match them. */
  socialContent?: SocialContentPackage;
  /** SEO analysis score (0–100) — set when autoSeoAnalysis runs after generation. */
  seoScore?: number;
  /** Full SEO analysis summary attached after generation (autoSeoAnalysis). */
  seoAnalysis?: {
    pct: number;
    status: string;
    summary: { good: number; ok: number; poor: number; na: number };
    recommendations: string[];
  };
  /** Consecutive auto-publish failures so far (server-side retry counter). */
  publishRetryCount?: number;
  /** Epoch ms when the next server-side publish retry is allowed (backoff).
   *  The client must clear this when manually resetting an item so the
   *  server tick doesn't keep skipping it. */
  publishRetryAt?: number;
}

/** Complete context from a single Google Sheet row. Every field maps to a
 *  column in the OC Blog Strategy sheet and is fed into the AI prompt
 *  to produce richer, more SEO-targeted articles. */
export interface SheetRowContext {
  /** Column A: Supporting Advice Blogs category/ID. */
  categoryId?: string;
  /** Column B: Tip number within the category. */
  tipNo?: number;
  /** Column C: Blog title / working title. */
  blogTitle?: string;
  /** Column D: One-line summary of the article. */
  oneLineSummary?: string;
  /** Column E: Current status in the sheet (Planned, Published, etc.). */
  sheetStatus?: string;
  /** Column F: Primary target keyword. */
  primaryKeyword?: string;
  /** Column G: Secondary/LSI keywords (comma-separated). */
  secondaryKeywords?: string;
  /** Column H: Suggested internal links to other articles on the site. */
  internalLinks?: string;
  /** Column I: Search intent description — what the reader wants. */
  searchIntent?: string;
  /** Column J: Call to action text for the article. */
  callToAction?: string;
  /** Column K: Questions People Also Ask (semicolon-separated). */
  questionsPeopleAlsoAsk?: string;
  /** Column L: General keyword targets. */
  keywords?: string;
  /** Column M: Longtail keyword phrases (semicolon-separated). */
  longtailKeywords?: string;
}

/** Per-item overrides that customise how the AI generates the article
 * when it is pulled from a Google Sheet row. Every field is optional —
 * missing fields fall back to the brand defaults or global config. */
export interface AutoBlogOverrides {
  /** Override the article tone for this specific post. */
  tone?: 'professional' | 'warm' | 'playful' | 'formal' | 'casual' | 'brand';
  /** Override target word count. */
  wordCount?: number;
  /** Override the target brand (brandId). */
  brandId?: string;
  /** Extra instructions fed to the AI as a suffix to the system prompt. */
  customInstructions?: string;
  /** Override the publish template. */
  wpTemplate?: string;
  /** Override the default status on WP (draft vs publish). */
  wpStatus?: 'draft' | 'publish';
  /** Whether to generate AI images for this post. */
  generateImages?: boolean;
  /** Whether to run SEO analysis after generation. */
  runSeoAnalysis?: boolean;
  /** Whether to humanize the draft after generation. */
  humanize?: boolean;
}

/** Auto-generated social media content package for one blog article. Produced
 *  together with the main article so the VA gets one complete package per post,
 *  linked by blog number + main image. */
export interface SocialContentPackage {
  /** Facebook post text (~500 words). */
  facebook: string;
  /** Instagram caption text (~150 words). */
  instagram: string;
  /** Google Business Profile update text (~90 words). */
  googleBusiness: string;
  /** Same main image as the article — the VA posts this with the captions. */
  imageUrl?: string;
  /** Blog reference number linking this package to its article, e.g. "DTP001". */
  blogNumber?: string;
  /** Article title for context. */
  articleTitle?: string;
  /** Article live URL once published (filled at publish time). */
  articleUrl?: string;
  status: 'pending' | 'ready' | 'error';
  error?: string;
  generatedAt?: string;
  model?: string;    // e.g. 'gemini-3.5-flash'
  provider?: string; // 'gemini' | 'openrouter' | 'custom'
  fallback?: boolean;
  latencyMs?: number;
}

/** Global AutoBlog configuration stored per-brand or app-wide. */
export interface AutoBlogConfig {
  /** Google Sheet URL or ID to sync from. */
  sheetUrl: string;
  /** Tab/sheet names to import from (empty = all tabs). */
  sheetTabs: string[];
  /** How many days between scheduling each imported post. */
  publishingCadenceDays: number;
  /** The starting date for the first scheduled post. */
  publishingStartDate: string;
  /** Default brand for imported posts. */
  defaultBrandId: string;
  /** Default article tone. */
  defaultTone: 'professional' | 'warm' | 'playful' | 'formal' | 'casual' | 'brand';
  /** Default target word count. */
  defaultWordCount: number;
  /** Whether to auto-generate images. */
  autoGenerateImages: boolean;
  /** Whether to auto-run SEO analysis. */
  autoSeoAnalysis: boolean;
  /** Whether to auto-humanize drafts. */
  autoHumanize: boolean;
  /** Whether to auto-publish when the scheduled date arrives. */
  autoPublishEnabled: boolean;
  /** The WordPress template for auto-generated posts. */
  defaultWpTemplate: string;
  /** Default WordPress status for scheduled posts. */
  defaultWpStatus: 'draft' | 'publish';
}

export interface NanoBananaPromptOption {
  prompt: string;
  category: 'Product Focused' | 'Lifestyle Focused' | 'Abstract Minimalist';
  style: string;
  lighting: string;
}

export interface WPTestConnectionResult {
  success: boolean;
  message: string;
  userDisplayName?: string;
  siteName?: string;
  wpVersion?: string;
  statusCode?: number;
}

export interface WPSyncResult {
  success: boolean;
  message: string;
  wpPostId?: number;
  link?: string;
  previewUrl?: string;
}

export interface SeoAuditResult {
  score: number;
  wordCount: number;
  readability: 'Easy' | 'Medium' | 'Advanced';
  keywordDensity: number; // percentage
  suggestions: string[];
  metaTitle: string;
  metaDescription: string;
}

// ─── Feature Request Tracker ─────────────────────────────────────────────────

export type FeatureStatus = 'requested' | 'planned' | 'in-progress' | 'shipped' | 'deferred';
export type FeaturePriority = 'critical' | 'high' | 'medium' | 'low';
export type FeatureArea = 'editor' | 'autoblog' | 'seo' | 'wordpress' | 'dashboard' | 'images' | 'brands' | 'deployment' | 'other';

export interface FeatureRequest {
  id: string;
  userId: string;
  title: string;
  description: string;
  status: FeatureStatus;
  priority: FeaturePriority;
  area: FeatureArea;
  requestedBy: string;
  requestedAt: string;
  completedAt?: string;
  shippedInVersion?: string;
  tags: string[];
  notes: string;
}

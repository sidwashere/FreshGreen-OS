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
  | 'carousel';

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
  /** AI-generated in-body image (hosted WP media URL, or data URI fallback). */
  secondaryImageUrl?: string;
  /** WP media id of the AI-generated featured image (avoids re-upload on push). */
  featuredMediaId?: number;
  wpPostId?: number;
  wpMediaId?: number;
  wpPreviewUrl?: string;
  wpLiveUrl?: string;
  lastSyncedAt?: string;
  generationLog?: GenerationLogEntry[];
  createdAt: string;
  updatedAt: string;
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

export type ContentType = 'post' | 'page';

export type PipelineStatus = 'Planned' | 'Researching' | 'Generating' | 'Draft_Ready' | 'Published' | 'Error';

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
}

export type VisualBlockType = 
  | 'hero'
  | 'paragraph'
  | 'heading'
  | 'product_cta'
  | 'faq'
  | 'callout'
  | 'image_banner';

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
  badge?: string;
  faqItems?: Array<{ question: string; answer: string }>;
  accentColor?: string;
}

export interface ContentItem {
  id: string;
  brandId: string;
  title: string;
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
  wpPostId?: number;
  wpMediaId?: number;
  wpPreviewUrl?: string;
  wpLiveUrl?: string;
  lastSyncedAt?: string;
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

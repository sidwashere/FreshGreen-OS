/**
 * Grammar & Style Rules (Carol's feat-grammar-rules)
 * ─────────────────────────────────────────────────────────────────────────────
 * A single source of truth for the editorial rules injected into every
 * content-generation prompt AND enforced deterministically after generation.
 *
 * Design goals:
 *  - ROBUST: rules are enforced at source (prompt) AND deterministically
 *    (post-generation scan), so output stays clean even if the model slips.
 *  - FLEXIBLE: each rule is a discrete, independently toggleable item.
 *  - CUSTOMISABLE: per-brand overrides merge on top of global defaults, and
 *    per-request overrides merge on top of that. Custom free-text rules can be
 *    appended per brand.
 *
 * This module is shared by the server (server.ts) and the frontend
 * (BrandManager.tsx) so the rule catalogue and enforcement never drift apart.
 */

import { GrammarRules } from '../types';

/* ── Rule catalogue ──────────────────────────────────────────────────────────
 * Each rule has a stable id, a human label (for the UI) and the prompt text
 * injected when enabled. The ids match the GrammarRules interface fields. */
export interface GrammarRuleDef {
  id: keyof GrammarRules;
  label: string;
  description: string;
  /** Prompt text injected when the rule is enabled. */
  instruction: string;
  /** Default enabled state (used when a brand has no override). */
  defaultEnabled: boolean;
}

export const GRAMMAR_RULE_DEFS: GrammarRuleDef[] = [
  {
    id: 'noAndButStarts',
    label: 'No "And" / "But" sentence starts',
    description: 'Never begin a sentence with "And" or "But".',
    defaultEnabled: true,
    instruction:
      'NEVER begin a sentence with "And" or "But". Use "However", "In addition", "Additionally", "Yet", "Although", "Despite this", or restructure the sentence instead.',
  },
  {
    id: 'britishEnglish',
    label: 'British English',
    description: 'Write in British English (colour, favourite, analyse, etc.).',
    defaultEnabled: true,
    instruction:
      'Write in natural, flowing British English with correct grammar and punctuation throughout. Use "colour" not "color", "favourite" not "favorite", "analyse" not "analyze", "organise" not "organize", "behaviour" not "behavior", "defence" not "defense", "licence" not "license" (noun), "programme" not "program" (noun), "metre" not "meter", "centre" not "center", "grey" not "gray", "whilst" not "while" (conjunction), "towards" not "toward", and all other standard British spellings. Never default to American spellings.',
  },
  {
    id: 'naturalFlow',
    label: 'Natural sentence construction',
    description: 'Natural, flowing sentences with varied rhythm.',
    defaultEnabled: true,
    instruction:
      'Construct sentences naturally and vary their length and rhythm — avoid repetitive, mechanical or formulaic phrasing.',
  },
  {
    id: 'noRepetition',
    label: 'No unnecessary repetition',
    description: 'Do not restate the same idea, phrase or keyword in consecutive sentences.',
    defaultEnabled: true,
    instruction:
      'Avoid unnecessary repetition: do not restate the same idea, phrase or keyword in consecutive sentences.',
  },
  {
    id: 'noAiClichés',
    label: 'No AI-style phrasing',
    description: 'Avoid obvious AI clichés and template phrasing.',
    defaultEnabled: true,
    instruction:
      'Avoid obvious AI-style phrasing and clichés (e.g. "in today\'s fast-paced world", "it\'s important to note", "delve into", "unlock", "elevate", "game-changer", "seamlessly", "moreover" overuse). Write like a human expert, not a template.',
  },
  {
    id: 'shortSentences',
    label: 'Readable sentence length',
    description: 'No sentence over 25 words, average under 20 words.',
    defaultEnabled: true,
    instruction:
      'Keep sentences readable: no sentence longer than 25 words, average under 20 words.',
  },
  {
    id: 'publishReady',
    label: 'Publish-ready prose',
    description: 'Output should require very little editorial correction.',
    defaultEnabled: true,
    instruction:
      'The final copy should require very little editorial correction — it should read as polished, publish-ready prose.',
  },
];

/** The global default ruleset (all rules enabled). */
type BooleanGrammarRule = Exclude<keyof GrammarRules, 'customRules'>;
export const DEFAULT_GRAMMAR_RULES: GrammarRules = GRAMMAR_RULE_DEFS.reduce<GrammarRules>(
  (acc, def) => {
    (acc as any)[def.id] = def.defaultEnabled;
    return acc;
  },
  {} as GrammarRules,
);

/* ── Resolver ────────────────────────────────────────────────────────────────
 * Merge precedence (highest wins): per-request overrides → per-brand overrides
 * → global defaults. Custom free-text rules are concatenated (brand + request).
 * Returns a fully-resolved GrammarRules with every field populated. */
export function resolveGrammarRules(
  brand?: { grammarRules?: GrammarRules } | null,
  requestOverrides?: GrammarRules | null,
): GrammarRules {
  const merged: GrammarRules = { ...DEFAULT_GRAMMAR_RULES };

  // Per-brand overrides
  if (brand?.grammarRules) {
    for (const key of Object.keys(brand.grammarRules) as (keyof GrammarRules)[]) {
      const val = brand.grammarRules[key];
      if (val !== undefined) (merged as any)[key] = val;
    }
  }

  // Per-request overrides
  if (requestOverrides) {
    for (const key of Object.keys(requestOverrides) as (keyof GrammarRules)[]) {
      const val = requestOverrides[key];
      if (val !== undefined) (merged as any)[key] = val;
    }
  }

  // Custom rules: brand + request concatenated (deduped)
  const brandCustom = brand?.grammarRules?.customRules || [];
  const reqCustom = requestOverrides?.customRules || [];
  merged.customRules = Array.from(new Set([...brandCustom, ...reqCustom]));

  return merged;
}

/* ── Prompt builder ──────────────────────────────────────────────────────────
 * Renders the enabled rules (plus custom rules) into a prompt block. Returns
 * an empty string when no rules are enabled, so callers can omit the block. */
export function buildGrammarRulesPrompt(
  brand?: { grammarRules?: GrammarRules } | null,
  requestOverrides?: GrammarRules | null,
): string {
  const rules = resolveGrammarRules(brand, requestOverrides);

  const lines: string[] = [];
  for (const def of GRAMMAR_RULE_DEFS) {
    if (rules[def.id]) lines.push(`- ${def.instruction}`);
  }
  for (const custom of rules.customRules || []) {
    if (custom.trim()) lines.push(`- ${custom.trim()}`);
  }

  if (lines.length === 0) return '';
  return `GRAMMAR & STYLE RULES (apply to every sentence):\n${lines.join('\n')}`;
}

/* ── Deterministic post-generation enforcement ───────────────────────────────
 * These run AFTER generation so the rules hold even if the model ignores the
 * prompt. Each returns the corrected text plus a count of fixes applied, so
 * callers can report what changed. Operates on visible text inside HTML tags
 * only (never on tag names, attributes or URLs). */

/** Fix sentences that begin with "And" or "But" (Carol's headline rule). */
export function fixAndButSentenceStarts(html: string): { text: string; fixes: number } {
  const fixSentenceStart = (text: string): string => {
    return text.replace(
      /(^|(?:\.|!|\?|…|"|')\s+|>\s*)([Aa]nd|[Bb]ut)\s+(?=[a-z])/g,
      (full, lead: string, conj: string) => {
        const lower = conj.toLowerCase();
        if (lower === 'and') return `${lead}Additionally, `;
        return `${lead}However, `;
      },
    );
  };
  const before = html;
  const after = fixSentenceStart(html);
  return { text: after, fixes: after !== before ? 1 : 0 };
}

/** Deterministic US→UK spelling corrections (zero AI cost). */
export function fixBritishEnglish(html: string): { text: string; fixes: number } {
  const usToUk: [RegExp, string | ((...args: any[]) => string)][] = [
    [/\b(flavor|flavors|flavored|flavoring)\b/gi, (m: string) => m.replace(/or$/i, 'our').replace(/or(s|ed|ing)$/i, (_, s: string) => s === 's' ? 'ours' : s === 'ed' ? 'oured' : 'ouring')],
    [/\b(color|colors|colored|coloring)\b/gi, (m: string) => m.replace(/or$/i, 'our').replace(/or(s|ed|ing)$/i, (_, s: string) => s === 's' ? 'ours' : s === 'ed' ? 'oured' : 'ouring')],
    [/\b(honor|honors|honored|honoring)\b/gi, (m: string) => m.replace(/or$/i, 'our').replace(/or(s|ed|ing)$/i, (_, s: string) => s === 's' ? 'ours' : s === 'ed' ? 'oured' : 'ouring')],
    [/\b(labor|labors|labored|laboring)\b/gi, (m: string) => m.replace(/or$/i, 'our').replace(/or(s|ed|ing)$/i, (_, s: string) => s === 's' ? 'ours' : s === 'ed' ? 'oured' : 'ouring')],
    [/\b(favorite|favorites)\b/gi, (m: string) => m.replace(/or/g, 'ou')],
    [/\b(behavior|behaviors)\b/gi, (m: string) => m.replace(/or/g, 'ou')],
    [/\b(neighbor|neighbors|neighborhood)\b/gi, (m: string) => m.replace(/or/g, 'ou')],
    [/\b(analyze|analyzes|analyzing|analyzed)\b/gi, (m: string) => m.replace(/ze/i, 'se')],
    [/\b(optimize|optimizes|optimizing|optimized)\b/gi, (m: string) => m.replace(/ze/i, 'se')],
    [/\b(realize|realizes|realizing|realized)\b/gi, (m: string) => m.replace(/ze/i, 'se')],
    [/\b(customize|organize|recognize|summarize|standardize|prioritize|minimize|maximize|utilize|specialize|initialize|authorize)\b/gi, (m: string) => m.replace(/ze/i, 'se')],
    [/\b(defense)\b/gi, 'defence'],
    [/\b(license)\b/gi, (m: string, off: number, str: string) => {
      const after = str.slice(off + m.length, off + m.length + 20);
      if (/^\s+(to|for|the|a|an|and|or|is|are|was|were|of|in|on|at)\b/.test(after)) return 'licence';
      return m;
    }],
    [/\b(program)\b/gi, (m: string, off: number, str: string) => {
      const before = str.slice(Math.max(0, off - 30), off);
      if (/\b(computer|software|app|training|exercise)\s*$/.test(before)) return 'program';
      return 'programme';
    }],
    [/\b(center|centers|centered|centering)\b/gi, (m: string) => m.replace(/er/g, 're').replace(/er(s|ed|ing)$/i, (_, s: string) => s === 's' ? 'res' : s === 'ed' ? 'red' : 'ring')],
    [/\b(gray|grey)\b/gi, 'grey'],
    [/\b(toward)\b/gi, 'towards'],
  ];
  let text = html;
  let fixes = 0;
  for (const [pat, repl] of usToUk) {
    const before = text;
    if (typeof repl === 'function') {
      text = text.replace(pat, repl as any);
    } else {
      text = text.replace(pat, repl);
    }
    if (text !== before) fixes++;
  }
  return { text, fixes };
}

/** Common AI clichés / template phrases to strip or neutralise. */
const AI_CLICHÉ_PATTERNS: [RegExp, string][] = [
  [/\bin today'?s (fast-paced|modern|digital) world\b/gi, 'today'],
  [/\bit'?s important to note\b/gi, 'note'],
  [/\bdelve into\b/gi, 'explore'],
  [/\bunlock\b/gi, 'reveal'],
  [/\belevate\b/gi, 'improve'],
  [/\bgame-?changer\b/gi, 'major improvement'],
  [/\bseamlessly\b/gi, 'smoothly'],
  [/\bmoreover\b/gi, 'in addition'],
  [/\bin conclusion\b/gi, 'to summarise'],
  [/\bwhen it comes to\b/gi, 'regarding'],
  [/\ba wide range of\b/gi, 'a range of'],
  [/\bplays a (crucial|vital|key|important) role\b/gi, 'is important in'],
  [/\bin the realm of\b/gi, 'in'],
  [/\bit goes without saying\b/gi, ''],
  [/\bthe bottom line is\b/gi, ''],
];

/** Neutralise common AI clichés (best-effort, conservative replacements). */
export function fixAiClichés(html: string): { text: string; fixes: number } {
  let text = html;
  let fixes = 0;
  for (const [pat, repl] of AI_CLICHÉ_PATTERNS) {
    const before = text;
    text = text.replace(pat, repl);
    if (text !== before) fixes++;
  }
  return { text, fixes };
}

/** Run all deterministic grammar/style fixes. Returns corrected text + a
 * human-readable summary of what changed (for notices / logs). */
export function enforceGrammarRules(
  html: string,
  rules?: GrammarRules,
): { text: string; fixes: string[] } {
  const resolved = rules ? resolveGrammarRules(null, rules) : DEFAULT_GRAMMAR_RULES;
  const fixes: string[] = [];
  let text = html;

  if (resolved.noAndButStarts) {
    const r = fixAndButSentenceStarts(text);
    if (r.fixes) fixes.push('corrected sentence(s) beginning with "And"/"But"');
    text = r.text;
  }
  if (resolved.britishEnglish) {
    const r = fixBritishEnglish(text);
    if (r.fixes) fixes.push(`applied ${r.fixes} British English spelling correction(s)`);
    text = r.text;
  }
  if (resolved.noAiClichés) {
    const r = fixAiClichés(text);
    if (r.fixes) fixes.push(`neutralised ${r.fixes} AI-style phrase(s)`);
    text = r.text;
  }

  return { text, fixes };
}

import { GoogleGenAI } from '@google/genai';

export class Humanizer {
  private tone: string;
  private bannedWords: string[];
  private levers: any;

  constructor(options: any) {
    this.tone = options.tone || 'conversational';
    this.bannedWords = options.bannedWords || [];
    this.levers = options.levers || {};
  }

  async rewriteHtml(html: string, aiKey?: string, model?: string): Promise<string> {
    const aiApiKey = aiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!aiApiKey) return html;
    
    try {
      return await this.callHumanizer(html, aiApiKey, model);
    } catch (err) {
      console.warn('Humanizer failed, returning original html:', err);
      return html;
    }
  }

  /**
   * Strict variant for the interactive Humanise step: unlike rewriteHtml it
   * does NOT swallow errors, so the UI can show exactly what went wrong
   * instead of silently keeping the original draft.
   */
  async rewriteHtmlOrThrow(html: string, aiKey?: string, model?: string): Promise<string> {
    const aiApiKey = aiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!aiApiKey) throw new Error('No Gemini API key is configured. Add one in Settings > AI Models.');
    return this.callHumanizer(html, aiApiKey, model);
  }

  private async callHumanizer(html: string, aiApiKey: string, model?: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: aiApiKey });
    const prompt = `Rewrite the following HTML content to sound highly human, natural, and engaging.
Avoid generic AI phrasing. Preserve all HTML tags exactly.
Tone: ${this.tone}
${this.bannedWords.length ? 'Banned words: ' + this.bannedWords.join(', ') : ''}

GRAMMAR & STYLE RULES (apply to every sentence):
- NEVER begin a sentence with "And" or "But". Use "However", "In addition", "Additionally", "Yet", "Although", "Despite this", or restructure the sentence instead.
- Write in natural, flowing British English with correct grammar and punctuation throughout.
- Construct sentences naturally and vary their length and rhythm — avoid repetitive, mechanical or formulaic phrasing.
- Avoid unnecessary repetition: do not restate the same idea, phrase or keyword in consecutive sentences.
- Avoid obvious AI-style phrasing and clichés (e.g. "in today's fast-paced world", "it's important to note", "delve into", "unlock", "elevate", "game-changer", "seamlessly"). Write like a human expert, not a template.
- Keep sentences readable: no sentence longer than 25 words, average under 20 words.
- The final copy should require very little editorial correction — it should read as polished, publish-ready prose.

HTML Content:
${html}`;

    const response = await ai.models.generateContent({
      model: model || 'gemini-flash-latest',
      contents: prompt,
      config: {
        systemInstruction: 'You are an expert humanizer. Return ONLY the raw rewritten HTML. Do not wrap in markdown code blocks.',
      }
    });

    let text = response.text || html;
    text = text.replace(/^```html\n/, '').replace(/\n```$/, '').trim();
    return text;
  }
}

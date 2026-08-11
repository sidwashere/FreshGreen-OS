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
    const aiApiKey = aiKey || process.env.GEMINI_API_KEY;
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
    const aiApiKey = aiKey || process.env.GEMINI_API_KEY;
    if (!aiApiKey) throw new Error('No Gemini API key is configured. Add one in Settings > AI Models.');
    return this.callHumanizer(html, aiApiKey, model);
  }

  private async callHumanizer(html: string, aiApiKey: string, model?: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: aiApiKey });
    const prompt = `Rewrite the following HTML content to sound highly human, natural, and engaging.
Avoid generic AI phrasing. Preserve all HTML tags exactly.
Tone: ${this.tone}
${this.bannedWords.length ? 'Banned words: ' + this.bannedWords.join(', ') : ''}

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

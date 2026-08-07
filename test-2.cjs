const { GoogleGenAI } = require('@google/genai');

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: 'hello',
    });
    console.log("SUCCESS:", response.text);
  } catch (err) {
    console.error("ERROR:", err.message);
  }
}
test();

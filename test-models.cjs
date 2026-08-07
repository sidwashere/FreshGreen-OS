const { GoogleGenAI } = require('@google/genai');

async function test(modelName) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: 'hello',
    });
    console.log(`SUCCESS [${modelName}]:`, response.text);
  } catch (err) {
    console.error(`ERROR [${modelName}]:`, err.message);
  }
}

async function run() {
  await test('gemini-2.5-flash');
  await test('gemini-2.0-flash');
  await test('gemini-1.5-pro');
  await test('gemini-3.5-flash');
  await test('gemini-pro');
}
run();

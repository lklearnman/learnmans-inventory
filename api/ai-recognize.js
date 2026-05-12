// api/ai-recognize.js
// Vercel Serverless Function — 支持 Gemini 和 Claude 双引擎切换
// 环境变量：ANTHROPIC_API_KEY、GEMINI_API_KEY

const SYSTEM_PROMPT = '你是专业矿物宝石首饰库管助手。识别图片商品，返回JSON：{"name":"商品名","cat":"类别（矿物标本/宝石/首饰/元石/化石/其他）","origin":"产地或规格","country":"原产国","note":"50字内描述"}。只返回JSON，不要加任何markdown代码块或多余文字。';

async function callClaude(imageBase64, mediaType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 未配置');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 600, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: '识别这个商品' }
      ]}],
    }),
  });
  if (!res.ok) throw new Error(`Claude API错误 ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).map(c => c.text || '').join('');
}

async function callGemini(imageBase64, mediaType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 未配置');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mediaType, data: imageBase64 } },
          { text: SYSTEM_PROMPT + '\n\n识别这个商品' }
        ]}],
        generationConfig: { maxOutputTokens: 600, temperature: 0.1 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API错误 ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://lklearnman.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType = 'image/jpeg', provider = 'gemini' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

  try {
    const rawText = provider === 'claude'
      ? await callClaude(imageBase64, mediaType)
      : await callGemini(imageBase64, mediaType);

    const clean = rawText.replace(/```json|```/g, '').trim();
    try {
      return res.status(200).json({ result: JSON.parse(clean), provider });
    } catch {
      return res.status(500).json({ error: '解析AI返回失败', raw: clean });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

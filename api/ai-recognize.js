// api/ai-recognize.js
// 自动 fallback：先试 Gemini，失败自动换 Claude Haiku

const SYSTEM_PROMPT = '你是专业矿物宝石首饰库管助手。识别图片商品，返回JSON：{"name":"商品名","cat":"类别（矿物标本/宝石/首饰/元石/化石/其他）","origin":"产地或规格","country":"原产国","note":"50字内描述"}。只返回JSON，不要加任何markdown代码块或多余文字。';

const GEMINI_MODELS = [
  'gemini-1.5-flash-002',
  'gemini-1.5-pro-002',
];

async function callGemini(model, imageBase64, mediaType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('SKIP:no gemini key');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
  const data = await res.json();
  if (!res.ok) {
    const code = data?.error?.code;
    if (code === 429 || code === 404 || res.status === 429 || res.status === 404) {
      throw new Error(`SKIP:${model} ${code}`);
    }
    throw new Error(`Gemini ${model} 错误: ${data?.error?.message || res.status}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error(`SKIP:${model} 空响应`);
  return { text, provider: `Gemini/${model}` };
}

async function callClaude(imageBase64, mediaType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 未配置');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: '识别这个商品' }
      ]}],
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Claude错误 ${res.status}: ${JSON.stringify(err)}`);
  }
  const data = await res.json();
  const text = (data.content || []).map(c => c.text || '').join('');
  return { text, provider: 'Claude/haiku' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType = 'image/jpeg' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

  const errors = [];

  // 先试 Gemini
  for (const model of GEMINI_MODELS) {
    try {
      const { text, provider } = await callGemini(model, imageBase64, mediaType);
      const clean = text.replace(/```json|```/g, '').trim();
      return res.status(200).json({ result: JSON.parse(clean), provider });
    } catch (err) {
      errors.push(err.message);
      if (!err.message.startsWith('SKIP:')) break;
    }
  }

  // Gemini 失败，用 Claude Haiku
  try {
    const { text, provider } = await callClaude(imageBase64, mediaType);
    const clean = text.replace(/```json|```/g, '').trim();
    return res.status(200).json({ result: JSON.parse(clean), provider });
  } catch (err) {
    errors.push(err.message);
  }

  return res.status(500).json({ error: '所有AI引擎均失败', details: errors });
}

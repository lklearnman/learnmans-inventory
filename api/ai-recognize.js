// api/ai-recognize.js
// 自动 fallback：按顺序尝试多个模型，一个失败自动换下一个
// 环境变量：GEMINI_API_KEY、ANTHROPIC_API_KEY

const SYSTEM_PROMPT = '你是专业矿物宝石首饰库管助手。识别图片商品，返回JSON：{"name":"商品名","cat":"类别（矿物标本/宝石/首饰/元石/化石/其他）","origin":"产地或规格","country":"原产国","note":"50字内描述"}。只返回JSON，不要加任何markdown代码块或多余文字。';

const GEMINI_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
];

async function callGemini(model, imageBase64, mediaType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 未配置');
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
    const msg = data?.error?.message || res.status;
    // 429=超额, 404=模型不存在 → 都可以继续试下一个
    if (code === 429 || code === 404 || res.status === 429 || res.status === 404) {
      throw new Error(`SKIP:${model} ${code||res.status}`);
    }
    throw new Error(`Gemini ${model} 错误: ${msg}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error(`SKIP:${model} 返回为空`);
  return { text, provider: `Gemini/${model}` };
}

async function callClaude(imageBase64, mediaType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('SKIP:claude ANTHROPIC_API_KEY未配置');
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
  if (!res.ok) throw new Error(`Claude错误 ${res.status}`);
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

  // 依次尝试 Gemini 各模型
  for (const model of GEMINI_MODELS) {
    try {
      const { text, provider } = await callGemini(model, imageBase64, mediaType);
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return res.status(200).json({ result: parsed, provider });
    } catch (err) {
      errors.push(err.message);
      if (!err.message.startsWith('SKIP:')) break; // 非跳过错误直接停
      continue;
    }
  }

  // Gemini 全部失败，尝试 Claude Haiku
  try {
    const { text, provider } = await callClaude(imageBase64, mediaType);
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json({ result: parsed, provider });
  } catch (err) {
    errors.push(err.message);
  }

  return res.status(500).json({ error: '所有AI引擎均失败', details: errors });
}

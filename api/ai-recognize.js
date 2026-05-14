// api/ai-recognize.js
// 支持前端选择 provider + 超时机制
// 环境变量：GEMINI_API_KEY、ANTHROPIC_API_KEY

const SYSTEM_PROMPT = '你是专业矿物宝石首饰库管助手。识别图片商品，返回JSON：{"name":"商品名","cat":"类别（矿物标本/宝石/首饰/元石/化石/其他）","origin":"产地或规格","country":"原产国","note":"50字内描述"}。只返回JSON，不要加任何markdown代码块或多余文字。';

const GEMINI_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

// 每个模型的超时（毫秒）
const TIMEOUT_MS = 15000;

function fetchWithTimeout(url, options, ms) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms))
  ]);
}

async function callGemini(model, imageBase64, mediaType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('SKIP:GEMINI_API_KEY 未配置');
  const res = await fetchWithTimeout(
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
    },
    TIMEOUT_MS
  );
  const data = await res.json();
  if (!res.ok) {
    const code = data?.error?.code;
    const msg = data?.error?.message || res.status;
    if (code === 429 || code === 404 || res.status === 429 || res.status === 404 || res.status === 503) {
      throw new Error(`SKIP:${model} ${code||res.status}`);
    }
    throw new Error(`Gemini ${model}: ${msg}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error(`SKIP:${model} 空响应`);
  return { text, provider: `Gemini/${model}` };
}

async function callClaude(imageBase64, mediaType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 未配置');
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
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
  }, TIMEOUT_MS);
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.content || []).map(c => c.text || '').join('');
  if (!text) throw new Error('Claude 空响应');
  return { text, provider: 'Claude/haiku' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType = 'image/jpeg', provider = 'claude' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

  const errors = [];

  // 优先用户选的 provider
  if (provider === 'claude') {
    try {
      const { text, provider: prv } = await callClaude(imageBase64, mediaType);
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return res.status(200).json({ result: parsed, provider: prv });
    } catch (err) {
      errors.push('Claude: ' + err.message);
      // Claude 失败时不 fallback 到 Gemini（用户选了 Claude）
      return res.status(500).json({ error: 'Claude 识别失败', details: errors });
    }
  }

  // provider === 'gemini'：试 Gemini 各模型，全失败 fallback 到 Claude
  for (const model of GEMINI_MODELS) {
    try {
      const { text, provider: prv } = await callGemini(model, imageBase64, mediaType);
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return res.status(200).json({ result: parsed, provider: prv });
    } catch (err) {
      errors.push(err.message);
      if (!err.message.startsWith('SKIP:') && err.message !== 'TIMEOUT') break;
      continue;
    }
  }

  // Gemini 全部失败，fallback Claude
  try {
    const { text, provider: prv } = await callClaude(imageBase64, mediaType);
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json({ result: parsed, provider: prv + '(fallback)' });
  } catch (err) {
    errors.push('Claude fallback: ' + err.message);
  }

  return res.status(500).json({ error: '所有AI引擎均失败', details: errors });
}

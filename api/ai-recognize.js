// api/ai-recognize.js
// 支持前端选择 provider + 超时机制
// 环境变量：GEMINI_API_KEY、ANTHROPIC_API_KEY

const SYSTEM_PROMPT = '你是专业矿物宝石首饰库管助手。仔细观察图片，识别商品。返回 JSON：{"name_ja":"日文商品名（必填，如\\"鉄隕石ペンダント\\"）","name_zh":"中文商品名（必填，如\\"陨石吊坠\\"）","name":"和 name_ja 一致（向后兼容）","cat":"类别（矿物标本/宝石/首饰/元石/化石/其他）","origin":"产地或规格（如\\"约 30×40mm\\"）","country":"原产国（中文）","note":"100字内特征描述（颜色/纹理/品质/晶系等）"}。只返回 JSON，不加 markdown 代码块或多余文字。';

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
];

const CLAUDE_PRIMARY_MODEL = 'claude-sonnet-4-5-20251022';
const CLAUDE_FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

// 每个模型的超时（毫秒）
// ⚠️ Vercel Hobby plan 函数最长 10 秒，超过就会被强杀。
const TIMEOUT_MS = 9000;
const CLAUDE_SONNET_TIMEOUT_MS = 8000;

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
        generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
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

async function callClaude(imageBase64, mediaType, model = CLAUDE_PRIMARY_MODEL, timeoutMs = TIMEOUT_MS) {
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
      model,
      max_tokens: 1024,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: '识别这个商品' }
      ]}],
    }),
  }, timeoutMs);
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude ${model} ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.content || []).map(c => c.text || '').join('');
  if (!text) throw new Error(`Claude ${model} 空响应`);
  const tag = model.includes('sonnet') ? 'sonnet' : 'haiku';
  return { text, provider: `Claude/${tag}` };
}

// 先 Sonnet（8s timeout），超时/失败 fallback Haiku
async function callClaudeWithFallback(imageBase64, mediaType) {
  try {
    return await callClaude(imageBase64, mediaType, CLAUDE_PRIMARY_MODEL, CLAUDE_SONNET_TIMEOUT_MS);
  } catch (err) {
    // Sonnet 失败或超时 → 降级 Haiku
    const { text, provider } = await callClaude(imageBase64, mediaType, CLAUDE_FALLBACK_MODEL, TIMEOUT_MS);
    return { text, provider: provider + '(fallback)' };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 健康检查端点：GET /api/ai-recognize → 看 API 是否活着、key 是否配置
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      hasClaudeKey: !!process.env.ANTHROPIC_API_KEY,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      timeoutMs: TIMEOUT_MS,
      claudePrimary: CLAUDE_PRIMARY_MODEL,
      claudeFallback: CLAUDE_FALLBACK_MODEL,
      geminiModels: GEMINI_MODELS,
      time: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType = 'image/jpeg', provider = 'claude' } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

  // 体积保护：base64 > 4MB（约对应 3MB 原图）的话直接报错，避免 Vercel 4.5MB body 限制
  const sizeBytes = Math.floor(imageBase64.length * 0.75);
  if (sizeBytes > 4 * 1024 * 1024) {
    return res.status(413).json({
      error: `图片太大（约 ${(sizeBytes / 1024 / 1024).toFixed(1)} MB），请把客户端压缩到 < 3 MB`,
      sizeBytes,
    });
  }

  const errors = [];

  // 优先用户选的 provider
  if (provider === 'claude') {
    try {
      const { text, provider: prv } = await callClaudeWithFallback(imageBase64, mediaType);
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return res.status(200).json({ result: parsed, provider: prv });
    } catch (err) {
      errors.push('Claude: ' + err.message);
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
    const { text, provider: prv } = await callClaudeWithFallback(imageBase64, mediaType);
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json({ result: parsed, provider: prv + '(fallback)' });
  } catch (err) {
    errors.push('Claude fallback: ' + err.message);
  }

  return res.status(500).json({ error: '所有AI引擎均失败', details: errors });
}

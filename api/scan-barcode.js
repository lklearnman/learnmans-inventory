// api/scan-barcode.js
// 让 AI 读照片里的条码/QR 文本。和 ai-recognize.js 隔离,改不影响 AI 建品。
// 环境变量：ANTHROPIC_API_KEY、GEMINI_API_KEY

const BARCODE_PROMPT = '你是 OCR 助手。这张照片里有 1D 条形码或 2D QR 码,**只**返回该条码里编码的原始文字/数字。规则:\n- 优先识别 1D 条形码下方印的数字(EAN/UPC/Code128)\n- 如果是 QR 码,返回它编码的字符串(可能是 URL)\n- 多条码时取最清晰/最居中的那条\n- 找不到返回字符串 NONE\n- 严禁:解释、markdown、引号、前后空格、其它任何文字。直接吐编码内容。';

const TIMEOUT_MS = 9000;

function fetchWithTimeout(url, options, ms) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms))
  ]);
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
      max_tokens: 100,
      system: BARCODE_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: '读条码' }
      ]}],
    }),
  }, TIMEOUT_MS);
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.content || []).map(c => c.text || '').join('').trim();
  if (!text) throw new Error('Claude 空响应');
  return { text, provider: 'Claude/haiku' };
}

async function callGemini(imageBase64, mediaType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 未配置');
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mediaType, data: imageBase64 } },
          { text: BARCODE_PROMPT + '\n\n读条码' }
        ]}],
        generationConfig: { maxOutputTokens: 100, temperature: 0 },
      }),
    },
    TIMEOUT_MS
  );
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || res.status;
    throw new Error(`Gemini: ${msg}`);
  }
  const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  if (!text) throw new Error('Gemini 空响应');
  return { text, provider: 'Gemini/2.0-flash' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      endpoint: 'scan-barcode',
      hasClaudeKey: !!process.env.ANTHROPIC_API_KEY,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      time: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType = 'image/jpeg', provider = 'claude' } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

  const sizeBytes = Math.floor(imageBase64.length * 0.75);
  if (sizeBytes > 4 * 1024 * 1024) {
    return res.status(413).json({
      error: `图片太大（约 ${(sizeBytes / 1024 / 1024).toFixed(1)} MB），请压缩到 < 3 MB`,
      sizeBytes,
    });
  }

  const errors = [];
  const call = provider === 'gemini' ? callGemini : callClaude;
  const fallback = provider === 'gemini' ? callClaude : callGemini;

  try {
    const { text, provider: prv } = await call(imageBase64, mediaType);
    if (/^NONE$/i.test(text)) {
      return res.status(200).json({ code: null, provider: prv, raw: text });
    }
    return res.status(200).json({ code: text, provider: prv });
  } catch (err) {
    errors.push(`${provider}: ${err.message}`);
  }

  // 主引擎失败 fallback 另一个
  try {
    const { text, provider: prv } = await fallback(imageBase64, mediaType);
    if (/^NONE$/i.test(text)) {
      return res.status(200).json({ code: null, provider: prv + '(fallback)', raw: text });
    }
    return res.status(200).json({ code: text, provider: prv + '(fallback)' });
  } catch (err) {
    errors.push(`fallback: ${err.message}`);
  }

  return res.status(500).json({ error: '条码 OCR 失败', details: errors });
}

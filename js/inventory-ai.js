// ===================== 摄像头扫码 =====================
async function startCamera(){
  try{
    document.getElementById('camera-wrap').style.display='block';
    document.getElementById('camera-start-wrap').style.display='none';
    document.getElementById('camera-scan-result').style.display='none';
    document.getElementById('camera-result-bar').textContent='将条形码或QR码对准框内…';
    if(!zxingReader){
      // 限制常用格式 + TRY_HARDER,提升识别率(默认尝试全部格式很慢且常漏)
      const hints=new Map();
      const fmt=ZXing.BarcodeFormat;
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,[
        fmt.QR_CODE,fmt.CODE_128,fmt.CODE_39,
        fmt.EAN_13,fmt.EAN_8,fmt.UPC_A,fmt.UPC_E,
        fmt.ITF,fmt.DATA_MATRIX
      ]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
      zxingReader=new ZXing.BrowserMultiFormatReader(hints,200); // 200ms 间隔
    }
    // 高分辨率 + 连续对焦,iPhone 近拍 barcode 才清晰
    const constraints={video:{
      facingMode:{ideal:'environment'},
      width:{ideal:1920},
      height:{ideal:1080},
      advanced:[{focusMode:'continuous'}]
    }};
    await zxingReader.decodeFromConstraints(
      constraints,
      document.getElementById('camera-video'),
      (result,err)=>{
        if(result){
          const code=result.getText();
          document.getElementById('camera-result-bar').textContent='✅ 扫到：'+code;
          stopCamera();
          showScanResult(code,'camera-scan-result');
        }
      }
    );
  }catch(e){
    toast('无法访问摄像头：'+e.message);
    document.getElementById('camera-wrap').style.display='none';
    document.getElementById('camera-start-wrap').style.display='block';
  }
}
function stopCamera(){
  if(zxingReader){try{zxingReader.reset();}catch(e){}}
  document.getElementById('camera-wrap').style.display='none';
  document.getElementById('camera-start-wrap').style.display='block';
}

// ===================== 手动扫码 =====================
function doScan(){
  const q=document.getElementById('scan-input').value.trim();if(!q)return;
  const code=q.includes('|')?q.split('|')[0]:q;
  showScanResult(code,'scan-result');
}
function showScanResult(code,targetId){
  const parts=code.split('|');
  const sku=parts[0].trim();
  const nameFromQR=parts[1]?parts[1].trim():'';
  const p=DB.products.find(pr=>pr.sku===sku||pr.id===sku||pr.sku===code||pr.id===code||pr.name===code||(nameFromQR&&pr.name===nameFromQR));
  const el=document.getElementById(targetId);
  el.style.display='block';
  if(p){
    const showOut=DB.showItems.filter(s=>s.productId===p.id).reduce((a,s)=>a+s.qty,0);
    el.innerHTML=`
      <div style="background:var(--surface2);border:1px solid var(--jade);border-radius:var(--radius);padding:14px;">
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;">
          ${p.photos&&p.photos[0]?`<img src="${p.photos[0]}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;">`:`<div style="width:60px;height:60px;border-radius:8px;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:28px;">${catEmoji(p.cat)}</div>`}
          <div>
            <div style="font-size:15px;font-weight:500;margin-bottom:4px;">${p.name}</div>
            <div style="font-size:12px;color:var(--text-muted);">SKU: ${p.sku||'—'} · ${p.cat||'未分类'}</div>
            <div style="font-size:13px;color:var(--jade-light);margin-top:3px;">库存 ${p.qty-showOut} 件${showOut>0?`（展会带出${showOut}件）`:''}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="openDetail('${p.id}')">详情</button>
          <button class="btn btn-jade btn-sm" onclick="openStockInModal('${p.id}')">⬆️ 入库</button>
          <button class="btn btn-rose btn-sm" onclick="quickOutScan('${p.id}','${targetId}')">⬇️ 出库</button>
        </div>
      </div>`;
  }else{
    el.innerHTML=`<div style="background:var(--surface2);border:1px solid var(--rose);border-radius:var(--radius);padding:14px;">
      <div style="color:var(--rose);margin-bottom:10px;">❌ 未找到商品「${code}」</div>
      <button class="btn btn-gold btn-sm" onclick="openAddModal()">新建此商品</button>
    </div>`;
  }
}
async function quickOutScan(pid,targetId){
  const p=getProduct(pid);if(!p)return;
  const n=parseInt(prompt(`出库数量（当前库存 ${p.qty} 件）：`,1));
  if(!n||n<=0)return;
  if(p.qty<n){toast('库存不足');return;}
  p.qty-=n;
  const log={id:uid(),productId:pid,type:'out',qty:n,note:'扫码出库',ts:Date.now()};
  DB.logs.unshift(log);
  await Promise.all([upsertProduct(p),insertLog(log)]);
  renderInventory();showScanResult(p.sku||p.id,targetId);toast(`✅ 出库 ${n} 件`);
}

// ===================== AI识别 =====================
// ⚡ 通过 Vercel 后端中转，识别后自动搜索库存
const AI_API_URL='https://learnmans-inventory.vercel.app/api/ai-recognize';
let aiProvider='claude'; // 默认Claude（更稳定），可切换为Gemini

// 📏 图片压缩：iPhone 原图常 5-10MB，base64 后超 Vercel 4.5MB 限制 + Safari "Load failed"
// 压到最长边 1600px、JPEG 85% → 大约 200-500KB，又快又稳
async function compressImageForAI(file, maxSize=1600, quality=0.85){
  // 先把文件加载成 Image
  const dataURL = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = () => reject(new Error('文件读取失败'));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('图片解码失败（HEIC格式不支持，请改用JPEG/PNG）'));
    im.src = dataURL;
  });
  // 按比例缩放到 maxSize 长边内
  let w = img.naturalWidth, h = img.naturalHeight;
  if (w > h) {
    if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
  } else {
    if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,w,h); // 防 PNG 透明变黑
  ctx.drawImage(img, 0, 0, w, h);
  // 输出 JPEG dataURL
  const outDataURL = canvas.toDataURL('image/jpeg', quality);
  const base64 = outDataURL.split(',')[1];
  const sizeKB = Math.round(base64.length * 0.75 / 1024);
  return { dataURL: outDataURL, base64, sizeKB, width: w, height: h };
}

// 🔍 测试 AI 后端连接（点按钮触发，方便快速诊断）
async function testAIBackend(){
  const stText = document.getElementById('ai-status-text');
  const st = document.getElementById('ai-status');
  const res = document.getElementById('ai-result');
  st.style.display='flex'; res.style.display='none';
  if(stText) stText.textContent='检测后端 API…';
  try {
    const r = await fetch(AI_API_URL, { method:'GET' });
    const txt = await r.text();
    let info;
    try { info = JSON.parse(txt); } catch(e) { info = { raw: txt.slice(0,300) }; }
    st.style.display='none'; res.style.display='block';
    const keyOk = info.hasClaudeKey || info.hasGeminiKey;
    res.innerHTML = `<div style="background:var(--surface2);border:1px solid var(--jade);border-radius:var(--radius);padding:14px;font-size:13px;">
      <div style="font-weight:600;color:var(--jade-light);margin-bottom:8px;">🔍 后端诊断 (HTTP ${r.status})</div>
      <div style="font-family:monospace;font-size:12px;color:var(--text-dim);white-space:pre-wrap;word-break:break-all;">${JSON.stringify(info, null, 2)}</div>
      <div style="margin-top:8px;color:${keyOk?'var(--jade-light)':'var(--rose)'};">
        ${keyOk ? '✅ API 在线、密钥已配置' : '❌ API key 未配置或未读到，去 Vercel 环境变量检查 ANTHROPIC_API_KEY / GEMINI_API_KEY'}
      </div>
      <button class="btn btn-outline btn-sm" style="margin-top:8px;" onclick="document.getElementById('ai-result').style.display='none'">关闭</button>
    </div>`;
  } catch(err) {
    st.style.display='none'; res.style.display='block';
    res.innerHTML = `<div style="color:var(--rose);font-size:13px;padding:10px;background:var(--surface2);border-radius:var(--radius);">
      ❌ 无法连接后端（${err.message}）<br>
      <span style="color:var(--text-muted);font-size:11px;">检查：① 网络 ② Vercel 部署是否成功 ③ AI_API_URL 是否对</span>
    </div>`;
  }
}

// 同义词对照表
const SYNONYMS=[
  ['陨石','天铁','铁陨石','石铁陨石','陨铁','meteorite'],
  ['葫芦','葫芦形','葫芦状'],
  ['宝石','gemstone','gem'],
  ['首饰','jewelry','吊坠','项链','手链','戒指','耳环','手镯'],
  ['矿物','矿石','crystal','水晶'],
  ['玛瑙','agate'],
  ['琥珀','amber'],
  ['翡翠','jadeite','硬玉'],
  ['和田玉','软玉','nephrite'],
  ['黄金','金','gold'],
  ['白银','银','silver'],
  ['钻石','diamond','钻'],
];

function expandSynonyms(word){
  const w=word.toLowerCase();
  for(const group of SYNONYMS){
    if(group.some(s=>s.toLowerCase()===w||w.includes(s.toLowerCase())||s.toLowerCase().includes(w))){
      return group;
    }
  }
  return [word];
}

// 搜索库存匹配商品
function searchByAIResult(parsed){
  const keywords=[parsed.name,parsed.cat,parsed.origin].filter(Boolean).join(' ');
  // 分词
  const rawWords=keywords.replace(/[，,、。！？\s]+/g,' ').split(' ').filter(w=>w.length>=2);
  // 展开同义词
  const expandedWords=[...new Set(rawWords.flatMap(w=>expandSynonyms(w)))];
  
  const matches=DB.products.filter(p=>{
    const target=(p.name+' '+(p.cat||'')+' '+(p.origin||'')+' '+(p.note||'')).toLowerCase();
    return expandedWords.some(w=>w.length>=2&&target.includes(w.toLowerCase()));
  });
  
  // 按匹配分数排序，匹配越多越靠前
  const calcScore=(p)=>{
    const name=(p.name||'').toLowerCase();
    const cat=(p.cat||'').toLowerCase();
    const origin=(p.origin||'').toLowerCase();
    const note=(p.note||'').toLowerCase();
    return expandedWords.filter(w=>w.length>=2).reduce((score,w)=>{
      const wl=w.toLowerCase();
      if(name.includes(wl)) score+=3;       // 名称匹配权重最高
      if(cat.includes(wl)) score+=2;        // 类别次之
      if(origin.includes(wl)) score+=1;     // 产地
      if(note.includes(wl)) score+=1;       // 备注
      return score;
    },0);
  };
  matches.sort((a,b)=>calcScore(b)-calcScore(a));
  return matches;
}

let aiCapturedPhoto=null; // 保存识别时拍的照片
let detailOpenedFromAI=false; // 记录详情是否从AI结果打开

async function doAIRecognize(e){
  const file=e.target.files[0];if(!file)return;
  const st=document.getElementById('ai-status'),res=document.getElementById('ai-result');
  const stText=document.getElementById('ai-status-text');
  st.style.display='flex';res.style.display='none';
  if(stText)stText.textContent='📏 压缩图片…';
  // 🔧 压缩图片：最长边 1600px、JPEG 85%（防 Vercel 4.5MB body 限制、防 Safari "Load failed"）
  let compressed;
  try {
    compressed = await compressImageForAI(file);
  } catch (err) {
    st.style.display='none';res.style.display='block';
    res.innerHTML=`<div style="color:var(--rose);font-size:13px;padding:10px;background:var(--surface2);border-radius:var(--radius);">图片处理失败：${err.message}</div>`;
    e.target.value=''; return;
  }
  aiCapturedPhoto = compressed.dataURL; // 用压缩后的图保存到建品（也省 Supabase 流量）
  if(stText)stText.textContent=`${aiProvider==='claude'?'Claude':'Gemini'} 识别中… (${compressed.sizeKB}KB)`;
  // 前端 25 秒兜底超时（虽然 Vercel 10s 会先返回，但万一连接挂死的话）
  const ctrl = new AbortController();
  const tmr = setTimeout(()=>ctrl.abort(), 25000);
  try{
    const resp=await fetch(AI_API_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({imageBase64:compressed.base64,mediaType:'image/jpeg',provider:aiProvider}),
      signal: ctrl.signal,
    });
    clearTimeout(tmr);
    if(!resp.ok){
      // 把后端返回的 error + details 全部抓出来显示
      let er; try { er = await resp.json(); } catch(_) { er = { error: 'HTTP '+resp.status }; }
      const detailStr = Array.isArray(er.details) ? ' / ' + er.details.join(' | ') : '';
      throw new Error(`HTTP ${resp.status}: ${er.error||'未知错误'}${detailStr}`);
    }
    const data=await resp.json();
    const parsed=data.result;
    const providerLabel=data.provider||aiProvider;
    st.style.display='none';res.style.display='block';

    // 搜索库存
    const matches=searchByAIResult(parsed);

    let matchHTML='';
    if(matches.length>0){
      matchHTML=`<div style="margin-top:12px;">
        <div style="font-size:12px;color:var(--jade-light);margin-bottom:8px;">📦 库存中找到 ${matches.length} 个匹配商品</div>
        ${matches.map(p=>{
          const showOut=DB.showItems.filter(s=>s.productId===p.id).reduce((a,s)=>a+s.qty,0);
          const avail=p.qty-showOut;
          const tn=p.thumbnail||(p.photos&&p.photos[0]);
          return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:8px;">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
              ${tn?`<img src="${tn}" class="zoomable" style="width:60px;height:60px;border-radius:8px;object-fit:contain;background:#000;flex-shrink:0;" onmouseenter="showZoomPreview(this,'${p.id}')" onmouseleave="hideZoomPreview()">`:`<div style="width:60px;height:60px;border-radius:8px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;">${catEmoji(p.cat)}</div>`}
              <div style="flex:1;min-width:0;">
                <div style="font-size:14px;font-weight:600;color:var(--text);">${p.name}</div>
                <div style="font-size:11px;color:var(--text-muted);">${p.sku||'—'} · ${p.cat||'未分类'}${p.origin?' · '+p.origin:''}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:18px;font-weight:700;color:${avail>0?'var(--jade-light)':'var(--rose)'};">${avail}</div>
                <div style="font-size:10px;color:var(--text-muted);">可用</div>
              </div>
            </div>
            ${p.price?`<div style="font-size:13px;color:var(--gold);margin-bottom:8px;">💰 ${p.price}</div>`:''}
            <div style="display:flex;gap:8px;">
              <button class="btn btn-jade btn-sm" onclick="closeAIResult();openStockInModal('${p.id}')">⬆️ 入库</button>
              <button class="btn btn-sm" style="background:var(--rose-dim);color:var(--rose-light);" onclick="closeAIResult();openStockOutModal('${p.id}')">⬇️ 出库</button>
              <button class="btn btn-outline btn-sm" onclick="detailOpenedFromAI=true;openDetail('${p.id}')">详情</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    } else {
      matchHTML=`<div style="margin-top:10px;padding:10px;background:var(--surface2);border-radius:var(--radius);font-size:13px;color:var(--text-muted);">
        库存中未找到匹配商品
        <button class="btn btn-gold btn-sm" style="margin-top:8px;width:100%;" onclick='useAIResult(${JSON.stringify(JSON.stringify(parsed))})'>＋ 用此结果建新品</button>
      </div>`;
    }

    res.innerHTML=`<div style="background:var(--surface2);border:1px solid var(--jade);border-radius:var(--radius);padding:14px;">
      <div style="font-size:12px;color:var(--jade-light);margin-bottom:10px;">✅ AI识别完成 · ${providerLabel}</div>
      <div class="detail-grid">
        <div class="detail-field"><label>识别名称</label><div class="val">${parsed.name||'—'}</div></div>
        <div class="detail-field"><label>类别</label><div class="val">${parsed.cat||'—'}</div></div>
        ${parsed.origin?`<div class="detail-field"><label>产地/规格</label><div class="val">${parsed.origin}</div></div>`:''}
        ${parsed.country?`<div class="detail-field"><label>原产国</label><div class="val">${parsed.country}</div></div>`:''}
        ${parsed.note?`<div class="detail-field full"><label>描述</label><div class="val" style="font-size:13px;color:var(--text-dim);">${parsed.note}</div></div>`:''}
      </div>
      ${matchHTML}
      <div style="margin-top:10px;display:flex;gap:8px;">
        ${matches.length>0?`<button class="btn btn-outline btn-sm" onclick='useAIResult(${JSON.stringify(JSON.stringify(parsed))})'>＋ 建新品</button>`:''}
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('ai-result').style.display='none'">关闭</button>
      </div>
    </div>`;
  }catch(err){
    clearTimeout(tmr);
    st.style.display='none';res.style.display='block';
    // 把可能的根因写明白
    let hint = '';
    const msg = String(err.message||err);
    if (msg === 'Load failed' || msg.includes('aborted') || msg.includes('NetworkError')) {
      hint = '💡 通常原因：Vercel 函数 10 秒超时（Claude API 太慢） / 网络中断。可点下方"测试后端"看 API 是否在线。';
    } else if (msg.includes('413')) {
      hint = '💡 图片压缩后还是太大。换一张试试。';
    } else if (msg.includes('401') || msg.includes('403')) {
      hint = '💡 Vercel 环境变量里的 API key 失效，去 Vercel 项目 Settings → Environment Variables 检查。';
    } else if (msg.includes('429')) {
      hint = '💡 API 调用频率超限或额度用完，去 Anthropic/Google 控制台看余额。';
    } else if (msg.includes('TIMEOUT')) {
      hint = '💡 单次调用超过 9 秒。试试改用 Gemini 引擎，或者图片再小一点。';
    }
    res.innerHTML=`<div style="color:var(--rose);font-size:13px;padding:12px;background:var(--surface2);border-radius:var(--radius);">
      <div style="font-weight:600;margin-bottom:6px;">识别失败</div>
      <div style="font-family:monospace;font-size:11px;color:var(--text-dim);word-break:break-all;margin-bottom:8px;">${msg}</div>
      ${hint?`<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${hint}</div>`:''}
      <button class="btn btn-outline btn-sm" onclick="testAIBackend()">🔍 测试后端 API</button>
    </div>`;
  }
  e.target.value='';
}

function closeAIResult(){document.getElementById('ai-result').style.display='none';}

function openStockOutModal(preId){
  switchTab('inout',document.querySelector('[onclick*="inout"]'));
  setTimeout(()=>{
    // 切到出库 segment(原来漏了,导致跳进去看到的是入库画面)
    const outBtn=document.querySelector('.mode-btn[onclick*="\'out\'"]');
    if(outBtn)setIOMode('out',outBtn);
    renderOutSelects();
    if(preId){
      const sel=document.getElementById('out-product');
      if(sel)sel.value=preId;
      // 默认带入商品售价 + 币种
      const p=(typeof getProduct==='function')?getProduct(preId):null;
      if(p){
        const priceEl=document.getElementById('out-price');
        if(priceEl)priceEl.value=p.price||'';
        const curEl=document.getElementById('out-currency');
        if(curEl)curEl.value=p.currency||'JPY';
      }
    }
    document.getElementById('out-qty').focus();
  },200);
}
function useAIResult(j){
  try{
    const parsed=JSON.parse(j);
    openAddModal(parsed);
    // 把识别时的照片带入建品
    if(aiCapturedPhoto){
      pendingPhotos=[aiCapturedPhoto];
      renderPhotoPreviews();
    }
  }catch(e){openAddModal();}
}

// ===================== 摄像头扫码 =====================
let _scanFrames=0;
let _scanStream=null;
let _scanLoop=null;
async function startCamera(){
  const bar=document.getElementById('camera-result-bar');
  try{
    document.getElementById('camera-wrap').style.display='block';
    document.getElementById('camera-start-wrap').style.display='none';
    document.getElementById('camera-scan-result').style.display='none';
    bar.textContent='① 启动摄像头…';

    // 手动 getUserMedia,逐级降级
    let stream;
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{
        facingMode:{ideal:'environment'},
        width:{ideal:1920},height:{ideal:1080}
      }});
    }catch(e1){
      bar.textContent='② 高清失败,降级…';
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    }
    _scanStream=stream;
    const videoEl=document.getElementById('camera-video');
    videoEl.setAttribute('playsinline','');
    videoEl.muted=true;
    videoEl.srcObject=stream;
    await videoEl.play().catch(e=>{bar.textContent='video.play 失败: '+e.message;});

    // 试着开连续对焦(iOS 经常 ignore)
    const track=stream.getVideoTracks()[0];
    if(track&&track.applyConstraints){
      try{await track.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch(e){}
    }
    const s=track?track.getSettings():{};
    const resTxt=`${s.width||'?'}×${s.height||'?'}`;

    // 阶段 A: 优先用原生 BarcodeDetector(iOS 16.4+ Safari / Chrome Android)
    // 没有则 fall-through 到阶段 B(ZXing 0.19.1)
    let bdDetector=null;
    let useBD=false;
    if('BarcodeDetector' in window){
      try{
        bdDetector=new window.BarcodeDetector({formats:[
          'qr_code','code_128','code_39',
          'ean_13','ean_8','upc_a','upc_e',
          'itf','data_matrix'
        ]});
        useBD=true;
      }catch(_){useBD=false;}
    }
    // 阶段 C: 多库并行(jsQR + Quagga2 + ZXing),BD 优先时不需要
    const hasJsQR=typeof jsQR==='function';
    const hasQuagga=typeof Quagga!=='undefined';
    const tag=useBD?'[A:BarcodeDetector]':`[C:Multi ZXing${hasJsQR?'+jsQR':''}${hasQuagga?'+Quagga':''}]`;

    // ZXing reader 仅在 fallback 路径需要
    if(!useBD&&!zxingReader){
      const hints=new Map();
      const fmt=ZXing.BarcodeFormat;
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,[
        fmt.QR_CODE,fmt.CODE_128,fmt.CODE_39,
        fmt.EAN_13,fmt.EAN_8,fmt.UPC_A,fmt.UPC_E,
        fmt.ITF,fmt.DATA_MATRIX
      ]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
      try{zxingReader=new ZXing.BrowserMultiFormatReader(hints,100);}
      catch(_){zxingReader=new ZXing.BrowserMultiFormatReader();zxingReader.hints=hints;}
    }

    _scanFrames=0;
    let lastErr='';
    let bdBusy=false;
    let quaggaBusy=false;
    bar.textContent=`📹 ${tag} ${resTxt} | 帧 0 | 对准框内…`;

    const canvas=useBD?null:document.createElement('canvas');
    const ctx=canvas?canvas.getContext('2d'):null;
    const innerReader=useBD?null:zxingReader.reader;
    _scanLoop=setInterval(()=>{
      if(!_scanStream)return;
      if(videoEl.readyState<2||!videoEl.videoWidth){
        bar.textContent=`📹 ${tag} ${resTxt} | 等待视频帧 readyState=${videoEl.readyState}`;
        return;
      }

      // 阶段 A: BarcodeDetector 直读 video 元素
      if(useBD){
        if(bdBusy)return;
        _scanFrames++;
        bdBusy=true;
        bdDetector.detect(videoEl).then(codes=>{
          bdBusy=false;
          if(!_scanStream)return;
          if(codes&&codes.length){
            const code=codes[0].rawValue;
            bar.textContent=`✅ ${tag} 扫到: ${code}`;
            stopCamera();
            showScanResult(code,'camera-scan-result');
            return;
          }
          if(_scanFrames%5===0){
            bar.textContent=`📹 ${tag} ${resTxt} | 帧 ${_scanFrames} | ${videoEl.videoWidth}×${videoEl.videoHeight} | 对准框内…`;
          }
        }).catch(err=>{
          bdBusy=false;
          const name=err&&err.name?err.name:String(err);
          if(name!==lastErr){
            lastErr=name;
            bar.textContent=`⚠️ ${tag} 帧 ${_scanFrames} | ${name}: ${err.message||''}`;
          }
        });
        return;
      }

      // 阶段 C: 三路并行 — jsQR(sync) + ZXing(sync) + Quagga2(async,每 3 帧)
      canvas.width=videoEl.videoWidth;
      canvas.height=videoEl.videoHeight;
      ctx.drawImage(videoEl,0,0,canvas.width,canvas.height);
      _scanFrames++;
      let hit=null;

      // jsQR — QR 专,sync
      if(hasJsQR){
        try{
          const id=ctx.getImageData(0,0,canvas.width,canvas.height);
          const r=jsQR(id.data,id.width,id.height,{inversionAttempts:'attemptBoth'});
          if(r&&r.data){hit={engine:'jsQR',code:r.data};}
        }catch(_){}
      }

      // ZXing — 2D+1D 综合,sync
      if(!hit){
        try{
          const src=new ZXing.HTMLCanvasElementLuminanceSource(canvas);
          const bmp=new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(src));
          const result=innerReader.decode(bmp);
          if(result){hit={engine:'ZXing',code:result.getText()};}
        }catch(err){
          const name=err&&err.name?err.name:String(err);
          if(name!=='NotFoundException'&&name!==lastErr){
            lastErr=name;
            bar.textContent=`⚠️ ${tag} 帧 ${_scanFrames} | ZXing:${name}`;
          }
        }
      }

      if(hit){
        bar.textContent=`✅ [${hit.engine}] 扫到: ${hit.code}`;
        stopCamera();
        showScanResult(hit.code,'camera-scan-result');
        return;
      }

      // Quagga2 — 1D 专,async,每 3 帧丢一次(decodeSingle 较慢)
      if(hasQuagga&&!quaggaBusy&&_scanFrames%3===0){
        quaggaBusy=true;
        try{
          Quagga.decodeSingle({
            src:canvas.toDataURL('image/jpeg',0.8),
            numOfWorkers:0,
            inputStream:{size:Math.min(canvas.width,1280)},
            locator:{patchSize:'medium',halfSample:true},
            decoder:{readers:['ean_reader','ean_8_reader','code_128_reader','code_39_reader','upc_reader','upc_e_reader','i2of5_reader']},
            locate:true
          },(result)=>{
            quaggaBusy=false;
            if(!_scanStream)return;
            if(result&&result.codeResult&&result.codeResult.code){
              const code=result.codeResult.code;
              bar.textContent=`✅ [Quagga] 扫到: ${code}`;
              stopCamera();
              showScanResult(code,'camera-scan-result');
            }
          });
        }catch(e){quaggaBusy=false;}
      }

      if(_scanFrames%5===0){
        bar.textContent=`📹 ${tag} ${resTxt} | 帧 ${_scanFrames} | ${canvas.width}×${canvas.height} | 对准框内…`;
      }
    },150);
  }catch(e){
    bar.textContent='❌ '+(e.message||e);
    toast('摄像头错误: '+(e.message||e));
    document.getElementById('camera-wrap').style.display='none';
    document.getElementById('camera-start-wrap').style.display='block';
  }
}
function stopCamera(){
  if(_scanLoop){clearInterval(_scanLoop);_scanLoop=null;}
  if(zxingReader){try{zxingReader.reset();}catch(e){}}
  if(_scanStream){try{_scanStream.getTracks().forEach(t=>t.stop());}catch(e){}_scanStream=null;}
  document.getElementById('camera-wrap').style.display='none';
  document.getElementById('camera-start-wrap').style.display='block';
}

// ===================== 阶段 D: 拍照让 AI 读条码 =====================
async function scanFromPhoto(input){
  const file=input.files&&input.files[0];
  input.value=''; // 让下次拍同一张也能触发 onchange
  if(!file)return;
  const resultEl=document.getElementById('camera-scan-result');
  resultEl.style.display='block';
  resultEl.innerHTML=`<div style="background:var(--surface2);border:1px solid var(--gold);border-radius:var(--radius);padding:14px;color:var(--text-dim);">🤖 [D:AI] 上传中…</div>`;
  try{
    // 压缩(复用 core 的 compressImage:800px max,<200KB)
    const compressed=await compressImage(file);
    const base64=compressed.split(',')[1];
    resultEl.innerHTML=`<div style="background:var(--surface2);border:1px solid var(--gold);border-radius:var(--radius);padding:14px;color:var(--text-dim);">🤖 [D:AI] AI 读图中…(~2 秒)</div>`;
    const provider=document.querySelector('input[name="ai-provider"]:checked')?.value||'claude';
    const res=await fetch('/api/scan-barcode',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({imageBase64:base64,mediaType:'image/jpeg',provider})
    });
    const data=await res.json();
    if(!res.ok){
      resultEl.innerHTML=`<div style="background:var(--surface2);border:1px solid var(--rose);border-radius:var(--radius);padding:14px;color:var(--rose);">❌ [D:AI] ${data.error||res.status}: ${(data.details||[]).join(' / ')}</div>`;
      return;
    }
    if(!data.code){
      resultEl.innerHTML=`<div style="background:var(--surface2);border:1px solid var(--rose);border-radius:var(--radius);padding:14px;color:var(--rose);">❌ [D:AI] 图中没找到条码(${data.provider})</div>`;
      return;
    }
    // AI 拿到 code → 走 showScanResult 在库存里查
    showScanResult(data.code.trim(),'camera-scan-result');
    toast(`✅ [D:AI/${data.provider}] 读到 ${data.code}`);
  }catch(e){
    resultEl.innerHTML=`<div style="background:var(--surface2);border:1px solid var(--rose);border-radius:var(--radius);padding:14px;color:var(--rose);">❌ [D:AI] ${e.message||e}</div>`;
  }
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
  // 优先精确匹配 sku/id/name,失败再用后缀匹配(新标签 barcode 编码 ID 后 8 位)
  let p=DB.products.find(pr=>pr.sku===sku||pr.id===sku||pr.sku===code||pr.id===code||pr.name===code||(nameFromQR&&pr.name===nameFromQR));
  if(!p&&sku.length>=6&&sku.length<=12){
    p=DB.products.find(pr=>(pr.id||'').endsWith(sku)||(pr.sku||'').endsWith(sku));
  }
  const el=document.getElementById(targetId);
  el.style.display='block';
  if(p){
    const showOut=DB.showItems.filter(s=>s.productId===p.id).reduce((a,s)=>a+s.qty,0);
    const avail=p.qty-showOut;
    const priceStr=(typeof p.price==='number'&&p.price>0)?` · ${(p.currency||'JPY')==='JPY'?'¥':(p.currency==='CNY'?'¥':(p.currency==='USD'?'$':(p.currency==='EUR'?'€':'')))}${p.price.toLocaleString()}`:'';
    const thumbHTML=p.photos&&p.photos[0]
      ? `<img src="${p.photos[0]}" alt="">`
      : `<span>${catEmoji(p.cat)||'◈'}</span>`;
    el.innerHTML=`
      <div class="scan-result-banner">
        <div class="scan-result-icon">✓</div>
        <div class="scan-result-text">
          <div class="scan-result-title">识别成功 · 命中商品</div>
          <div class="scan-result-sub">SKU ${(p.sku||p.id||'').toString().slice(0,16)} · 库存 ${avail}${showOut>0?` · 展会带出 ${showOut}`:''}</div>
        </div>
      </div>
      <div class="scan-cand">
        <div class="scan-cand-thumb">
          <span class="scan-cand-match">100%</span>
          ${thumbHTML}
        </div>
        <div class="scan-cand-info">
          <div class="scan-cand-name">${p.name||'(未命名)'}</div>
          <div class="scan-cand-meta">${p.cat||'未分类'} · 库存 ${avail}${priceStr}</div>
        </div>
        <div class="scan-cand-actions">
          <a class="scan-cand-btn in"  href="javascript:void(0)" onclick="openStockInModal('${p.id}')" title="入库">⬆</a>
          <a class="scan-cand-btn out" href="javascript:void(0)" onclick="quickOutScan('${p.id}','${targetId}')" title="出库">⬇</a>
          <a class="scan-cand-btn det" href="javascript:void(0)" onclick="openDetail('${p.id}')" title="详情">›</a>
        </div>
      </div>`;
  }else{
    el.innerHTML=`
      <div class="scan-result-banner miss">
        <div class="scan-result-icon">!</div>
        <div class="scan-result-text">
          <div class="scan-result-title">未匹配到商品</div>
          <div class="scan-result-sub">扫到的码:${(code||'').toString().slice(0,32)}</div>
        </div>
      </div>
      <div class="scan-cand-miss">
        <div>没有这件商品,或它的 SKU 还没绑这个码</div>
        <div class="scan-cand-miss-code">${code}</div>
        <button class="btn btn-gold btn-sm" onclick="openAddModal()">＋ 新建此商品</button>
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

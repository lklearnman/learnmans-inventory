// ===================== 摄像头扫码 =====================
// v5 (2026-05-19): 砍 Quagga2 (误识别), ROI 裁剪到黄框, requestVideoFrameCallback
let _scanFrames=0;
let _scanStream=null;
let _scanRaf=null;
let _scanStopFlag=false;
let _torchOn=false;
async function startCamera(){
  const bar=document.getElementById('camera-result-bar');
  try{
    const _wrap=document.getElementById('camera-wrap');
    // 把 overlay 移到 body 末尾,避免被 .scan-stage(overflow:hidden + border-radius)困住导致 fixed 失效 / video 不显示
    if(_wrap&&_wrap.parentNode!==document.body){
      _wrap.__origParent=_wrap.parentNode;
      _wrap.__origNext=_wrap.nextSibling;
      document.body.appendChild(_wrap);
    }
    _wrap.style.display='flex';
    document.getElementById('camera-start-wrap').style.display='none';
    const _csr=document.getElementById('camera-scan-result');if(_csr)_csr.style.display='none';
    document.body.style.overflow='hidden';
    bar.textContent='① 启动摄像头…';

    // 权限预检 (iOS Safari 不支持 permissions.query('camera') 会 throw,忽略)
    try{
      if(navigator.permissions&&navigator.permissions.query){
        const st=await navigator.permissions.query({name:'camera'});
        if(st&&st.state==='denied'){
          bar.innerHTML='❌ 摄像头权限被拒绝。请到 <b>设置 → Safari → 网站设置 → learnmans-inventory.vercel.app → 相机:允许</b> 后重新打开本页面';
          toast('请到系统设置开启相机权限');
          return;
        }
      }
    }catch(_){/* iOS Safari throws on name:'camera' — ignore */}

    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
      bar.textContent='❌ 浏览器不支持摄像头 API';
      return;
    }

    // 手动 getUserMedia,逐级降级
    let stream;
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{
        facingMode:{ideal:'environment'},
        width:{ideal:1920},height:{ideal:1080},
        frameRate:{ideal:60}
      }});
    }catch(e1){
      // 用户 reject / NotAllowedError
      if(e1&&(e1.name==='NotAllowedError'||e1.name==='SecurityError')){
        bar.innerHTML='❌ 摄像头被拒绝。iOS:<b>设置 → Safari → 相机 → 允许</b>;Android:浏览器地址栏锁图标 → 权限 → 相机';
        toast('请允许相机权限');
        throw e1;
      }
      bar.textContent='② 高清失败,降级…';
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    }
    _scanStream=stream;
    _scanStopFlag=false;
    const videoEl=document.getElementById('camera-video');
    videoEl.setAttribute('playsinline','');
    videoEl.muted=true;
    videoEl.srcObject=stream;
    await videoEl.play().catch(e=>{bar.textContent='video.play 失败: '+e.message;});

    // 连续对焦 + 手电筒按钮可用性
    const track=stream.getVideoTracks()[0];
    if(track&&track.applyConstraints){
      // iOS Safari 优化:连续对焦 + 白平衡 + 曝光,逐项尝试避免一个不支持导致全失败
      try{await track.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch(e){}
      try{await track.applyConstraints({advanced:[{whiteBalanceMode:'continuous'}]});}catch(e){}
      try{await track.applyConstraints({advanced:[{exposureMode:'continuous'}]});}catch(e){}
    }
    const caps=(track&&track.getCapabilities)?track.getCapabilities():{};
    const torchBtn=document.getElementById('scan-torch-btn');
    if(torchBtn){
      torchBtn.style.display=caps.torch?'inline-flex':'none';
      _torchOn=false;
      torchBtn.textContent='🔦';
    }
    const s=track?track.getSettings():{};
    const resTxt=`${s.width||'?'}×${s.height||'?'}`;

    // 路径 A: 原生 BarcodeDetector (Chrome Android / Edge);iOS Safari 无
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
    const hasJsQR=typeof jsQR==='function';
    // Quagga2 已砍 — false positive 严重(把 MZ-MP1KOA 读成 11924470)
    const tag=useBD?'[A:Native]':`[ZXing${hasJsQR?'+jsQR':''}]`;

    if(!useBD&&!zxingReader){
      const hints=new Map();
      const fmt=ZXing.BarcodeFormat;
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,[
        fmt.QR_CODE,fmt.CODE_128,fmt.CODE_39,
        fmt.EAN_13,fmt.EAN_8,fmt.UPC_A,fmt.UPC_E,
        fmt.ITF,fmt.DATA_MATRIX
      ]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
      try{zxingReader=new ZXing.BrowserMultiFormatReader(hints,50);}
      catch(_){zxingReader=new ZXing.BrowserMultiFormatReader();zxingReader.hints=hints;}
    }

    _scanFrames=0;
    let lastErr='';
    let bdBusy=false;
    bar.textContent=`📹 ${tag} ${resTxt} | 帧 0 | 对准黄框…`;

    // ROI 裁剪:从视频中心取 60% 短边正方形,匹配 CSS .scan-frame
    const roiCanvas=document.createElement('canvas');
    const roiCtx=roiCanvas.getContext('2d',{willReadFrequently:true});
    const innerReader=useBD?null:zxingReader.reader;

    function computeROI(){
      const vw=videoEl.videoWidth,vh=videoEl.videoHeight;
      const side=Math.floor(Math.min(vw,vh)*0.9);
      return{
        sx:Math.floor((vw-side)/2),
        sy:Math.floor((vh-side)/2),
        sw:side,sh:side
      };
    }

    async function tick(){
      if(_scanStopFlag||!_scanStream)return;
      if(videoEl.readyState<2||!videoEl.videoWidth){
        bar.textContent=`📹 ${tag} ${resTxt} | 等待视频帧 readyState=${videoEl.readyState}`;
        scheduleNext();return;
      }
      const roi=computeROI();
      // 解码 canvas 缩放到最大 720,平衡分辨率与速度
      const targetSide=Math.min(roi.sw,720);
      roiCanvas.width=targetSide;
      roiCanvas.height=targetSide;
      roiCtx.drawImage(videoEl,roi.sx,roi.sy,roi.sw,roi.sh,0,0,targetSide,targetSide);
      _scanFrames++;

      // 路径 A: BarcodeDetector (async)
      if(useBD){
        if(bdBusy){scheduleNext();return;}
        bdBusy=true;
        try{
          const codes=await bdDetector.detect(roiCanvas);
          bdBusy=false;
          if(codes&&codes.length){
            const code=codes[0].rawValue;
            bar.textContent=`✅ ${tag} ${code}`;
            stopCamera();
            showScanResult(code,'camera-scan-result');
            return;
          }
        }catch(err){
          bdBusy=false;
          const name=err&&err.name?err.name:String(err);
          if(name!==lastErr){lastErr=name;bar.textContent=`⚠️ ${tag} 帧 ${_scanFrames} | ${name}`;}
        }
        if(_scanFrames%10===0){
          bar.textContent=`📹 ${tag} ${resTxt} | 帧 ${_scanFrames} | ROI ${targetSide}² | 对准黄框…`;
        }
        scheduleNext();return;
      }

      // 路径 B: jsQR + ZXing (全 sync)
      let hit=null;
      if(hasJsQR){
        try{
          const id=roiCtx.getImageData(0,0,targetSide,targetSide);
          const r=jsQR(id.data,id.width,id.height,{inversionAttempts:'attemptBoth'});
          if(r&&r.data){hit={engine:'jsQR',code:r.data};}
        }catch(_){}
      }
      if(!hit){
        try{
          const src=new ZXing.HTMLCanvasElementLuminanceSource(roiCanvas);
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
        bar.textContent=`✅ [${hit.engine}] ${hit.code}`;
        stopCamera();
        showScanResult(hit.code,'camera-scan-result');
        return;
      }
      if(_scanFrames%10===0){
        bar.textContent=`📹 ${tag} ${resTxt} | 帧 ${_scanFrames} | ROI ${targetSide}² | 对准黄框…`;
      }
      scheduleNext();
    }

    function scheduleNext(){
      if(_scanStopFlag)return;
      // requestVideoFrameCallback 跟着视频帧率走(iOS Safari 15.4+/Chrome 83+)
      if(typeof videoEl.requestVideoFrameCallback==='function'){
        _scanRaf=videoEl.requestVideoFrameCallback(()=>tick());
      }else{
        _scanRaf=setTimeout(tick,60);
      }
    }
    tick();
  }catch(e){
    if(bar){bar.textContent='❌ '+(e.message||e);}
    toast('摄像头错误: '+(e.message||e));
    try{stopCamera();}catch(_){}
  }
}
function stopCamera(){
  _scanStopFlag=true;
  if(_scanRaf){
    try{
      const v=document.getElementById('camera-video');
      if(v&&typeof v.cancelVideoFrameCallback==='function'){v.cancelVideoFrameCallback(_scanRaf);}
      else clearTimeout(_scanRaf);
    }catch(_){}
    _scanRaf=null;
  }
  if(zxingReader){try{zxingReader.reset();}catch(e){}}
  if(_scanStream){try{_scanStream.getTracks().forEach(t=>t.stop());}catch(e){}_scanStream=null;}
  _torchOn=false;
  const _wrap=document.getElementById('camera-wrap');
  if(_wrap){
    _wrap.style.display='none';
    // 还原到原位置
    if(_wrap.__origParent){
      try{_wrap.__origParent.insertBefore(_wrap,_wrap.__origNext||null);}catch(_){}
      _wrap.__origParent=null;_wrap.__origNext=null;
    }
  }
  document.getElementById('camera-start-wrap').style.display='block';
  document.body.style.overflow='';
}

// ===================== 相册选图 → 本地解码 (jsQR + ZXing,不走 AI) =====================
async function decodeFileImage(file){
  if(!file)return;
  const bar=document.getElementById('camera-result-bar');
  const fileInput=document.getElementById('scan-file-input');
  if(fileInput)fileInput.value=''; // 让下次选同一张也触发
  if(bar)bar.textContent='🖼 解码相册图…';
  try{
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.decoding='async';
    await new Promise((res,rej)=>{img.onload=res;img.onerror=()=>rej(new Error('图片加载失败'));img.src=url;});
    URL.revokeObjectURL(url);
    // 高保真画到 canvas (限制最大 1600 边,避免内存爆炸)
    const maxSide=1600;
    const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
    const w=Math.round(img.naturalWidth*scale);
    const h=Math.round(img.naturalHeight*scale);
    const cv=document.createElement('canvas');
    cv.width=w;cv.height=h;
    const cx=cv.getContext('2d',{willReadFrequently:true});
    cx.drawImage(img,0,0,w,h);

    // 路径 1: jsQR (二维码)
    if(typeof jsQR==='function'){
      try{
        const id=cx.getImageData(0,0,w,h);
        const r=jsQR(id.data,id.width,id.height,{inversionAttempts:'attemptBoth'});
        if(r&&r.data){
          if(bar)bar.textContent=`✅ [jsQR] ${r.data}`;
          stopCamera();
          showScanResult(r.data,'camera-scan-result');
          return;
        }
      }catch(_){}
    }
    // 路径 2: BarcodeDetector (Android Chrome)
    if('BarcodeDetector' in window){
      try{
        const bd=new window.BarcodeDetector({formats:[
          'qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e','itf','data_matrix'
        ]});
        const codes=await bd.detect(cv);
        if(codes&&codes.length){
          const code=codes[0].rawValue;
          if(bar)bar.textContent=`✅ [BD] ${code}`;
          stopCamera();
          showScanResult(code,'camera-scan-result');
          return;
        }
      }catch(_){}
    }
    // 路径 3: ZXing (兜底,iOS Safari 主路径)
    if(window.ZXing){
      try{
        const hints=new Map();
        const fmt=ZXing.BarcodeFormat;
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,[
          fmt.QR_CODE,fmt.CODE_128,fmt.CODE_39,fmt.EAN_13,fmt.EAN_8,
          fmt.UPC_A,fmt.UPC_E,fmt.ITF,fmt.DATA_MATRIX
        ]);
        hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
        const reader=new ZXing.BrowserMultiFormatReader(hints);
        const src=new ZXing.HTMLCanvasElementLuminanceSource(cv);
        const bmp=new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(src));
        const result=reader.reader.decode(bmp);
        if(result){
          const code=result.getText();
          if(bar)bar.textContent=`✅ [ZXing] ${code}`;
          stopCamera();
          showScanResult(code,'camera-scan-result');
          return;
        }
      }catch(_){}
    }
    if(bar)bar.textContent='❌ 图中未识别到条码/QR(可尝试拍照识别走 AI)';
    toast('图中没找到条码');
  }catch(e){
    if(bar)bar.textContent='❌ 相册解码失败: '+(e.message||e);
    toast('解码失败: '+(e.message||e));
  }
}

async function toggleTorch(){
  if(!_scanStream)return;
  const track=_scanStream.getVideoTracks()[0];
  if(!track||!track.applyConstraints)return;
  try{
    _torchOn=!_torchOn;
    await track.applyConstraints({advanced:[{torch:_torchOn}]});
    const btn=document.getElementById('scan-torch-btn');
    if(btn)btn.textContent=_torchOn?'💡':'🔦';
  }catch(e){
    toast('手电筒不支持: '+(e.message||e));
    _torchOn=false;
  }
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

// 高级选项折叠区里的 AI 引擎 chip 切换同步
function _syncAiChip(){
  const claude=document.getElementById('ai-chip-claude');
  const gemini=document.getElementById('ai-chip-gemini');
  if(!claude||!gemini)return;
  claude.classList.toggle('cur',aiProvider==='claude');
  gemini.classList.toggle('cur',aiProvider==='gemini');
}

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

// ===================== 拍照按钮 → 本地解码 (ZXing 三路 binarizer) =====================
// HTML #scan-photo-btn(capture=environment) 直拍 4K 后 onchange 调到这里
async function decodePhotoFile(file){
  if(!file) return;
  const bar=document.getElementById('camera-result-bar');
  if(bar) bar.textContent='📷 解码照片中…';
  try{
    const img=new Image();
    const url=URL.createObjectURL(file);
    await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url;});
    URL.revokeObjectURL(url);

    const canvas=document.createElement('canvas');
    canvas.width=img.naturalWidth;
    canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(img,0,0);

    if(bar) bar.textContent=`📷 ${img.naturalWidth}×${img.naturalHeight} 解码中…`;

    if(!window.ZXing){
      if(bar) bar.textContent='❌ ZXing 未加载';
      return;
    }
    if(!zxingReader){
      const hints=new Map();
      const fmt=ZXing.BarcodeFormat;
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,[fmt.QR_CODE,fmt.CODE_128,fmt.CODE_39,fmt.EAN_13,fmt.EAN_8,fmt.UPC_A,fmt.UPC_E,fmt.ITF,fmt.DATA_MATRIX]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
      try{zxingReader=new ZXing.BrowserMultiFormatReader(hints,50);}
      catch(_){zxingReader=new ZXing.BrowserMultiFormatReader();zxingReader.hints=hints;}
    }
    const reader=zxingReader.reader;

    const tryBin=(BinCls,cv)=>{
      try{
        const src=new ZXing.HTMLCanvasElementLuminanceSource(cv);
        const bmp=new ZXing.BinaryBitmap(new BinCls(src));
        return reader.decode(bmp);
      }catch(_){return null;}
    };
    let r=tryBin(ZXing.HybridBinarizer,canvas);
    if(!r) r=tryBin(ZXing.GlobalHistogramBinarizer,canvas);
    if(!r){
      try{
        const id=ctx.getImageData(0,0,canvas.width,canvas.height);
        for(let i=0;i<id.data.length;i+=4){id.data[i]=255-id.data[i];id.data[i+1]=255-id.data[i+1];id.data[i+2]=255-id.data[i+2];}
        const inv=document.createElement('canvas');
        inv.width=canvas.width; inv.height=canvas.height;
        inv.getContext('2d').putImageData(id,0,0);
        r=tryBin(ZXing.HybridBinarizer,inv);
        if(!r) r=tryBin(ZXing.GlobalHistogramBinarizer,inv);
      }catch(_){}
    }

    if(r){
      if(bar) bar.textContent=`✅ 拍照识别: ${r.getText()}`;
      stopCamera();
      showScanResult(r.getText(),'camera-scan-result');
    } else {
      if(bar) bar.textContent='❌ 照片解不出条码,试再拍一张(对准 + 充足光线 + 距离 10-15cm)';
    }
  }catch(e){
    if(bar) bar.textContent='❌ 解码失败: '+(e.message||e);
  }
}

// DOMContentLoaded 时绑定拍照/相册按钮(HTML inline onchange 是兜底,这里再保一层)
document.addEventListener('DOMContentLoaded',function(){
  const photoBtn=document.getElementById('scan-photo-btn');
  const photoIn=document.getElementById('scan-photo-input');
  if(photoBtn&&photoIn){
    photoBtn.addEventListener('click',function(e){e.preventDefault();photoIn.click();});
    photoIn.addEventListener('change',function(){const f=this.files&&this.files[0];if(f)decodePhotoFile(f);this.value='';});
  }
  const galBtn=document.getElementById('scan-gallery-btn');
  const galIn=document.getElementById('scan-file-input');
  if(galBtn&&galIn){
    galBtn.addEventListener('click',function(e){e.preventDefault();galIn.click();});
    galIn.addEventListener('change',function(){const f=this.files&&this.files[0];if(f)decodePhotoFile(f);this.value='';});
  }
});

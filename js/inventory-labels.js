// ===================== LABELS / 价格标签 =====================
let selectedLabelIds=new Set();

// jsPDF 中文字体加载(单例,fetch 一次 → base64 缓存到内存供后续 PDF 复用)
let _chineseFontB64Promise=null;
function loadChineseFontForPDF(pdf){
  if(!_chineseFontB64Promise){
    _chineseFontB64Promise=fetch('fonts/NotoSansSC-Regular-subset.ttf')
      .then(r=>{if(!r.ok)throw new Error('font http '+r.status);return r.arrayBuffer();})
      .then(buf=>{
        let bin='';const bytes=new Uint8Array(buf);
        const CHUNK=0x8000;
        for(let i=0;i<bytes.length;i+=CHUNK){
          bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+CHUNK));
        }
        return btoa(bin);
      });
  }
  return _chineseFontB64Promise.then(b64=>{
    pdf.addFileToVFS('NotoSansSC-Regular.ttf',b64);
    pdf.addFont('NotoSansSC-Regular.ttf','NotoSansSC','normal');
  });
}

// presetIds: 可选数组,若传入则覆盖当前选择(从详情页 🏷️ 打来,只打这一个)
// 不传则使用库存页已勾选的 selectedLabelIds
function openLabelModal(presetIds){
  if(Array.isArray(presetIds)&&presetIds.length){
    selectedLabelIds=new Set(presetIds);
  }
  if(!selectedLabelIds.size){
    toast('请先在库存页勾选要打印的商品');
    return;
  }
  // 默认币种跟随库存页全局币种
  const curSel=document.getElementById('label-currency');
  if(curSel&&typeof inventoryCurrency!=='undefined')curSel.value=inventoryCurrency;
  renderLabelList();
  document.getElementById('modal-label').classList.add('open');
}

// 兼容旧调用
function renderQRSelects(){}

function renderLabelList(){
  const el=document.getElementById('label-product-list');
  if(!el)return;
  const prods=DB.products.filter(p=>selectedLabelIds.has(p.id));
  if(!prods.length){
    el.innerHTML='<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">未选择商品</div>';
    updateLabelCount();return;
  }
  el.innerHTML=prods.map(p=>{
    const tn=p.thumbnail||(p.photos&&p.photos[0]);
    const thumb=tn
      ?`<img src="${tn}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;flex-shrink:0;">`
      :`<div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:22px;background:var(--surface2);border-radius:4px;flex-shrink:0;">${typeof catEmoji==='function'?catEmoji(p.cat):'💎'}</div>`;
    return`<div style="display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid var(--border);">
      ${thumb}
      <span style="flex:1;min-width:0;font-size:13px;line-height:1.4;">${p.name}</span>
      <button class="btn btn-outline btn-sm" onclick="removeFromLabelSelection('${p.id}')" style="padding:2px 9px;font-size:13px;line-height:1;flex-shrink:0;" title="从打印列表移除">×</button>
    </div>`;
  }).join('');
  updateLabelCount();
}

function removeFromLabelSelection(pid){
  selectedLabelIds.delete(pid);
  renderLabelList();
  if(typeof renderInventory==='function')renderInventory();
  if(!selectedLabelIds.size){
    closeModal('modal-label');
    toast('已清空打印列表');
  }
}

function updateLabelCount(){
  const el=document.getElementById('label-selected-count');
  if(el)el.textContent=selectedLabelIds.size?`(${selectedLabelIds.size} 件)`:'';
}

// label-size 切换钩子。早期版本会自动 sku→qr,后来用户指出根因是
// barcode 分辨率不够(不是物理限制),撤回 auto-flip。函数保留以备后续微调。
function onLabelSizeChange(size){
  // 当前是 no-op。如果将来想做提示/默认勾选改动,在这里加。
}

function getLabelConfig(){
  const size=document.getElementById('label-size').value;
  const sizes={
    tiny:{w:25,h:15,nameSize:5,priceSize:7,subSize:4,bcW:0.45,bcH:5},
    mini:{w:30,h:20,nameSize:6,priceSize:9,subSize:5,bcW:0.55,bcH:6},
    'fold-ring':{w:25,h:30,nameSize:6,priceSize:10,subSize:4,bcW:0.5,bcH:9,fold:true},
    small:{w:40,h:30,nameSize:8,priceSize:11,subSize:6,bcW:0.6,bcH:8},
    medium:{w:60,h:40,nameSize:10,priceSize:14,subSize:7,bcW:0.8,bcH:10},
    large:{w:90,h:60,nameSize:14,priceSize:20,subSize:9,bcW:1.2,bcH:14},
    big:{w:120,h:80,nameSize:18,priceSize:28,subSize:11,bcW:1.6,bcH:18}
  };
  return{
    ...sizes[size],
    size,
    showName:document.getElementById('lbl-name').checked,
    showPrice:document.getElementById('lbl-price').checked,
    showOrigin:document.getElementById('lbl-origin').checked,
    showSku:document.getElementById('lbl-sku').checked,
    showQR:document.getElementById('lbl-qr').checked,
    labelCurrency:(document.getElementById('label-currency')||{}).value||'', // 空串=按商品原币种
    pdfMode:(document.getElementById('label-pdf-mode')||{}).value||'single' // single=精臣单页, grid=A4网格
  };
}

// barcode 实际编码的字符串:用户设了 SKU 用 SKU,否则用 ID 后 8 位(随机部分,避免 23 字符
// 长 ID 把 CODE128 module 挤到 0.12mm/格物理上扫不到)。文字标签仍显示完整 SKU/ID 供人眼读。
function getBarcodeContent(p){
  const sku=(p.sku||'').trim();
  if(sku&&sku.length<=12)return sku;
  const id=p.id||'';
  return id.length>8?id.slice(-8):id||'NA';
}

// PDF 端纯矢量画 barcode bars,告别 PNG 中间桥的抗锯齿/缩放损失
// JsBarcode SVG 输出:外层白底 rect + <g translate(margin,margin)> 包一堆 <rect> 黑条
// margin:24 = 12 × width:2 → quiet zone ≥10× 模块宽,满足 CODE128 标准
// (之前 margin:10 = 5×,扫描器有时找不到 start/stop pattern,看起来「粗糙」)
function drawBarcodeVector(pdf,text,x_mm,y_mm,w_mm,h_mm){
  try{
    const svgEl=document.createElementNS('http://www.w3.org/2000/svg','svg');
    JsBarcode(svgEl,text||'NA',{format:'CODE128',displayValue:false,width:2,height:100,margin:24});
    const totalW=parseFloat(svgEl.getAttribute('width'));
    if(!totalW)return false;
    const g=svgEl.querySelector('g');
    let groupX=0;
    if(g){
      const m=(g.getAttribute('transform')||'').match(/translate\(\s*([-\d.]+)/);
      if(m)groupX=parseFloat(m[1]);
    }
    const bars=svgEl.querySelectorAll('g rect');
    if(!bars.length)return false;
    pdf.setFillColor(0,0,0);
    bars.forEach(r=>{
      const xSvg=(parseFloat(r.getAttribute('x'))||0)+groupX;
      const wSvg=parseFloat(r.getAttribute('width'))||0;
      pdf.rect(x_mm+(xSvg/totalW)*w_mm,y_mm,(wSvg/totalW)*w_mm,h_mm,'F');
    });
    return true;
  }catch(e){return false;}
}

function makeBarcodeDataURL(text,cfg){
  // 高分辨率渲染:每条 24px,height ×80,canvas 像素 ×24 vs 早期版本
  // 36mm 宽 barcode 在 600 DPI 打印机出 850 dots,源 PNG ~2400+px → 2-3× 超采样,
  // 印 1D 模块 0.25mm 时仍能保持边缘锐利不模糊
  // margin:10 — CODE128 标准要求两侧 quiet zone,没它扫描器找不到 start/stop pattern
  try{
    const c=document.createElement('canvas');
    JsBarcode(c,text||'NA',{format:'CODE128',displayValue:false,width:24,height:cfg.bcH*80,margin:10});
    return c.toDataURL('image/png');
  }catch(e){return null;}
}

function makeQRDataURL(text){
  const div=document.createElement('div');
  new QRCode(div,{text,width:120,height:120,colorDark:'#000',colorLight:'#fff'});
  const canvas=div.querySelector('canvas');
  return canvas?canvas.toDataURL('image/png'):null;
}

function previewLabels(){
  if(!selectedLabelIds.size){toast('请先选择商品');return;}
  const cfg=getLabelConfig();
  const prods=DB.products.filter(p=>selectedLabelIds.has(p.id));
  const w=window.open('','_blank');
  const html=prods.map(p=>renderLabelHTML(p,cfg)).join('');
  // 字号公式: pt to px 是 1.06× (96dpi 屏 + 3px/mm 标签缩放),为可读再×1.1 = ~1.15
  // 价格字号原 1.8× 太大,在 tiny/mini/small 上压商品名第二行。统一 1.15 跟商品名一致 weight
  // 商品名限制 2 行 (-webkit-line-clamp),溢出加省略号防视觉撞车
  // 价格位置: 有 QR 时绝对定位右上(避让 QR);无 QR 时贴 barcode 上方右对齐(跟 PDF 一致)
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>价格标签预览</title>
  <style>
    body{background:#e5e5e5;padding:20px;font-family:sans-serif;}
    .label-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(${cfg.w*3}px,1fr));gap:10px;}
    .label{position:relative;background:#fff;padding:${Math.max(4,cfg.w*0.05)}px;border:1px dashed #999;display:flex;flex-direction:column;justify-content:space-between;width:${cfg.w*3}px;height:${cfg.h*3}px;color:#000;box-sizing:border-box;overflow:hidden;}
    .lbl-top{flex-shrink:1;min-height:0;overflow:hidden;${cfg.showQR?`padding-right:${cfg.h*1.5+4}px;`:''}}
    .lbl-bot{flex-shrink:0;display:flex;flex-direction:column;gap:2px;}
    .lbl-name{font-size:${cfg.nameSize*1.15}px;font-weight:bold;line-height:1.15;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;word-break:break-word;}
    .lbl-origin{font-size:${cfg.subSize*1.15}px;color:#666;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .lbl-price{font-size:${cfg.priceSize*1.15}px;font-weight:bold;color:#000;text-align:right;line-height:1.1;}
    .lbl-price-tr{position:absolute;top:${Math.max(4,cfg.w*0.05)}px;right:${Math.max(4,cfg.w*0.05)}px;font-size:${cfg.priceSize*1.15}px;font-weight:bold;color:#000;line-height:1;}
    .lbl-sku{font-size:${cfg.subSize}px;font-family:monospace;color:#444;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .lbl-bc-row{display:flex;align-items:flex-end;justify-content:space-between;gap:4px;}
    .lbl-bc-stack{flex:1;min-width:0;}
    .lbl-barcode img{display:block;width:100%;height:${cfg.bcH*3}px;object-fit:contain;}
    .lbl-qr img{display:block;width:${cfg.h*1.5}px;height:${cfg.h*1.5}px;}
  </style></head><body>
    <h3>价格标签预览（${prods.length}个 · ${cfg.w}×${cfg.h}mm）</h3>
    <div class="label-grid">${html}</div>
  </body></html>`);
  w.document.close();
}

function renderLabelHTML(p,cfg){
  const pCur=p.currency||'CNY';
  const priceTxt=cfg.showPrice&&p.price
    ? (cfg.labelCurrency
        ? fmtPrice(p.price,cfg.labelCurrency,pCur)
        : fmtPriceRaw(p.price,pCur))
    : '';
  // 镜像 PDF 布局:
  // - 顶区: 商品名 (2 行 clamp) + 产地 (1 行 clamp)
  // - 底区: 价格(无 QR 时贴 barcode 上方右对齐) + barcode + SKU 文字
  //         + QR(右下,有时)
  // - 价格(有 QR 时):绝对定位右上角避让 QR
  const priceAtTopRight=cfg.showQR;
  return`<div class="label">
    <div class="lbl-top">
      ${cfg.showName?`<div class="lbl-name">${p.name}</div>`:''}
      ${cfg.showOrigin&&p.origin?`<div class="lbl-origin">${p.origin}</div>`:''}
    </div>
    <div class="lbl-bot">
      ${priceTxt&&!priceAtTopRight?`<div class="lbl-price">${priceTxt}</div>`:''}
      <div class="lbl-bc-row">
        <div class="lbl-bc-stack">
          ${cfg.showSku?`<div class="lbl-barcode"><img src="${makeBarcodeDataURL(getBarcodeContent(p),cfg)}"></div><div class="lbl-sku">${p.sku||p.id}</div>`:''}
        </div>
        ${cfg.showQR?`<div class="lbl-qr"><img src="${makeQRDataURL((p.sku||p.id)+'|'+p.name)}"></div>`:''}
      </div>
    </div>
    ${priceTxt&&priceAtTopRight?`<div class="lbl-price-tr">${priceTxt}</div>`:''}
  </div>`;
}

async function exportLabelsPDF(){
  if(!selectedLabelIds.size){toast('请先选择商品');return;}
  if(!window.jspdf){toast('PDF库加载中，请稍后');return;}
  const cfg=getLabelConfig();
  const prods=DB.products.filter(p=>selectedLabelIds.has(p.id));

  const isSingle=cfg.pdfMode==='single';
  // 单页模式: 页面=标签尺寸,一页一张 → 进精臣云印 app 连续打印
  // 网格模式: A4 = 210 × 297mm,多个标签摆一页 → 家用打印机+不干胶贴纸
  const pageW=isSingle?cfg.w:210;
  const pageH=isSingle?cfg.h:297;
  const margin=isSingle?0:8;
  const gap=isSingle?0:2;
  const cols=isSingle?1:Math.floor((pageW-margin*2+gap)/(cfg.w+gap));
  const rows=isSingle?1:Math.floor((pageH-margin*2+gap)/(cfg.h+gap));
  const perPage=cols*rows;

  const{jsPDF}=window.jspdf;
  // 单页模式: 显式指定 orientation,否则 jsPDF 默认 portrait 把宽高反转,barcode 会侧着印
  const orientation=isSingle&&cfg.w>cfg.h?'landscape':'portrait';
  const pdf=new jsPDF({unit:'mm',orientation,format:isSingle?[cfg.w,cfg.h]:'a4'});

  toast('生成PDF中…');

  let chineseOK=false;
  try{
    await loadChineseFontForPDF(pdf);
    chineseOK=true;
  }catch(e){
    toast('⚠️ 中文字体加载失败,商品名将乱码');
    console.error('label font load failed',e);
  }
  const setFont=(w)=>{
    if(chineseOK)pdf.setFont('NotoSansSC','normal');
    else pdf.setFont(undefined,w||'normal');
  };

  for(let i=0;i<prods.length;i++){
    const p=prods[i];
    const pageIdx=Math.floor(i/perPage);
    const idxInPage=i%perPage;
    const row=Math.floor(idxInPage/cols);
    const col=idxInPage%cols;
    const x=margin+col*(cfg.w+gap);
    const y=margin+row*(cfg.h+gap);
    
    if(idxInPage===0&&pageIdx>0){
      if(isSingle)pdf.addPage([cfg.w,cfg.h],orientation);
      else pdf.addPage();
    }

    // 标签外框(虚线)— 仅 A4 网格模式需要给用户裁剪定位用,精臣单页 PDF 不需要
    if(!isSingle){
      pdf.setDrawColor(200);
      pdf.setLineDashPattern([1,1],0);
      pdf.rect(x,y,cfg.w,cfg.h);
      pdf.setLineDashPattern([],0);
    }
    
    const pad=2;
    let cy=y+pad+cfg.nameSize*0.4;

    // 价格文本 + 宽度先算出来,后面布局决策要用
    let priceTxt='';
    let priceW=0;
    if(cfg.showPrice&&p.price){
      pdf.setFontSize(cfg.priceSize);
      setFont('bold');
      const pCur=p.currency||'CNY';
      priceTxt=cfg.labelCurrency
        ? fmtPrice(p.price,cfg.labelCurrency,pCur)
        : fmtPriceRaw(p.price,pCur);
      priceW=pdf.getTextWidth(priceTxt);
    }

    // F型对折标签:上下分区,上半 barcode/SKU(对折后变背面),下半 名+价(正面)
    // bars 用满下半的 22×9mm,模块比 tiny 宽近 2 倍 → 扫描稳
    if(cfg.fold){
      const halfH=cfg.h/2;
      const fpad=1.5;
      // 上半 (y+0 → y+halfH): barcode + SKU 文字
      {
        const code=getBarcodeContent(p);
        const bcW=cfg.w-fpad*2;
        const bcH=halfH-fpad*2-2; // 留 2mm 给 SKU 文字
        const ok=drawBarcodeVector(pdf,code,x+fpad,y+fpad,bcW,bcH);
        if(!ok){
          const bc=makeBarcodeDataURL(code,cfg);
          if(bc)pdf.addImage(bc,'PNG',x+fpad,y+fpad,bcW,bcH);
        }
        pdf.setFontSize(cfg.subSize*0.9);
        setFont('normal');
        pdf.setTextColor(50);
        pdf.text(p.sku||p.id,x+cfg.w/2,y+halfH-fpad*0.3,{align:'center'});
      }
      // 下半 (y+halfH → y+h): 名+价 (对折后是正面)
      {
        const bot=y+halfH;
        let bcy=bot+fpad+cfg.nameSize*0.4;
        if(cfg.showName&&p.name){
          pdf.setFontSize(cfg.nameSize);
          setFont('bold');
          pdf.setTextColor(0);
          const nameLines=pdf.splitTextToSize(p.name,cfg.w-fpad*2).slice(0,2);
          pdf.text(nameLines,x+cfg.w/2,bcy,{align:'center'});
          bcy+=cfg.nameSize*0.5*nameLines.length;
        }
        if(priceTxt){
          pdf.setFontSize(cfg.priceSize);
          setFont('bold');
          pdf.setTextColor(0,0,0);
          // 价格垂直居中在下半 + 名字之后剩余空间
          const remainH=(y+cfg.h-fpad)-bcy;
          const priceY=bcy+remainH/2+cfg.priceSize*0.15;
          pdf.text(priceTxt,x+cfg.w/2,priceY,{align:'center'});
        }
      }
      continue; // 跳过常规渲染
    }

    // 商品名行数预探(用 full width - priceW 试):>1 行的话价格挪到右上角,
    // 避免老布局「价格贴 barcode 上方」时被 2 行中文压字。短名仍贴 barcode 上方(美观)
    let isMultiLineName=false;
    if(cfg.showName&&p.name){
      pdf.setFontSize(cfg.nameSize);
      const probeW=cfg.w-pad*2-(priceTxt?(priceW+1):0);
      isMultiLineName=pdf.splitTextToSize(p.name,probeW).length>1;
    }
    const priceAtTop=cfg.showQR||isMultiLineName;

    // 商品名: 价格在顶部时让出右侧宽度,否则用全宽
    if(cfg.showName){
      pdf.setFontSize(cfg.nameSize);
      setFont('bold');
      pdf.setTextColor(0);
      const reservedR=(priceTxt&&priceAtTop)?priceW+1:0;
      const nameMaxW=Math.max(cfg.w*0.5,cfg.w-pad*2-reservedR);
      const nameLines=pdf.splitTextToSize(p.name,nameMaxW);
      pdf.text(nameLines.slice(0,2),x+pad,cy);
      cy+=cfg.nameSize*0.5*Math.min(nameLines.length,2);
    }

    // 产地
    if(cfg.showOrigin&&p.origin){
      pdf.setFontSize(cfg.subSize);
      setFont('normal');
      pdf.setTextColor(100);
      pdf.text(p.origin,x+pad,cy+cfg.subSize*0.4);
    }

    // 价格画出来
    if(priceTxt){
      pdf.setFontSize(cfg.priceSize);
      setFont('bold');
      pdf.setTextColor(0,0,0);
      const bcH=cfg.bcH*0.7;
      const priceY=priceAtTop
        ? y+pad+cfg.priceSize*0.4
        : y+cfg.h-pad-bcH-3-cfg.priceSize*0.15;  // 贴条形码上方,留 0.15*priceSize 间隙
      pdf.text(priceTxt,x+cfg.w-pad,priceY,{align:'right'});
    }

    // 条形码（底部）— 先尝试矢量,失败 fallback PNG
    if(cfg.showSku){
      try{
        const bcH=cfg.bcH*0.7;
        const bcW=cfg.showQR?cfg.w*0.55:cfg.w-pad*2;
        const code=getBarcodeContent(p);
        const ok=drawBarcodeVector(pdf,code,x+pad,y+cfg.h-pad-bcH-3,bcW,bcH);
        if(!ok){
          const bc=makeBarcodeDataURL(code,cfg);
          if(bc)pdf.addImage(bc,'PNG',x+pad,y+cfg.h-pad-bcH-3,bcW,bcH);
        }
        pdf.setFontSize(cfg.subSize*0.8);
        setFont('normal');
        pdf.setTextColor(50);
        pdf.text(p.sku||p.id,x+pad,y+cfg.h-pad);
      }catch(e){console.log(e);}
    }
    
    // QR码（右下）
    if(cfg.showQR){
      try{
        const qr=makeQRDataURL((p.sku||p.id)+'|'+p.name);
        if(qr){
          const qrSize=Math.min(cfg.h*0.45,cfg.w*0.35);
          pdf.addImage(qr,'PNG',x+cfg.w-pad-qrSize,y+cfg.h-pad-qrSize,qrSize,qrSize);
        }
      }catch(e){console.log(e);}
    }
  }
  
  pdf.save(`矿珍库_价格标签_${new Date().toISOString().slice(0,10)}.pdf`);
  toast(`✅ PDF已导出（${prods.length}个标签）`);
}

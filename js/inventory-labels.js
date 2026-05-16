// ===================== LABELS / 价格标签 =====================
let selectedLabelIds=new Set();

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
  el.innerHTML=prods.map(p=>`
    <div style="display:flex;align-items:center;gap:8px;padding:8px 6px;border-bottom:1px solid var(--border);">
      <span style="flex:1;min-width:0;font-size:13px;line-height:1.4;">${p.name}${p.sku?` <span style="font-size:11px;color:var(--text-muted);">${p.sku}</span>`:''}${p.price?` <span style="font-size:11px;color:var(--gold);">¥${p.price}</span>`:''}</span>
      <button class="btn btn-outline btn-sm" onclick="removeFromLabelSelection('${p.id}')" style="padding:2px 9px;font-size:13px;line-height:1;flex-shrink:0;" title="从打印列表移除">×</button>
    </div>
  `).join('');
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

function getLabelConfig(){
  const size=document.getElementById('label-size').value;
  const sizes={
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
    showQR:document.getElementById('lbl-qr').checked
  };
}

function makeBarcodeDataURL(text,cfg){
  try{
    const c=document.createElement('canvas');
    JsBarcode(c,text||'NA',{format:'CODE128',displayValue:false,width:cfg.bcW,height:cfg.bcH*3,margin:0});
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
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>价格标签预览</title>
  <style>
    body{background:#e5e5e5;padding:20px;font-family:sans-serif;}
    .label-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(${cfg.w*3}px,1fr));gap:10px;}
    .label{background:#fff;padding:8px;border:1px dashed #999;display:flex;flex-direction:column;justify-content:space-between;width:${cfg.w*3}px;height:${cfg.h*3}px;color:#000;box-sizing:border-box;}
    .lbl-name{font-size:${cfg.nameSize*1.5}px;font-weight:bold;line-height:1.2;}
    .lbl-price{font-size:${cfg.priceSize*1.8}px;font-weight:bold;color:#d4af37;text-align:right;}
    .lbl-origin{font-size:${cfg.subSize*1.5}px;color:#666;}
    .lbl-sku{font-size:${cfg.subSize*1.3}px;font-family:monospace;color:#444;}
    .lbl-barcode img{width:100%;height:${cfg.bcH*3}px;object-fit:contain;}
    .lbl-qr img{width:${cfg.h*1.5}px;height:${cfg.h*1.5}px;}
  </style></head><body>
    <h3>价格标签预览（${prods.length}个 · ${cfg.w}×${cfg.h}mm）</h3>
    <div class="label-grid">${html}</div>
  </body></html>`);
  w.document.close();
}

function renderLabelHTML(p,cfg){
  return`<div class="label">
    ${cfg.showName?`<div class="lbl-name">${p.name}</div>`:''}
    ${cfg.showPrice&&p.price?`<div class="lbl-price">¥${p.price}</div>`:''}
    ${cfg.showOrigin&&p.origin?`<div class="lbl-origin">${p.origin}</div>`:''}
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:6px;">
      <div style="flex:1;">
        ${cfg.showSku?`<div class="lbl-barcode"><img src="${makeBarcodeDataURL(p.sku||p.id,cfg)}"></div><div class="lbl-sku">${p.sku||p.id}</div>`:''}
      </div>
      ${cfg.showQR?`<div class="lbl-qr"><img src="${makeQRDataURL((p.sku||p.id)+'|'+p.name)}"></div>`:''}
    </div>
  </div>`;
}

async function exportLabelsPDF(){
  if(!selectedLabelIds.size){toast('请先选择商品');return;}
  if(!window.jspdf){toast('PDF库加载中，请稍后');return;}
  const cfg=getLabelConfig();
  const prods=DB.products.filter(p=>selectedLabelIds.has(p.id));
  
  // A4 = 210 × 297mm，2mm间距
  const pageW=210,pageH=297,margin=8,gap=2;
  const cols=Math.floor((pageW-margin*2+gap)/(cfg.w+gap));
  const rows=Math.floor((pageH-margin*2+gap)/(cfg.h+gap));
  const perPage=cols*rows;
  
  const{jsPDF}=window.jspdf;
  const pdf=new jsPDF({unit:'mm',format:'a4'});
  
  toast('生成PDF中…');
  
  for(let i=0;i<prods.length;i++){
    const p=prods[i];
    const pageIdx=Math.floor(i/perPage);
    const idxInPage=i%perPage;
    const row=Math.floor(idxInPage/cols);
    const col=idxInPage%cols;
    const x=margin+col*(cfg.w+gap);
    const y=margin+row*(cfg.h+gap);
    
    if(idxInPage===0&&pageIdx>0)pdf.addPage();
    
    // 标签外框（虚线）
    pdf.setDrawColor(200);
    pdf.setLineDashPattern([1,1],0);
    pdf.rect(x,y,cfg.w,cfg.h);
    pdf.setLineDashPattern([],0);
    
    const pad=2;
    let cy=y+pad+cfg.nameSize*0.4;
    
    // 商品名
    if(cfg.showName){
      pdf.setFontSize(cfg.nameSize);
      pdf.setFont(undefined,'bold');
      pdf.setTextColor(0);
      const nameLines=pdf.splitTextToSize(p.name,cfg.w-pad*2);
      pdf.text(nameLines.slice(0,2),x+pad,cy);
      cy+=cfg.nameSize*0.5*Math.min(nameLines.length,2);
    }
    
    // 产地
    if(cfg.showOrigin&&p.origin){
      pdf.setFontSize(cfg.subSize);
      pdf.setFont(undefined,'normal');
      pdf.setTextColor(100);
      pdf.text(p.origin,x+pad,cy+cfg.subSize*0.4);
    }
    
    // 价格（右上角，大字）
    if(cfg.showPrice&&p.price){
      pdf.setFontSize(cfg.priceSize);
      pdf.setFont(undefined,'bold');
      pdf.setTextColor(180,140,30);
      pdf.text(`¥${p.price}`,x+cfg.w-pad,y+pad+cfg.priceSize*0.4,{align:'right'});
    }
    
    // 条形码（底部）
    if(cfg.showSku){
      try{
        const bc=makeBarcodeDataURL(p.sku||p.id,cfg);
        if(bc){
          const bcH=cfg.bcH*0.7;
          const bcW=cfg.showQR?cfg.w*0.55:cfg.w-pad*2;
          pdf.addImage(bc,'PNG',x+pad,y+cfg.h-pad-bcH-3,bcW,bcH);
          pdf.setFontSize(cfg.subSize*0.8);
          pdf.setFont(undefined,'normal');
          pdf.setTextColor(50);
          pdf.text(p.sku||p.id,x+pad,y+cfg.h-pad);
        }
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

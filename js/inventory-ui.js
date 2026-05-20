// ===================== TABS =====================
function switchTab(name,el){
  // 「入出」tab → 直接打开 modal,不切 section(保留商品页 active)
  if(name==='inout'){
    if(el){
      document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
      el.classList.add('active');
      // 短暂高亮后回到原 active tab,避免 UI 失焦
      setTimeout(()=>{
        el.classList.remove('active');
        const cur=document.querySelector('.section.active');
        const tabName=cur?cur.id.replace(/^sec-/,''):'inventory';
        const back=document.querySelector(`.nav-tab[onclick*="switchTab('${tabName}'"]`);
        if(back)back.classList.add('active');
      },180);
    }
    if(typeof openStockInModal==='function')openStockInModal(null);
    return;
  }
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  const target=document.getElementById('sec-'+name);
  if(target)target.classList.add('active');
  if(el)el.classList.add('active');
  // FAB 只在流水 tab 显示
  const fab=document.getElementById('logs-fab');
  if(fab)fab.style.display=(name==='logs')?'flex':'none';
  if(name==='show'){renderShowSelects();renderShowList();}
  if(name==='stats'){renderStats();}
  if(name==='logs'){if(typeof renderLogsPage==='function')renderLogsPage();}
  if(name!=='scan')stopCamera();
}
// 旧版兼容(防其他地方误调);新流水 tab 不需要 segment 切换
function setIOMode(mode,el){
  // legacy noop:入出库已 modal 化
  if(typeof switchStockioMode==='function')switchStockioMode(mode);
}

// ===================== INVENTORY =====================
let invViewMode='grid'; // 'grid' or 'list'
let invSortMode='new';  // 'new' | 'qty' | 'price' | 'az'
function setInventoryView(mode){
  if(mode!=='grid'&&mode!=='list')return;
  invViewMode=mode;
  const grid=document.getElementById('product-grid');
  if(grid)grid.style.display='';
  // 同步 view-toggle 按钮高亮
  document.querySelectorAll('#inv-view-toggle>button[data-view]').forEach(b=>{
    if(b.dataset.view==='grid'||b.dataset.view==='list'){
      b.classList.toggle('cur',b.dataset.view===mode);
    }
  });
  renderInventory();
}
function toggleInventoryView(){
  // 兼容旧调用入口
  setInventoryView(invViewMode==='grid'?'list':'grid');
}
function setInvSort(mode,el){
  if(['new','qty','price','az'].indexOf(mode)<0)return;
  invSortMode=mode;
  const sel=document.getElementById('inv-sort-select');
  if(sel&&sel.value!==mode)sel.value=mode;
  renderInventory();
}
// 商品库存清单 CSV 导出 (mock screen-2 toolbar 📥)
function exportInventoryCSV(){
  try{
    const list=(typeof getVisibleProducts==='function')?getVisibleProducts():(DB.products||[]);
    if(!list||!list.length){toast('暂无商品可导出');return;}
    const cur=(typeof inventoryCurrency!=='undefined'?inventoryCurrency:'JPY');
    const rows=[['SKU','名称','类别','库存','单价','币种','尺寸','材质','重量','单位','产地','原产国','备注']];
    list.forEach(p=>{
      rows.push([p.sku||'',p.name||'',p.cat||'',(p.qty!=null?p.qty:''),(p.price!=null?p.price:''),(p.currency||cur),p.size||'',p.material||'',(p.weight!=null?p.weight:''),p.unit||'',p.origin||'',p.country||'',(p.note||'').replace(/[\r\n]+/g,' ')]);
    });
    const csv='﻿'+rows.map(r=>r.map(c=>{
      const s=String(c==null?'':c);
      return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
    }).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const dt=new Date().toISOString().slice(0,10);
    a.href=url;a.download='库存清单_'+dt+'.csv';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('✓ 已导出 '+(rows.length-1)+' 行');
  }catch(e){toast('导出失败: '+e.message);}
}
function quickScan(){
  // nav 已无 scan tab(2026-05-19),直接切到 sec-scan section 并启动相机
  const target=document.getElementById('sec-scan');
  if(target){
    document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
    target.classList.add('active');
    // nav 高亮短暂回到 inventory(给视觉反馈)
    const fab=document.getElementById('logs-fab');
    if(fab)fab.style.display='none';
  }else{
    // 兜底:section 不存在则提示
    if(typeof toast==='function')toast('扫码界面未就绪');
    return;
  }
  if(typeof startCamera==='function')setTimeout(startCamera,80);
}

function getVisibleProducts(){
  const q=(document.getElementById('inv-search')?.value||'').toLowerCase();
  const list=DB.products.filter(p=>{
    if(catFilter!=='all'&&(p.cat||'未分类')!==catFilter)return false;
    if(q&&!p.name.toLowerCase().includes(q)&&!(p.sku||'').toLowerCase().includes(q)&&!(p.cat||'').toLowerCase().includes(q))return false;
    return true;
  });
  // 排序
  const showOutMap={};
  if(invSortMode==='qty'){
    DB.showItems.forEach(s=>{showOutMap[s.productId]=(showOutMap[s.productId]||0)+s.qty;});
  }
  switch(invSortMode){
    case 'qty':
      return list.slice().sort((a,b)=>((b.qty-(showOutMap[b.id]||0))-(a.qty-(showOutMap[a.id]||0))));
    case 'price':
      return list.slice().sort((a,b)=>(+b.price||0)-(+a.price||0));
    case 'az':
      return list.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','zh'));
    case 'new':
    default:
      return list.slice().sort((a,b)=>{
        const ta=a.createdAt||a.created_at||0,tb=b.createdAt||b.created_at||0;
        return (tb>ta?1:tb<ta?-1:0);
      });
  }
}
function renderInventory(){
  const grid=document.getElementById('product-grid');
  const showOutMap={};
  DB.showItems.forEach(s=>{showOutMap[s.productId]=(showOutMap[s.productId]||0)+s.qty;});
  let prods=getVisibleProducts();
  if(!prods.length){
    grid.className='product-grid';
    grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div style="font-size:40px;margin-bottom:12px;">${DB.products.length?'🔍':'💎'}</div><div style="margin-bottom:14px;font-size:14px;">${DB.products.length?'没有符合的商品':'还没有商品，开始建品吧'}</div><button class="btn btn-gold" onclick="openAddModal()">＋ 建品</button></div>`;
    updateHeader();return;
  }

  if(invViewMode==='list'){
    // 列表视图 — mock screen-2 .inv-row 行式卡片(E PR #41)
    grid.className='inv-list';
    grid.innerHTML=prods.map(p=>{
      const showOut=showOutMap[p.id]||0;
      const avail=p.qty-showOut;
      const qc=avail<=0?'out':avail<3?'low':'';
      const tn=p.thumbnail||(p.photos&&p.photos[0]);
      const thumb=tn
        ?`<img src="${tn}" loading="lazy" alt="" onmouseenter="showZoomPreview(this,'${p.id}')" onmouseleave="hideZoomPreview()">`
        :`<span class="emo">${catEmoji(p.cat)}</span>`;
      const isSel=selectedLabelIds.has(p.id);
      const availText=avail<=0?'缺货':('可用 '+avail);
      return`<div class="inv-row${isSel?' selected':''}" onclick="openDetail('${p.id}')">
        <input type="checkbox" class="inv-row-sel" ${isSel?'checked':''} onclick="event.stopPropagation()" onchange="toggleCardSelect('${p.id}')">
        <div class="inv-row-thumb">${thumb}</div>
        <div class="inv-row-body">
          <div class="inv-row-name">${p.name}</div>
          <div class="inv-row-meta">
            <span class="inv-row-cat">${p.cat||'未分类'}</span>
            <span class="inv-row-price">${fmtPrice(p.price,inventoryCurrency,p.currency||'CNY')}</span>
            <span>${p.sku||'—'}</span>
          </div>
        </div>
        <div class="inv-row-right">
          <div class="inv-row-qty ${qc}">${avail}</div>
          <div class="inv-row-avail">${availText}</div>
        </div>
        <div class="inv-row-actions" onclick="event.stopPropagation()">
          <button class="inv-row-act in" title="入库" onclick="openStockInModal('${p.id}')">⬆</button>
          <button class="inv-row-act out" title="出库" onclick="openStockOutModal('${p.id}')">⬇</button>
        </div>
      </div>`;
    }).join('');
  } else {
    // 卡片视图
    grid.className='product-grid';
    grid.innerHTML=prods.map(p=>{
      const showOut=showOutMap[p.id]||0;
      const avail=p.qty-showOut;
      const qc=avail<=0?' zero':avail<3?' low':'';
      const tn=p.thumbnail||(p.photos&&p.photos[0]);
      const thumb=tn?`<div class="product-thumb"><img src="${tn}" loading="lazy" class="zoomable" onmouseenter="showZoomPreview(this,'${p.id}')" onmouseleave="hideZoomPreview()"></div>`:`<div class="product-thumb">${catEmoji(p.cat)}</div>`;
      const isSel=selectedLabelIds.has(p.id);
      const priceTxt=(p.price!=null&&p.price!=='')?fmtPrice(p.price,inventoryCurrency,p.currency||'CNY'):'';
      return`<div class="product-card${isSel?' selected':''}" onclick="openDetail('${p.id}')">${thumb}<div class="category-badge">${p.cat||'未分类'}</div><div class="product-qty${qc}">${avail}</div><div class="card-select" onclick="event.stopPropagation();toggleCardSelect('${p.id}')" title="选择打印标签">${isSel?'✓':''}</div><div class="product-info"><div class="product-name">${p.name}</div>${priceTxt?`<div class="product-price">${priceTxt}</div>`:''}<div class="product-sku">${p.sku||'—'}</div></div></div>`;
    }).join('');
  }
  updateHeader();renderCatFilters();updateLabelButtonCount();
}

function toggleCardSelect(id){
  if(selectedLabelIds.has(id))selectedLabelIds.delete(id);else selectedLabelIds.add(id);
  renderInventory();
}

function toggleSelectAllVisible(){
  const visible=getVisibleProducts();
  if(!visible.length){toast('当前没有可选的商品');return;}
  const allSelected=visible.every(p=>selectedLabelIds.has(p.id));
  if(allSelected)visible.forEach(p=>selectedLabelIds.delete(p.id));
  else visible.forEach(p=>selectedLabelIds.add(p.id));
  renderInventory();
}
function updateLabelButtonCount(){
  const btn=document.getElementById('label-print-btn');
  if(!btn)return;
  const visible=getVisibleProducts();
  const n=visible.filter(p=>selectedLabelIds.has(p.id)).length;
  btn.textContent=n>0?`🏷️ 标签打印 (${n})`:'🏷️ 标签打印';
  const cb=document.getElementById('select-all-cb');
  if(cb){
    if(visible.length===0){cb.checked=false;cb.indeterminate=false;}
    else if(n===visible.length){cb.checked=true;cb.indeterminate=false;}
    else if(n>0){cb.checked=false;cb.indeterminate=true;}
    else{cb.checked=false;cb.indeterminate=false;}
  }
  const lbl=document.getElementById('select-all-label');
  if(lbl){
    lbl.textContent=visible.length?`全选 (${n}/${visible.length})`:'全选';
  }
}
function renderCatFilters(){
  const cats=allCats();
  const dl=document.getElementById('cat-list');
  if(dl)dl.innerHTML=cats.map(c=>`<option value="${c}">`).join('');
  const sel=document.getElementById('cat-filter-select');
  if(!sel)return;
  sel.innerHTML='<option value="all">全部</option>'+cats.map(c=>`<option value="${c}">${c}</option>`).join('');
  sel.value=catFilter;
}
function setCatFilter(cat){catFilter=cat;renderInventory();}
function updateHeader(){
  const totalQty=DB.products.reduce((a,p)=>a+p.qty,0);
  const showQty=DB.showItems.reduce((a,s)=>a+s.qty,0);
  document.getElementById('hdr-total').textContent=DB.products.length;
  document.getElementById('hdr-qty').textContent=totalQty;
  document.getElementById('hdr-show').textContent=showQty;
  // 库存主页概览(mock screen-2 顶部统计)
  const ovQty=document.getElementById('inv-ov-qty');
  const ovKinds=document.getElementById('inv-ov-kinds');
  const ovTotal=document.getElementById('inv-ov-total');
  if(ovQty)ovQty.textContent=totalQty;
  if(ovKinds)ovKinds.textContent=DB.products.length;
  if(ovTotal){
    try{
      const cur=(typeof inventoryCurrency!=='undefined'&&inventoryCurrency)||'JPY';
      let sum=0;
      DB.products.forEach(p=>{
        const price=+p.price||0;
        const from=p.currency||'CNY';
        if(typeof convertCurrency==='function')sum+=convertCurrency(price,from,cur)*(p.qty||0);
        else sum+=price*(p.qty||0);
      });
      ovTotal.textContent=(typeof fmtPrice==='function')?fmtPrice(sum,cur,cur):(cur+' '+Math.round(sum));
    }catch(e){ovTotal.textContent='—';}
  }
}

// ===================== 建品 =====================
function openAddModal(prefill){
  editingId=null;pendingPhotos=[];
  document.getElementById('modal-add-title').textContent='新建商品档案';
  ['f-name','f-sku','f-cat','f-price','f-origin','f-country','f-note','f-size','f-material','f-weight','f-unit'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('f-rec-hint').innerHTML='';
  document.getElementById('photo-previews').innerHTML='';
  // 重置类别 6 宫格(默认本位币 + 没有选中)
  _resetCatGrid();
  // 币种 select 默认跟随全局 inventoryCurrency
  const cs=document.getElementById('f-currency-sel');
  if(cs){cs.value=(typeof inventoryCurrency!=='undefined'?inventoryCurrency:'JPY');onAddCurrencyChange(cs.value);}
  if(prefill){
    ['name','cat','note','origin','country'].forEach(k=>{if(prefill[k])document.getElementById('f-'+k).value=prefill[k];});
    if(prefill.cat)_syncCatGrid(prefill.cat);
  }
  // 新建模式:隐藏「删除此商品」入口
  const dz=document.getElementById('modal-edit-danger');
  if(dz)dz.style.display='none';
  // 新建模式:恢复「登录+入库」按钮
  const btnStockIn=document.getElementById('btn-save-stockin');
  if(btnStockIn)btnStockIn.style.display='';
  document.getElementById('modal-add').classList.add('open');
}
function _resetCatGrid(){
  const sel=document.getElementById('f-cat-sel');
  if(sel)sel.value='';
  const txt=document.getElementById('f-cat');
  if(txt)txt.value='';
}
function _syncCatGrid(catText){
  const sel=document.getElementById('f-cat-sel');
  const txt=document.getElementById('f-cat');
  if(!catText){if(sel)sel.value='';if(txt)txt.value='';return;}
  const t=String(catText).trim();
  // 内置选项命中 → select 选中,否则 「其他(自定义)」+ 填入 text
  const builtin=['陨石','首饰','矿物','葫芦','化石'];
  const hit=builtin.find(k=>t.indexOf(k)>=0);
  if(sel){sel.value=hit?hit:'__other__';}
  if(txt){txt.value=t;}
}
// select 选择类别 → 同步到 f-cat text(给 saveProductMain 读)
function onAddCatSel(val){
  const txt=document.getElementById('f-cat');
  if(!txt)return;
  if(val==='__other__'){txt.value='';txt.focus();}
  else if(val){txt.value=val;}
  else{txt.value='';}
}
// 兼容旧调用(如果有外部代码调 setAddCat)
function setAddCat(cat){
  const sel=document.getElementById('f-cat-sel');
  const txt=document.getElementById('f-cat');
  const builtin=['陨石','首饰','矿物','葫芦','化石'];
  if(sel)sel.value=builtin.indexOf(cat)>=0?cat:'__other__';
  if(txt)txt.value=cat;
}
function autoGenSku(){
  const selV=document.getElementById('f-cat-sel')?.value||'';
  const txtV=document.getElementById('f-cat')?.value.trim()||'';
  const cur=(selV&&selV!=='__other__')?selV:(txtV||'其他');
  const map={陨石:'MET',首饰:'JEW',矿物:'MIN',葫芦:'HLO',化石:'FOS',其他:'OTH'};
  let code='OTH';
  Object.keys(map).forEach(k=>{if(cur.indexOf(k)>=0)code=map[k];});
  const prefix=`MZ-${code}-`;
  let maxN=0;
  (DB.products||[]).forEach(p=>{
    const s=p.sku||'';
    if(s.indexOf(prefix)===0){
      const n=parseInt(s.slice(prefix.length),10);
      if(!isNaN(n)&&n>maxN)maxN=n;
    }
  });
  const num=String(maxN+1).padStart(6,'0');
  document.getElementById('f-sku').value=`${prefix}${num}`;
  if(typeof toast==='function')toast('⚡ 已生成 SKU');
}
function onAddCurrencyChange(cur){
  // 同步 label
  const lab=document.getElementById('f-currency-label');
  if(lab)lab.textContent=cur||'JPY';
}
function openEditModal(id){
  const p=getProduct(id);if(!p)return;
  editingId=id;pendingPhotos=[...(p.photos||[])];
  document.getElementById('modal-add-title').textContent='编辑商品';
  document.getElementById('f-name').value=p.name||'';
  document.getElementById('f-sku').value=p.sku||'';
  document.getElementById('f-cat').value=p.cat||'';
  // 推荐价(JPY):平均(进价换算JPY)×3
  const _jpy=DB.logs.filter(l=>l.productId===id&&l.type==='in'&&parseFloat(l.price)>0)
    .map(l=>convertCurrency(l.price,l.currency||'CNY','JPY')).filter(v=>!isNaN(v));
  const _rec=_jpy.length?Math.round(_jpy.reduce((a,b)=>a+b,0)/_jpy.length*3):0;
  // 价格统一以 JPY 显示/录入(本位币)
  if(p.price){
    document.getElementById('f-price').value=p.price;
  }else{
    document.getElementById('f-price').value=_rec?String(_rec):'';
  }
  // 推荐价 hint(按当前显示币种换算)
  const hint=document.getElementById('f-rec-hint');
  if(_rec){
    const recDisp=fmtPrice(_rec,inventoryCurrency,'JPY');
    hint.innerHTML=`推荐 ${recDisp} <a href="#" onclick="event.preventDefault();document.getElementById('f-price').value='${_rec}';" style="color:var(--gold);text-decoration:underline;">使用</a>`;
  }else{hint.innerHTML='';}
  document.getElementById('f-origin').value=p.origin||'';
  document.getElementById('f-country').value=p.country||'';
  document.getElementById('f-note').value=p.note||'';
  // 新字段(2026-05-20)
  const _set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||'';};
  _set('f-size',p.size);
  _set('f-material',p.material);
  _set('f-weight',(p.weight!==undefined&&p.weight!==null)?p.weight:'');
  _set('f-unit',p.unit);
  // 同步类别 6 宫格(根据 cat 文本匹配)
  _syncCatGrid(p.cat||'');
  // 币种 select 跟随商品(本位币改造后实际固定 JPY,但展示用 inventoryCurrency)
  const cs=document.getElementById('f-currency-sel');
  if(cs){cs.value=p.currency||(typeof inventoryCurrency!=='undefined'?inventoryCurrency:'JPY');onAddCurrencyChange(cs.value);}
  renderPhotoPreviews();closeModal('modal-detail');
  // 编辑模式:显示「删除此商品」入口
  const dz=document.getElementById('modal-edit-danger');
  if(dz)dz.style.display='';
  // 编辑模式:隐藏「登录+入库」(无意义)
  const btnStockIn=document.getElementById('btn-save-stockin');
  if(btnStockIn)btnStockIn.style.display='none';
  document.getElementById('modal-add').classList.add('open');
}
function openAddThenStockIn(){openAddModal();document.getElementById('modal-add').dataset.stockin='1';}
// 编辑 modal 内删除 (移自详情底部 2026-05-19)
async function deleteFromEdit(){
  if(!editingId){toast('未在编辑模式');return;}
  const p=getProduct(editingId);
  const name=p?p.name:'此商品';
  const eid=editingId;
  mzConfirm({
    title:'删除商品?',
    message:`将永久删除「${name}」及其所有入出库/展会记录,此操作不可撤销。`,
    okText:'确认删除',
    okClass:'btn-rose',
    icon:'🗑',
    onOk:async()=>{
      DB.products=DB.products.filter(p=>p.id!==eid);
      DB.logs=DB.logs.filter(l=>l.productId!==eid);
      DB.showItems=DB.showItems.filter(s=>s.productId!==eid);
      try{await deleteProduct(eid);}catch(e){console.warn('deleteProduct failed',e);}
      closeModal('modal-add');renderInventory();
      if(typeof updateHeader==='function')updateHeader();
      toast('已删除');
    }
  });
}
async function handlePhotos(e){
  const files=[...e.target.files],rem=5-pendingPhotos.length;
  if(rem<=0){toast('最多5张');return;}
  for(const f of files.slice(0,rem))pendingPhotos.push(await compressImage(f));
  renderPhotoPreviews();e.target.value='';
}
function renderPhotoPreviews(){
  document.getElementById('photo-previews').innerHTML=pendingPhotos.map((s,i)=>`<div class="photo-preview-item"><img src="${s}"><button class="photo-remove" onclick="removePhoto(${i})">✕</button></div>`).join('');
}
function removePhoto(i){pendingPhotos.splice(i,1);renderPhotoPreviews();}
function buildProduct(){
  const name=document.getElementById('f-name').value.trim();
  if(!name){toast('请填写商品名称');return null;}
  const sku=document.getElementById('f-sku').value.trim()||('MZ-'+uid().toUpperCase().slice(0,6));
  const id=editingId||uid();
  // 本位币改造:price 统一存 JPY。如果用户在币种 select 选了非 JPY 输入,这里换算
  let priceTxt=document.getElementById('f-price').value.trim();
  const selCur=document.getElementById('f-currency-sel')?.value||'JPY';
  if(priceTxt&&selCur!=='JPY'){
    const num=parseFloat(priceTxt);
    if(!isNaN(num)&&typeof getFxRate==='function'){
      const rate=getFxRate(selCur,'JPY');
      if(rate)priceTxt=String(Math.round(num*rate));
    }
  }
  // 新字段(2026-05-20)
  const _val=id=>document.getElementById(id)?.value?.trim()||'';
  const weightStr=_val('f-weight');
  return{
    id,name,sku,
    cat:document.getElementById('f-cat').value.trim(),
    price:priceTxt,currency:'JPY',
    origin:_val('f-origin'),
    country:_val('f-country'),
    note:_val('f-note'),
    size:_val('f-size')||null,
    material:_val('f-material')||null,
    unit:_val('f-unit')||null,
    weight:weightStr?parseFloat(weightStr):null,
    photos:[...pendingPhotos],
    qty:editingId?(getProduct(editingId).qty||0):0,
    createdAt:editingId?(getProduct(editingId).createdAt||Date.now()):Date.now()
  };
}
async function saveProductOnly(){
  const btn=document.getElementById('btn-save-only');
  if(btn)btn.disabled=true;
  const data=buildProduct();
  if(!data){if(btn)btn.disabled=false;return;}
  // 重复名称检查
  if(!editingId){
    const dup=DB.products.find(p=>p.name.trim()===data.name.trim());
    if(dup){
      toast(`⚠️ "${dup.name}" 已存在！正在打开已有商品，如需新建请修改名称`,5000);
      if(btn)btn.disabled=false;
      closeModal('modal-add');
      setTimeout(()=>openDetail(dup.id),600);
      return;
    }
  }
  if(editingId){
    const idx=DB.products.findIndex(p=>p.id===editingId);
    if(idx>=0)DB.products[idx]=data;
    toast('✅ 已更新');
  }else{
    DB.products.unshift(data);
    toast('✅ 商品登录完成（库存0）');
  }
  await upsertProduct(data);
  closeModal('modal-add');renderInventory();
}
async function saveProductAndStockIn(){
  if(editingId){saveProductOnly();return;}
  const btn=document.getElementById('btn-save-stockin');
  if(btn)btn.disabled=true;
  const data=buildProduct();
  if(!data){if(btn)btn.disabled=false;return;}
  // 重复名称检查
  const dup=DB.products.find(p=>p.name.trim()===data.name.trim());
  if(dup){
    toast(`⚠️ "${dup.name}" 已存在！正在打开已有商品，如需新建请修改名称`,5000);
    if(btn)btn.disabled=false;
    closeModal('modal-add');
    setTimeout(()=>openDetail(dup.id),600);
    return;
  }
  DB.products.unshift(data);
  await upsertProduct(data);
  closeModal('modal-add');renderInventory();
  setTimeout(()=>openStockInModal(data.id),200);
}

// ===================== 入库 / 出库(合并 modal) =====================
let stockioMode='in'; // 'in' 或 'out'

function openStockInModal(preId){
  stockioMode='in';
  _renderStockioModal(preId);
}
function openStockOutModal(preId){
  stockioMode='out';
  _renderStockioModal(preId);
}

function _renderStockioModal(preId){
  const sel=document.getElementById('si-product');
  if(stockioMode==='out'){
    sel.innerHTML=DB.products.map(p=>`<option value="${p.id}" ${p.id===preId?'selected':''}>${p.name}（库存:${p.qty}）</option>`).join('');
  }else{
    sel.innerHTML=DB.products.map(p=>`<option value="${p.id}" ${p.id===preId?'selected':''}>${p.name} 现库存:${p.qty}</option>`).join('');
  }
  if(!sel.innerHTML){toast('请先建品');return;}
  document.getElementById('si-qty').value=1;
  document.getElementById('si-price').value='';
  document.getElementById('si-currency').value='JPY';
  initPriceCurrency('si-currency');
  document.getElementById('si-note').value='';
  const cpEl=document.getElementById('si-counterparty');if(cpEl)cpEl.value='';
  // prefill size/material/weight/unit 从当前商品(2026-05-20)
  const _prefP=preId?getProduct(preId):null;
  const sSize=document.getElementById('si-size');if(sSize)sSize.value=_prefP?.size||'';
  const sMat=document.getElementById('si-material');if(sMat)sMat.value=_prefP?.material||'';
  const sW=document.getElementById('si-weight');if(sW)sW.value=(_prefP&&_prefP.weight!=null)?_prefP.weight:'';
  const sU=document.getElementById('si-unit');if(sU)sU.value=_prefP?.unit||'';
  // 出库默认带入商品售价
  if(stockioMode==='out'&&preId){
    const p=getProduct(preId);
    if(p){
      document.getElementById('si-price').value=p.price||'';
      document.getElementById('si-currency').value=p.currency||'JPY';
    }
  }
  _applyStockioMode();
  updateStockInInfo();
  document.getElementById('modal-stockin').classList.add('open');
}

function switchStockioMode(mode){
  stockioMode=(mode==='out')?'out':'in';
  // 重建 select 列表(出库展示库存量)
  const preId=document.getElementById('si-product').value;
  _renderStockioModal(preId);
}

function _applyStockioMode(){
  const tabs=document.querySelectorAll('#modal-stockin .sio-tab');
  tabs.forEach(t=>t.classList.remove('cur','in','out'));
  if(stockioMode==='in'){
    const t=document.querySelector('#modal-stockin .sio-tab[data-mode="in"]');if(t)t.classList.add('cur','in');
    document.getElementById('modal-stockin-title').textContent='⬆️ 入库';
    document.getElementById('si-qty-label').textContent='入库数量';
    document.getElementById('si-price-label').textContent='本次进价';
    document.getElementById('si-counterparty-label').textContent='进货商';
    document.getElementById('si-counterparty').placeholder='供应商名称（可选）';
    document.getElementById('si-note').placeholder='批次/产地（可选）';
    document.getElementById('sio-preview-label').textContent='本 次 入 库';
    const btn=document.getElementById('sio-confirm-btn');
    btn.textContent='✓ 确认入库';
    btn.className='btn btn-jade sio-confirm-big';
  }else{
    const t=document.querySelector('#modal-stockin .sio-tab[data-mode="out"]');if(t)t.classList.add('cur','out');
    document.getElementById('modal-stockin-title').textContent='⬇️ 出库';
    document.getElementById('si-qty-label').textContent='出库数量';
    document.getElementById('si-price-label').textContent='本次售价（可选）';
    document.getElementById('si-counterparty-label').textContent='客户/出库商';
    document.getElementById('si-counterparty').placeholder='客户名称（可选）';
    document.getElementById('si-note').placeholder='原因/渠道（可选）';
    document.getElementById('sio-preview-label').textContent='本 次 出 库';
    const btn=document.getElementById('sio-confirm-btn');
    btn.textContent='✓ 确认出库';
    btn.className='btn btn-gold sio-confirm-big';
  }
  renderStockioPreview();
}

function adjustStockioQty(delta){
  const el=document.getElementById('si-qty');if(!el)return;
  const cur=parseInt(el.value)||0;
  const next=Math.max(1,cur+delta);
  el.value=next;
  renderStockioPreview();
}

function renderStockioPreview(){
  const qty=parseInt(document.getElementById('si-qty')?.value)||0;
  const price=parseFloat(document.getElementById('si-price')?.value)||0;
  const cur=document.getElementById('si-currency')?.value||'JPY';
  const sym=(typeof CURRENCY_SYMBOL!=='undefined'&&CURRENCY_SYMBOL[cur])||'¥';
  const sub=qty*price;
  const valEl=document.getElementById('sio-preview-val');if(!valEl)return;
  const cls=stockioMode==='in'?'plus':'minus';
  const sign=stockioMode==='in'?'+':'−';
  valEl.innerHTML=`<span class="${cls}">${sign}${qty} 件</span>${sub>0?` · ${sym}${sub.toLocaleString()}`:''}`;
}

function updateStockInInfo(){
  const p=getProduct(document.getElementById('si-product').value);
  if(p&&stockioMode==='in'){
    const sSize=document.getElementById('si-size');if(sSize)sSize.value=p.size||'';
    const sMat=document.getElementById('si-material');if(sMat)sMat.value=p.material||'';
    const sW=document.getElementById('si-weight');if(sW)sW.value=(p.weight!=null)?p.weight:'';
    const sU=document.getElementById('si-unit');if(sU)sU.value=p.unit||'';
  }
  const el=document.getElementById('si-current-info');
  if(p){el.style.display='block';el.textContent=`当前库存 ${p.qty} 件${p.price?' · 价格：'+fmtPriceRaw(p.price,p.currency||'CNY'):''}`;}
  else el.style.display='none';
  // 商品预览卡(screen-4 .s4-product 风格)
  const card=document.getElementById('sio-product-card');
  if(card){
    if(p){
      card.style.display='flex';
      const thumb=document.getElementById('sio-product-thumb');
      const thumbSrc=p.thumbnail||(p.photos&&p.photos[0])||'';
      if(thumb)thumb.innerHTML=thumbSrc?`<img src="${thumbSrc}" alt="">`:'💎';
      const nameEl=document.getElementById('sio-product-name');
      if(nameEl)nameEl.textContent=p.name||'—';
      const metaEl=document.getElementById('sio-product-meta');
      if(metaEl){
        const priceTxt=p.price?(' · '+(typeof fmtPriceRaw==='function'?fmtPriceRaw(p.price,p.currency||'JPY'):p.price)):'';
        metaEl.textContent=(p.sku||'—')+priceTxt;
      }
      const stockEl=document.getElementById('sio-product-stock');
      if(stockEl)stockEl.textContent=String(p.qty||0);
    }else{
      card.style.display='none';
    }
  }
  renderStockioPreview();
}

async function doStockIo(){
  if(stockioMode==='out'){return doStockOut();}
  return doStockIn();
}

async function doStockIn(){
  const pid=document.getElementById('si-product').value;
  const qty=parseInt(document.getElementById('si-qty').value)||0;
  const note=document.getElementById('si-note').value.trim();
  const price=document.getElementById('si-price').value.trim();
  const currency=document.getElementById('si-currency').value||'CNY';
  const counterparty=document.getElementById('si-counterparty')?.value.trim()||null;
  if(!pid){toast('请选择商品');return;}
  if(qty<=0){toast('数量需大于0');return;}
  const p=getProduct(pid);
  p.qty+=qty;
  // 边入库边补 size/material/weight/unit 到 products(2026-05-20)
  const _siSize=document.getElementById('si-size')?.value.trim();
  const _siMat=document.getElementById('si-material')?.value.trim();
  const _siW=document.getElementById('si-weight')?.value.trim();
  const _siU=document.getElementById('si-unit')?.value||'';
  if(_siSize)p.size=_siSize;
  if(_siMat)p.material=_siMat;
  if(_siW!==''&&_siW!=null)p.weight=parseFloat(_siW);
  if(_siU)p.unit=_siU;
  const fxRate=(typeof getFxRate==='function')?getFxRate(currency,'JPY'):null;
  const basePrice=(price&&fxRate)?Math.round(parseFloat(price)*fxRate):null;
  const log={
    id:uid(),productId:pid,type:'in',qty,note,
    originalPrice:price,
    originalCurrency:currency,
    basePrice:basePrice,
    baseCurrency:'JPY',
    fxRate:fxRate,
    price:price,
    currency:currency,
    counterparty,ts:Date.now()
  };
  DB.logs.unshift(log);
  await Promise.all([upsertProduct(p),insertLog(log)]);
  closeModal('modal-stockin');renderInventory();
  if(typeof renderLogsPage==='function')renderLogsPage();
  toast(`✅ 入库 ${qty} 件，当前库存 ${p.qty} 件`);
}

async function doStockOut(){
  const pid=document.getElementById('si-product').value;
  const qty=parseInt(document.getElementById('si-qty').value)||0;
  const note=document.getElementById('si-note').value.trim();
  const price=document.getElementById('si-price').value.trim();
  const currency=document.getElementById('si-currency').value||'JPY';
  const counterparty=document.getElementById('si-counterparty')?.value.trim()||null;
  if(!pid){toast('请选择商品');return;}
  if(qty<=0){toast('数量需大于0');return;}
  const p=getProduct(pid);
  if(p.qty<qty){toast(`库存不足（当前${p.qty}件）`);return;}
  p.qty-=qty;
  const fxRate=(typeof getFxRate==='function')?getFxRate(currency,'JPY'):null;
  const basePrice=(price&&fxRate)?Math.round(parseFloat(price)*fxRate):null;
  const log={
    id:uid(),productId:pid,type:'out',qty,note,
    originalPrice:price||null,
    originalCurrency:currency,
    basePrice:basePrice,
    baseCurrency:'JPY',
    fxRate:fxRate,
    price:price||null,
    currency,
    counterparty,ts:Date.now()
  };
  DB.logs.unshift(log);
  await Promise.all([upsertProduct(p),insertLog(log)]);
  closeModal('modal-stockin');renderInventory();
  if(typeof renderLogsPage==='function')renderLogsPage();
  toast(`✅ 出库 ${qty} 件`);
}

// 旧版兼容
function renderOutSelects(){/* legacy noop */}
async function doOut(){return doStockOut();}

function toggleDateFilter(type){
  const panel=document.getElementById(type+'-log-date-panel');
  const btn=document.getElementById(type+'-log-date-btn');
  if(panel.style.display==='none'||!panel.style.display){
    panel.style.display='flex';
    btn.style.background='var(--gold-dim)';
    btn.style.color='var(--gold)';
  }else{
    panel.style.display='none';
    btn.style.background='';
    btn.style.color='';
    document.getElementById(type+'-log-date-from').value='';
    document.getElementById(type+'-log-date-to').value='';
    if(type==='in')renderInLogs();else renderOutLogs();
  }
}
// ===================== 商品详情 =====================
async function _loadPhotos(p){
  if(p.photos!==undefined)return;
  try{
    const{data}=await sb.from('products').select('photos').eq('id',p.id).single();
    p.photos=data?.photos||[];
  }catch{p.photos=[];}
}
async function openDetail(id){
  const p=getProduct(id);if(!p)return;
  detailId=id;
  document.getElementById('detail-title').textContent='商 品 详 情';
  // 确保该商品的 logs 已加载(DB.logs 默认空,只在流水 tab 才填充)
  try{
    const{data}=await sb.from('logs').select('*').eq('product_id',id).order('ts',{ascending:false});
    if(data){
      const existIds=new Set(DB.logs.map(l=>l.id));
      data.forEach(r=>{if(!existIds.has(r.id))DB.logs.push(dbToLog(r));});
    }
  }catch(e){}
  const showOut=DB.showItems.filter(s=>s.productId===id).reduce((a,s)=>a+s.qty,0);
  const avail=p.qty-showOut;
  const allLogs=DB.logs.filter(l=>l.productId===id);
  const logs=allLogs.slice(0,3);
  const totalLogs=allLogs.length;
  const lastOut=allLogs.find(l=>l.type==='out'&&l.price);
  // 累计入库/售出统计
  const totalIn=allLogs.filter(l=>l.type==='in').reduce((a,l)=>a+(parseInt(l.qty)||0),0);
  const totalOut=allLogs.filter(l=>l.type==='out').reduce((a,l)=>a+(parseInt(l.qty)||0),0);
  // 销售额(按当前 inventoryCurrency 汇总)
  const salesTotal=allLogs.filter(l=>l.type==='out'&&parseFloat(l.price)>0)
    .reduce((a,l)=>a+convertCurrency(parseFloat(l.price)*(parseInt(l.qty)||0),l.currency||'CNY',inventoryCurrency),0);
  // 平均进价(JPY) → 推荐价(JPY) → ×3
  const inJpyPrices=allLogs.filter(l=>l.type==='in'&&parseFloat(l.price)>0)
    .map(l=>convertCurrency(l.price,l.currency||'CNY','JPY'))
    .filter(v=>!isNaN(v));
  const avgInJPY=inJpyPrices.length?inJpyPrices.reduce((a,b)=>a+b,0)/inJpyPrices.length:0;
  const recPriceJPY=avgInJPY?Math.round(avgInJPY*3):0;
  // 毛利(售出 - 累计进价匹配)按当前 ccy
  const inCostInCur=avgInJPY?convertCurrency(avgInJPY,'JPY',inventoryCurrency):0;
  const grossProfit=salesTotal-inCostInCur*totalOut;
  // 毛利率/加价率(基于售价 vs 平均进价,都换算 JPY 后算)
  const priceJPY=convertCurrency(parseFloat(p.price)||0,p.currency||'CNY','JPY');
  const grossRate=(priceJPY>0&&avgInJPY>0)?((priceJPY-avgInJPY)/priceJPY*100):null;
  const markupRate=(avgInJPY>0&&priceJPY>0)?((priceJPY-avgInJPY)/avgInJPY*100):null;
  // 30 天 sparkline:按日 售出件数
  const now=Date.now();
  const day=86400000;
  const spark=new Array(30).fill(0);
  allLogs.filter(l=>l.type==='out').forEach(l=>{
    const d=Math.floor((now-l.ts)/day);
    if(d>=0&&d<30)spark[29-d]+=(parseInt(l.qty)||0);
  });
  const sparkMax=Math.max(...spark,1);
  // 货币符号
  const ccySymbol=({JPY:'¥',CNY:'¥',USD:'$',EUR:'€'})[inventoryCurrency]||'';
  const priceShown=fmtPrice(p.price,inventoryCurrency,p.currency||'CNY');
  // 提取数值部分(去符号)用于大字显示
  const priceNum=(priceShown||'').replace(/[^\d.,\-]/g,'')||'—';
  const showOriginal=p.currency&&p.currency!==inventoryCurrency;
  // 历史 timeline 项
  const histHtml=logs.map(l=>{
    const type=l.type;
    const icon=type==='in'?'⬆':type==='out'?'⬇':type==='show'?'★':'↺';
    const label=type==='in'?'入库':type==='out'?'出库':type==='show'?'展会带出':'归还';
    const sign=(type==='in'||type==='return')?'+':'−';
    const hasP=l.price&&parseFloat(l.price)>0;
    const priceTag=hasP?` · ${type==='in'?'进价':'成交'} ${fmtPriceRaw(l.price,l.currency)}`:'';
    const cpTag=l.counterparty?` · ${type==='in'?'进:':'客:'}${l.counterparty}`:'';
    const noteTag=l.note?` · ${l.note}`:'';
    return `<div class="d3-hist-item" onclick="closeModal('modal-detail');openLogDetail('${l.id}')">
      <div class="d3-hist-icon ${type}">${icon}</div>
      <div class="d3-hist-main">
        <div class="d3-hist-type">${label}${priceTag}${cpTag}${noteTag}</div>
        <div class="d3-hist-time">${fmtFull(l.ts)}</div>
      </div>
      <div class="d3-hist-qty ${type}">${sign}${l.qty}</div>
    </div>`;
  }).join('');
  // 主图区
  const photos=p.photos&&p.photos.length?p.photos:[];
  const photoMain=photos[0]
    ? `<img src="${photos[0]}" onclick="viewPhoto(detailPhotos,0)" id="detail-photo-main">`
    : `<div class="d3-photo-empty">${catEmojiSafe(p.cat)}</div>`;
  const dots=photos.length>1
    ? `<div class="d3-photo-dots">${photos.map((_,i)=>`<div class="d3-photo-dot${i===0?' cur':''}" onclick="d3SwitchPhoto(${i})"></div>`).join('')}</div>`
    : '';
  const counter=photos.length>1?`<div class="d3-photo-counter"><span id="d3-photo-cur">1</span> / ${photos.length}</div>`:'';
  // meta 区:badge(类别) · 产地 · 国家 · 尺寸 · 材质 · 重量
  const metaParts=[];
  if(p.cat)metaParts.push(`<span class="badge">${p.cat}</span>`);
  if(p.origin)metaParts.push(`<span>${p.origin}</span>`);
  if(p.country)metaParts.push(`<span>${p.country}</span>`);
  if(p.size)metaParts.push(`<span>📏 ${p.size}</span>`);
  if(p.material)metaParts.push(`<span>💎 ${p.material}</span>`);
  if(p.weight!=null&&p.weight!==''){
    const wTxt=`${p.weight}${p.unit||''}`;
    metaParts.push(`<span>⚖ ${wTxt}</span>`);
  }
  const metaHtml=metaParts.join('<span class="dot"></span>');

  document.getElementById('detail-body').innerHTML=`
    <div class="d3-photo">
      ${counter}
      <div class="d3-photo-img" id="detail-photos">${photoMain}</div>
      ${dots}
    </div>

    <div class="d3-head">
      <div class="d3-name">${p.name||'—'}</div>
      ${metaHtml?`<div class="d3-meta">${metaHtml}</div>`:''}
    </div>

    ${(p.currency&&p.currency!==inventoryCurrency)?`<div class="d3-fx-row">
      <span>显示币种 <span class="ccy">${inventoryCurrency}</span></span>
      <span style="margin-left:auto;">${fxUpdatedAt?'汇率 '+new Date(fxUpdatedAt).toLocaleDateString():'离线汇率'}</span>
    </div>`:''}

    <div class="d3-price">
      <div class="d3-price-label">售 价</div>
      <div class="d3-price-main">
        <span class="d3-price-cur">${ccySymbol}</span>
        <span class="d3-price-val">${priceNum}</span>
        ${showOriginal?`<span class="d3-price-raw">原 ${fmtPriceRaw(p.price,p.currency)}</span>`:''}
      </div>
      <div class="d3-price-sub">
        <div class="d3-price-sub-item">
          <div class="d3-price-sub-l">推荐价</div>
          <div class="d3-price-sub-v" title="平均进价(换算JPY) × 3">${recPriceJPY?fmtPrice(recPriceJPY,inventoryCurrency,'JPY'):'—'}</div>
        </div>
        <div class="d3-price-sub-item">
          <div class="d3-price-sub-l">毛利率</div>
          <div class="d3-price-sub-v profit">${grossRate!==null?grossRate.toFixed(1)+'%':'—'}</div>
        </div>
        <div class="d3-price-sub-item">
          <div class="d3-price-sub-l">加价率</div>
          <div class="d3-price-sub-v">${markupRate!==null?Math.round(markupRate)+'%':'—'}</div>
        </div>
      </div>
    </div>

    <div class="d3-stock">
      <div class="d3-stock-main">
        <div class="d3-stock-l">可用库存</div>
        <div class="d3-stock-v">${avail}<span class="d3-stock-u">件</span></div>
      </div>
      <div class="d3-stock-det">
        <div>总库存　<span class="num">${p.qty}</span></div>
        <div>展会带出 <span class="num show">${showOut}</span></div>
        <div>累计入库 <span class="num">${totalIn}</span></div>
      </div>
    </div>

    <div class="d3-sec">
      <div class="d3-sec-title">销售概况</div>
      <div class="d3-card">
        <div class="d3-sales-stats">
          <div class="d3-sales-stat"><div class="d3-sales-v">${totalOut}</div><div class="d3-sales-l">累计售出</div></div>
          <div class="d3-sales-stat"><div class="d3-sales-v">${salesTotal>0?fmtPriceK(salesTotal,inventoryCurrency,inventoryCurrency):'—'}</div><div class="d3-sales-l">销售额</div></div>
          <div class="d3-sales-stat"><div class="d3-sales-v">${grossProfit?fmtPriceK(grossProfit,inventoryCurrency,inventoryCurrency):'—'}</div><div class="d3-sales-l">毛利</div></div>
        </div>
        <div class="d3-spark-label">近 30 天售出件数</div>
        <div class="d3-spark">
          ${spark.map(v=>`<div class="d3-spark-b" style="height:${v===0?2:Math.max(8,(v/sparkMax)*100)}%;opacity:${v===0?0.18:0.75};"></div>`).join('')}
        </div>
        <div class="d3-spark-lab"><span>30天前</span><span>今天</span></div>
      </div>
    </div>

    ${p.sku?`<div class="d3-sec">
      <div class="d3-sec-title">SKU 编码</div>
      <div class="d3-barcode"><svg id="detail-barcode-svg"></svg></div>
    </div>`:''}

    ${p.note?`<div class="d3-sec">
      <div class="d3-sec-title">备注</div>
      <div class="d3-note">${escapeHTMLSafe(p.note)}</div>
    </div>`:''}

    <div class="d3-sec">
      <div class="d3-sec-title">操作历史</div>
      <div class="d3-hist">
        ${histHtml||'<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">暂无记录</div>'}
        ${totalLogs>3?`<div class="d3-hist-more" onclick="jumpToLogsForProduct('${(p.name||'').replace(/'/g,"\\'")}')">查看全部 ${totalLogs} 条记录 ▶</div>`:''}
      </div>
    </div>

    <div style="height:8px;"></div>
  `;
  // 异步加载真实照片(后端可能慢于初次渲染)
  _loadPhotos(p).then(()=>{
    if(!p.photos||!p.photos.length)return;
    detailPhotos=p.photos;
    const main=document.getElementById('detail-photo-main');
    if(main&&p.photos[0]&&main.tagName==='IMG'){main.src=p.photos[0];}
    else if(!main){
      // 之前是 emoji,现在有图,重新渲染照片区
      const wrap=document.getElementById('detail-photos');
      if(wrap)wrap.innerHTML=`<img id="detail-photo-main" src="${p.photos[0]}" onclick="viewPhoto(detailPhotos,0)">`;
    }
  });
  detailPhotos=p.photos||[];
  // 渲染 SKU 条码
  if(p.sku&&window.JsBarcode){
    try{
      JsBarcode('#detail-barcode-svg',p.sku,{
        format:'CODE128',width:1.4,height:42,displayValue:true,
        background:'transparent',lineColor:'#1a1410',fontSize:12,
        font:'DM Mono',margin:4
      });
    }catch(e){console.warn('barcode render failed',e);}
  }
  document.getElementById('modal-detail').classList.add('open');
}
// 详情页照片切换 + 工具
let detailPhotos=[];
function d3SwitchPhoto(i){
  if(!detailPhotos||!detailPhotos[i])return;
  const main=document.getElementById('detail-photo-main');
  if(main&&main.tagName==='IMG'){
    main.src=detailPhotos[i];
    main.onclick=()=>viewPhoto(detailPhotos,i);
  }
  document.querySelectorAll('#modal-detail .d3-photo-dot').forEach((d,j)=>d.classList.toggle('cur',j===i));
  const cur=document.getElementById('d3-photo-cur');if(cur)cur.textContent=i+1;
}
function catEmojiSafe(cat){
  try{if(typeof catEmoji==='function')return catEmoji(cat);}catch(e){}
  return '💎';
}
function escapeHTMLSafe(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function editFromDetail(){openEditModal(detailId);}
function stockInFromDetail(){closeModal('modal-detail');setTimeout(()=>openStockInModal(detailId),150);}
function printLabelFromDetail(){const id=detailId;closeModal('modal-detail');setTimeout(()=>openLabelModal([id]),150);}
function quickOutFromDetail(){
  closeModal('modal-detail');
  setTimeout(()=>openStockOutModal(detailId),150);
}
async function deleteFromDetail(){
  const p=getProduct(detailId);
  const name=p?p.name:'此商品';
  mzConfirm({
    title:'删除商品?',
    message:`将永久删除「${name}」及其所有入出库/展会记录,此操作不可撤销。`,
    okText:'确认删除',
    okClass:'btn-rose',
    icon:'🗑',
    onOk:async()=>{
      DB.products=DB.products.filter(p=>p.id!==detailId);
      DB.logs=DB.logs.filter(l=>l.productId!==detailId);
      DB.showItems=DB.showItems.filter(s=>s.productId!==detailId);
      await deleteProduct(detailId);
      closeModal('modal-detail');renderInventory();toast('已删除');
    }
  });
}
let _photoFsList=[],_photoFsIdx=0;
function viewPhoto(arg,idx){
  // 兼容 (src) 旧签名
  let list,i;
  if(Array.isArray(arg)){list=arg;i=idx||0;}
  else if(typeof arg==='string'){list=(detailPhotos&&detailPhotos.length)?detailPhotos:[arg];i=Math.max(0,list.indexOf(arg));if(i<0)i=0;}
  else return;
  if(!list||!list.length)return;
  _photoFsList=list;_photoFsIdx=i;
  let el=document.getElementById('photo-fs');
  if(!el){
    el=document.createElement('div');
    el.id='photo-fs';
    el.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.95);display:flex;align-items:center;justify-content:center;';
    el.innerHTML=`
      <img id="photo-fs-img" style="max-width:96vw;max-height:92vh;object-fit:contain;display:block;">
      <button id="photo-fs-prev" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.1);color:#fff;border:0;border-radius:50%;width:44px;height:44px;font-size:24px;cursor:pointer;">‹</button>
      <button id="photo-fs-next" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.1);color:#fff;border:0;border-radius:50%;width:44px;height:44px;font-size:24px;cursor:pointer;">›</button>
      <div id="photo-fs-counter" style="position:absolute;top:14px;left:50%;transform:translateX(-50%);color:#fff;font-size:13px;font-family:'DM Mono',monospace;background:rgba(0,0,0,0.4);padding:4px 10px;border-radius:12px;"></div>
      <button id="photo-fs-close" style="position:absolute;top:10px;right:10px;background:rgba(255,255,255,0.1);color:#fff;border:0;border-radius:50%;width:36px;height:36px;font-size:18px;cursor:pointer;">✕</button>
    `;
    document.body.appendChild(el);
    el.addEventListener('click',(e)=>{if(e.target===el)closeViewPhoto();});
    document.getElementById('photo-fs-prev').addEventListener('click',(e)=>{e.stopPropagation();viewPhotoNav(-1);});
    document.getElementById('photo-fs-next').addEventListener('click',(e)=>{e.stopPropagation();viewPhotoNav(1);});
    document.getElementById('photo-fs-close').addEventListener('click',(e)=>{e.stopPropagation();closeViewPhoto();});
    document.addEventListener('keydown',_photoFsKey);
  }
  _photoFsRender();
  el.style.display='flex';
}
function _photoFsRender(){
  const img=document.getElementById('photo-fs-img');if(img)img.src=_photoFsList[_photoFsIdx]||'';
  const c=document.getElementById('photo-fs-counter');if(c)c.textContent=`${_photoFsIdx+1} / ${_photoFsList.length}`;
  const showNav=_photoFsList.length>1;
  const prev=document.getElementById('photo-fs-prev');if(prev)prev.style.display=showNav?'block':'none';
  const next=document.getElementById('photo-fs-next');if(next)next.style.display=showNav?'block':'none';
}
function viewPhotoNav(d){
  if(!_photoFsList.length)return;
  _photoFsIdx=(_photoFsIdx+d+_photoFsList.length)%_photoFsList.length;
  _photoFsRender();
}
function closeViewPhoto(){const el=document.getElementById('photo-fs');if(el)el.style.display='none';}
function _photoFsKey(e){
  const el=document.getElementById('photo-fs');if(!el||el.style.display==='none')return;
  if(e.key==='Escape')closeViewPhoto();
  else if(e.key==='ArrowLeft')viewPhotoNav(-1);
  else if(e.key==='ArrowRight')viewPhotoNav(1);
}
// 详情卡 → 流水 tab 并按商品名筛选
function jumpToLogsForProduct(name){
  closeModal('modal-detail');
  // 先切 tab(可能有 URL 路由会更新 hash,留给 A 组兼容)
  try{
    const tabs=document.querySelectorAll('.nav-tab');
    let logsTab=null;
    tabs.forEach(t=>{if((t.getAttribute('onclick')||'').includes("'logs'"))logsTab=t;});
    switchTab('logs',logsTab);
  }catch(e){switchTab('logs');}
  // 填入搜索 + 触发渲染
  setTimeout(()=>{
    const inp=document.getElementById('logs-search');
    if(inp){inp.value=name||'';}
    if(typeof renderLogsPage==='function')renderLogsPage();
  },50);
}
function closeModal(id){document.getElementById(id).classList.remove('open');}

// ===================== 展会 =====================
function renderShowSelects(){
  document.getElementById('show-product').innerHTML=DB.products.map(p=>`<option value="${p.id}">${p.name}（库存:${p.qty}）</option>`).join('');
}
async function doShowOut(){
  const pid=document.getElementById('show-product').value;
  const qty=parseInt(document.getElementById('show-qty').value)||0;
  const showName=document.getElementById('show-name-input').value.trim()||'展会';
  if(!pid||qty<=0)return;
  const p=getProduct(pid);
  if(p.qty<qty){toast(`库存不足（当前${p.qty}件）`);return;}
  p.qty-=qty;
  // 查找/复用现有 show 实体(按 name 匹配 live 优先)
  let showId=null;
  if(DB.shows&&DB.shows.length){
    const match=DB.shows.find(s=>s.live&&s.name===showName)
      ||DB.shows.find(s=>s.name===showName);
    if(match)showId=match.id;
  }
  const si={id:uid(),productId:pid,qty,showName,showId,ts:Date.now()};
  const log={id:uid(),productId:pid,type:'show',qty,note:showName,ts:Date.now()};
  DB.showItems.push(si);DB.logs.unshift(log);
  await Promise.all([upsertProduct(p),upsertShow(si),insertLog(log)]);
  renderShowList();renderInventory();updateHeader();toast(`✅ 带出 ${qty} 件`);
}
async function doReturn(sid){
  const si=DB.showItems.find(s=>s.id===sid);if(!si)return;
  const n=parseInt(prompt(`归还数量（带出 ${si.qty} 件）：`,si.qty));
  if(!n||n<=0||n>si.qty)return;
  const p=getProduct(si.productId);if(p)p.qty+=n;
  const log={id:uid(),productId:si.productId,type:'return',qty:n,note:si.showName+' 归还',ts:Date.now()};
  DB.logs.unshift(log);
  const ops=[insertLog(log)];
  if(p)ops.push(upsertProduct(p));
  if(n>=si.qty){DB.showItems=DB.showItems.filter(s=>s.id!==sid);ops.push(deleteShow(sid));}
  else{si.qty-=n;ops.push(upsertShow(si));}
  await Promise.all(ops);
  renderShowList();renderInventory();updateHeader();toast(`✅ 归还 ${n} 件`);
}
// 计算某展会期间该商品在 logs 中的"已售"数(在 startDate~endDate 范围内的 out logs)
function _showSoldQty(productId,startTs,endTs){
  if(!DB.logs||!DB.logs.length)return 0;
  return DB.logs.filter(l=>l.productId===productId&&l.type==='out'
    &&(!startTs||l.ts>=startTs)&&(!endTs||l.ts<=endTs))
    .reduce((a,l)=>a+(parseInt(l.qty)||0),0);
}
// 展会 hero 概览卡聚合 (mock screen-6 对齐 2026-05-19: 带出 / 已售 / 销售额)
function _renderShowHero(){
  const totalOut=DB.showItems.reduce((a,si)=>a+(parseInt(si.qty)||0),0);
  // 已售/销售额:聚合所有 live show 期间 + 没有 show 实体的 showItems 的 out logs
  let totalSold=0;
  let totalSales=0;
  const cur=(typeof inventoryCurrency!=='undefined'?inventoryCurrency:'JPY');
  const sym=(typeof CURRENCY_SYMBOL!=='undefined'&&CURRENCY_SYMBOL[cur])||'¥';
  // 收集每个 showItem 对应的售出
  DB.showItems.forEach(si=>{
    const sh=(DB.shows||[]).find(s=>s.id===si.showId);
    const startTs=sh&&sh.startDate?new Date(sh.startDate).getTime():null;
    const endTs=sh&&sh.endDate?new Date(sh.endDate+'T23:59:59').getTime():null;
    const sold=(typeof _showSoldQty==='function')?_showSoldQty(si.productId,startTs,endTs):0;
    totalSold+=sold;
    // 销售额:对应 out logs amount(本位币换算到显示币种)
    (DB.logs||[]).filter(l=>l.productId===si.productId&&l.type==='out'
      &&(!startTs||l.ts>=startTs)&&(!endTs||l.ts<=endTs))
      .forEach(l=>{
        const bp=l.basePrice?parseFloat(l.basePrice):0;
        const amtJpy=bp*(parseInt(l.qty)||0);
        if(amtJpy&&typeof convertCurrency==='function'){
          totalSales+=(convertCurrency(amtJpy,'JPY',cur)||amtJpy);
        }else{
          totalSales+=amtJpy;
        }
      });
  });
  const fmtK=v=>{
    if(!v)return sym+'0';
    if(v>=10000)return sym+(v/1000).toFixed(1)+'K';
    return sym+Math.round(v).toLocaleString();
  };
  const setT=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  setT('show-hero-stat-out',totalOut);
  setT('show-hero-stat-sold',totalSold);
  setT('show-hero-stat-sales',fmtK(totalSales));
  // hero 名称/日期:有 live show 时显示第一个的名字+日期段
  const liveOne=(DB.shows||[]).find(s=>s.live);
  if(liveOne){
    setT('show-hero-name','🎪 '+liveOne.name);
    const fmtD=d=>d?d:'';
    const dateTxt=liveOne.startDate||liveOne.endDate
      ? `${fmtD(liveOne.startDate)}${liveOne.endDate?' ~ '+fmtD(liveOne.endDate):''}`
      : '展会期间累计带出';
    const liveEl=document.getElementById('show-hero-live');
    setT('show-hero-date',dateTxt+' ');
    if(liveEl){liveEl.textContent='● 进行中';document.getElementById('show-hero-date').appendChild(liveEl);}
  }
}
function renderShowList(){
  _renderShowHero();
  const el=document.getElementById('show-list');
  if(!DB.showItems.length){el.innerHTML=`<div class="empty-state"><div style="font-size:36px;margin-bottom:10px;">🎉</div><div>目前没有展会带出的商品</div></div>`;return;}
  // 按展会分组:优先 showId,fallback showName
  const groups=new Map();
  DB.showItems.forEach(si=>{
    const key=si.showId||('name:'+(si.showName||'未命名'));
    if(!groups.has(key))groups.set(key,{key,items:[],show:null,showName:si.showName||'未命名'});
    groups.get(key).items.push(si);
  });
  // 解析每组的 show 实体
  groups.forEach(g=>{
    if(g.key.startsWith('name:'))return;
    g.show=(DB.shows||[]).find(s=>s.id===g.key)||null;
    if(g.show)g.showName=g.show.name;
  });
  // 渲染
  const html=Array.from(groups.values()).map(g=>{
    const sh=g.show;
    const live=sh?sh.live:false;
    const dateTxt=sh&&(sh.startDate||sh.endDate)
      ? ` · 📅 ${sh.startDate||''}${sh.endDate?' ~ '+sh.endDate:''}`
      : '';
    const startTs=sh&&sh.startDate?new Date(sh.startDate).getTime():null;
    const endTs=sh&&sh.endDate?new Date(sh.endDate+'T23:59:59').getTime():null;
    // 该组商品行
    const rows=g.items.map(si=>{
      const p=getProduct(si.productId);
      const thumb=p&&p.photos&&p.photos[0]
        ? `<div class="show-thumb"><img src="${p.photos[0]}"></div>`
        : `<div class="show-thumb">${catEmoji(p&&p.cat)}</div>`;
      const sold=p?_showSoldQty(si.productId,startTs,endTs):0;
      const left=Math.max(0,(parseInt(si.qty)||0)-sold);
      const soldHtml=sold>0?` · <span style="color:var(--rose-light);">已售 ${sold}</span>`:'';
      const leftHtml=` · <span style="color:var(--jade-light);">剩 ${left}</span>`;
      const sellBtn=p?`<button class="btn btn-rose btn-sm" onclick="quickSellFromShow('${si.productId}')" title="开出库 modal" style="margin-right:6px;">💰 售出</button>`:'';
      return `<div class="show-item">${thumb}
        <div class="show-details">
          <div style="font-size:14px;color:var(--text);margin-bottom:4px;">${p?p.name:'已删除'}</div>
          <div style="font-size:12px;color:var(--text-muted);">带出 <strong style="color:var(--gold);">${si.qty}</strong>${soldHtml}${leftHtml} · ${fmt(si.ts)}</div>
        </div>
        ${sellBtn}<button class="btn btn-jade btn-sm" onclick="doReturn('${si.id}')">↩️ 归还</button>
      </div>`;
    }).join('');
    const liveDot=live?`<span class="show-grp-live" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#e74c3c;box-shadow:0 0 8px rgba(231,76,60,.6);animation:pulse 1.5s infinite;margin-right:6px;vertical-align:middle;"></span>`:'';
    const groupHead=`<div class="show-group-head" style="padding:10px 12px;margin:8px 0 6px;background:var(--surface2,#1f1a16);border-radius:8px;font-size:13px;color:var(--text);">
      ${liveDot}<strong>📍 ${g.showName}</strong><span style="color:var(--text-muted);font-size:11px;">${dateTxt} · ${g.items.length} 件商品</span>
    </div>`;
    return groupHead+rows;
  }).join('');
  el.innerHTML=html;
}
// 从展会行 → 出库 modal 预填
function quickSellFromShow(productId){
  if(typeof openStockOutModal==='function'){
    openStockOutModal(productId);
  }else{
    toast('出库功能未加载');
  }
}

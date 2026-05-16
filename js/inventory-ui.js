// ===================== TABS =====================
function switchTab(name,el){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('sec-'+name).classList.add('active');
  el.classList.add('active');
  if(name==='inout'){renderOutSelects();renderInLogs();renderOutLogs();}
  if(name==='show'){renderShowSelects();renderShowList();}
  if(name==='scan'){renderQRSelects();}
  if(name==='stats'){renderStats();}
  if(name!=='scan')stopCamera();
}
function setIOMode(mode,el){
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));el.classList.add('active');
  document.querySelectorAll('.segment').forEach(s=>s.classList.remove('active'));
  document.getElementById('seg-'+mode).classList.add('active');
  if(mode==='out')renderOutSelects();
}

// ===================== INVENTORY =====================
let invViewMode='grid'; // 'grid' or 'list'
const IS_MOBILE=()=>window.innerWidth<600;
function toggleInventoryView(){
  if(IS_MOBILE()){toast('手机屏幕窄,仅支持卡片视图');return;}
  invViewMode=invViewMode==='grid'?'list':'grid';
  const btn=document.getElementById('view-toggle');
  const grid=document.getElementById('product-grid');
  if(invViewMode==='list'){
    btn.textContent='⊟';btn.title='切换到卡片视图';
    grid.style.display='block';
  }else{
    btn.textContent='⊞';btn.title='切换到列表视图';
    grid.style.display='';
  }
  renderInventory();
}

function renderInventory(){
  if(IS_MOBILE())invViewMode='grid';
  const viewBtn=document.getElementById('view-toggle');
  if(viewBtn)viewBtn.style.display=IS_MOBILE()?'none':'';
  const q=document.getElementById('inv-search').value.toLowerCase();
  const grid=document.getElementById('product-grid');
  // 预计算showOut，避免每个商品都遍历showItems
  const showOutMap={};
  DB.showItems.forEach(s=>{showOutMap[s.productId]=(showOutMap[s.productId]||0)+s.qty;});
  let prods=DB.products.filter(p=>{
    if(catFilter!=='all'&&(p.cat||'未分类')!==catFilter)return false;
    if(q&&!p.name.toLowerCase().includes(q)&&!(p.sku||'').toLowerCase().includes(q)&&!(p.cat||'').toLowerCase().includes(q))return false;
    return true;
  });
  if(!prods.length){
    grid.className='product-grid';
    grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div style="font-size:40px;margin-bottom:12px;">${DB.products.length?'🔍':'💎'}</div><div style="margin-bottom:14px;font-size:14px;">${DB.products.length?'没有符合的商品':'还没有商品，开始建品吧'}</div><button class="btn btn-gold" onclick="openAddModal()">＋ 建品</button></div>`;
    updateHeader();return;
  }

  if(invViewMode==='list'){
    // 列表视图
    grid.className='';
    grid.innerHTML=`<table class="inv-table">
      <thead><tr>
        <th></th>
        <th>商品名称</th>
        <th>类别</th>
        <th>单价</th>
        <th>库存</th>
        <th>展会</th>
        <th>可用</th>
        <th>操作</th>
      </tr></thead>
      <tbody>${prods.map(p=>{
        const showOut=showOutMap[p.id]||0;
        const avail=p.qty-showOut;
        const qc=avail<=0?'zero':avail<3?'low':'ok';
        const tn=p.thumbnail||(p.photos&&p.photos[0]);
        const thumb=tn
          ?`<img class="thumb-sm zoomable" src="${tn}" loading="lazy" onmouseenter="showZoomPreview(this,'${p.id}')" onmouseleave="hideZoomPreview()">`
          :`<div class="thumb-emoji">${catEmoji(p.cat)}</div>`;
        return`<tr class="clickable" onclick="openDetail('${p.id}')">
          <td>${thumb}</td>
          <td style="font-weight:600;color:var(--text);max-width:140px;">${p.name}</td>
          <td><span style="font-size:11px;background:var(--surface2);padding:2px 7px;border-radius:10px;">${p.cat||'未分类'}</span></td>
          <td style="color:var(--gold);">${p.price?'¥'+p.price:'—'}</td>
          <td style="text-align:center;">${p.qty}</td>
          <td style="text-align:center;color:var(--text-muted);">${showOut||'—'}</td>
          <td style="text-align:center;"><span class="qty-badge ${qc}">${avail}</span></td>
          <td onclick="event.stopPropagation()">
            <div style="display:flex;gap:5px;">
              <button class="btn btn-jade btn-sm" style="padding:4px 8px;font-size:11px;" onclick="openStockInModal('${p.id}')">入库</button>
              <button class="btn btn-sm" style="padding:4px 8px;font-size:11px;background:var(--rose-dim);color:var(--rose-light);" onclick="openStockOutModal('${p.id}')">出库</button>
            </div>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  } else {
    // 卡片视图
    grid.className='product-grid';
    grid.innerHTML=prods.map(p=>{
      const showOut=showOutMap[p.id]||0;
      const avail=p.qty-showOut;
      const qc=avail<=0?' zero':avail<3?' low':'';
      const tn=p.thumbnail||(p.photos&&p.photos[0]);
      const thumb=tn?`<div class="product-thumb"><img src="${tn}" loading="lazy" class="zoomable" onmouseenter="showZoomPreview(this,'${p.id}')" onmouseleave="hideZoomPreview()"></div>`:`<div class="product-thumb">${catEmoji(p.cat)}</div>`;
      return`<div class="product-card" onclick="openDetail('${p.id}')">${thumb}<div class="category-badge">${p.cat||'未分类'}</div><div class="product-qty${qc}">${avail}</div><div class="product-info"><div class="product-name">${p.name}</div><div class="product-sku">${p.sku||'—'}</div></div></div>`;
    }).join('');
  }
  updateHeader();renderCatFilters();
}
function renderCatFilters(){
  const cats=allCats();
  const row=document.getElementById('cat-filters');
  const dl=document.getElementById('cat-list');
  dl.innerHTML=cats.map(c=>`<option value="${c}">`).join('');
  const existing=[...row.querySelectorAll('[data-cat]')].map(c=>c.dataset.cat);
  cats.forEach(cat=>{
    if(!existing.includes(cat)){
      const btn=document.createElement('button');
      btn.className='filter-chip';btn.dataset.cat=cat;btn.textContent=cat;
      btn.onclick=function(){setCatFilter(cat,this);};row.appendChild(btn);
    }
  });
}
function setCatFilter(cat,el){catFilter=cat;document.querySelectorAll('#cat-filters .filter-chip').forEach(c=>c.classList.remove('active'));el.classList.add('active');renderInventory();}
function updateHeader(){
  document.getElementById('hdr-total').textContent=DB.products.length;
  document.getElementById('hdr-qty').textContent=DB.products.reduce((a,p)=>a+p.qty,0);
  document.getElementById('hdr-show').textContent=DB.showItems.reduce((a,s)=>a+s.qty,0);
}

// ===================== 建品 =====================
function openAddModal(prefill){
  editingId=null;pendingPhotos=[];
  document.getElementById('modal-add-title').textContent='新建商品档案';
  ['f-name','f-sku','f-cat','f-price','f-origin','f-country','f-note'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('photo-previews').innerHTML='';
  if(prefill){['name','cat','note','origin','country'].forEach(k=>{if(prefill[k])document.getElementById('f-'+k).value=prefill[k];});}
  document.getElementById('modal-add').classList.add('open');
}
function openEditModal(id){
  const p=getProduct(id);if(!p)return;
  editingId=id;pendingPhotos=[...(p.photos||[])];
  document.getElementById('modal-add-title').textContent='编辑商品';
  document.getElementById('f-name').value=p.name||'';
  document.getElementById('f-sku').value=p.sku||'';
  document.getElementById('f-cat').value=p.cat||'';
  document.getElementById('f-price').value=p.price||'';
  document.getElementById('f-origin').value=p.origin||'';
  document.getElementById('f-country').value=p.country||'';
  document.getElementById('f-note').value=p.note||'';
  renderPhotoPreviews();closeModal('modal-detail');
  document.getElementById('modal-add').classList.add('open');
}
function openAddThenStockIn(){openAddModal();document.getElementById('modal-add').dataset.stockin='1';}
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
  return{id,name,sku,cat:document.getElementById('f-cat').value.trim(),price:document.getElementById('f-price').value.trim(),origin:document.getElementById('f-origin').value.trim(),country:document.getElementById('f-country').value.trim(),note:document.getElementById('f-note').value.trim(),photos:[...pendingPhotos],qty:editingId?(getProduct(editingId).qty||0):0,createdAt:editingId?(getProduct(editingId).createdAt||Date.now()):Date.now()};
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
    toast('✅ 建档完成（库存0）');
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

// ===================== 入库 =====================
function openStockInModal(preId){
  const sel=document.getElementById('si-product');
  sel.innerHTML=DB.products.map(p=>`<option value="${p.id}" ${p.id===preId?'selected':''}>${p.name}（${p.sku||'—'}）现库存:${p.qty}</option>`).join('');
  if(!sel.innerHTML){toast('请先建品');return;}
  document.getElementById('si-qty').value=1;
  document.getElementById('si-price').value='';
  document.getElementById('si-note').value='';
  updateStockInInfo();
  document.getElementById('modal-stockin').classList.add('open');
}
function updateStockInInfo(){
  const p=getProduct(document.getElementById('si-product').value);
  const el=document.getElementById('si-current-info');
  if(p){el.style.display='block';el.textContent=`当前库存 ${p.qty} 件${p.price?' · 参考售价：'+p.price:''}`;}
  else el.style.display='none';
}
async function doStockIn(){
  const pid=document.getElementById('si-product').value;
  const qty=parseInt(document.getElementById('si-qty').value)||0;
  const note=document.getElementById('si-note').value.trim();
  const price=document.getElementById('si-price').value.trim();
  if(!pid){toast('请选择商品');return;}
  if(qty<=0){toast('数量需大于0');return;}
  const p=getProduct(pid);
  p.qty+=qty;
  const log={id:uid(),productId:pid,type:'in',qty,note,price,ts:Date.now()};
  DB.logs.unshift(log);
  await Promise.all([upsertProduct(p),insertLog(log)]);
  closeModal('modal-stockin');renderInventory();renderInLogs();
  toast(`✅ 入库 ${qty} 件，当前库存 ${p.qty} 件`);
}

// ===================== 出库 =====================
function renderOutSelects(){
  document.getElementById('out-product').innerHTML='<option value="">-- 请选择商品 --</option>'+DB.products.map(p=>`<option value="${p.id}">${p.name}（库存:${p.qty}）</option>`).join('');
}
async function doOut(){
  const pid=document.getElementById('out-product').value;
  const qty=parseInt(document.getElementById('out-qty').value)||0;
  const priceEl=document.getElementById('out-price');
  const price=priceEl?priceEl.value.trim():'';
  const note=document.getElementById('out-note').value.trim();
  if(!pid){toast('请选择商品');return;}
  if(qty<=0){toast('数量需大于0');return;}
  const p=getProduct(pid);
  if(p.qty<qty){toast(`库存不足（当前${p.qty}件）`);return;}
  p.qty-=qty;
  const log={id:uid(),productId:pid,type:'out',qty,note,price:price||null,ts:Date.now()};
  DB.logs.unshift(log);
  await Promise.all([upsertProduct(p),insertLog(log)]);
  renderOutSelects();renderInventory();renderOutLogs();
  document.getElementById('out-qty').value=1;document.getElementById('out-note').value='';if(priceEl)priceEl.value='';
  toast(`✅ 出库 ${qty} 件`);
}

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
function openDetail(id){
  const p=getProduct(id);if(!p)return;
  _loadPhotos(p).then(()=>{
    const el=document.getElementById('detail-photos');
    if(el&&p.photos&&p.photos[0]){
      el.innerHTML=p.photos.map(ph=>`<img class="detail-photo" src="${ph}">`).join('');
    }
  });
  detailId=id;
  document.getElementById('detail-title').textContent=p.name;
  const showOut=DB.showItems.filter(s=>s.productId===id).reduce((a,s)=>a+s.qty,0);
  const avail=p.qty-showOut;
  const allLogs=DB.logs.filter(l=>l.productId===id);
  const logs=allLogs.slice(0,10);
  const lastIn=allLogs.find(l=>l.type==='in'&&l.price);
  const lastOut=allLogs.find(l=>l.type==='out'&&l.price);
  document.getElementById('detail-body').innerHTML=`
    ${p.photos&&p.photos.length?`<div class="detail-photos">${p.photos.map(s=>`<img class="detail-photo" src="${s}" onclick="viewPhoto('${s}')">`).join('')}</div>`:''}
    <div class="detail-grid">
      <div class="detail-field"><label>SKU</label><div class="val mono">${p.sku||'—'}</div></div>
      <div class="detail-field"><label>类别</label><div class="val">${p.cat||'未分类'}</div></div>
      <div class="detail-field"><label>可用库存</label><div class="val big">${avail}</div></div>
      <div class="detail-field"><label>总库存</label><div class="val mono">${p.qty}件${showOut>0?`（展会带出${showOut}件）`:''}</div></div>
      ${p.price?`<div class="detail-field"><label>参考售价</label><div class="val">¥${p.price}</div></div>`:''}
      ${lastIn?`<div class="detail-field"><label>最近一次进价</label><div class="val" style="color:var(--jade-light);">¥${lastIn.price} <span style="font-size:11px;color:var(--text-muted);">(${fmt(lastIn.ts)})</span></div></div>`:''}
      ${lastOut?`<div class="detail-field"><label>最近一次售价</label><div class="val" style="color:var(--rose-light);">¥${lastOut.price} <span style="font-size:11px;color:var(--text-muted);">(${fmt(lastOut.ts)})</span></div></div>`:''}
      ${p.origin?`<div class="detail-field"><label>产地/规格</label><div class="val">${p.origin}</div></div>`:''}
      ${p.country?`<div class="detail-field"><label>原产国</label><div class="val">${p.country}</div></div>`:''}
      <div class="detail-field"><label>建档时间</label><div class="val mono" style="font-size:11px;">${fmtFull(p.createdAt)}</div></div>
    </div>
    ${p.note?`<div style="font-size:13px;color:var(--text-dim);padding:10px;background:var(--surface2);border-radius:6px;margin-bottom:14px;">${p.note}</div>`:''}
    ${logs.length?`<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">操作历史（点击查看详情）</div>
    <div class="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th>数量</th><th>备注</th></tr></thead><tbody>
    ${logs.map(l=>`<tr class="clickable" onclick="closeModal('modal-detail');openLogDetail('${l.id}')">
      <td class="td-mono">${fmt(l.ts)}</td>
      <td><span class="badge badge-${l.type==='in'?'in':l.type==='out'?'out':l.type==='show'?'show':'return'}">${l.type==='in'?'入库':l.type==='out'?'出库':l.type==='show'?'带出':'归还'}</span></td>
      <td style="font-family:'DM Mono',monospace;color:${l.type==='in'||l.type==='return'?'var(--jade-light)':'var(--rose-light)'};">${l.type==='in'||l.type==='return'?'+':'−'}${l.qty}</td>
      <td style="color:var(--text-muted);">${l.note||'—'}</td>
    </tr>`).join('')}
    </tbody></table></div>`:''}`;
  document.getElementById('modal-detail').classList.add('open');
}
function editFromDetail(){openEditModal(detailId);}
function stockInFromDetail(){closeModal('modal-detail');setTimeout(()=>openStockInModal(detailId),150);}
async function quickOutFromDetail(){
  const p=getProduct(detailId);if(!p)return;
  const n=parseInt(prompt(`出库数量（当前库存 ${p.qty} 件）：`,1));
  if(!n||n<=0)return;
  if(p.qty<n){toast('库存不足');return;}
  p.qty-=n;
  const log={id:uid(),productId:detailId,type:'out',qty:n,note:'详情页出库',ts:Date.now()};
  DB.logs.unshift(log);
  await Promise.all([upsertProduct(p),insertLog(log)]);
  renderInventory();closeModal('modal-detail');toast(`✅ 出库 ${n} 件`);
}
async function deleteFromDetail(){
  if(!confirm('确认删除此商品及其所有记录？'))return;
  DB.products=DB.products.filter(p=>p.id!==detailId);
  DB.logs=DB.logs.filter(l=>l.productId!==detailId);
  DB.showItems=DB.showItems.filter(s=>s.productId!==detailId);
  await deleteProduct(detailId);
  closeModal('modal-detail');renderInventory();toast('已删除');
}
function viewPhoto(src){const w=window.open();w.document.write(`<img src="${src}" style="max-width:100%;max-height:100vh;display:block;margin:auto;background:#000;">`);}
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
  const si={id:uid(),productId:pid,qty,showName,ts:Date.now()};
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
function renderShowList(){
  const el=document.getElementById('show-list');
  if(!DB.showItems.length){el.innerHTML=`<div class="empty-state"><div style="font-size:36px;margin-bottom:10px;">🎉</div><div>目前没有展会带出的商品</div></div>`;return;}
  el.innerHTML=DB.showItems.map(si=>{
    const p=getProduct(si.productId);
    const thumb=p&&p.photos&&p.photos[0]?`<div class="show-thumb"><img src="${p.photos[0]}"></div>`:`<div class="show-thumb">${catEmoji(p&&p.cat)}</div>`;
    return`<div class="show-item">${thumb}<div class="show-details"><div style="font-size:14px;color:var(--text);margin-bottom:4px;">${p?p.name:'已删除'}</div><div style="font-size:12px;color:var(--text-muted);">📍 ${si.showName} · 带出 <strong style="color:var(--gold);">${si.qty}</strong> 件 · ${fmt(si.ts)}</div></div><button class="btn btn-jade btn-sm" onclick="doReturn('${si.id}')">↩️ 归还</button></div>`;
  }).join('');
}

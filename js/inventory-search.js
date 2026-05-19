// 矿珍库 全局搜索 overlay (A 组改造 2026-05-19)
// 顶部 🔍 → openSearch() 注入全屏遮罩,匹配 DB.products 的名称/SKU/类别/备注
// 点击结果跳详情(openDetail),Esc 关闭,记录最近搜索到 localStorage('mzRecentSearches')

(function(){
  const RECENT_KEY='mzRecentSearches';
  const RECENT_MAX=8;
  // 默认 seed:用户初次没历史时给一组常用 chip 引导(mock screen-2 搜索 overlay 风格)
  const SEED_RECENT=['陨石','首饰','矿物','¥1000+','缺货'];

  function getRecent(){
    try{
      const raw=localStorage.getItem(RECENT_KEY);
      if(!raw)return SEED_RECENT.slice();
      const arr=JSON.parse(raw);
      return (Array.isArray(arr)&&arr.length)?arr:SEED_RECENT.slice();
    }
    catch(e){ return SEED_RECENT.slice(); }
  }
  function pushRecent(kw){
    kw=(kw||'').trim();
    if(!kw)return;
    let arr=getRecent().filter(k=>k!==kw);
    arr.unshift(kw);
    arr=arr.slice(0,RECENT_MAX);
    try{ localStorage.setItem(RECENT_KEY, JSON.stringify(arr)); }catch(e){}
  }
  function clearRecent(){
    try{ localStorage.removeItem(RECENT_KEY); }catch(e){}
    gsRender('');
  }

  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s){
    return String(s||'').replace(/'/g,"\\'");
  }

  // 计算商品库存(可用件数 = sum logs in - sum logs out - 展会中)
  function getAvail(p){
    if(typeof window.getAvail==='function') return window.getAvail(p);
    // fallback: 用 p.qty
    return (p&&typeof p.qty==='number')?p.qty:0;
  }

  function fmtPrice(p){
    if(!p) return '—';
    const price=p.price;
    if(price==null||isNaN(price)) return '—';
    const cur=p.currency||'JPY';
    const sym={JPY:'¥',CNY:'¥',USD:'$',EUR:'€'}[cur]||'';
    // 整数化显示,JPY/CNY 不显示小数
    const isJpyOrCny=cur==='JPY'||cur==='CNY';
    const n=isJpyOrCny?Math.round(price):Number(price).toFixed(2);
    return `${sym}${n} ${cur}`;
  }

  function thumbHtml(p){
    if(p.thumbnail) return `<img src="${escapeHtml(p.thumbnail)}" alt="">`;
    if(p.photos && Array.isArray(p.photos) && p.photos[0]) return `<img src="${escapeHtml(p.photos[0])}" alt="">`;
    return '💎';
  }

  function gsItem(p){
    const avail=getAvail(p);
    const meta=`${escapeHtml(p.cat||'未分类')} · ${escapeHtml(p.sku||'—')} · <b>${fmtPrice(p)}</b> · 库存 ${avail}`;
    return `<div class="gs-result" onclick="window._gsPickProduct('${escapeAttr(p.id)}')">
      <div class="gs-result-thumb">${thumbHtml(p)}</div>
      <div class="gs-result-info">
        <div class="gs-result-name">${escapeHtml(p.name||'未命名')}</div>
        <div class="gs-result-meta">${meta}</div>
      </div>
    </div>`;
  }

  function filterProducts(kw){
    const products=(window.DB&&Array.isArray(DB.products))?DB.products:[];
    if(!kw) return products.slice(0,20); // 最近 / 全部前 20
    const k=kw.toLowerCase();
    return products.filter(p=>{
      const hay=`${p.name||''} ${p.sku||''} ${p.cat||''} ${p.note||''} ${p.barcode||''}`.toLowerCase();
      return hay.includes(k);
    }).slice(0,30);
  }

  function gsRender(kw){
    const body=document.getElementById('gsBody');
    if(!body)return;
    const k=(kw||'').trim();
    const results=filterProducts(k);
    if(k){
      body.innerHTML = (results.length===0)
        ? `<div class="gs-empty">未找到「${escapeHtml(kw)}」相关商品<br><br>试试换个关键词,或扫码搜索</div>`
        : `<div class="gs-sec"><div class="gs-sec-title">搜索结果 · ${results.length} 项</div>${results.map(gsItem).join('')}</div>`;
    }else{
      const recent=getRecent();
      const recentHtml = recent.length
        ? `<div class="gs-sec">
             <div class="gs-sec-title">最近搜索 <span style="margin-left:auto;cursor:pointer;color:var(--text-dim);" onclick="window._gsClearRecent()">清空</span></div>
             <div class="gs-chips">${recent.map(k=>`<div class="gs-chip" onclick="window._gsSet('${escapeAttr(k)}')">${escapeHtml(k)}</div>`).join('')}</div>
           </div>`
        : '';
      const listHtml = results.length
        ? `<div class="gs-sec">
             <div class="gs-sec-title">推荐 · 全部商品</div>
             ${results.map(gsItem).join('')}
           </div>`
        : `<div class="gs-empty">还没有商品,先去库存页建品吧</div>`;
      body.innerHTML = recentHtml + listHtml;
    }
  }

  // 内部辅助
  window._gsSet=function(kw){
    const input=document.getElementById('gsInput');
    if(input){ input.value=kw; }
    gsRender(kw);
  };
  window._gsClearRecent=clearRecent;
  window._gsPickProduct=function(id){
    // 记录关键词
    const input=document.getElementById('gsInput');
    if(input&&input.value.trim()) pushRecent(input.value.trim());
    closeSearch();
    if(typeof window.openDetail==='function'){
      window.openDetail(id);
    }else if(typeof window.toast==='function'){
      toast('详情功能不可用');
    }
  };

  // 公开 API
  window.openSearch=function(){
    let ov=document.getElementById('gsOverlay');
    if(!ov){
      ov=document.createElement('div');
      ov.id='gsOverlay';
      ov.className='gs-overlay';
      ov.innerHTML=`
        <div class="gs-bar">
          <div class="gs-input-wrap">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input class="gs-input" id="gsInput" placeholder="商品名 / SKU / 类别 / 备注..." autocomplete="off">
          </div>
          <div class="gs-close" onclick="closeSearch()" title="关闭 (Esc)">×</div>
        </div>
        <div class="gs-body" id="gsBody"></div>
      `;
      document.body.appendChild(ov);
      ov.addEventListener('click', e=>{ if(e.target===ov) closeSearch(); });
      const input=ov.querySelector('#gsInput');
      let debounce=null;
      input.addEventListener('input', e=>{
        clearTimeout(debounce);
        debounce=setTimeout(()=>gsRender(e.target.value), 80);
      });
      input.addEventListener('keydown', e=>{
        if(e.key==='Enter'){
          const v=input.value.trim();
          if(v) pushRecent(v);
          // 如果只有一个结果,直接打开
          const results=filterProducts(v);
          if(v && results.length===1){
            closeSearch();
            if(typeof window.openDetail==='function') window.openDetail(results[0].id);
          }
        }
      });
    }
    ov.classList.add('show');
    gsRender('');
    setTimeout(()=>{ const i=document.getElementById('gsInput'); if(i){ i.value=''; i.focus(); } }, 50);
  };

  window.closeSearch=function(){
    const ov=document.getElementById('gsOverlay');
    if(ov) ov.classList.remove('show');
  };

  // ESC 全局关闭(只有 overlay 显示时才响应)
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'){
      const ov=document.getElementById('gsOverlay');
      if(ov && ov.classList.contains('show')) closeSearch();
    }
  });
})();

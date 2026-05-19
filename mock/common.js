// 矿珍库 mock 公共 JS
// 全局币种切换(localStorage 持久化,跨页面保持)
(function(){
  const CURS=[
    {code:'JPY', sym:'¥'},
    {code:'CNY', sym:'¥'},
    {code:'USD', sym:'$'},
    {code:'EUR', sym:'€'}
  ];
  function getIdx(){return parseInt(localStorage.getItem('mockCurIdx')||'0');}
  function apply(){
    const c=CURS[getIdx()];
    document.querySelectorAll('.s1-cur-chip').forEach(el=>{
      el.textContent=`${c.sym} ${c.code}`;
    });
  }
  window.cycleCur=function(){
    let i=(getIdx()+1)%CURS.length;
    localStorage.setItem('mockCurIdx', i);
    apply();
  };
  if(document.readyState!=='loading') apply();
  else document.addEventListener('DOMContentLoaded', apply);
})();

// ========= 全局搜索 overlay =========
const MOCK_PRODUCTS=[
  {name:'阿勒泰陨石原石',  cat:'🪨 陨石',  sku:'MZ-MET-001', price:'¥ 2,800', qty:5},
  {name:'黄金葫芦吊坠',    cat:'💍 首饰',  sku:'MZ-JEW-007', price:'¥ 4,580', qty:2},
  {name:'老葫芦把件',      cat:'🥒 葫芦',  sku:'MZ-HLO-003', price:'¥ 880',   qty:8},
  {name:'橄榄陨铁',        cat:'🪨 陨石',  sku:'MZ-MET-012', price:'¥ 1,200', qty:0},
  {name:'天然绿萤石',      cat:'💎 矿物',  sku:'MZ-MIN-018', price:'¥ 360',   qty:3},
  {name:'玫瑰金镶嵌戒指',  cat:'💍 首饰',  sku:'MZ-JEW-022', price:'¥ 2,200', qty:6},
  {name:'巴西紫水晶簇',    cat:'💎 矿物',  sku:'MZ-MIN-021', price:'¥ 1,200', qty:12},
  {name:'摩洛哥三叶虫化石',cat:'🦴 化石',  sku:'MZ-FOS-005', price:'¥ 2,100', qty:4},
  {name:'青金石手串',      cat:'💍 首饰',  sku:'MZ-JEW-031', price:'¥ 980',   qty:7},
  {name:'海蓝宝戒指',      cat:'💍 首饰',  sku:'MZ-JEW-019', price:'¥ 1,800', qty:5},
  {name:'天然托帕石吊坠',  cat:'💍 首饰',  sku:'MZ-JEW-014', price:'¥ 1,500', qty:3},
  {name:'萤石球 (绿)',     cat:'💎 矿物',  sku:'MZ-MIN-009', price:'¥ 850',   qty:6},
];
const RECENT_KW=['陨石','黄金','¥1000+','缺货','MZ-MET'];

function gsRender(kw){
  const k=(kw||'').trim().toLowerCase();
  const results=k
    ? MOCK_PRODUCTS.filter(p=>(p.name+p.sku+p.cat).toLowerCase().includes(k)).slice(0,8)
    : MOCK_PRODUCTS.slice(0,5);  // 空 keyword 展示前 5 个最近
  const body=document.getElementById('gsBody');
  body.innerHTML = k
    ? (results.length===0
        ? `<div class="gs-empty">未找到「${kw}」相关商品<br><br>试试扫描条形码或换个关键词</div>`
        : `<div class="gs-sec"><div class="gs-sec-title">搜索结果 · ${results.length} 项</div>` + results.map(p=>gsItem(p)).join('') + `</div>`)
    : `<div class="gs-sec">
         <div class="gs-sec-title">最近搜索</div>
         <div class="gs-chips">${RECENT_KW.map(k=>`<div class="gs-chip" onclick="gsSet('${k}')">${k}</div>`).join('')}</div>
       </div>
       <div class="gs-sec">
         <div class="gs-sec-title">推荐 · 全部商品</div>
         ${results.map(p=>gsItem(p)).join('')}
       </div>`;
}
function gsItem(p){
  const emoji=p.cat.split(' ')[0];
  return `<a class="gs-result" href="screen-3-detail.html">
    <div class="gs-result-thumb">${emoji}</div>
    <div class="gs-result-info">
      <div class="gs-result-name">${p.name}</div>
      <div class="gs-result-meta">${p.cat.replace(emoji,'').trim()} · ${p.sku} · <b>${p.price}</b> · 库存 ${p.qty}</div>
    </div>
  </a>`;
}
function gsSet(kw){
  const input=document.getElementById('gsInput');
  input.value=kw;
  gsRender(kw);
}
window.openSearch=function(){
  if(!document.getElementById('gsOverlay')){
    const ov=document.createElement('div');
    ov.id='gsOverlay';
    ov.className='gs-overlay';
    ov.innerHTML=`
      <div class="gs-bar">
        <div class="gs-input-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="gs-input" id="gsInput" placeholder="商品名 / SKU / 扫码..." autocomplete="off">
        </div>
        <div class="gs-close" onclick="closeSearch()">×</div>
      </div>
      <div class="gs-body" id="gsBody"></div>
    `;
    document.body.appendChild(ov);
    ov.addEventListener('click',e=>{ if(e.target===ov) closeSearch(); });
    document.getElementById('gsInput').addEventListener('input',e=>gsRender(e.target.value));
  }
  document.getElementById('gsOverlay').classList.add('show');
  gsRender('');
  setTimeout(()=>document.getElementById('gsInput').focus(), 50);
};
window.closeSearch=function(){
  const ov=document.getElementById('gsOverlay');
  if(ov) ov.classList.remove('show');
};
document.addEventListener('keydown',e=>{
  if(e.key==='Escape') closeSearch();
});

// ========= 全局确认对话框 mockConfirm({title, message, okText, okClass, onOk, cancelText}) =========
window.mockConfirm=function(opts){
  opts=opts||{};
  const title=opts.title||'确认操作?';
  const message=opts.message||'';
  const okText=opts.okText||'确认';
  const cancelText=opts.cancelText||'取消';
  const okClass=opts.okClass||'btn-gold';
  const danger=okClass==='btn-rose'||opts.danger;
  const icon=opts.icon||(danger?'🗑':'?');
  let ov=document.getElementById('mcOverlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='mcOverlay';
    ov.className='mc-overlay';
    document.body.appendChild(ov);
  }
  ov.innerHTML=`
    <div class="mc-card${danger?' danger':''}">
      <div class="mc-icon">${icon}</div>
      <div class="mc-title">${title}</div>
      <div class="mc-msg">${message}</div>
      <div class="mc-actions">
        <button class="btn btn-ghost" id="mcCancel">${cancelText}</button>
        <button class="btn ${okClass}" id="mcOk">${okText}</button>
      </div>
    </div>`;
  ov.classList.add('show');
  const close=()=>{ov.classList.remove('show');};
  document.getElementById('mcCancel').onclick=close;
  document.getElementById('mcOk').onclick=()=>{ close(); if(opts.onOk) opts.onOk(); };
  ov.onclick=(e)=>{ if(e.target===ov) close(); };
  const onKey=(e)=>{ if(e.key==='Escape'){close(); document.removeEventListener('keydown',onKey);} };
  document.addEventListener('keydown',onKey);
};

// 顶部图标按钮占位提示
window.mockTip=function(msg){
  // 简易提示(避免阻塞 alert)
  let t=document.getElementById('mockTip');
  if(!t){
    t=document.createElement('div');
    t.id='mockTip';
    t.style.cssText='position:fixed;left:50%;top:80px;transform:translateX(-50%);background:rgba(20,20,20,0.95);border:1px solid #8e7b3c;color:#e6c478;padding:10px 18px;border-radius:8px;font-size:12px;z-index:2000;box-shadow:0 4px 24px rgba(0,0,0,0.6);pointer-events:none;transition:opacity 0.3s;letter-spacing:1px;';
    document.body.appendChild(t);
  }
  t.textContent=msg;
  t.style.opacity='1';
  clearTimeout(window._mockTipT);
  window._mockTipT=setTimeout(()=>{t.style.opacity='0';},1800);
};

// ===================== SUPABASE =====================
const SUPABASE_URL='https://dvpkitoobvvskerxtraz.supabase.co';
const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2cGtpdG9vYnZ2c2tlcnh0cmF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTUxMjIsImV4cCI6MjA5NDA5MTEyMn0.Ec9vRagr6AUWQPdU5efHuqD-5Woc-N3-VqPUP7A1zCw';
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

// ===================== LOCAL CACHE =====================
let DB={products:[],logs:[],showItems:[]};
let editingId=null,detailId=null,pendingPhotos=[];
let catFilter='all',zxingReader=null;

// ===================== SYNC STATUS =====================
function setSyncStatus(status){
  const dot=document.getElementById('sync-dot');
  dot.className='sync-dot';
  if(status==='syncing')dot.classList.add('syncing');
  if(status==='error')dot.classList.add('error');
}

// ===================== ZOOM PREVIEW =====================
let _zoomTimer=null;
async function showZoomPreview(el,pid){
  if(matchMedia('(hover:none)').matches)return;
  clearTimeout(_zoomTimer);
  _zoomTimer=setTimeout(async()=>{
    const preview=document.getElementById('zoom-preview');
    const img=document.getElementById('zoom-img');
    const info=document.getElementById('zoom-info');
    const p=getProduct(pid);
    if(!p)return;
    
    // 先用缩略图显示
    img.src=el.src;
    info.textContent=p.name+(p.price?' · ¥'+p.price:'');
    
    // 定位（鼠标右下方）
    const rect=el.getBoundingClientRect();
    preview.style.display='block';
    const pw=preview.offsetWidth,ph=preview.offsetHeight;
    let x=rect.right+10,y=rect.top;
    if(x+pw>window.innerWidth)x=rect.left-pw-10;
    if(y+ph>window.innerHeight)y=window.innerHeight-ph-10;
    if(y<10)y=10;
    preview.style.left=x+'px';
    preview.style.top=y+'px';
    
    // 后台加载高清原图
    try{
      const {data}=await sb.from('products').select('photos').eq('id',pid).single();
      if(data&&data.photos&&data.photos[0]){
        img.src=data.photos[0];
      }
    }catch(e){}
  },200); // 200ms延迟，避免快速划过
}

function hideZoomPreview(){
  clearTimeout(_zoomTimer);
  document.getElementById('zoom-preview').style.display='none';
}

// ===================== UTILS =====================
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function fmt(ts){const d=new Date(ts);return`${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;}
function fmtFull(ts){const d=new Date(ts);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;}
function toast(msg,dur=2500){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),dur);}
function getProduct(id){return DB.products.find(p=>p.id===id);}
function allCats(){return[...new Set(DB.products.map(p=>p.cat||'未分类'))].sort();}
function catEmoji(cat){if(!cat)return'📦';const c=cat.toLowerCase();if(c.includes('首饰')||c.includes('项链')||c.includes('戒'))return'💍';if(c.includes('矿')||c.includes('标本'))return'🪨';if(c.includes('元石')||c.includes('宝石')||c.includes('水晶'))return'💎';if(c.includes('化石'))return'🦕';return'📦';}
async function compressImage(file){return new Promise(res=>{const r=new FileReader();r.onload=e=>{const img=new Image();img.onload=()=>{let w=img.width,h=img.height;const mx=800;if(w>mx||h>mx){const s=Math.min(mx/w,mx/h);w=Math.round(w*s);h=Math.round(h*s);}const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);let q=0.82;const go=()=>{const d=c.toDataURL('image/jpeg',q);if((d.length*3/4)/1024<=200||q<=0.2)res(d);else{q-=0.1;go();}};go();};img.src=e.target.result;};r.readAsDataURL(file);});}

// 从base64生成200x200缩略图
async function generateThumbnail(b64){
  if(!b64)return null;
  return new Promise((res,rej)=>{
    const img=new Image();
    img.onload=()=>{
      const size=200;
      const c=document.createElement('canvas');
      c.width=size;c.height=size;
      const ctx=c.getContext('2d');
      const m=Math.min(img.width,img.height);
      const sx=(img.width-m)/2;
      const sy=(img.height-m)/2;
      ctx.drawImage(img,sx,sy,m,m,0,0,size,size);
      res(c.toDataURL('image/jpeg',0.75));
    };
    img.onerror=()=>res(null);
    img.src=b64;
  });
}

// ===================== SUPABASE CRUD =====================
async function loadAll(){
  setSyncStatus('syncing');
  try{
    // 优先尝试带 currency 字段,失败回退(支持没跑 ALTER 的情况)
    let pResp=await sb.from('products').select('id,name,sku,cat,price,currency,origin,country,note,qty,thumbnail,created_at').order('created_at',{ascending:false});
    if(pResp.error){
      console.warn('[currency] products 列不存在,回退到旧 schema',pResp.error.message);
      pResp=await sb.from('products').select('id,name,sku,cat,price,origin,country,note,qty,thumbnail,created_at').order('created_at',{ascending:false});
      toast('⚠️ 数据库未加 currency 列,请尽快跑 SQL',6000);
    }
    const s=await sb.from('show_items').select('*').order('ts',{ascending:false}).limit(200);
    DB.products=(pResp.data||[]).map(dbToProduct);
    DB.showItems=(s.data||[]).map(dbToShow);
    DB.logs=[];
    setSyncStatus('ok');
  }catch(e){
    setSyncStatus('error');
    toast('⚠️ 云端连接失败，请检查网络');
  }
  document.getElementById('loading-overlay').style.display='none';
  renderInventory();
}

// DB field mapping
function productToDb(p){return{id:p.id,name:p.name,sku:p.sku,cat:p.cat,price:p.price,currency:p.currency||'JPY',origin:p.origin,country:p.country,note:p.note,qty:p.qty,photos:p.photos||[],thumbnail:p.thumbnail||null,created_at:p.createdAt?new Date(p.createdAt).toISOString():new Date().toISOString()};}
function dbToProduct(r){return{id:r.id,name:r.name,sku:r.sku,cat:r.cat,price:r.price,currency:r.currency||'CNY',origin:r.origin,country:r.country,note:r.note,qty:r.qty||0,photos:r.photos,thumbnail:r.thumbnail,createdAt:new Date(r.created_at).getTime()};}
function logToDb(l){return{id:l.id,product_id:l.productId,type:l.type,qty:l.qty,note:l.note,price:l.price,currency:l.currency||'JPY',ts:new Date(l.ts).toISOString()};}
function dbToLog(r){return{id:r.id,productId:r.product_id,type:r.type,qty:r.qty,note:r.note,price:r.price,currency:r.currency||'CNY',ts:new Date(r.ts).getTime()};}
function showToDb(s){return{id:s.id,product_id:s.productId,qty:s.qty,show_name:s.showName,ts:new Date(s.ts).toISOString()};}
function dbToShow(r){return{id:r.id,productId:r.product_id,qty:r.qty,showName:r.show_name,ts:new Date(r.ts).getTime()};}

async function upsertProduct(p){
  // 自动生成缩略图（如果有照片且没缩略图）
  if(p.photos&&p.photos[0]&&!p.thumbnail){
    try{
      p.thumbnail=await generateThumbnail(p.photos[0]);
    }catch(e){console.log('缩略图生成失败',e);}
  }
  // 如果没有照片，清空缩略图
  if(!p.photos||!p.photos.length){p.thumbnail=null;}
  setSyncStatus('syncing');
  const payload=productToDb(p);
  let{error}=await sb.from('products').upsert(payload);
  if(error&&/currency/i.test(error.message||'')){
    // currency 列不存在,去掉重试
    delete payload.currency;
    ({error}=await sb.from('products').upsert(payload));
  }
  if(error){toast('❌ 保存失败：'+error.message);setSyncStatus('error');}
  else setSyncStatus('ok');
}
async function deleteProduct(id){
  await sb.from('logs').delete().eq('product_id',id);
  await sb.from('show_items').delete().eq('product_id',id);
  await sb.from('products').delete().eq('id',id);
}
async function insertLog(l){
  const payload=logToDb(l);
  let{error}=await sb.from('logs').insert(payload);
  if(error&&/currency/i.test(error.message||'')){
    delete payload.currency;
    ({error}=await sb.from('logs').insert(payload));
  }
  if(error)toast('❌ 流水保存失败：'+error.message);
}
async function upsertShow(s){
  await sb.from('show_items').upsert(showToDb(s));
}
async function deleteShow(id){
  await sb.from('show_items').delete().eq('id',id);
}

// ===================== 货币 / 汇率 =====================
// 数据库存的金额一律视为 CNY(人民币),显示时按 currentCurrency 换算
const CURRENCIES=['JPY','CNY','USD','EUR'];
const CURRENCY_SYMBOL={JPY:'¥',CNY:'¥',USD:'$',EUR:'€'};
// 库存页 / 详情页 各自独立的显示货币(都默认 JPY)
let inventoryCurrency=localStorage.getItem('mz_inv_currency')||'JPY';
let detailCurrency=localStorage.getItem('mz_detail_currency')||'JPY';
// currentCurrency 保留作为兜底(用户没指定 toCur 时用)
let currentCurrency='JPY';
// 默认 fallback 汇率(CNY 基准, API 拉失败时用),会被 loadFxRates 覆盖
let fxRates={CNY:1,JPY:20.5,USD:0.137,EUR:0.127};
let fxUpdatedAt=0;
async function loadFxRates(){
  try{
    const cached=localStorage.getItem('mz_fx_v2');
    if(cached){
      const c=JSON.parse(cached);
      if(c.rates&&c.base==='CNY'&&Date.now()-c.ts<6*3600*1000){fxRates=c.rates;fxUpdatedAt=c.ts;return;}
    }
    const r=await fetch('https://api.frankfurter.app/latest?from=CNY&to=JPY,USD,EUR');
    if(!r.ok)throw new Error('fx http '+r.status);
    const j=await r.json();
    fxRates={CNY:1,JPY:j.rates.JPY,USD:j.rates.USD,EUR:j.rates.EUR};
    fxUpdatedAt=Date.now();
    localStorage.setItem('mz_fx_v2',JSON.stringify({rates:fxRates,base:'CNY',ts:fxUpdatedAt}));
  }catch(e){/* 用默认 fxRates 兜底 */}
}
// 把 value (单位 fromCur) 换算成 toCur 的数值
function convertCurrency(value,fromCur,toCur){
  const n=parseFloat(value);
  if(isNaN(n))return NaN;
  fromCur=fromCur||'CNY';toCur=toCur||'CNY';
  if(fromCur===toCur)return n;
  // fxRates 是 CNY 基准: 1 CNY = fxRates[X] X
  const valInCNY=n/(fxRates[fromCur]||1);
  return valInCNY*(fxRates[toCur]||1);
}
// 显示价格:value 是 fromCur 单位,要按 toCur 显示(默认按 currentCurrency)
function fmtPrice(value,toCur,fromCur){
  toCur=toCur||currentCurrency;
  fromCur=fromCur||'CNY';
  if(value===null||value===undefined||value==='')return '—';
  const conv=convertCurrency(value,fromCur,toCur);
  if(isNaN(conv))return '—';
  const sym=CURRENCY_SYMBOL[toCur]||'';
  if(toCur==='JPY'||toCur==='CNY')return sym+Math.round(conv).toLocaleString();
  return sym+conv.toFixed(2);
}
// 显示原币种价格(不换算),用于流水
function fmtPriceRaw(value,cur){
  if(value===null||value===undefined||value==='')return '—';
  const n=parseFloat(value);
  if(isNaN(n))return '—';
  cur=cur||'CNY';
  const sym=CURRENCY_SYMBOL[cur]||'';
  return sym+n.toLocaleString();
}
// 库存页货币(只影响库存列表)
function setInventoryCurrency(c){
  if(!CURRENCIES.includes(c))return;
  inventoryCurrency=c;
  localStorage.setItem('mz_inv_currency',c);
  const sel=document.querySelector('.inv-currency-select');
  if(sel&&sel.value!==c)sel.value=c;
  if(typeof renderInventory==='function')renderInventory();
  // 统计页若已渲染过,跟着切币种
  if(document.getElementById('stats-money-row')&&typeof renderStats==='function')renderStats();
}
// 详情页货币(只影响详情)
function setDetailCurrency(c){
  if(!CURRENCIES.includes(c))return;
  detailCurrency=c;
  localStorage.setItem('mz_detail_currency',c);
  if(typeof detailId!=='undefined'&&detailId&&document.getElementById('modal-detail')&&document.getElementById('modal-detail').classList.contains('open'))openDetail(detailId);
}
// 兼容:旧 onchange 调用
function setCurrency(c){setInventoryCurrency(c);}
// DOM 加载完后,把库存页 select 同步到 inventoryCurrency
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{const s=document.querySelector('.inv-currency-select');if(s)s.value=inventoryCurrency;});
else {const s=document.querySelector('.inv-currency-select');if(s)s.value=inventoryCurrency;}
loadFxRates();

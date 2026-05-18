// ===================== LOGS =====================
async function filterLogs(type){
  // 不分页，拉所有符合条件的（用于CSV/打印）
  const searchEl=document.getElementById(type+'-log-search');
  const catEl=document.getElementById(type+'-log-cat');
  const fromEl=document.getElementById(type+'-log-date-from');
  const toEl=document.getElementById(type+'-log-date-to');
  const q=(searchEl?searchEl.value:'').toLowerCase();
  const cat=catEl?catEl.value:'';
  const from=fromEl&&fromEl.value?new Date(fromEl.value).toISOString():null;
  const to=toEl&&toEl.value?new Date(toEl.value+'T23:59:59').toISOString():null;
  let allowedPids=null;
  if(q||cat){
    allowedPids=DB.products.filter(p=>{
      if(q&&!p.name.toLowerCase().includes(q))return false;
      if(cat&&(p.cat||'')!==cat)return false;
      return true;
    }).map(p=>p.id);
    if(!allowedPids.length)return [];
  }
  let dataQ=sb.from('logs').select('*').eq('type',type).order('ts',{ascending:false}).limit(5000);
  if(from)dataQ=dataQ.gte('ts',from);
  if(to)dataQ=dataQ.lte('ts',to);
  if(allowedPids)dataQ=dataQ.in('product_id',allowedPids);
  const{data}=await dataQ;
  return (data||[]).map(dbToLog);
}

let _logCatCache='';
function updateLogCatOptions(type,force){
  const sel=document.getElementById(type+'-log-cat');
  if(!sel)return;
  const cats=[...new Set(DB.products.map(p=>p.cat||'').filter(Boolean))].sort();
  const sig=cats.join('|');
  if(!force&&sig===_logCatCache)return; // 没变就不重建
  _logCatCache=sig;
  const cur=sel.value;
  sel.innerHTML='<option value="">全部类别</option>'+cats.map(c=>`<option value="${c}" ${c===cur?'selected':''}>${c}</option>`).join('');
}

function renderSummary(logs, elId){
  const el=document.getElementById(elId);if(!el)return;
  const totalQty=logs.reduce((a,l)=>a+l.qty,0);
  const totalBaseJpy=logs.reduce((a,l)=>{
    const bp=l.basePrice; const q=l.qty;
    return a + (bp && q ? parseFloat(bp)*q : 0);
  }, 0);
  const totalDisp=convertCurrency(totalBaseJpy,'JPY',inventoryCurrency);
  el.innerHTML=`
    <span>📦 共 <b>${logs.length}</b> 条记录</span>
    <span>🔢 总数量 <b>${totalQty}</b> 件</span>
    ${totalBaseJpy>0?`<span>💰 合计金额 <b style="color:var(--gold);">${fmtPrice(totalDisp||totalBaseJpy, inventoryCurrency, inventoryCurrency)}</b></span>`:''}
  `;
}

// ===================== 分页 =====================
const LOGS_PER_PAGE=20;
let logPageState={in:{page:1,total:0,totalPages:0},out:{page:1,total:0,totalPages:0}};

async function fetchLogsPage(type){
  const st=logPageState[type];
  const offset=(st.page-1)*LOGS_PER_PAGE;
  
  const searchEl=document.getElementById(type+'-log-search');
  const catEl=document.getElementById(type+'-log-cat');
  const fromEl=document.getElementById(type+'-log-date-from');
  const toEl=document.getElementById(type+'-log-date-to');
  const q=(searchEl?searchEl.value:'').toLowerCase();
  const cat=catEl?catEl.value:'';
  const from=fromEl&&fromEl.value?new Date(fromEl.value).toISOString():null;
  const to=toEl&&toEl.value?new Date(toEl.value+'T23:59:59').toISOString():null;
  
  console.log('[fetchLogsPage]', type, {page: st.page, q, cat, from, to});
  try{
    let allowedPids=null;
    if(q||cat){
      allowedPids=DB.products.filter(p=>{
        if(q&&!p.name.toLowerCase().includes(q))return false;
        if(cat&&(p.cat||'')!==cat)return false;
        return true;
      }).map(p=>p.id);
      if(allowedPids.length===0){
        st.total=0;st.totalPages=0;
        renderLogsTable(type,[]);
        return;
      }
    }
    
    // 查总数
    let countQ=sb.from('logs').select('*',{count:'exact',head:true}).eq('type',type);
    if(from)countQ=countQ.gte('ts',from);
    if(to)countQ=countQ.lte('ts',to);
    if(allowedPids)countQ=countQ.in('product_id',allowedPids);
    const cnt=await countQ;
    console.log('[count result]', type, cnt);
    if(cnt.error){throw cnt.error;}
    const count=cnt.count;
    st.total=count||0;
    toast(`查询 ${type}: ${count} 条`,1500);
    st.totalPages=Math.max(1,Math.ceil(st.total/LOGS_PER_PAGE));
    if(st.page>st.totalPages)st.page=st.totalPages;
    
    // 查数据
    let dataQ=sb.from('logs').select('*').eq('type',type).order('ts',{ascending:false}).range(offset,offset+LOGS_PER_PAGE-1);
    if(from)dataQ=dataQ.gte('ts',from);
    if(to)dataQ=dataQ.lte('ts',to);
    if(allowedPids)dataQ=dataQ.in('product_id',allowedPids);
    const dq=await dataQ;
    console.log('[data result]', type, dq);
    if(dq.error)throw dq.error;
    const logs=(dq.data||[]).map(dbToLog);
    renderLogsTable(type,logs);
  }catch(e){
    console.log(e);
    toast('⚠️ 加载失败: '+(e.message||e));
    const tbody=document.getElementById(type+'-log-tbody');
    if(tbody)tbody.innerHTML=`<tr><td colspan="7" style="text-align:center;color:var(--rose);padding:20px;">查询失败：${e.message||e}</td></tr>`;
  }
}

function renderLogsTable(type,logs){
  const st=logPageState[type];
  const tbody=document.getElementById(type+'-log-tbody');
  if(!tbody)return;
  
  // 汇总(只算当前页)
  const totalQty=logs.reduce((a,l)=>a+l.qty,0);
  const totalBaseJpy=logs.reduce((a,l)=>a+(l.basePrice&&l.qty?parseFloat(l.basePrice)*l.qty:0),0);
  const totalDisp=convertCurrency(totalBaseJpy,'JPY',inventoryCurrency);

  const sumEl=document.getElementById(type+'-log-summary');
  if(sumEl){
    sumEl.innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;">
      <span>📦 共 <b style="color:var(--gold);">${st.total}</b> 条</span>
      <span>📄 第 <b>${st.page}</b> / <b>${st.totalPages}</b> 页</span>
      <span>🔢 本页 <b>${totalQty}</b> 件</span>
      ${totalBaseJpy>0?`<span>💰 <b style="color:var(--gold);">${fmtPrice(totalDisp||totalBaseJpy, inventoryCurrency, inventoryCurrency)}</b></span>`:''}
    </div>`;
  }
  const totalPages=st.totalPages||1;
  const pagerHtml=`
    <button class="btn btn-outline" style="padding:5px 10px;font-size:12px;" onclick="goLogPage('${type}',1)" ${st.page<=1?'disabled':''}>⏮ 首页</button>
    <button class="btn btn-outline" style="padding:5px 10px;font-size:12px;" onclick="goLogPage('${type}',${st.page-1})" ${st.page<=1?'disabled':''}>◀ 上一页</button>
    <span style="padding:5px 10px;font-size:12px;color:var(--text-muted);">${st.page} / ${totalPages}</span>
    <button class="btn btn-outline" style="padding:5px 10px;font-size:12px;" onclick="goLogPage('${type}',${st.page+1})" ${st.page>=totalPages?'disabled':''}>下一页 ▶</button>
    <button class="btn btn-outline" style="padding:5px 10px;font-size:12px;" onclick="goLogPage('${type}',${totalPages})" ${st.page>=totalPages?'disabled':''}>末页 ⏭</button>
  `;
  ['', '-top'].forEach(suffix=>{
    const el=document.getElementById(`${type}-log-pager${suffix}`);
    if(el)el.innerHTML=pagerHtml;
  });
  
  if(!logs.length){
    tbody.innerHTML=`<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px;">${st.total===0?'暂无'+(type==='in'?'入库':'出库')+'记录':'本页无记录'}</td></tr>`;
    return;
  }
  
  tbody.innerHTML=logs.map(l=>logRow(l,type)).join('');
}

function goLogPage(type,page){
  if(page<1)page=1;
  if(page>logPageState[type].totalPages)page=logPageState[type].totalPages;
  logPageState[type].page=page;
  fetchLogsPage(type);
}

function renderInLogs(){
  updateLogCatOptions('in');
  logPageState.in.page=1;
  fetchLogsPage('in');
}
function renderOutLogs(){
  updateLogCatOptions('out');
  logPageState.out.page=1;
  fetchLogsPage('out');
}
function logRow(l,type){
  const p=getProduct(l.productId);
  const price=l.originalPrice?parseFloat(l.originalPrice):(l.price?parseFloat(l.price):null);
  const subtotal=price&&l.qty?price*l.qty:null;
  const cur=l.originalCurrency||l.currency||'CNY';
  const color=type==='in'?'var(--jade-light)':'var(--rose-light)';
  return`<tr class="clickable" onclick="openLogDetail('${l.id}')">
    <td class="td-mono" style="white-space:nowrap;">${fmt(l.ts)}</td>
    <td style="max-width:120px;">${p?p.name:'已删除'}</td>
    <td style="font-size:11px;"><span style="background:var(--surface2);padding:2px 6px;border-radius:8px;">${p?p.cat||'—':'—'}</span></td>
    <td style="font-family:'DM Mono',monospace;color:${color};text-align:center;">${type==='in'?'+':'−'}${l.qty}</td>
    <td style="color:var(--gold);text-align:right;white-space:nowrap;">${price?fmtPriceRaw(price,cur):'—'}</td>
    <td style="color:var(--gold);font-weight:600;text-align:right;white-space:nowrap;">${subtotal?fmtPriceRaw(subtotal,cur):'—'}</td>
    <td style="color:var(--text-muted);font-size:12px;">${l.note||'—'}</td>
  </tr>`;
}
async function exportLogCSV(type){
  const logs=await filterLogs(type);
  const label=type==='in'?'入库':'出库';
  const rows=[['日期','商品名','SKU','类别','数量','原始单价','原始币种','汇率','本位单价(JPY)','小计(JPY)','备注']];
  logs.forEach(l=>{
    const p=getProduct(l.productId);
    const op=l.originalPrice||l.price||'';
    const oc=l.originalCurrency||l.currency||'';
    const fx=l.fxRate||'';
    const bp=l.basePrice||'';
    const subBase=(bp&&l.qty)?parseFloat(bp)*l.qty:'';
    rows.push([
      fmtFull(l.ts),
      p?p.name:'已删除',
      p?p.sku||'':'',
      p?p.cat||'':'',
      l.qty,
      op,
      oc,
      fx,
      bp,
      subBase,
      l.note||''
    ]);
  });
  // 合计行
  const totalQty=logs.reduce((a,l)=>a+l.qty,0);
  const totalBaseJpy=logs.reduce((a,l)=>a+(l.basePrice&&l.qty?parseFloat(l.basePrice)*l.qty:0),0);
  const totalDisp=convertCurrency(totalBaseJpy,'JPY',inventoryCurrency)||totalBaseJpy;
  rows.push(['合计','','','',totalQty,'','','','',totalBaseJpy,'']);
  rows.push([`全局币种合计(${inventoryCurrency})`,'','','','','','','','',Math.round(totalDisp),'']);
  
  const bom='﻿';
  const csv=bom+rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`矿珍库_${label}记录_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  toast(`✅ ${label}记录已导出`);
}

async function printLogs(type){
  const logs=await filterLogs(type);
  const label=type==='in'?'入库':'出库';
  const totalQty=logs.reduce((a,l)=>a+l.qty,0);
  const totalBaseJpy=logs.reduce((a,l)=>a+(l.basePrice&&l.qty?parseFloat(l.basePrice)*l.qty:0),0);
  const totalDisp=convertCurrency(totalBaseJpy,'JPY',inventoryCurrency)||totalBaseJpy;
  const rows=logs.map(l=>{
    const p=getProduct(l.productId);
    const op=l.originalPrice?parseFloat(l.originalPrice):(l.price?parseFloat(l.price):null);
    const oc=l.originalCurrency||l.currency||'CNY';
    const fx=l.fxRate?parseFloat(l.fxRate):null;
    const bp=l.basePrice?parseFloat(l.basePrice):null;
    const subBase=bp&&l.qty?bp*l.qty:null;
    return`<tr>
      <td>${fmtFull(l.ts)}</td>
      <td>${p?p.name:'已删除'}</td>
      <td>${p?p.sku||'—':'—'}</td>
      <td>${p?p.cat||'—':'—'}</td>
      <td style="text-align:center;">${l.qty}</td>
      <td style="text-align:right;">${op?fmtPriceRaw(op,oc):'—'}</td>
      <td style="text-align:center;">${oc}</td>
      <td style="text-align:right;">${fx?fx.toFixed(4):'—'}</td>
      <td style="text-align:right;">${bp?fmtPriceRaw(bp,'JPY'):'—'}</td>
      <td style="text-align:right;">${subBase?fmtPriceRaw(subBase,'JPY'):'—'}</td>
      <td>${l.note||'—'}</td>
    </tr>`;
  }).join('');
  
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>矿珍库 ${label}记录</title>
    <style>
      body{font-family:sans-serif;font-size:12px;padding:20px;color:#111;}
      h2{margin-bottom:4px;}
      .sub{color:#666;margin-bottom:16px;font-size:11px;}
      table{width:100%;border-collapse:collapse;}
      th{background:#f0f0f0;padding:6px 8px;text-align:left;border:1px solid #ddd;font-size:11px;}
      td{padding:5px 8px;border:1px solid #eee;}
      tr:nth-child(even){background:#fafafa;}
      .summary{margin-top:12px;padding:10px;background:#f5f5f5;border-radius:4px;display:flex;gap:24px;}
      .summary b{color:#b8860b;}
      @media print{button{display:none;}}
    </style>
  </head><body>
    <h2>矿珍库 · ${label}记录</h2>
    <div class="sub">导出时间：${fmtFull(Date.now())} · 共${logs.length}条</div>
    <table>
      <thead><tr><th>日期</th><th>商品名</th><th>SKU</th><th>类别</th><th>数量</th><th>原始单价</th><th>原始币种</th><th>汇率</th><th>本位单价(JPY)</th><th>小计(JPY)</th><th>备注</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="summary">
      <span>总数量：<b>${totalQty}</b> 件</span>
      ${totalBaseJpy>0?`<span>合计金额(按当前显示币种)：<b>${fmtPrice(totalDisp, inventoryCurrency, inventoryCurrency)}</b></span>`:''}
    </div>
    <br><button onclick="window.print()">🖨️ 打印</button>
  </body></html>`);
  w.document.close();
}

async function openLogDetail(lid){
  let l=DB.logs.find(x=>x.id===lid);
  if(!l){
    // 分页模式下DB.logs不完整，去数据库查
    try{
      const{data,error}=await sb.from('logs').select('*').eq('id',lid).single();
      if(error||!data){toast('找不到记录');return;}
      l=dbToLog(data);
    }catch(e){toast('查询失败');return;}
  }
  const p=getProduct(l.productId);
  const typeLabel={in:'⬆️ 入库',out:'⬇️ 出库',show:'🎪 展会带出',return:'↩️ 展会归还'};
  // fallback:本条没填进价,用同商品所有 in logs 换算到 JPY 的平均
  const inJpy=DB.logs.filter(x=>x.productId===l.productId&&x.type==='in'&&parseFloat(x.originalPrice||x.price)>0)
    .map(x=>convertCurrency(x.originalPrice||x.price, x.originalCurrency||x.currency||'CNY','JPY')).filter(v=>!isNaN(v));
  const avgInJpy=inJpy.length?Math.round(inJpy.reduce((a,b)=>a+b,0)/inJpy.length):0;
  const dispPrice=l.originalPrice||l.price||(avgInJpy>0?String(avgInJpy):null);
  const dispCurrency=(l.originalPrice||l.price)?(l.originalCurrency||l.currency||'CNY'):'JPY';
  const dispSym=(typeof CURRENCY_SYMBOL!=='undefined'&&CURRENCY_SYMBOL[dispCurrency])||'¥';
  const isFallback=!(l.originalPrice||l.price)&&avgInJpy>0;
  const priceLabel=l.type==='in'?'进价':(l.type==='out'?'售价':'单价');
  const amtLabel=l.type==='in'?'进货金额':(l.type==='out'?'销售金额':'金额');
  const priceColor=isFallback?'var(--text-muted)':'var(--gold)';
  document.getElementById('log-detail-body').innerHTML=`
    <div style="margin-bottom:14px;">
      <span class="badge badge-${l.type}">${typeLabel[l.type]||l.type}</span>
      <span class="td-mono" style="margin-left:10px;">${fmtFull(l.ts)}</span>
    </div>
    <div class="detail-grid">
      <div class="detail-field"><label>商品名称</label><div class="val">${p?p.name:'（已删除）'}</div></div>
      <div class="detail-field"><label>SKU</label><div class="val mono">${p?p.sku||'—':'—'}</div></div>
      <div class="detail-field"><label>数量</label><div class="val" style="font-size:20px;font-family:'DM Mono',monospace;color:${l.type==='in'||l.type==='return'?'var(--jade-light)':'var(--rose-light)'};">${l.type==='in'||l.type==='return'?'+':'−'}${l.qty}</div></div>
      ${dispPrice?`<div class="detail-field"><label>${priceLabel}</label><div class="val" style="color:${priceColor};">${dispSym}${dispPrice} <span style="font-size:12px;color:var(--text-dim);font-weight:500;">${dispCurrency}</span></div></div>`:''}
      ${dispPrice&&l.qty?`<div class="detail-field"><label>${amtLabel}</label><div class="val" style="color:${priceColor};font-weight:600;">${dispSym}${(parseFloat(dispPrice)*l.qty).toLocaleString()} <span style="font-size:12px;color:var(--text-dim);font-weight:500;">${dispCurrency}</span></div></div>`:''}
      ${l.note?`<div class="detail-field full"><label>备注</label><div class="val">${l.note}</div></div>`:''}
      ${p?`<div class="detail-field"><label>商品当前库存</label><div class="val mono">${p.qty} 件</div></div>`:''}
    </div>
    ${p?`<button class="btn btn-outline btn-sm" style="margin-top:8px;" onclick="closeModal('modal-log');openDetail('${p.id}')">查看商品详情 →</button>`:''}`;
  document.getElementById('modal-log').classList.add('open');
}
// ===================== STATS =====================
// 启动时 DB.logs 为空,只有进详情/流水 tab 才会拉一部分 — 统计需要全量,首次进 stats tab 时拉一次
let _statsLogsLoaded=false;
async function ensureAllLogsLoaded(){
  if(_statsLogsLoaded)return;
  try{
    const{data,error}=await sb.from('logs').select('*').order('ts',{ascending:false}).limit(10000);
    if(error)throw error;
    if(data){
      const existIds=new Set(DB.logs.map(l=>l.id));
      data.forEach(r=>{if(!existIds.has(r.id))DB.logs.push(dbToLog(r));});
    }
    _statsLogsLoaded=true;
  }catch(e){toast('⚠️ 统计数据加载失败:'+(e.message||e));}
}
const STATS_RANGES = [
  {key:'today', label:'今日', titleLabel:'今日'},
  {key:'week', label:'本周', titleLabel:'本周'},
  {key:'month', label:'本月', titleLabel:'本月'},
  {key:'quarter', label:'本季', titleLabel:'本季'},
  {key:'year', label:'本年', titleLabel:'本年'},
  {key:'all', label:'全部', titleLabel:'全部'}
];
let statsRangeIdx = 2; // 默认本月

function cycleStatsRange(el){
  statsRangeIdx = (statsRangeIdx + 1) % STATS_RANGES.length;
  const r = STATS_RANGES[statsRangeIdx];
  if(el) el.textContent = r.label + ' ▼';
  const titleEl = document.querySelector('.s8-range-title');
  if(titleEl) titleEl.textContent = r.titleLabel + '概况';
  renderStats();
}

function getStatsRange(){
  const now = new Date();
  const r = STATS_RANGES[statsRangeIdx];
  let from, to = now.getTime(), prevFrom = null, prevTo = null, bucketBy = 'day', bucketCount = 30;
  const startOfDay = d => { const x = new Date(d); x.setHours(0,0,0,0); return x.getTime(); };

  if(r.key === 'today'){
    from = startOfDay(now);
    prevTo = from - 1;
    prevFrom = startOfDay(prevTo);
    bucketBy = 'hour'; bucketCount = 24;
  } else if(r.key === 'week'){
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7; // 周一 0
    from = startOfDay(new Date(d.getTime() - day * 86400000));
    prevTo = from - 1;
    prevFrom = from - 7 * 86400000;
    bucketBy = 'day'; bucketCount = 7;
  } else if(r.key === 'month'){
    from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    prevTo = from - 1;
    prevFrom = startOfDay(new Date(now.getFullYear(), now.getMonth()-1, 1));
    bucketBy = 'day'; bucketCount = 30;
  } else if(r.key === 'quarter'){
    const qStart = Math.floor(now.getMonth()/3) * 3;
    from = startOfDay(new Date(now.getFullYear(), qStart, 1));
    prevTo = from - 1;
    prevFrom = startOfDay(new Date(now.getFullYear(), qStart-3, 1));
    bucketBy = 'week'; bucketCount = 13;
  } else if(r.key === 'year'){
    from = startOfDay(new Date(now.getFullYear(), 0, 1));
    prevTo = from - 1;
    prevFrom = startOfDay(new Date(now.getFullYear()-1, 0, 1));
    bucketBy = 'month'; bucketCount = 12;
  } else { // all
    const earliest = DB.logs.length
      ? DB.logs.reduce((m, l) => Math.min(m, new Date(l.ts).getTime()), Date.now())
      : Date.now();
    from = earliest;
    bucketBy = 'month'; bucketCount = 12;
  }
  return {from, to, prevFrom, prevTo, bucketBy, bucketCount};
}

async function renderStats(){
  await ensureAllLogsLoaded();
  const cur = inventoryCurrency;
  const sym = CURRENCY_SYMBOL[cur] || '';
  const range = getStatsRange();

  const pidOf = l => l.product_id || l.productId;
  const _origPrice = l => parseFloat(l.originalPrice || l.price) || 0;
  const _origCur = l => l.originalCurrency || l.currency || 'CNY';
  const logAmt = l => {
    if(l.basePrice && !isNaN(l.basePrice)){
      const v = convertCurrency(parseFloat(l.basePrice), 'JPY', cur);
      return (typeof v === 'number' && !isNaN(v)) ? v * l.qty : 0;
    }
    const v = convertCurrency(_origPrice(l), _origCur(l), cur);
    return (typeof v === 'number' && !isNaN(v)) ? v * l.qty : 0;
  };
  const inRange = (ts, from, to) => ts >= from && ts <= to;

  // ===== 1. 库存价值(售价 ×当前库存,跟期间无关)=====
  let stockValue = 0;
  DB.products.forEach(p=>{
    const v = convertCurrency(p.price, p.currency||'JPY', cur);
    if(!isNaN(v)) stockValue += v * p.qty;
  });

  // ===== 2. 期间销售额 / 期间销售件数 =====
  let salesAmt = 0, salesQty = 0;
  DB.logs.filter(l=>l.type==='out').forEach(l=>{
    const ts = new Date(l.ts).getTime();
    if(!inRange(ts, range.from, range.to)) return;
    salesAmt += logAmt(l);
    salesQty += l.qty;
  });

  // ===== 3. 期间销售对应成本 =====
  let salesCost = 0;
  DB.logs.filter(l=>l.type==='out').forEach(l=>{
    const ts = new Date(l.ts).getTime();
    if(!inRange(ts, range.from, range.to)) return;
    const pid = pidOf(l);
    const ins = DB.logs.filter(x=>x.type==='in' && pidOf(x)===pid && _origPrice(x)>0);
    if(!ins.length) return;
    ins.sort((a,b)=>new Date(b.ts) - new Date(a.ts));
    const lastIn = ins[0];
    const unitCost = (lastIn.basePrice && !isNaN(lastIn.basePrice))
      ? (convertCurrency(parseFloat(lastIn.basePrice),'JPY',cur)||0)
      : (convertCurrency(_origPrice(lastIn), _origCur(lastIn), cur)||0);
    salesCost += unitCost * l.qty;
  });
  const profit = salesAmt - salesCost;

  // ===== 4. 周转率 = 期间销售件数 / 期末库存件数 =====
  const totalStockQty = DB.products.reduce((a,p)=>a+p.qty,0);
  const turnover = totalStockQty > 0 ? (salesQty / totalStockQty) : 0;

  // ===== 5. 上期数据(算趋势) =====
  let prevSalesAmt = 0, prevProfit = 0;
  if(range.prevFrom !== null && range.prevTo !== null){
    let prevSalesCost = 0;
    DB.logs.filter(l=>l.type==='out').forEach(l=>{
      const ts = new Date(l.ts).getTime();
      if(!inRange(ts, range.prevFrom, range.prevTo)) return;
      prevSalesAmt += logAmt(l);
      const pid = pidOf(l);
      const ins = DB.logs.filter(x=>x.type==='in' && pidOf(x)===pid && new Date(x.ts).getTime()<=ts && _origPrice(x)>0);
      if(ins.length){
        ins.sort((a,b)=>new Date(b.ts)-new Date(a.ts));
        const lastIn = ins[0];
        const unitCost = (lastIn.basePrice && !isNaN(lastIn.basePrice))
          ? (convertCurrency(parseFloat(lastIn.basePrice),'JPY',cur)||0)
          : (convertCurrency(_origPrice(lastIn), _origCur(lastIn), cur)||0);
        prevSalesCost += unitCost * l.qty;
      }
    });
    prevProfit = prevSalesAmt - prevSalesCost;
  }

  // ===== 6. 渲染 4 张卡 =====
  const fmtMoney = v => {
    if(v >= 10000) return sym + (v/1000).toFixed(1) + 'K';
    return sym + Math.round(v).toLocaleString();
  };
  const fmtTrend = (cur_, prev_) => {
    if(!prev_ || prev_ === 0) return {txt: '—', cls: ''};
    const pct = (cur_ - prev_) / prev_ * 100;
    const cls = pct >= 0 ? 'up' : 'down';
    const arrow = pct >= 0 ? '↑' : '↓';
    return {txt: arrow + ' ' + Math.abs(pct).toFixed(1) + '%', cls};
  };

  const setText = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
  const setHTML = (id, html) => { const el = document.getElementById(id); if(el) el.innerHTML = html; };
  const setAttr = (id, name, val) => { const el = document.getElementById(id); if(el) el.setAttribute(name, val); };

  setText('stats-v-stockvalue', fmtMoney(stockValue));
  setText('stats-v-sales', fmtMoney(salesAmt));
  setText('stats-v-profit', fmtMoney(profit));
  setText('stats-v-turnover', turnover.toFixed(2));

  const tStockEl = document.getElementById('stats-t-stockvalue');
  if(tStockEl){ tStockEl.textContent = ''; tStockEl.className = 's8-stat-trend'; }
  const tSales = fmtTrend(salesAmt, prevSalesAmt);
  const tSalesEl = document.getElementById('stats-t-sales');
  if(tSalesEl){ tSalesEl.textContent = tSales.txt; tSalesEl.className = 's8-stat-trend ' + tSales.cls; }
  const tProfit = fmtTrend(profit, prevProfit);
  const tProfitEl = document.getElementById('stats-t-profit');
  if(tProfitEl){ tProfitEl.textContent = tProfit.txt; tProfitEl.className = 's8-stat-trend ' + tProfit.cls; }
  const tTurnEl = document.getElementById('stats-t-turnover');
  if(tTurnEl){ tTurnEl.textContent = ''; tTurnEl.className = 's8-stat-trend'; }

  // ===== 7. 销售趋势图 SVG =====
  const buckets = new Array(range.bucketCount).fill(0);
  DB.logs.filter(l=>l.type==='out').forEach(l=>{
    const ts = new Date(l.ts).getTime();
    if(!inRange(ts, range.from, range.to)) return;
    const span = Math.max(1, range.to - range.from);
    const idx = Math.floor((ts - range.from) / span * range.bucketCount);
    const i = Math.min(range.bucketCount - 1, Math.max(0, idx));
    buckets[i] += logAmt(l);
  });
  const maxVal = Math.max(...buckets, 1);
  const w = 300, h = 140;
  const stepX = w / Math.max(1, range.bucketCount - 1);
  const points = buckets.map((v, i) => {
    const x = i * stepX;
    const y = h - (v / maxVal) * (h - 20) - 10;
    return {x, y};
  });
  const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + ' ' + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
  const fillPath = linePath + ' L ' + w + ',' + h + ' L 0,' + h + ' Z';
  setAttr('stats-chart-line', 'd', linePath);
  setAttr('stats-chart-fill', 'd', fillPath);
  const last = points[points.length - 1];
  const dot = document.getElementById('stats-chart-dot');
  if(dot){
    if(last && buckets[buckets.length - 1] > 0){
      dot.setAttribute('cx', last.x.toFixed(1));
      dot.setAttribute('cy', last.y.toFixed(1));
      dot.style.display = '';
    } else {
      dot.style.display = 'none';
    }
  }
  const subTexts = {today:'今日', week:'本周', month:'近 30 天', quarter:'本季', year:'本年 12 月', all:'全部'};
  const r = STATS_RANGES[statsRangeIdx];
  setText('stats-chart-sub', subTexts[r.key] || r.label);
  setText('stats-top-range', r.label);

  // ===== 8. 畅销榜 TOP 5 =====
  const prodSales = {};
  DB.logs.filter(l=>l.type==='out').forEach(l=>{
    const ts = new Date(l.ts).getTime();
    if(!inRange(ts, range.from, range.to)) return;
    const pid = pidOf(l);
    if(!prodSales[pid]) prodSales[pid] = {qty: 0, amt: 0};
    prodSales[pid].qty += l.qty;
    prodSales[pid].amt += logAmt(l);
  });
  const top5 = Object.entries(prodSales)
    .map(([pid, v]) => ({pid, ...v, name: (DB.products.find(p=>p.id===pid)||{}).name || '已删除'}))
    .sort((a,b) => b.qty - a.qty || b.amt - a.amt)
    .slice(0, 5);
  if(top5.length === 0){
    setHTML('stats-top-list', '<div class="s8-top-item"><div class="s8-top-rank">—</div><div class="s8-top-name" style="color:var(--text-muted);">期间无销售</div></div>');
  } else {
    setHTML('stats-top-list', top5.map((p, i) => `
      <div class="s8-top-item">
        <div class="s8-top-rank">${i+1}</div>
        <div class="s8-top-name" onclick="openDetail('${p.pid}')" style="cursor:pointer;">${p.name}</div>
        <div class="s8-top-val">${fmtMoney(p.amt)} · ${p.qty}件</div>
      </div>`).join(''));
  }

  // ===== 9. 预警 =====
  const lowCount = DB.products.filter(p => p.qty <= 2 && p.qty > 0).length;
  const SIXTY_DAYS = 60 * 24 * 3600 * 1000;
  const now = Date.now();
  const idleCount = DB.products.filter(p => {
    const recent = DB.logs.find(l => pidOf(l) === p.id && (now - new Date(l.ts).getTime()) <= SIXTY_DAYS);
    return !recent;
  }).length;
  const showCount = (DB.showItems||[]).reduce((a, s) => a + (s.qty || 0), 0);
  setText('stats-alert-low', lowCount + ' 项');
  setText('stats-alert-idle', idleCount + ' 项');
  setText('stats-alert-show', showCount + ' 项');
}

// ===================== 导入旧数据 =====================
function exportData(){
  const b=new Blob([JSON.stringify(DB,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`minzhen_${new Date().toISOString().slice(0,10)}.json`;a.click();
}
async function importData(e){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=async ev=>{
    try{
      const d=JSON.parse(ev.target.result);
      if(!d.products)throw 0;
      if(!confirm(`导入 ${d.products.length} 个商品到云端？`))return;
      toast('正在上传到云端…');
      for(const p of d.products){
        if(!getProduct(p.id)){
          DB.products.push(p);
          await upsertProduct(p);
        }
      }
      for(const l of (d.logs||[])){
        if(!DB.logs.find(x=>x.id===l.id)){
          DB.logs.push(l);
          await insertLog(l);
        }
      }
      for(const s of (d.showItems||[])){
        if(!DB.showItems.find(x=>x.id===s.id)){
          DB.showItems.push(s);
          await upsertShow(s);
        }
      }
      renderInventory();toast(`✅ 已导入 ${d.products.length} 个商品到云端！`);
    }catch{toast('❌ 文件格式错误');}
  };
  r.readAsText(f);
}

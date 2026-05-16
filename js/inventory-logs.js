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
  const totalAmt=logs.reduce((a,l)=>a+(l.price&&l.qty?parseFloat(l.price)*l.qty:0),0);
  el.innerHTML=`
    <span>📦 共 <b>${logs.length}</b> 条记录</span>
    <span>🔢 总数量 <b>${totalQty}</b> 件</span>
    ${totalAmt>0?`<span>💰 合计金额 <b style="color:var(--gold);">¥${totalAmt.toLocaleString()}</b></span>`:''}
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
  const totalAmt=logs.reduce((a,l)=>a+(l.price&&l.qty?parseFloat(l.price)*l.qty:0),0);
  
  const sumEl=document.getElementById(type+'-log-summary');
  if(sumEl){
    sumEl.innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;">
      <span>📦 共 <b style="color:var(--gold);">${st.total}</b> 条</span>
      <span>📄 第 <b>${st.page}</b> / <b>${st.totalPages}</b> 页</span>
      <span>🔢 本页 <b>${totalQty}</b> 件</span>
      ${totalAmt>0?`<span>💰 <b style="color:var(--gold);">¥${totalAmt.toLocaleString()}</b></span>`:''}
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
  const price=l.price?parseFloat(l.price):null;
  const subtotal=price&&l.qty?price*l.qty:null;
  const color=type==='in'?'var(--jade-light)':'var(--rose-light)';
  return`<tr class="clickable" onclick="openLogDetail('${l.id}')">
    <td class="td-mono" style="white-space:nowrap;">${fmt(l.ts)}</td>
    <td style="max-width:120px;">${p?p.name:'已删除'}</td>
    <td style="font-size:11px;"><span style="background:var(--surface2);padding:2px 6px;border-radius:8px;">${p?p.cat||'—':'—'}</span></td>
    <td style="font-family:'DM Mono',monospace;color:${color};text-align:center;">${type==='in'?'+':'−'}${l.qty}</td>
    <td style="color:var(--gold);text-align:right;">${price?'¥'+price.toLocaleString():'—'}</td>
    <td style="color:var(--gold);font-weight:600;text-align:right;">${subtotal?'¥'+subtotal.toLocaleString():'—'}</td>
    <td style="color:var(--text-muted);font-size:12px;">${l.note||'—'}</td>
  </tr>`;
}
async function exportLogCSV(type){
  const logs=await filterLogs(type);
  const label=type==='in'?'入库':'出库';
  const rows=[['日期','商品名','SKU','类别','数量','单价','小计','备注']];
  logs.forEach(l=>{
    const p=getProduct(l.productId);
    const price=l.price?parseFloat(l.price):'';
    const subtotal=price&&l.qty?price*l.qty:'';
    rows.push([
      fmtFull(l.ts),
      p?p.name:'已删除',
      p?p.sku||'':'',
      p?p.cat||'':'',
      l.qty,
      price,
      subtotal,
      l.note||''
    ]);
  });
  // 合计行
  const totalQty=logs.reduce((a,l)=>a+l.qty,0);
  const totalAmt=logs.reduce((a,l)=>a+(l.price&&l.qty?parseFloat(l.price)*l.qty:0),0);
  rows.push(['合计','','','',totalQty,'',totalAmt,'']);
  
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
  const totalAmt=logs.reduce((a,l)=>a+(l.price&&l.qty?parseFloat(l.price)*l.qty:0),0);
  const rows=logs.map(l=>{
    const p=getProduct(l.productId);
    const price=l.price?parseFloat(l.price):null;
    const subtotal=price&&l.qty?price*l.qty:null;
    return`<tr>
      <td>${fmtFull(l.ts)}</td>
      <td>${p?p.name:'已删除'}</td>
      <td>${p?p.sku||'—':'—'}</td>
      <td>${p?p.cat||'—':'—'}</td>
      <td style="text-align:center;">${l.qty}</td>
      <td style="text-align:right;">${price?'¥'+price.toLocaleString():'—'}</td>
      <td style="text-align:right;">${subtotal?'¥'+subtotal.toLocaleString():'—'}</td>
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
      <thead><tr><th>日期</th><th>商品名</th><th>SKU</th><th>类别</th><th>数量</th><th>单价</th><th>小计</th><th>备注</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="summary">
      <span>总数量：<b>${totalQty}</b> 件</span>
      ${totalAmt>0?`<span>合计金额：<b>¥${totalAmt.toLocaleString()}</b></span>`:''}
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
  document.getElementById('log-detail-body').innerHTML=`
    <div style="margin-bottom:14px;">
      <span class="badge badge-${l.type}">${typeLabel[l.type]||l.type}</span>
      <span class="td-mono" style="margin-left:10px;">${fmtFull(l.ts)}</span>
    </div>
    <div class="detail-grid">
      <div class="detail-field"><label>商品名称</label><div class="val">${p?p.name:'（已删除）'}</div></div>
      <div class="detail-field"><label>SKU</label><div class="val mono">${p?p.sku||'—':'—'}</div></div>
      <div class="detail-field"><label>数量</label><div class="val" style="font-size:20px;font-family:'DM Mono',monospace;color:${l.type==='in'||l.type==='return'?'var(--jade-light)':'var(--rose-light)'};">${l.type==='in'||l.type==='return'?'+':'−'}${l.qty}</div></div>
      ${l.price?`<div class="detail-field"><label>${l.type==='in'?'本次进价':l.type==='out'?'本次售价':'单价'}</label><div class="val" style="color:var(--gold);">¥${l.price}</div></div>`:''}
      ${l.price&&l.qty?`<div class="detail-field"><label>${l.type==='in'?'进货金额':l.type==='out'?'销售金额':'金额'}</label><div class="val" style="color:var(--gold);font-weight:600;">¥${(parseFloat(l.price)*l.qty).toLocaleString()}</div></div>`:''}
      ${l.note?`<div class="detail-field full"><label>备注</label><div class="val">${l.note}</div></div>`:''}
      ${p?`<div class="detail-field"><label>商品当前库存</label><div class="val mono">${p.qty} 件</div></div>`:''}
    </div>
    ${p?`<button class="btn btn-outline btn-sm" style="margin-top:8px;" onclick="closeModal('modal-log');openDetail('${p.id}')">查看商品详情 →</button>`:''}`;
  document.getElementById('modal-log').classList.add('open');
}
// ===================== STATS =====================
function renderStats(){
  const t=DB.products.length,q=DB.products.reduce((a,p)=>a+p.qty,0);
  const so=DB.showItems.reduce((a,s)=>a+s.qty,0),lw=DB.products.filter(p=>p.qty<3).length;
  const inc=DB.logs.filter(l=>l.type==='in').length;
  document.getElementById('stats-row').innerHTML=`
    <div class="stat-card"><span class="stat-num">${t}</span><div class="stat-label">商品种类</div></div>
    <div class="stat-card"><span class="stat-num">${q}</span><div class="stat-label">总库存件数</div></div>
    <div class="stat-card"><span class="stat-num" style="color:var(--rose)">${so}</span><div class="stat-label">展会带出中</div></div>
    <div class="stat-card"><span class="stat-num" style="color:var(--rose)">${lw}</span><div class="stat-label">库存不足</div></div>
    <div class="stat-card"><span class="stat-num" style="color:var(--jade-light)">${inc}</span><div class="stat-label">累计入库次数</div></div>`;
  const cm={};
  DB.products.forEach(p=>{const c=p.cat||'未分类';if(!cm[c])cm[c]={count:0,qty:0};cm[c].count++;cm[c].qty+=p.qty;});
  document.getElementById('cat-stats-tbody').innerHTML=Object.entries(cm).sort((a,b)=>b[1].qty-a[1].qty).map(([c,v])=>`<tr><td>${c}</td><td class="td-mono">${v.count}</td><td class="td-mono">${v.qty}</td></tr>`).join('');
  const low=DB.products.filter(p=>p.qty<3);
  document.getElementById('low-stock-list').innerHTML=low.length?low.map(p=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;" onclick="openDetail('${p.id}')">
    <span style="font-size:13px;">${p.name}</span>
    <span style="color:${p.qty<=0?'var(--text-muted)':'var(--rose)'};font-family:'DM Mono',monospace;">${p.qty}件</span>
  </div>`).join(''):`<div style="color:var(--jade-light);font-size:13px;padding:8px;">✅ 所有商品库存充足</div>`;
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

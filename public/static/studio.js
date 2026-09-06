(()=>{
 'use strict';
 const root=document.getElementById('st-root'),alert=document.getElementById('st-alert'),dialog=document.getElementById('st-detail');
 const params=new URLSearchParams(location.search),source=params.get('source')||'qkltj:6001';
 const view=['overview','generate','tracking','data'].includes(params.get('view'))?params.get('view'):'overview';
 let data=null,recipe='balanced',count=150,loading=false,mutating=false,loadError=false,filter='all',dataRows=[],dataSources=[],query='',loadedQuery='',timer,detailId=null;
 try{const pref=JSON.parse(localStorage.getItem('studio:'+source)||'{}');if(['balanced','focused','control'].includes(pref.recipe))recipe=pref.recipe;if([100,150,300,500].includes(pref.count))count=pref.count}catch{}
 const saveChoice=()=>{try{localStorage.setItem('studio:'+source,JSON.stringify({recipe,count}))}catch{}};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const pct=n=>n==null?'—':(n*100).toFixed(1)+'%';
 const time=ms=>ms?new Date(ms).toLocaleString('zh-CN',{hour12:false}):'—';
 const short=period=>period?String(period).slice(8):'—';
 const route=v=>'/workspace?view='+v+'&source='+encodeURIComponent(source);
 const link=(path)=>path+(path.includes('?')?'&':'?')+'source='+encodeURIComponent(source);
 async function api(path,init={}){const r=await fetch(path,{...init,signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...init.headers}});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'读取失败，请稍后再试');return d}
 function toast(message){const n=document.getElementById('st-toast');n.textContent=message;clearTimeout(timer);timer=setTimeout(()=>n.textContent='',4000)}
 const chosenHistory=()=>data?.history.find(h=>h.origin==='studio'&&h.strategy===recipe&&h.count===count&&h.version==='studio-v1');
 function empty(title,text,action=''){return '<div class="st-empty"><strong>'+esc(title)+'</strong>'+esc(text)+(action?'<div style="margin-top:18px">'+action+'</div>':'')+'</div>'}
 function badge(p){return p.status==='settled'?'<span class="st-pill '+(p.hit?'hit':'miss')+'">'+(p.hit?'已命中':'未命中')+'</span>':'<span class="st-pill pending">'+(p.status==='locked'?'开奖前已锁定':'等待开奖数据')+'</span>'}
 function metric(label,value,note){return '<div class="st-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></div>'}
 function historyNote(){return '<p class="st-note">历史命中率 = 已核对命中期数 ÷ 已核对期数。每个策略版本与覆盖数量独立统计最近 500 份提前锁定记录；未开奖、缺失或无效结果不计作失败。区间仅描述历史样本，持续查看、多策略挑选与期次相关性会影响解读。</p>'}
 function coverageHero(action=true){
  const h=chosenHistory(),g=data.readiness;
  return '<section class="st-card st-hero"><div class="st-card-head"><h3>下期覆盖，一眼看清</h3><span class="st-badge">'+count+' / 1,000 个号码</span></div><div class="st-hero-main"><div><div class="st-big">'+(count/10).toFixed(0)+'<small>%</small></div><div class="st-meta">独立均匀假设下的理论覆盖率</div></div><div><span class="st-muted">目标期号</span><p style="font-size:17px;margin-top:6px">'+esc(g.expect||'等待数据')+'</p><div class="st-meta">截止 '+time(g.cutoff_ms)+'</div><div class="st-meta">当前配方 · '+esc(data.recipes.find(r=>r.id===recipe)?.name)+'</div></div></div><div class="st-progress"><i style="width:'+count/10+'%"></i></div><p class="st-note">已校准的下期命中概率：<strong>尚无</strong>。排序分与历史命中率不能替代下一期概率。</p><div class="st-rule st-actions">'+(action?'<a class="st-button st-primary" href="'+route('generate')+'">生成并追踪方案 →</a>':'')+'<span class="st-note">同配置实测 '+pct(h?.rate)+' · '+(h?.n||0)+' 期</span></div></section>'
 }
 function latest(){
  const s=data.snapshot,last=s.records.at(-1);
  return '<section class="st-card"><div class="st-card-head"><h3>共享数据快照</h3><a href="'+route('data')+'">查看数据 ↗</a></div><div class="st-muted">'+esc(s.source.label)+' · '+esc(s.latestPeriod||'尚无期号')+'</div><div class="st-digits">'+(last?last.numbers:['—','—','—','—','—']).map(n=>'<b>'+n+'</b>').join('')+'</div><p class="st-note">前三位用于本工作台的方案核对</p><div class="st-quality" style="margin-top:18px"><span>库内记录</span><strong>'+s.count.toLocaleString()+' 期</strong></div><div class="st-quality"><span>最近样本缺期 / 无效</span><strong>'+s.quality.missingPeriods+' / '+s.quality.rejectedRows+'</strong></div><div class="st-quality"><span>数据版本</span><strong>'+esc(s.revision)+'</strong></div><div class="st-quality"><span>最近成功同步</span><strong>'+time(s.sync.lastSuccessAt)+'</strong></div></section>'
 }
 function planTable(plans){
  if(!plans.length)return empty('还没有锁定方案','选择固定配方，留下第一份开奖前记录。','<a class="st-button st-primary" href="'+route('generate')+'">创建第一份方案</a>');
  return '<div class="st-table-wrap"><table class="st-table"><thead><tr><th>目标期号 / 锁定时间</th><th>策略 / 覆盖</th><th>实际前三位</th><th>核对结果</th><th>记录</th></tr></thead><tbody>'+plans.map(p=>'<tr><td><strong>'+esc(p.expect)+'</strong><small>'+time(p.created_ms)+'</small></td><td>'+esc(data.recipes.find(r=>r.id===p.recipe)?.name||p.recipe)+'<small>'+p.count+' 个 · 理论 '+pct(p.theoretical_coverage)+'</small></td><td><strong>'+esc(p.actual||'—')+'</strong></td><td>'+badge(p)+'</td><td><button class="st-button st-small" data-detail="'+esc(p.id)+'">'+(p.pinned?'★ ':'')+'查看'+(p.note?' · 有备注':'')+'</button></td></tr>').join('')+'</tbody></table></div>'
 }
 function frequency(){
  const rows=data.snapshot.records.slice(-120),a=Array(10).fill(0);for(const r of rows)for(const n of r.numbers.slice(0,3))a[n]++;
  const max=Math.max(1,...a);
  return '<section class="st-card"><div class="st-card-head"><h3>最近 120 期 · 前三位数字分布</h3><a href="'+link('/analysis')+'">深入分析 ↗</a></div><p class="st-note">合计 '+rows.length*3+' 个位置观察值；热度展示历史频数，不表示未来更容易出现。</p><div class="st-frequencies">'+a.map((n,i)=>'<div class="st-bar"><span>'+n+'</span><i style="height:'+Math.round(n/max*70)+'px"></i><b>'+i+'</b></div>').join('')+'</div></section>'
 }
 function overview(){
  const h=chosenHistory();
  return '<div class="st-grid">'+coverageHero()+latest()+'</div><div class="st-metrics">'+metric('所选配置 · 历史实测',pct(h?.rate),(h?.hits||0)+' 次命中 / '+(h?.n||0)+' 期已核对')+metric('历史 95% 区间',h?.interval95?pct(h.interval95.lo)+' – '+pct(h.interval95.hi):'等待样本','固定配方描述性区间，不是下期概率')+metric('生成状态',data.readiness.ready?'可生成方案':'等待数据',data.readiness.ready?'使用最新快照 · 开奖前锁定':'请在数据管理查看同步与完整性')+'</div><div class="st-grid"><section class="st-card"><div class="st-card-head"><h3>一条完整的研究路径</h3><a href="'+route('tracking')+'">策略追踪 ↗</a></div><div class="st-steps"><div class="st-step"><i>01 / DATA</i><h4>核对数据</h4><p>确认来源、期号与连续性，所有工具共用开奖库。</p></div><div class="st-step"><i>02 / PLAN</i><h4>锁定方案</h4><p>选择配方和覆盖数量，在截止前保存完整号码。</p></div><div class="st-step"><i>03 / REVIEW</i><h4>逐期验证</h4><p>核对真实结果，累计样本，记录观察和复盘。</p></div></div><div class="st-divider"></div>'+historyNote()+'</section>'+frequency()+'</div><section class="st-card"><div class="st-card-head"><h3>最近方案</h3><a href="'+route('tracking')+'">全部追踪 →</a></div>'+planTable(data.plans.slice(0,5))+'</section>'
 }
 function generation(){
  const current=data.plans.find(p=>p.expect===data.readiness.expect&&p.recipe===recipe&&p.count===count&&p.version==='studio-v1');
  return '<div class="st-grid"><section class="st-card"><div class="st-card-head"><h3>01 选择固定配方</h3><span class="st-pill">本地计算 · 无需 AI 密钥</span></div>'+data.recipes.map(r=>'<label class="st-recipe"><input type="radio" name="recipe" value="'+r.id+'" '+(recipe===r.id?'checked':'')+'><strong>'+r.name+'</strong><p>'+r.description+'</p></label>').join('')+'<div class="st-field">02 选择覆盖数量<div class="st-counts">'+data.counts.map(n=>'<button class="st-button st-count" data-count="'+n+'" aria-pressed="'+(n===count)+'">'+n+' 个</button>').join('')+'</div></div><p class="st-note" style="margin-top:14px">覆盖越多，理论覆盖率随之增加；这不等于策略产生了预测优势。保持同一配方与数量，才能积累可比较的记录。</p><button id="st-generate" class="st-button st-primary st-wide" '+(!current&&(!data.readiness.ready||mutating||loadError)?'disabled':'')+'>'+(current?'查看已锁定方案':mutating?'正在计算并锁定…':'03 生成并锁定本期方案')+'</button><p class="st-note" style="margin-top:10px">'+(current?'同一期同一配置保留首次结果。':esc(data.readiness.reason||'完整号码、依据期号和生成时间一并保存，开奖后自动核对。'))+'</p></section><div>'+coverageHero(false)+'<section class="st-card" style="margin-top:18px"><div class="st-card-head"><h3>配套研究工具</h3></div><div class="st-actions"><a class="st-button" href="'+link('/atlas')+'">图谱条件分析 ↗</a><a class="st-button" href="'+link('/analysis')+'">量化信号 ↗</a><a class="st-button" href="'+link('/ai')+'">AI 研究 ↗</a></div><p class="st-note" style="margin-top:14px">AI 策略中可验证的开奖前记录也会汇入策略追踪；各工具保留自己的配方与版本。</p></section></div></div>'+(current?'<section class="st-card"><div class="st-card-head"><h3>本期已锁定</h3></div>'+planTable([current])+'</section>':'')
 }
 function tracking(){
  const hs=data.history.filter(h=>filter==='all'||h.origin===filter);
  return '<section class="st-card"><div class="st-card-head"><h3>固定配置 · 真实追踪成绩</h3><span class="st-pill">每组最近 500 份记录</span></div><div class="st-filter"><label for="st-filter">记录来源</label><select id="st-filter"><option value="all">全部可验证策略</option><option value="studio" '+(filter==='studio'?'selected':'')+'>工作台方案</option><option value="arena" '+(filter==='arena'?'selected':'')+'>原量化 / AI 策略</option></select></div>'+(hs.length?'<div class="st-table-wrap"><table class="st-table"><thead><tr><th>策略 / 固定配置</th><th>已核对</th><th>历史命中率</th><th>理论基线</th><th>历史 95% 区间</th><th>最近结果 · 绿中 / 红未中</th></tr></thead><tbody>'+hs.map(h=>'<tr><td class="st-strategy-name"><strong>'+esc(h.name)+'</strong><small>'+esc(h.version)+' · '+h.count+' 个 · '+(h.origin==='studio'?'工作台':'原策略')+'</small></td><td>'+h.hits+' / '+h.n+'<small>待开奖 '+h.pending+' · 待数据 '+h.missing+'</small></td><td><strong>'+pct(h.rate)+'</strong><small>'+(h.rate==null?'—':'较基线 '+((h.rate-h.baseline)*100>=0?'+':'')+((h.rate-h.baseline)*100).toFixed(1)+' 百分点')+'</small></td><td>'+pct(h.baseline)+'</td><td>'+(h.interval95?pct(h.interval95.lo)+' – '+pct(h.interval95.hi):'—')+'</td><td><div class="st-trail" aria-label="最近结果">'+h.trail.map(x=>'<i class="'+(x?'hit':'')+'" title="'+(x?'命中':'未命中')+'"></i>').join('')+'</div><small>'+esc(h.first_period||'—')+' 至 '+esc(h.last_period||'—')+'</small><small>最多连续未中 '+h.max_miss+' 期 · 缺期断开</small></td></tr>').join('')+'</tbody></table></div>':empty('等待第一份可验证的成绩','先锁定方案，开奖数据到达后会自动核对。'))+'<div class="st-divider"></div>'+historyNote()+'<p class="st-note" style="margin-top:8px">旧版本无法验证提前锁定的记录和历史回放保留在原工具中，不计入这里。共享期次的多条策略不能视为独立证据。</p></section><section class="st-card" style="margin-top:18px"><div class="st-card-head"><h3>方案记录 · 最近 100 份</h3><button class="st-button st-small" id="st-export-plans">导出记录 JSON</button></div>'+planTable(data.plans)+'</section>'
 }
 function manageData(){
  return '<section class="st-card"><div class="st-card-head"><h3>统一数据源</h3><span class="st-pill">图谱 · 量化 · 追踪共用</span></div><div class="st-table-wrap"><table class="st-table"><thead><tr><th>来源</th><th>库内记录</th><th>最新期号</th><th>数据状态</th><th>最近成功同步</th><th>操作</th></tr></thead><tbody>'+dataSources.map(s=>'<tr><td><strong>'+esc(s.source.label)+'</strong><small>'+esc(s.revision)+'</small></td><td>'+s.count.toLocaleString()+'</td><td>'+esc(s.latestPeriod||'—')+'</td><td><span class="st-pill '+(s.sync.lastError?'miss':s.sync.freshness==='fresh'?'hit':'pending')+'">'+(s.sync.lastError?'同步异常':s.sync.freshness==='fresh'?'已同步':s.count?'等待更新':'尚无数据')+'</span><small>'+esc(s.sync.lastError||'')+'</small></td><td>'+time(s.sync.lastSuccessAt)+'</td><td><button class="st-button st-small" data-sync="'+esc(s.source.id)+'" '+(mutating?'disabled':'')+'>同步</button></td></tr>').join('')+'</tbody></table></div><p class="st-note" style="margin-top:16px">同步只更新共用开奖库，不调用 AI。备份与恢复可使用桌面顶部“数据”菜单；本地文件导入在图谱的独立数据来源中管理。</p></section><div class="st-grid" style="margin-top:18px">'+latest()+'<section class="st-card"><div class="st-card-head"><h3>数据质量与记录原则</h3></div><div class="st-steps" style="grid-template-columns:1fr"><div class="st-step"><i>一致性</i><p>所有板块读取同一开奖表，数据修正后，方案核对结果随原始记录更新。</p></div><div class="st-step"><i>完整性</i><p>生成需要最近 120 期连续有效数据。缺期、无效值、旧期次会暂停生成。</p></div><div class="st-step"><i>可追溯</i><p>方案保留原始号码与依据版本；备注独立保存，不改写历史预测。</p></div></div></section></div><section class="st-card"><div class="st-card-head"><h3>原始开奖记录</h3><span class="st-muted">当前来源 · '+(loadedQuery?'期号 '+esc(loadedQuery):'最近 100 期')+'</span></div><div class="st-filter"><label for="st-period">完整期号</label><input id="st-period" placeholder="留空显示最近记录" value="'+esc(query)+'" inputmode="numeric"><button class="st-button" id="st-search">查询</button><button class="st-button" id="st-export-data">导出当前查询 CSV</button><a class="st-link" href="'+link('/atlas')+'">本地导入 ↗</a></div>'+(dataRows.length?'<div class="st-table-wrap" style="max-height:430px"><table class="st-table"><thead><tr><th>期号</th><th>五位号码</th><th>开奖时间</th><th>来源标记</th><th>号码 / 哈希差异</th></tr></thead><tbody>'+dataRows.map(r=>'<tr><td>'+esc(r.expect)+'</td><td><strong>'+[r.n1,r.n2,r.n3,r.n4,r.n5].map(esc).join(' ')+'</strong></td><td>'+time(r.open_ms)+'</td><td>'+esc(r.src||'未标注')+'</td><td>'+esc(r.mismatch==null?'未核对':r.mismatch?'有差异，以官方号码为准':'一致')+'</td></tr>').join('')+'</tbody></table></div>':empty('暂无符合条件的记录','核对期号或同步当前数据来源。'))+'</section>'
 }
 function render(){
  if(!data)return;root.setAttribute('aria-busy','false');
  const titles={overview:['把每一步研究，变成可追踪的依据。','同一份开奖数据，贯穿分析、方案与复盘。'],generate:['从一份固定方案，开始验证。','先看清覆盖范围，再留下开奖前的真实记录。'],tracking:['看长期记录，也看证据边界。','固定配置分别统计，关注真实样本与可持续的追踪价值。'],data:['一份数据，贯穿整个平台。','集中查看同步、期次、质量与导出记录。']};
  document.getElementById('st-title').textContent=titles[view][0];document.getElementById('st-subtitle').textContent=titles[view][1];
  if(!loadError){alert.className=data.readiness.ready?'':'st-banner';alert.textContent=data.readiness.reason}
  root.innerHTML=({overview,generation,tracking,manageData})[({overview:'overview',generate:'generation',tracking:'tracking',data:'manageData'})[view]]();
  bind();
 }
 async function load(){
  if(loading||mutating||dialog.open||document.activeElement?.id==='st-period')return;loading=true;
  try{const next=await api('/api/studio/overview?source='+encodeURIComponent(source));
   if(view==='data'){const [rows,sources]=await Promise.all([api('/api/studio/data?source='+encodeURIComponent(source)+'&period='+encodeURIComponent(query)),Promise.all(['6001','6002','6003','6004','7001'].map(id=>api('/api/atlas/status?source=qkltj:'+id)))]);dataRows=rows.rows;loadedQuery=rows.period||'';dataSources=sources}
   data=next;loadError=false;render()
  }catch(e){loadError=true;alert.className='st-banner';alert.textContent='读取失败：'+e.message+'。可点击右上角刷新。';if(data)render();else root.innerHTML=empty('暂时无法读取数据','请稍后刷新；已有方案保留在数据库中。')}
  finally{loading=false}
 }
 function download(name,text,type){const u=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),3000)}
 function openDetail(id){
  const p=data.plans.find(x=>x.id===id);if(!p)return;detailId=id;
  dialog.innerHTML='<div class="st-card-head"><h3>方案 '+esc(p.expect)+'</h3><button id="st-close">关闭</button></div>'+badge(p)+'<div class="st-plan-summary"><div><span>覆盖数量</span><strong>'+p.count+'</strong></div><div><span>理论覆盖</span><strong>'+pct(p.theoretical_coverage)+'</strong></div><div><span>实际前三位</span><strong>'+esc(p.actual||'—')+'</strong></div></div><p class="st-note">锁定 '+time(p.created_ms)+' · 截止 '+time(p.cutoff_ms)+'<br>依据 '+esc(p.based_on)+' · '+p.input_count+' 期 · '+esc(p.input_revision)+'<br>配方 '+esc(p.recipe)+' · '+esc(p.version)+' · 下期概率尚未校准</p><div class="st-number-list">'+p.numbers.map(n=>'<span class="'+(n===p.actual?'hit':'')+'">'+n+'</span>').join('')+'</div><div class="st-actions"><button id="st-copy">复制号码</button><button id="st-download">导出完整方案</button></div><div class="st-divider"></div><label><input id="st-pin" type="checkbox" '+(p.pinned?'checked':'')+'> 关注这份方案</label><label for="st-note" class="st-field">复盘备注</label><textarea id="st-note" maxlength="1000" placeholder="记录观察依据和复盘结论">'+esc(p.note)+'</textarea><div class="st-actions"><button id="st-save" class="st-primary">保存备注</button><span class="st-note">备注不会改写原方案与统计成绩</span></div>';
  if(!dialog.open)dialog.showModal();
  document.getElementById('st-close').onclick=()=>dialog.close();
  document.getElementById('st-copy').onclick=async()=>{try{await navigator.clipboard.writeText(p.numbers.join(' '));toast('号码已复制')}catch{toast('复制失败，可使用导出方案')}};
  document.getElementById('st-download').onclick=()=>download('HashPlay-plan-'+p.expect+'-'+p.recipe+'-'+p.count+'.json',JSON.stringify(p,null,2),'application/json');
  document.getElementById('st-save').onclick=async e=>{e.target.disabled=true;try{const note=document.getElementById('st-note').value,pinned=document.getElementById('st-pin').checked;await api('/api/studio/plans/'+p.id,{method:'PATCH',body:JSON.stringify({note,pinned})});p.note=note;p.pinned=pinned;toast('关注与备注已保存')}catch(e){toast(e.message)}finally{const b=document.getElementById('st-save');if(b)b.disabled=false}};
 }
 function bind(){
  for(const n of root.querySelectorAll('[data-count]'))n.onclick=()=>{count=Number(n.dataset.count);saveChoice();render()};
  for(const n of root.querySelectorAll('[name=recipe]'))n.onchange=()=>{recipe=n.value;saveChoice();render()};
  for(const n of root.querySelectorAll('[data-detail]'))n.onclick=()=>openDetail(n.dataset.detail);
  const gen=document.getElementById('st-generate');if(gen)gen.onclick=async()=>{
   const current=data.plans.find(p=>p.expect===data.readiness.expect&&p.recipe===recipe&&p.count===count&&p.version==='studio-v1');
   if(current){openDetail(current.id);return}
   mutating=true;render();let id=null;
   try{const r=await api('/api/studio/plans',{method:'POST',body:JSON.stringify({source,recipe,count,expect:data.readiness.expect,revision:data.snapshot.revision})});id=r.id;toast(r.existing?'已返回首次锁定的方案':'已在开奖前锁定，开始自动追踪')}
   catch(e){toast(e.message)}finally{mutating=false;await load();if(id)openDetail(id)}
  };
  const f=document.getElementById('st-filter');if(f)f.onchange=()=>{filter=f.value;render()};
  const ep=document.getElementById('st-export-plans');if(ep)ep.onclick=()=>download('HashPlay-tracking-'+source.replace(':','-')+'.json',JSON.stringify({source,exported_at:Date.now(),scope:'recent_100_plans_per_source',plans:data.plans,history:data.history,methodology:data.methodology},null,2),'application/json');
  for(const n of root.querySelectorAll('[data-sync]'))n.onclick=async()=>{if(mutating)return;mutating=true;render();try{await api('/api/atlas/sync',{method:'POST',body:JSON.stringify({sourceId:n.dataset.sync,force:true})});toast('同步完成')}catch(e){toast(e.message)}finally{mutating=false;await load()}};
  const search=document.getElementById('st-search'),input=document.getElementById('st-period');
  if(input){input.oninput=()=>query=input.value;input.onkeydown=e=>{if(e.key==='Enter'){input.blur();load()}};search.onclick=()=>{input.blur();load()}}
  const ex=document.getElementById('st-export-data');if(ex)ex.onclick=()=>{
   const quote=v=>'"'+String(v??'').replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"';
   const header=['source','expect','n1','n2','n3','n4','n5','open_ms','block','hash','src','mismatch'];
   download('HashPlay-data-'+source.replace(':','-')+'.csv','\uFEFF'+header.join(',')+'\r\n'+dataRows.map(r=>header.map(k=>quote(k==='source'?source:r[k])).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('已导出'+(loadedQuery?'期号 '+loadedQuery:'最近记录')+'，共 '+dataRows.length+' 条')
  };
 }
 dialog.addEventListener('close',()=>{detailId=null;load()});
 window.addEventListener('studio-refresh',load);load();setInterval(load,15000);
 setInterval(()=>{const b=document.getElementById('st-generate');if(b&&data&&!mutating&&!b.textContent.includes('查看')&&data.readiness.cutoff_ms<=Date.now()+1500){b.disabled=true;b.textContent='本期已截止 · 等待新数据'}},1000);
})();
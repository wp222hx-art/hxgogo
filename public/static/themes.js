/* Appearance is local UI state. It never requests data or changes a strategy. */
(()=>{
 'use strict';
 const themes=[{"id":"warm","name":"暖米白","note":"奶油底色 · 杏棕点缀"},{"id":"market","name":"股市经典","note":"白底蓝选 · 红涨绿跌"},{"id":"betting","name":"绿金竞技","note":"博彩风格 · 深绿与香槟金"},{"id":"cyber","name":"赛博朋克","note":"深紫夜幕 · 霓虹粉与冰青"},{"id":"game","name":"游戏战术","note":"靛蓝面板 · 紫色选择与青柠命中"},{"id":"fintech","name":"科技金融","note":"冰蓝留白 · 钴蓝与深青"},{"id":"exchange","name":"加密交易所","note":"石墨黑底 · 明黄选择与红绿成交"}];
 const key='platform:appearance',root=document.documentElement,echartsSet=new Set(),charts=new Set();
 let preference={theme:'warm',emphasis:true},ui=false;
 function read(value){try{const p=JSON.parse(value||'null');return {theme:themes.some(t=>t.id===p?.theme)?p.theme:'warm',emphasis:p?.emphasis!==false}}catch{return {theme:'warm',emphasis:true}}}
 try{preference=read(localStorage.getItem(key))}catch{}
 function color(name){return getComputedStyle(root).getPropertyValue('--theme-'+name).trim()}
 function axes(value,full){const one=a=>({...full?a:{},axisLabel:{...a?.axisLabel,color:color('muted')},axisLine:{...a?.axisLine,lineStyle:{...a?.axisLine?.lineStyle,color:color('border')}},splitLine:{...a?.splitLine,lineStyle:{...a?.splitLine?.lineStyle,color:color('border')}}});return Array.isArray(value)?value.map(one):one(value)}
 function chartPatch(option,full=false){const p={};for(const k of ['xAxis','yAxis'])if(option[k])p[k]=axes(option[k],full);
  if(option.legend){const one=l=>({...full?l:{},textStyle:{...l.textStyle,color:color('muted')}});p.legend=Array.isArray(option.legend)?option.legend.map(one):one(option.legend)}
  if(option.tooltip){const one=t=>({...full?t:{},backgroundColor:color('panel'),borderColor:color('border'),textStyle:{...t.textStyle,color:color('ink')}});p.tooltip=Array.isArray(option.tooltip)?option.tooltip.map(one):one(option.tooltip)}
  return p;
 }
 function styleChart(chart){if(!chart.ctx){charts.delete(chart);return}chart.options.color=color('muted');for(const scale of Object.values(chart.options.scales||{})){scale.ticks.color=color('muted');scale.grid.color=color('border');if(scale.border)scale.border.color=color('border')}
  const p=chart.options.plugins;if(p?.legend?.labels)p.legend.labels.color=color('muted');if(p?.title)p.title.color=color('ink');if(p?.tooltip){p.tooltip.backgroundColor=color('panel');p.tooltip.titleColor=color('ink');p.tooltip.bodyColor=color('ink');p.tooltip.borderColor=color('border');p.tooltip.borderWidth=1}chart.update('none');
 }
 function apply(next,persist=true){preference={theme:themes.some(t=>t.id===next.theme)?next.theme:'warm',emphasis:next.emphasis!==false};root.dataset.theme=preference.theme;root.dataset.emphasis=preference.emphasis?'strong':'normal';
  if(persist)try{localStorage.setItem(key,JSON.stringify(preference))}catch{}
  if(ui){const current=themes.find(t=>t.id===preference.theme);document.getElementById('hp-theme-toggle').textContent='◐ '+current.name;document.getElementById('hp-theme-toggle').title='外观：'+current.name+'，点击切换';document.getElementById('hp-theme-emphasis').checked=preference.emphasis;document.querySelectorAll('[data-theme-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeChoice===preference.theme)));document.getElementById('hp-theme-note').textContent=preference.theme==='market'?'股市主题：红色表示命中 / 正收益，绿色表示未中 / 负收益。':'选中用边框强调；命中、未中与待开奖均保留文字标记。'}
  for(const c of echartsSet){if(c.isDisposed()){echartsSet.delete(c);continue}c.__hpSetOption(chartPatch(c.getOption()),false)}
  for(const c of charts)styleChart(c);
  window.dispatchEvent(new CustomEvent('platform-theme',{detail:{...preference}}));
 }
 window.HashPlayTheme={color,get:()=>({...preference}),apply,
  echarts(c){if(c.__hpSetOption)return c;c.__hpSetOption=c.setOption.bind(c);c.setOption=(option,...args)=>c.__hpSetOption({...option,...chartPatch(option,true)},...args);echartsSet.add(c);return c},
  chart(c){charts.add(c);styleChart(c);return c}
 };
 apply(preference,false);
 window.addEventListener('storage',e=>{if(e.key===key||e.key===null){let value=e.newValue;if(e.key===null)value=null;apply(read(value),false)}});
 function mount(){
  const toggle=document.getElementById('hp-theme-toggle');if(!toggle)return;
  const dialog=document.createElement('dialog');dialog.id='hp-theme-dialog';dialog.setAttribute('aria-labelledby','hp-theme-title');
  dialog.innerHTML='<div class="hp-theme-head"><div><h2 id="hp-theme-title">选择你的工作台外观</h2><p>即时预览，跨页面保留。颜色与高亮不会改变策略或计算结果。</p></div><button id="hp-theme-close" type="button" aria-label="关闭外观设置">关闭</button></div><div class="hp-theme-grid" role="group" aria-label="色彩主题">'+themes.map(t=>'<button type="button" class="hp-theme-card" data-palette="'+t.id+'" data-theme-choice="'+t.id+'" aria-pressed="false"><span class="hp-theme-check" aria-hidden="true">✓</span><span class="hp-theme-swatches" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>'+t.name+'</strong><small>'+t.note+'</small></button>').join('')+'</div><div class="hp-theme-preview"><span class="hp-theme-preview-label">状态示例 · 用于比较配色</span><div class="hp-theme-samples"><span class="hp-selected">◎ 选中 128</span><span class="hp-hit">✓ 命中</span><span class="hp-miss">× 未中</span><span class="hp-pending">◷ 待开奖</span><span class="hp-profit">+ 85.00</span><span class="hp-loss">− 10.00</span></div></div><div class="hp-theme-foot"><label><input id="hp-theme-emphasis" type="checkbox">增强选择与命中高亮</label><span id="hp-theme-note"></span></div>';
  document.body.append(dialog);ui=true;apply(preference,false);
  toggle.addEventListener('click',()=>dialog.showModal());
  document.getElementById('hp-theme-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>toggle.focus());
  dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()});
  dialog.querySelectorAll('[data-theme-choice]').forEach(b=>b.addEventListener('click',()=>apply({...preference,theme:b.dataset.themeChoice})));
  document.getElementById('hp-theme-emphasis').addEventListener('change',e=>apply({...preference,emphasis:e.target.checked}));
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();

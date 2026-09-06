(()=>{
 const q=new URLSearchParams(location.search);let source=q.get('source')||localStorage.getItem('platform:source')||'qkltj:6001';
 const builtin=s=>/^qkltj:(600[1-4]|7001)$/.test(s);const valid=builtin(source)||(source==='local:five'&&!['/workspace','/atlas','/'].includes(location.pathname)),sel=document.getElementById('hp-source'),status=document.getElementById('hp-status');
 sel.value=valid?source:'qkltj:6001';
 if(!valid){sel.disabled=true;status.textContent='本地导入来源'}
 window.platformSource=source;
 const view=q.get('view')||'overview';
 if(location.pathname==='/workspace')for(const a of document.querySelectorAll('[data-hp-route]')){a.removeAttribute('aria-current');if(a.dataset.hpRoute===view){a.setAttribute('aria-current','page');document.getElementById('hp-page-title').textContent=a.lastChild.textContent.trim()}}
 for(const a of document.querySelectorAll('#hp-sidebar a,#hp-header a')){const u=new URL(a.href);if(valid&&(builtin(source)||!['/workspace','/atlas'].includes(u.pathname)))u.searchParams.set('source',source);a.href=u.pathname+u.search}
 sel.addEventListener('change',()=>{if(builtin(sel.value))localStorage.setItem('platform:source',sel.value);localStorage.setItem('ai:source',sel.value);const u=new URL(location.href);u.searchParams.set('source',sel.value);location.href=u.pathname+u.search});
 window.addEventListener('platform-source',event=>{const next=event.detail;if(!/^qkltj:(600[1-4]|7001)$/.test(next))return;source=next;window.platformSource=next;sel.value=next;try{localStorage.setItem('platform:source',next);localStorage.setItem('ai:source',next)}catch{}for(const a of document.querySelectorAll('#hp-sidebar a,#hp-header a')){const u=new URL(a.href);u.searchParams.set('source',next);a.href=u.pathname+u.search}});
 let busy=false;
 async function refresh(){if(!builtin(source)){status.textContent='本地演示数据';return}if(busy||!valid)return;busy=true;try{const r=await fetch('/api/atlas/status?source='+encodeURIComponent(source)),s=await r.json();if(!r.ok||!s.ok)throw Error();status.textContent=s.sync.lastError?'同步待恢复':s.sync.freshness==='fresh'?'● 数据已同步':s.count?'● 等待新数据':'● 尚无数据';status.dataset.state=s.sync.lastError?'error':s.sync.freshness==='fresh'?'ok':'pending';status.title='最新期号：'+(s.latestPeriod||'—')+' · 数据版本：'+s.revision}catch{status.textContent='连接暂时中断';status.dataset.state='error'}finally{busy=false}}
 document.getElementById('hp-refresh').onclick=()=>{if(location.pathname==='/workspace')window.dispatchEvent(new Event('studio-refresh'));else location.reload();refresh()};
 refresh();setInterval(refresh,5000);
 // Atlas owns additional imported schemas. Its own source selector remains visible and authoritative.
 if(location.pathname==='/atlas'){sel.hidden=true;document.querySelector('label[for="hp-source"]').textContent='图谱来源见下方';status.hidden=true}
})();
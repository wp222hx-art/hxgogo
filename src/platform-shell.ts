import { SOURCES } from './sync'
const pages = [
 ['overview','/workspace','◈','总览'],['generate','/workspace?view=generate','＋','生成方案'],['tracking','/workspace?view=tracking','◎','策略追踪'],['data','/workspace?view=data','▤','数据管理'],
 ['simulator','/simulator','◉','模拟机器人'],
 ['atlas','/atlas','◇','图谱研究'],['analysis','/analysis','⌁','量化分析'],['ai','/ai','✦','AI 研究'],['arena','/arena','▥','策略实验室'],['query','/query','⌕','逐期查询'],['top3','/top3','☆','策略精选'],['settings','/settings','⚙','配置中心'],['demo','/','▧','公平演示']
]
export function platformPage(html:string,key:string) {
 const title=pages.find(p=>p[0]===key)?.[3]||'研究工作台'
 const bootstrap=`<script>(function(){try{var u=new URL(location.href),s=u.searchParams.get('source'),v=localStorage.getItem('platform:source')||localStorage.getItem('ai:source');if(!s&&/^qkltj:(600[1-4]|7001)$/.test(v||'')){s=v;u.searchParams.set('source',s);history.replaceState(null,'',u)}if(!s)s='qkltj:6001';if(/^qkltj:(600[1-4]|7001)$/.test(s)){localStorage.setItem('platform:source',s);localStorage.setItem('ai:source',s)}else if(s==='local:five'){localStorage.setItem('ai:source',s)}}catch(e){}})()</script>`
 const nav=pages.map((p,i)=>(p[0]==='atlas'?'<div class="hp-nav-caption">研究工具</div>':p[0]==='settings'?'<div class="hp-nav-caption">平台</div>':'')+`<a data-hp-route="${p[0]}" href="${p[1]}" ${key===p[0]?'aria-current="page"':''}><span aria-hidden="true">${p[2]}</span>${p[3]}</a>`).join('')
 const shell=`<a class="hp-skip" href="#platform-content">跳到主要内容</a><aside id="hp-sidebar"><a class="hp-brand" href="/workspace"><img src="/static/atlas.svg" alt="" width="36" height="36"><span>HashPlay<small>数据 · 研究 · 追踪</small></span></a><div class="hp-nav-caption">工作台</div><nav aria-label="平台导航">${nav}</nav><div class="hp-sidebar-foot"><i></i> 共用本地数据库<small>每份方案，都留下可核对的记录</small></div></aside>
 <header id="hp-header"><div><small>RESEARCH WORKSPACE</small><h1 id="hp-page-title">${title}</h1></div><div class="hp-header-actions"><label for="hp-source">数据来源</label><select id="hp-source">${Object.entries(SOURCES).filter(([id])=>id.startsWith('qkltj:')||!['overview','atlas','demo','simulator'].includes(key)).map(([id,s])=>`<option value="${id}">${s.name}</option>`).join('')}</select><span id="hp-status" role="status">读取数据</span><button id="hp-refresh" type="button">刷新</button><a href="/workspace?view=data" class="hp-data-link">数据管理 ↗</a></div></header>
 <div id="platform-content" data-page="${key}" tabindex="-1">`
 return html.replace('</head>',bootstrap+'<link rel="stylesheet" href="/static/platform.css"></head>')
 .replace(/<body([^>]*)>/,'<body$1>'+shell)
 .replace('</body>','</div><script src="/static/platform.js"></script></body>')
}

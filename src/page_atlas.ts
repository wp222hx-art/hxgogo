export const atlasPage = () => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>HashPlay · 图谱工作台</title>
<link rel="icon" type="image/svg+xml" href="/static/atlas.svg">
<link rel="stylesheet" href="/static/atlas.css"><link rel="stylesheet" href="/static/atlas-tools.css">
</head><body>
<div id="atlas-app" class="atlas-app">
<aside class="atlas-sidebar">
<a class="atlas-brand" href="/atlas"><img src="/static/atlas.svg" alt="" width="38" height="38"><span>HashPlay<small>图谱工作台</small></span></a>
<div class="atlas-nav-caption">研究空间</div><nav id="atlas-navigation" aria-label="图谱工作台导航"></nav>
<div class="atlas-sidebar-bottom"><span class="atlas-local-dot"></span>本地数据 · 独立工作区<a href="/" class="atlas-return">← 返回原平台</a></div>
</aside>
<div class="atlas-main"><header class="atlas-header"><div><div class="atlas-eyebrow">PATTERN ATLAS</div><h1 id="atlas-title">条件工作台</h1><p id="atlas-subtitle">从一条规则开始，看清每一步筛选。</p></div><div class="atlas-header-actions"><span id="atlas-data-status" class="atlas-chip">正在读取数据</span><button id="atlas-sync-now" class="atlas-button" type="button" hidden>⇄ 同步数据</button><button id="atlas-refresh" class="atlas-button" type="button">↻ 刷新快照</button></div></header>
<section id="atlas-source-bar" class="atlas-source-bar" aria-label="数据与分析范围"></section>
<div class="atlas-live-bar"><div id="atlas-live-status" class="atlas-live-status" role="status" aria-live="polite" data-phase="checking">正在核对数据库</div><button id="atlas-apply-update" class="atlas-button small" type="button" hidden>应用数据更新</button></div>
<div id="atlas-announcement" aria-live="polite"></div>
<main id="atlas-content" class="atlas-content"><div class="atlas-empty"><span class="atlas-loading"></span><h2>正在打开图谱</h2><p>读取本地目录、快照与工作区设置。</p></div></main>
<footer class="atlas-footer"><span>所有规则公开可查，排序分不表示预测命中概率。</span><a href="/analysis">原量化分析 ↗</a><a href="/settings">原配置中心 ↗</a></footer>
</div></div>
<div id="atlas-toast" class="atlas-toast" role="status" aria-live="polite"></div>
<script type="module" src="/static/atlas.js"></script>
</body></html>`

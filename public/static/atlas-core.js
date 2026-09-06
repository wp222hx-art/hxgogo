// 图谱工作台的纯计算层。这里的排序分均为历史描述，不是预测概率。
export const CORE_VERSION = 'atlas-metrics.v1';
const sum = a => a.reduce((s,n) => s+n,0);
const unique = a => [...new Set(a)];
const range = (a,b) => Array.from({length:Math.max(0,b-a+1)},(_,i)=>a+i);
const sorted = a => [...a].sort((a,b)=>a-b);
const mod = (n,d) => ((n%d)+d)%d;
export function validateRule(rule) {
  if(!rule || !Number.isInteger(rule.min)||!Number.isInteger(rule.max)||!Number.isInteger(rule.count)||rule.min<0||rule.max>49||rule.max<rule.min||rule.count<1||rule.count>10||typeof rule.ordered!=='boolean'||typeof rule.replacement!=='boolean'||(!rule.replacement&&rule.count>rule.max-rule.min+1)) throw Error('号码规则无效');
  return rule;
}
export function validNumbers(nums,rule) {
  return Array.isArray(nums)&&nums.length===rule.count&&nums.every(n=>Number.isInteger(n)&&n>=rule.min&&n<=rule.max)&&(rule.replacement||new Set(nums).size===nums.length);
}
export function validObservation(nums,rule) { return Array.isArray(nums)&&nums.length>=rule.count&&nums.every(n=>Number.isInteger(n)&&n>=rule.min&&n<=rule.max)&&(nums.length===rule.count?validNumbers(nums,rule):!rule.ordered&&!rule.replacement&&new Set(nums).size===nums.length); }
function observationSets(nums,rule){if(nums.length>rule.count&&choose(nums.length,rule.count)>500000)throw Error('单期子集超过50万，请缩小观察范围');return nums.length===rule.count?[nums]:[...combinations(nums,rule.count)];}
export function numberKey(nums,rule) { return (rule.ordered?nums:sorted(nums)).map(n=>String(n).padStart(rule.max>9?2:1,'0')).join(','); }
export function* combinations(values,k) {
  if(!Number.isInteger(k)||k<0||k>values.length)return;
  const a=[];
  function* step(start){if(a.length===k){yield [...a];return;}for(let i=start;i<=values.length-(k-a.length);i++){a.push(values[i]);yield*step(i+1);a.pop();}}
  yield*step(0);
}
export function choose(n,k){if(k<0||k>n)return 0;let x=1;for(let i=1;i<=Math.min(k,n-k);i++)x=x*(n-i+1)/i;return Math.round(x);}
export function candidateSpace(rule) {
  validateRule(rule);const n=rule.max-rule.min+1,k=rule.count;
  if(rule.ordered)return rule.replacement?n**k:Array.from({length:k},(_,i)=>n-i).reduce((a,b)=>a*b,1);
  return rule.replacement?choose(n+k-1,k):choose(n,k);
}
export function* enumerateCandidates(rule) {
  validateRule(rule);
  if(candidateSpace(rule)>500000)throw Error('组合空间超过50万，请缩小号码域或按区域分别分析');
  const a=[];
  function* step(start){if(a.length===rule.count){yield [...a];return;}for(let n=rule.ordered?rule.min:start;n<=rule.max;n++){if(!rule.replacement&&a.includes(n))continue;a.push(n);yield*step(rule.ordered?rule.min:(rule.replacement?n:n+1));a.pop();}}
  yield*step(rule.min);
}
function prime(n,params){if(n===1)return params.oneAsPrime!==false;if(n<2)return false;for(let i=2;i*i<=n;i++)if(n%i===0)return false;return true;}
function attrs(n,rule,params){const split=Number.isFinite(params.smallMax)?params.smallMax:Math.floor((rule.min+rule.max)/2);return [n%2?'单':'双',n<=split?'小':'大',prime(n,params)?'质':'合',mod(n,3)+'路'];}
function normalizedPairs(n,params){
  if(params.pairs!==undefined&&(!Array.isArray(params.pairs)||params.pairs.some(x=>!Array.isArray(x)||x.length!==2||x.some(i=>!Number.isInteger(i)||i<0||i>=n)||x[0]===x[1])))throw Error('跳位映射必须是两个不同有效位置的整数数组');
  return params.pairs??Array.from({length:n},(_,i)=>[i,(i+(n>2?2:1))%n]).filter(([a,b])=>a!==b);
}
function calcContext(nums,previous,rule,params) {
  const a=rule.ordered?[...nums]:sorted(nums),s=sorted(nums),p=[],triples=[];
  for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)p.push({i,j,d:Math.abs(a[i]-a[j]),s:a[i]+a[j],t:mod(a[i]+a[j],10)});
  for(const t of combinations(a,3)){const d=Math.abs(t[0]-t[1])+Math.abs(t[0]-t[2])+Math.abs(t[1]-t[2]);triples.push({s:sum(t),t:mod(sum(t),10),d,dt:mod(d,10),linked:sorted(t).slice(1).filter((n,i)=>n-sorted(t)[i]===1).length});}
  const pairs=normalizedPairs(a.length,params);
  const jump=pairs.map(([i,j])=>({d:Math.abs(a[i]-a[j]),s:a[i]+a[j],t:mod(a[i]+a[j],10)}));
  const u=unique(s), gaps=u.slice(1).map((n,i)=>n-u[i]), freq=new Map();
  nums.forEach(n=>freq.set(n,(freq.get(n)||0)+1));
  let runs=0,inside=false;for(const g of gaps){if(g===1&&!inside)runs++;inside=g===1;}
  const mean=sum(nums)/nums.length,variance=sum(nums.map(n=>(n-mean)**2))/nums.length,sd=Math.sqrt(variance);
  return {a,s,p,triples,jump,pairs,u,gaps,freq,runs,mean,variance,skew:sd?sum(nums.map(n=>((n-mean)/sd)**3))/nums.length:0,previous:validObservation(previous,rule)?previous:null};
}
function valueOf(id,c,rule,params) {
  const {a,s,p,triples,jump,u,gaps,freq,previous}=c,n=a.length,S=sum(a),D=p.map(x=>x.d),T=p.map(x=>x.t),pairCount=p.length;
  const count=(arr,x)=>arr.filter(v=>v===x).length;
  const repeated=arr=>unique(arr).filter(x=>count(arr,x)>1);
  const scalar=x=>x===null||x===undefined?[]:[x];
  const parts=id.split(':');
  if(parts[0]==='position')return scalar(a[+parts[1]]);
  if(parts[0]==='sorted')return scalar(s[+parts[1]]);
  if(parts[0]==='positionAttr')return a[+parts[1]]===undefined?[]:attrs(a[+parts[1]],rule,params);
  if(parts[0]==='sortedAttr')return s[+parts[1]]===undefined?[]:attrs(s[+parts[1]],rule,params);
  if(parts[0]==='pair'){const x=p.find(x=>x.i===+parts[2]&&x.j===+parts[3]);return scalar(x?.[parts[1]]);}
  if(parts[0]==='diffCount')return scalar(count(D,+parts[1]));
  if(parts[0]==='tailCount')return scalar(count(T,+parts[1]));
  if(parts[0]==='jump')return scalar(jump[+parts[2]]?.[parts[1]]);
  if(parts[0]==='jumpSort')return scalar(sorted(jump.map(x=>x[parts[1]]))[+parts[2]]);
  if(parts[0]==='jumpDigit'){const v=jump[+parts[2]]?.[parts[1]];return scalar(v===undefined?undefined:mod(v,10));}
  if(parts[0]==='routeCount')return scalar(a.filter(x=>mod(x,3)===+parts[1]).length);
  if(parts[0]==='differenceRank')return scalar(sorted(D)[+parts[1]]);
  if(parts[0]==='positionOmission'){
    const pos=+parts[1],candidate=a[pos],h=params.historyBefore;
    if(!Array.isArray(h)||!h.length)return [];
    let miss=0;for(let i=h.length-1;i>=0;i--){const nums=h[i].numbers??h[i];if(!validObservation(nums,rule))continue;if(observationSets(nums,rule).some(x=>(rule.ordered?x:sorted(x))[pos]===candidate))break;miss++;if(h[i].previousContiguous===false)break;}
    return [Math.min(300,miss)];
  }
  switch(id){
    case 'numbers':return a;
    case 'numberSet':return [numberKey(a,rule)];
    case 'sum':return [S];
    case 'tail':return [mod(S,10)];
    case 'span':return [s[n-1]-s[0]];
    case 'diffSum':return [sum(D)];
    case 'diffTail':return [mod(sum(D),10)];
    case 'mean':return [Math.round(S/n)];
    case 'meanAttr':return attrs(Math.round(S/n),rule,params);
    case 'sumAmplitude':return previous&&previous.length===n?[Math.abs(S-sum(previous))]:[];
    case 'amplitudeAttr':return previous&&previous.length===n?attrs(Math.abs(S-sum(previous)),{...rule,min:0,max:sumBounds(rule)[1]-sumBounds(rule)[0]},{...params,smallMax:params.amplitudeSmallMax}):[];
    case 'sumBands':{
      const bands=Array.isArray(params.sumBands)?params.sumBands:defaultBands(rule);
      return bands.map((b,i)=>S>=b[0]&&S<=b[1]?i:null).filter(x=>x!==null);
    }
    case 'evenCount':return [a.filter(x=>x%2===0).length];
    case 'smallCount':return [a.filter(x=>attrs(x,rule,params).includes('小')).length];
    case 'compositeCount':return [a.filter(x=>!prime(x,params)).length];
    case 'attributes':return a.flatMap(x=>attrs(x,rule,params).slice(0,3));
    case 'head':return [a[0]];
    case 'tailNumber':return [a[n-1]];
    case 'headAttr':return attrs(a[0],rule,params);
    case 'tailAttr':return attrs(a[n-1],rule,params);
    case 'headDecade':return [Math.floor(a[0]/10)];
    case 'tailDecade':return [Math.floor(a[n-1]/10)];
    case 'pairDiff':return D;
    case 'pairSum':return p.map(x=>x.s);
    case 'pairTail':return T;
    case 'pairCodes':return p.map(x=>[a[x.i],a[x.j]].sort((a,b)=>a-b).join('-'));
    case 'sameDiff':return repeated(D);
    case 'sameTail':return repeated(T);
    case 'sameDiffSegments':return repeated(D).map(x=>Math.min(2,Math.floor(3*x/(rule.max-rule.min+1))));
    case 'sameTailSegments':return repeated(T).map(x=>Math.min(2,Math.floor(3*x/10)));
    case 'uniqueDiffCount':return [unique(D).length];
    case 'uniqueTailCount':return [unique(T).length];
    case 'ac':return [unique(D.filter(x=>x>0)).length-(u.length-1)];
    case 'consecutiveLinks':return [gaps.filter(x=>x===1).length];
    case 'consecutiveRuns':return [c.runs];
    case 'repeat':return previous?[u.filter(x=>previous.includes(x)).length]:[];
    case 'shape':{
      if(n===3)return [freq.size===1?'豹子':freq.size===2?'组三':'组六'];
      return [sorted([...freq.values()]).reverse().join('+')];
    }
    case 'innerEmpty':return [s[n-1]-s[0]+1-u.length];
    case 'edgeEmpty':return [(s[0]-rule.min)+(rule.max-s[n-1])];
    case 'edgeNeighbor':return [unique(u.flatMap(x=>[x-1,x+1]).filter(x=>x>=rule.min&&x<=rule.max&&!u.includes(x))).length];
    case 'maxGap':return [Math.max(0,...gaps)];
    case 'sumDataA':return [mod(Math.floor(S/10),3)];
    case 'sumDataB':return [mod(S,10)%3];
    case 'balance':{
      const width=(rule.max-rule.min+1)/3;
      return [range(0,2).map(i=>a.filter(x=>Math.min(2,Math.floor((x-rule.min)/width))===i).length).join(':')];
    }
    case 'jumpDiff':return jump.map(x=>x.d);
    case 'jumpTail':return jump.map(x=>x.t);
    case 'jumpSum':return jump.map(x=>x.s);
    case 'tripleSum':return triples.map(x=>x.s);
    case 'tripleTail':return triples.map(x=>x.t);
    case 'tripleDiffSum':return triples.map(x=>x.d);
    case 'tripleDiffTail':return triples.map(x=>x.dt);
    case 'tripleDiffConsecutive':return triples.map(x=>x.linked);
    case 'tripleTailCount':return [unique(triples.map(x=>x.t)).length];
    case 'tripleDiffTailCount':return [unique(triples.map(x=>x.dt)).length];
    case 'sameLastDigitCount':return [a.length-unique(a.map(x=>x%10)).length];
    case 'dispersion':return [Math.round(Math.sqrt(c.variance))];
    case 'skewness':return [Math.round(c.skew*10)/10];
    default:throw Error('未知指标：'+id);
  }
}
export function metricValues(id,numbers,previous,rule,params={}) {
  validateRule(rule);if(!validNumbers(numbers,rule))return [];
  return valueOf(id,calcContext(numbers,previous,rule,params),rule,params);
}
function sumBounds(rule){return rule.replacement?[rule.min*rule.count,rule.max*rule.count]:[sum(range(rule.min,rule.min+rule.count-1)),sum(range(rule.max-rule.count+1,rule.max))];}
function defaultBands(rule){
  if(rule.min===1&&rule.max===11&&rule.count===5)return [[15,20],[21,26],[27,33],[34,39],[40,45]];
  if(rule.min===0&&rule.max===9&&rule.count===3)return [[0,9],[10,18],[19,27]];
  const [lo,hi]=sumBounds(rule),width=(hi-lo+1)/5;
  return Array.from({length:5},(_,i)=>[lo+Math.floor(i*width),i===4?hi:lo+Math.floor((i+1)*width)-1]).filter(([l,h])=>l<=h);
}
export function metricCatalog(rule,params={}) {
  validateRule(rule);const out=[],n=rule.count,N=rule.max-rule.min+1,pairs=choose(n,2),triples=choose(n,3),[slo,shi]=sumBounds(rule);
  const add=(id,label,group,values,definition,uncertain=false)=>out.push({id,label,group,values,definition,uncertain});
  const digits=range(rule.min,rule.max),at=['单','双','大','小','质','合','0路','1路','2路'];
  add('numberSet','指定号码集合','方案',[],'仅匹配完整号码集合；由方案、遗漏排行或粘贴列表建立；有序规则保留位置，无序规则按升序规范化。');
  add('numbers','胆码 / 基本走势 / 平面走势','基础',digits,'按位置统计所选号码开出个数；走势同一期同数字仅高亮一次。');
  add('sum','和值 / 和值走势','基础',range(slo,shi),'当前分析区域所有号码相加。');
  add('tail','合值 / 和合走势','基础',range(0,9),'和值对10取余（个位）。');
  add('span','跨度 / 差跨走势','基础',range(rule.replacement?0:n-1,rule.max-rule.min),'最大号码减最小号码。');
  add('diffSum','差值和','基础',range(0,pairs*(rule.max-rule.min)),'所有位置对绝对差之和。');
  add('diffTail','差合','基础',range(0,9),'所有位置对绝对差之和的个位；本平台明示口径。',true);
  const bands=Array.isArray(params.sumBands)?params.sumBands:defaultBands(rule);
  add('sumBands','和值分布','基础',bands.map((_,i)=>i),'区间编号：'+bands.map((b,i)=>i+'='+b[0]+'–'+b[1]).join('；'));
  add('mean','均值 / 均值走势','基础',digits,'所有号码平均数四舍五入取整数。');
  add('meanAttr','均值属性','号码属性',at,'对四舍五入均值取单双、大小、质合和012路。');
  add('sumAmplitude','和值振幅 / 和振走势','跨期',range(0,shi-slo),'与前一条记录和值之差绝对值；已知缺期时不计算；无日历时只代表相邻记录。');
  add('amplitudeAttr','和振属性','跨期',at,'对和值振幅分类；大小阈值默认使用振幅理论范围中点。');
  add('evenCount','号码属性 · 偶数个数','号码属性',range(0,n),'号码中偶数的位置个数。');
  add('smallCount','号码属性 · 小数个数','号码属性',range(0,n),'小数阈值≤'+(params.smallMax??Math.floor((rule.min+rule.max)/2))+'；按位置计数。');
  add('compositeCount','号码属性 · 合数个数','号码属性',range(0,n),'业务质合集合：'+(params.oneAsPrime===false?'数学质数为质，0/1及其余为合。':'1与数学质数归质，0及其他归合；可在参数中改用数学定义。'));
  add('attributes','号码属性 / 立体走势','号码属性',at.slice(0,6),'每个位置分别贡献单双、大小、质合三个属性；开出数为所选属性累计出现次数。');
  for(const [id,label] of [['head','龙头'],['tailNumber','凤尾']])add(id,label,'龙头凤尾',digits,rule.ordered?'原始固定位置的'+(id==='head'?'第一':'最后')+'位。':'号码排序后的'+(id==='head'?'最小':'最大')+'值。');
  add('headAttr','龙头凤尾 · 龙头属性','龙头凤尾',at,'当前规则首位的属性；组合规则先升序排列。');
  add('tailAttr','龙头凤尾 · 凤尾属性','龙头凤尾',at,'当前规则末位的属性；组合规则先升序排列。');
  add('headDecade','龙头首','龙头凤尾',range(0,Math.floor(rule.max/10)),'龙头号码的十位，向下取整。',true);
  add('tailDecade','凤尾首','龙头凤尾',range(0,Math.floor(rule.max/10)),'凤尾号码的十位，向下取整。',true);
  for(let i=0;i<n;i++){
    const label='第'+(i+1)+'位';
    add('position:'+i,'定位胆 / 开奖位置分布 · '+label,'定位',digits,rule.ordered?'原始固定'+label+'。':'升序排列的'+label+'；保留开奖原始顺序供对照。');
    add('positionAttr:'+i,'定位属性 · '+label,'定位',at,'对定位号码分类。');
    add('sorted:'+i,'顺序排列 / 排列走势 · '+label,'排列',digits,'将区域号码从小到大排序，取'+label+'。');
    add('sortedAttr:'+i,'排列属性 · '+label,'排列',at,'排序后'+label+'号码属性。');
    add('positionOmission:'+i,'定位遗漏 · '+label,'跨期',range(0,300),'该位置本期数字在此前记录中连续未出现的条数；扫描窗口外未知，不视为精确全历史遗漏；列300表示≥300条。',true);
  }
  for(let i=0;i<3;i++)add('routeCount:'+i,'012路个数 · '+i+'路','012路',range(0,n),'号码对3取余等于'+i+'的位置个数。');
  add('pairDiff','任意两码差值 / 差值跨度','两码',range(0,rule.max-rule.min),'所有位置对的绝对差；筛选保留重数，走势按是否至少出现一次。');
  add('pairSum','任意两码和值 / 和合分布','两码',range(rule.min*2,rule.max*2),'所有位置对的和值；筛选保留重数。');
  add('pairTail','任意两码合值','两码',range(0,9),'所有两码和值对10取余；保留重数。');
  const codes=[];for(let i=rule.min;i<=rule.max;i++)for(let j=rule.replacement?i:i+1;j<=rule.max;j++)codes.push(i+'-'+j);
  add('pairCodes','两码组合','两码',codes,'两码按数值升序规范化；支持包含或排除所选号码对。');
  add('sameDiff','同差','两码',range(0,rule.max-rule.min),'至少出现两次的两码绝对差，仅输出不同差值。');
  add('sameTail','同合','两码',range(0,9),'至少出现两次的两码和尾，仅输出不同和尾。');
  add('sameDiffSegments','同差分段','两码',range(0,2),'把重复差值按理论差值域等宽分为0/1/2段；本平台明确分段定义。',true);
  add('sameTailSegments','同合分段','两码',range(0,2),'重复和尾分段：0–3为0段，4–6为1段，7–9为2段。',true);
  add('uniqueDiffCount','两码差值个数','差值个数',range(0,pairs),'所有两码绝对差去重后的个数。',true);
  add('uniqueTailCount','两码合值个数','差值个数',range(0,Math.min(10,pairs)),'所有两码和尾去重后的个数。',true);
  for(let i=0;i<=rule.max-rule.min;i++)add('diffCount:'+i,'差值个数 · 差'+i,'差值个数',range(0,pairs),'两码绝对差等于'+i+'的位置对数量，重复号码形成的0差也计数。');
  for(let i=0;i<10;i++)add('tailCount:'+i,'两码合值个数 · 合'+i,'差值个数',range(0,pairs),'两码和尾等于'+i+'的位置对数量。');
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)for(const [key,label,max] of [['d','定位差值 / 两码差值',rule.max-rule.min],['s','两码和值',rule.max*2],['t','两码合值',9]])add('pair:'+key+':'+i+':'+j,label+' · '+(i+1)+'-'+(j+1),'位置对',range(0,max),'按当前规则位置取第'+(i+1)+'和'+(j+1)+'位，计算'+({d:'绝对差',s:'和值',t:'和值个位'})[key]+'。');
  add('ac','AC值','邻空',range(0,Math.max(0,pairs-(n-1))),'去重正差值个数 −（不同号码个数−1）；公开差值复杂度定义。',true);
  add('innerEmpty','间空值','邻空',range(0,N-1),'最小与最大号码之间未被选取的整数个数。');
  add('edgeEmpty','边空值','邻空',range(0,N-1),'最小号码以下与最大号码以上的可选号个数之和。');
  add('edgeNeighbor','边邻值','邻空',range(0,N-1),'未选号码中，至少与一个已选号码相差1的不同号码个数；截图原式不明，此处采用公开邻接定义。',true);
  add('maxGap','最大邻码差 / 最大邻码跨度','邻空',range(0,rule.max-rule.min),'排序去重后相邻号码之差的最大值。');
  add('consecutiveLinks','连号落码 / 连号个数','连号落码',range(0,n-1),'排序去重后相邻差为1的链接数，如3,4,5计2。');
  add('consecutiveRuns','连号段数','连号落码',range(0,Math.floor(n/2)),'含至少2个相邻连续号码的段数，如1,2,5,6计2。');
  add('repeat','落码 / 重码个数','跨期',range(0,n),'与前一条记录重复的不同号码个数；已知缺期则不计算。',true);
  if(n===3)add('shape','形态组合','排列',['豹子','组三','组六'],'三同号/恰有两同号/三个不同号。');
  else {
    const partitions=[];function p(left,max,a){if(!left){partitions.push(a.join('+'));return;}for(let x=Math.min(left,max);x>=1;x--)p(left-x,x,[...a,x]);}p(n,n,[]);
    add('shape','形态组合','排列',partitions,'相同数字重数从大到小组成的分区，如2+1+1+1。');
  }
  add('sumDataA','和值数据 A','自定义口径',range(0,2),'A定义为floor(和值/10)对3取余。参考图未提供原公式。',true);
  add('sumDataB','和值数据 B','自定义口径',range(0,2),'B定义为和值个位对3取余。参考图未提供原公式。',true);
  const balances=[];for(let a=0;a<=n;a++)for(let b=0;b<=n-a;b++)balances.push(a+':'+b+':'+(n-a-b));
  add('balance','均衡数据 / 均衡分布','自定义口径',balances,'号码域按等宽三段分区，统计每段号码个数；参考图没有原分区公式。',true);
  const jp=normalizedPairs(n,params);
  for(const [key,label,max] of [['d','跳位差值',rule.max-rule.min],['s','跳位和值',rule.max*2],['t','跳位合值',9]]){
    add(key==='d'?'jumpDiff':key==='s'?'jumpSum':'jumpTail',label+'分布','跳位',range(0,max),'分组位置对：'+jp.map(([a,b],i)=>String.fromCharCode(65+i)+'='+(a+1)+'-'+(b+1)).join('；')+'。可配置映射，原软件A–E映射未知。',true);
    jp.forEach(([a,b],i)=>{
      add('jump:'+key+':'+i,label+' '+String.fromCharCode(65+i),'跳位',range(0,max),'第'+(a+1)+'与第'+(b+1)+'位'+({d:'绝对差',s:'之和',t:'和尾'})[key]+'；位置映射可改。',true);
      if(key!=='s'){
        add('jumpSort:'+key+':'+i,label+'排序 · '+(i+1),'跳位排序',range(0,max),'对所有跳位'+(key==='d'?'差值':'合值')+'排序，取第'+(i+1)+'项。',true);
        add('jumpDigit:'+key+':'+i,(key==='d'?'跳位差分解':'跳位合分解')+' '+String.fromCharCode(65+i),'跳位排序',range(0,9),'取该跳位结果的个位；截图未提供分解公式。',true);
      }
    });
  }
  for(let i=1;i<=Math.min(4,pairs-1);i++)add('differenceRank:'+i,'差值'+['一','二','三','四','五'][i]+'分布','差值排序',range(0,rule.max-rule.min),'将所有位置对绝对差升序排序，取第'+(i+1)+'项（计重数）；本平台定义。',true);
  if(n>=3){
    for(const [id,label,max,def] of [
      ['tripleSum','三码和值 / 任意三码和值',rule.max*3,'每个三位置组合求和'],
      ['tripleTail','三码合值 / 任意三码合值',9,'每个三位置组合的和值个位'],
      ['tripleDiffSum','三码差值和',2*(rule.max-rule.min),'每组三码三对绝对差的和（等于2倍跨度）'],
      ['tripleDiffTail','三码差值合',9,'每组三码三对绝对差之和的个位'],
      ['tripleDiffConsecutive','三码差值连号',2,'每组三码升序后相邻差为1的链接数'],
      ['tripleTailCount','三码合值个数',Math.min(10,triples),'所有三码组合和尾去重个数'],
      ['tripleDiffTailCount','三码差值合个数',Math.min(10,triples),'所有三码组合差值和尾去重个数']
    ])add(id,label,'三码',range(0,max),def+'。',true);
  }
  add('sameLastDigitCount','同尾个数','大乐透',range(0,n-1),'号码个数减不同个位数个数（额外同尾号码数）。',true);
  add('dispersion','号码散度值','大乐透',range(0,rule.max-rule.min),'号码总体标准差四舍五入取整；截图未提供散度公式。',true);
  add('skewness','号码偏度值','大乐透',range(-30,30).map(x=>x/10),'号码总体标准化三阶中心矩，保留1位小数；标准差0时记0；截图未提供偏度公式。',true);
  return out;
}
export function omissionStats(hits) {
  let count=0,streak=0,miss=0,maxStreak=0,maxMiss=0,observed=0,lastUnknown=true;
  for(const hit of hits){if(hit===null||hit===undefined){streak=0;miss=0;lastUnknown=true;continue;}observed++;lastUnknown=false;if(hit){count++;streak++;miss=0;maxStreak=Math.max(maxStreak,streak);}else{miss++;streak=0;maxMiss=Math.max(maxMiss,miss);}}
  return {count,maxStreak,maxMiss,currentMiss:lastUnknown?null:miss,observed,neverHit:observed>0&&count===0};
}
const cross = id => ['sumAmplitude','amplitudeAttr','repeat'].includes(id)||id.startsWith('positionOmission:');
export function buildTrend(records,metricIds,rule,params={}) {
  const catalog=metricCatalog(rule,params),selected=metricIds.map(id=>catalog.find(m=>m.id===id)).filter(Boolean);
  const columns=selected.flatMap(m=>m.values.map(value=>({key:m.id+'='+value,metricId:m.id,value,label:m.label+' · '+value})));
  if(columns.length>1500)throw Error('列数超过1500，请减少同时显示的指标');
  const history=[],series=columns.map(()=>[]),miss=columns.map(()=>0),rows=[];let contiguousHistory=[];
  for(let i=0;i<records.length;i++){
    const row=records[i];if(!validObservation(row.numbers,rule))continue;
    if(row.previousContiguous===false){contiguousHistory=[];series.forEach(s=>s.push(null));miss.fill(0);}
    const previous=row.previousContiguous===false?null:history.at(-1)?.numbers;
    const localParams={...params,historyBefore:contiguousHistory};
    const contexts=observationSets(row.numbers,rule).map(numbers=>calcContext(numbers,previous,rule,localParams)),vals=new Map(selected.map(m=>[m.id,contexts.flatMap(c=>valueOf(m.id,c,rule,localParams))]));
    const cells=columns.map((col,j)=>{
      const values=vals.get(col.metricId),unknown=cross(col.metricId)&&values.length===0;
      const hit=unknown?null:values.includes(col.value);series[j].push(hit);
      if(hit!==null)miss[j]=hit?0:miss[j]+1;else miss[j]=0;
      return {hit,miss:hit===null?null:miss[j]};
    });
    rows.push({period:row.period,numbers:row.numbers,cells});history.push(row);contiguousHistory.push(row);
  }
  return {columns,rows,stats:series.map(omissionStats)};
}
export function matchesRules(numbers,rules,rule,options={}) {
  if(!validObservation(numbers,rule))return {accepted:false,failed:rules.length,known:false};
  if(numbers.length>rule.count){const results=observationSets(numbers,rule).map(nums=>matchesRules(nums,rules,rule,options));return {accepted:results.some(r=>r.known!==false&&r.accepted),failed:Math.min(...results.map(r=>r.failed)),known:results.some(r=>r.known!==false)};}
  const active=rules.filter(r=>r.enabled!==false&&Array.isArray(r.values)&&r.values.length);
  if(!active.length)return {accepted:!options.inverse,failed:0,known:true};
  const params={...options.params,historyBefore:options.history||[]},cache=new Map();let failed=0,c=null,known=true;
  for(const r of rules){
    if(r.enabled===false||!Array.isArray(r.values)||r.values.length===0)continue;
    if(!cache.has(r.metricId)){
      let v;
      if(r.metricId==='numberSet')v=[numberKey(numbers,rule)];
      else if(r.metricId==='numbers')v=numbers;
      else if(r.metricId==='sum')v=[sum(numbers)];
      else if(r.metricId==='tail')v=[mod(sum(numbers),10)];
      else if(r.metricId==='span')v=[Math.max(...numbers)-Math.min(...numbers)];
      else { c??=calcContext(numbers,options.previous,rule,params);v=valueOf(r.metricId,c,rule,params); }
      cache.set(r.metricId,v);
    }
    const vals=cache.get(r.metricId),hits=vals.filter(x=>r.values.includes(x)).length,tol=Math.max(0,Number(r.tolerance)||0);
    if(cross(r.metricId)&&vals.length===0)known=false;
    const lo=Math.max(0,(r.minHits===undefined?1:Number(r.minHits))-tol),hi=(r.maxHits===undefined?Infinity:Number(r.maxHits))+tol;
    let ok=vals.length>0&&hits>=lo&&hits<=hi;if(r.exclude&&vals.length>0)ok=!ok;if(!ok)failed++;
  }
  const accepted=failed<=Math.max(0,Number(options.globalTolerance)||0);
  return {accepted:known&&(options.inverse?!accepted:accepted),failed,known};
}
function rankModel(history,rule){
  const counts=Array.from({length:rule.count},()=>new Map()),all=new Map(),valid=history.filter(r=>validObservation(r.numbers,rule)),n=valid.length;
  for(const r of valid)r.numbers.forEach((v,i)=>{if(counts[i])counts[i].set(v,(counts[i].get(v)||0)+1);all.set(v,(all.get(v)||0)+1);});
  return nums=>!n?0:Math.round(sum(nums.map((v,i)=>rule.ordered?(counts[i].get(v)||0)/n:(all.get(v)||0)/n))/nums.length*10000)/100;
}
export function evaluateCandidates(rule,rules=[],options={}) {
  const total=candidateSpace(rule);if(total>500000)throw Error('组合空间过大，请分区分析');
  const catalog=new Set(metricCatalog(rule,options.params).map(m=>m.id));
  for(const r of rules)if(r.enabled!==false&&r.values?.length&&!catalog.has(r.metricId))throw Error('条件不适用当前规则：'+r.metricId);
  const page=Math.max(1,Math.floor(Number(options.page)||1)),pageSize=Math.min(10000,Math.max(1,Math.floor(Number(options.pageSize)||100))),start=(page-1)*pageSize;
  const rank=rankModel(options.history||[],rule),ranked=[],items=[];let count=0;
  for(const numbers of enumerateCandidates(rule)){
    const match=matchesRules(numbers,rules,rule,options);if(!match.accepted)continue;
    const index=count++;if(options.order==='score'||(index>=start&&index<start+pageSize)){
      const item={numbers,key:numberKey(numbers,rule),score:rank(numbers),failed:match.failed};
      if(options.order==='score')ranked.push(item);else items.push(item);
    }
  }
  if(options.order==='score'){ranked.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));items.push(...ranked.slice(start,start+pageSize));}
  return {total,count,items,page,pageSize,truncated:count>items.length,definition:'排序分为历史各位置（或号码）出现频次平均值×100，不是命中概率。'};
}
export function combinedPage(front,back,page=1,pageSize=100){
  const f=front.map(x=>x.numbers||x),b=back.map(x=>x.numbers||x),count=f.length*b.length,start=Math.max(0,(page-1)*pageSize),items=[];
  for(let i=start;i<Math.min(count,start+pageSize);i++)items.push({front:f[Math.floor(i/b.length)],back:b[i%b.length]});
  return {count,items,page,pageSize};
}

/** One scan for full exports; only use inside the isolated calculation worker. */
export function* iterateMatches(rule,rules=[],options={}) {
  const total=candidateSpace(rule);if(total>500000)throw Error('组合空间超过50万，请分区分析');
  const catalog=new Set(metricCatalog(rule,options.params).map(m=>m.id));
  for(const r of rules)if(r.enabled!==false&&r.values?.length&&!catalog.has(r.metricId))throw Error('条件不适用当前规则：'+r.metricId);
  const rank=rankModel(options.history||[],rule);
  for(const numbers of enumerateCandidates(rule)){
    const match=matchesRules(numbers,rules,rule,options);
    if(match.accepted)yield {numbers,key:numberKey(numbers,rule),score:rank(numbers),failed:match.failed};
  }
}
/** Independent zone filters, then a Cartesian product in number order. Never materializes 21M rows. */
export function evaluateZonedCandidates(zones,zoneRules={},options={}) {
  if(!zones?.front||!zones?.back)throw Error('需要前后区独立规则');
  const zoneOptions=options.zoneOptions||{},back=[...iterateMatches(zones.back,zoneRules.back||[],zoneOptions.back||{})];
  const page=Math.max(1,Math.floor(Number(options.page)||1)),pageSize=Math.min(10000,Math.max(1,Math.floor(Number(options.pageSize)||100))),start=(page-1)*pageSize;
  let frontCount=0;const items=[];
  for(const front of iterateMatches(zones.front,zoneRules.front||[],zoneOptions.front||{})){
    const base=frontCount++*back.length;
    if(base+back.length<=start||base>=start+pageSize)continue;
    for(let j=Math.max(0,start-base);j<Math.min(back.length,start+pageSize-base);j++){
      const b=back[j];items.push({zones:{front:front.numbers,back:b.numbers},key:front.key+'|'+b.key});
    }
  }
  return {total:candidateSpace(zones.front)*candidateSpace(zones.back),frontCount,backCount:back.length,count:frontCount*back.length,items,page,pageSize,definition:'前后区分别满足各自条件后组合；按号码序分页，不一次展开全部组合。'};
}

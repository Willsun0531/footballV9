const UPSTREAM = "https://football-predict.pages.dev/api/daily-jingcai";
const HEADERS = {"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=120, s-maxage=120","access-control-allow-origin":"*"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function normalize(a){const s=a.reduce((x,y)=>x+y,0);return s>0?a.map(x=>x/s):null}
function argmax(a){return a.indexOf(Math.max(...a))}
function oldProb(m){return normalize([n(m.homeWinProb??m.spf?.homeWinProb),n(m.drawProb??m.spf?.drawProb),n(m.awayWinProb??m.spf?.awayWinProb)])}
function marketProb(m){const a=[n(m.sp_win),n(m.sp_draw),n(m.sp_lose)];return a.every(x=>x>1)?normalize(a.map(x=>1/x)):null}
function eloProb(m){const eh=n(m.home_elo??m.homeElo??m.elo?.home,NaN),ea=n(m.away_elo??m.awayElo??m.elo?.away,NaN);if(!Number.isFinite(eh)||!Number.isFinite(ea))return null;const raw=1/(1+Math.pow(10,-((eh+65)-ea)/400)),draw=clamp(.30-Math.abs(raw-.5)*.22,.17,.30);return normalize([raw*(1-draw),draw,(1-raw)*(1-draw)])}
function factorial(k){let r=1;for(let i=2;i<=k;i++)r*=i;return r}
function pois(k,l){return Math.exp(-l)*Math.pow(l,k)/factorial(k)}
function matrix(lh,la,dc=false){if(!(lh>0&&la>0))return null;let h=0,d=0,a=0,total=0,scores=[];for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){let p=pois(i,lh)*pois(j,la);if(dc){const rho=-.08;if(i===0&&j===0)p*=1-lh*la*rho;else if(i===0&&j===1)p*=1+lh*rho;else if(i===1&&j===0)p*=1+la*rho;else if(i===1&&j===1)p*=1-rho}p=Math.max(0,p);total+=p;if(i>j)h+=p;else if(i===j)d+=p;else a+=p;scores.push({score:`${i}:${j}`,prob:p})}if(!(total>0))return null;scores=scores.map(x=>({score:x.score,prob:x.prob/total})).sort((x,y)=>y.prob-x.prob);return{probabilities:normalize([h,d,a]),scores:scores.slice(0,8),probabilityUnit:'fraction'}}
function fraction(v){const x=n(v,NaN);if(!Number.isFinite(x)||x<0)return null;return x>1?x/100:x}
function normalizeScores(rows){const out=[];for(const x of rows||[]){const p=fraction(x.prob??x.probability);if(p!=null&&p<=1)out.push({score:String(x.score||'').replace('-',':'),prob:p})}return out.sort((a,b)=>b.prob-a.prob).slice(0,8)}
function sampleInfo(m){const fields=[m.sampleCount,m.historySample,m.history_samples,m.dataQuality?.sampleCount,m.dataQuality?.historySample,m.dataQuality?.samples,m.stats?.sampleCount];for(const v of fields)if(v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v)))return{known:true,count:Math.max(0,Number(v))};return{known:false,count:null}}
function buildFusion(m){
  const legacy=oldProb(m),market=marketProb(m),elo=eloProb(m),lh=n(m.score?.homeLambda??m.homeLambda,NaN),la=n(m.score?.awayLambda??m.awayLambda,NaN),poisson=matrix(lh,la,false),dc=matrix(lh,la,true);
  const components=[];
  if(elo)components.push({key:'elo',familyKey:'elo',familyName:'Elo',name:'Elo',familyWeight:.25,probabilities:elo,source:'upstream-elo'});
  if(poisson)components.push({key:'poisson',familyKey:'goals',familyName:'进球模型家族',name:'Poisson',familyWeight:.30,probabilities:poisson.probabilities,source:'upstream-lambda'});
  if(dc)components.push({key:'dixonColes',familyKey:'goals',familyName:'进球模型家族',name:'Dixon-Coles',familyWeight:.30,probabilities:dc.probabilities,source:'upstream-lambda-rho--0.08'});
  if(legacy)components.push({key:'legacy',familyKey:'legacy',familyName:'旧接口模型',name:'旧接口模型',familyWeight:.15,probabilities:legacy,source:'daily-jingcai'});
  if(market)components.push({key:'market',familyKey:'market',familyName:'体彩市场',name:'体彩SP去水',familyWeight:.30,probabilities:market,source:'official-sp'});
  const familyMap=new Map();
  for(const c of components){if(!familyMap.has(c.familyKey))familyMap.set(c.familyKey,{key:c.familyKey,name:c.familyName,weight:c.familyWeight,components:[]});familyMap.get(c.familyKey).components.push(c)}
  const families=[];
  for(const f of familyMap.values()){
    const avg=[0,0,0];for(const c of f.components)for(let i=0;i<3;i++)avg[i]+=c.probabilities[i]/f.components.length;
    families.push({...f,probabilities:normalize(avg),direction:['主胜','平局','客胜'][argmax(avg)]});
  }
  const sum=families.reduce((s,x)=>s+x.weight,0),fused=[0,0,0];if(sum>0)for(const f of families)for(let i=0;i<3;i++)fused[i]+=f.probabilities[i]*f.weight/sum;
  const probabilities=normalize(fused)||legacy||market||[1/3,1/3,1/3],top=argmax(probabilities),supportingFamilies=families.filter(f=>argmax(f.probabilities)===top).length,familyConsistency=families.length?supportingFamilies/families.length*100:0;
  const goalFamily=families.find(f=>f.key==='goals'),dcDraw=dc?dc.probabilities[1]*100:null,poissonDraw=poisson?poisson.probabilities[1]*100:null;
  const scores=dc?.scores||poisson?.scores||normalizeScores(m.score?.topScores);
  return{version:'V16-P14',components:components.map(c=>({...c,probabilities:c.probabilities.map(v=>v*100),probabilityUnit:'percent',direction:['主胜','平局','客胜'][argmax(c.probabilities)]})),families:families.map(f=>({key:f.key,name:f.name,weight:f.weight,probabilities:f.probabilities.map(v=>v*100),direction:f.direction,componentKeys:f.components.map(c=>c.key)})),probabilities:probabilities.map(v=>v*100),probabilityUnit:'percent',componentCount:components.length,modelCount:families.length,supportingFamilies,familyConsistency:Number(familyConsistency.toFixed(1)),consistency:Number(familyConsistency.toFixed(1)),weightsNormalized:true,scoreSource:dc?'dixon-coles':poisson?'poisson':'upstream',scores:scores||[],scoreProbabilityUnit:'fraction',drawDiagnostics:{dixonColes:dcDraw==null?null:Number(dcDraw.toFixed(1)),poisson:poissonDraw==null?null:Number(poissonDraw.toFixed(1)),goalFamily:goalFamily?Number((goalFamily.probabilities[1]*100).toFixed(1)):null}};
}
function riskWarnings(m,f){
  const p=f.probabilities,market=marketProb(m),draw=p[1],drawScores=(f.scores||[]).filter(x=>{const[h,a]=String(x.score).split(':').map(Number);return h===a}).reduce((s,x)=>s+n(x.prob),0)*100;
  const drawSupportingFamilies=(f.families||[]).filter(x=>x.direction==='平局'||n(x.probabilities?.[1])>=30).length,marketDraw=market?market[1]*100:null,gap=Math.abs(n(m.score?.homeLambda??m.homeLambda)-n(m.score?.awayLambda??m.awayLambda)),dcDraw=f.drawDiagnostics?.dixonColes;
  const drawScore=clamp(draw*.75+drawScores*.55+(dcDraw??draw)*.35+drawSupportingFamilies*6+(marketDraw??0)*.25+(gap<.35?10:gap<.7?5:0),0,100);
  const drawLevel=drawScore>=68?'高':drawScore>=52?'中':'低';
  const top=argmax(p),labels=['主胜','平局','客胜'],favorite=labels[top],nonFavorite=100-p[top],primaryRisk=top===0?(p[1]>=p[2]?'平局':'客胜'):top===2?(p[1]>=p[0]?'平局':'主胜'):(p[0]>=p[2]?'主胜':'客胜');
  const upsetScore=clamp(nonFavorite*.75+(100-f.familyConsistency)*.35+(drawLevel==='高'&&favorite!=='平局'?10:0)+(n(m.dataQuality?.reliability)<45?6:0),0,100),upsetLevel=upsetScore>=68?'高':upsetScore>=52?'中':'低';
  return{version:'V16-P14',draw:{level:drawLevel,score:Number(drawScore.toFixed(1)),probability:Number(draw.toFixed(1)),drawScoreProbability:Number(drawScores.toFixed(1)),dixonColesProbability:dcDraw,gxGap:Number.isFinite(gap)?Number(gap.toFixed(2)):null,familySupport:drawSupportingFamilies,familyDenominator:f.modelCount,reasons:[`融合平局${draw.toFixed(1)}%`,dcDraw==null?'Dixon-Coles平局不可用':`Dixon-Coles平局${dcDraw.toFixed(1)}%`,`平局比分合计${drawScores.toFixed(1)}%`,`${drawSupportingFamilies}/${f.modelCount}个独立模型家族支持平局`,marketDraw==null?'市场平局概率缺失':`市场平局${marketDraw.toFixed(1)}%`]},upset:{level:upsetLevel,score:Number(upsetScore.toFixed(1)),favorite,primaryRisk,reasons:[`非首选合计${nonFavorite.toFixed(1)}%`,`独立家族一致性${f.familyConsistency.toFixed(0)}%`,drawLevel==='高'?'高平局风险':'平局风险未达高位']}};
}
function grade(m,f,w){
  const p=f.probabilities,ord=[...p].sort((a,b)=>b-a),lead=ord[0]-ord[1],si=sampleInfo(m),samples=si.count,reliability=n(m.dataQuality?.reliability??m.reliability),official=!!marketProb(m),quality=Math.min(100,(si.known?samples*4:0)+(official?25:0)+f.modelCount*10+(reliability>=45?10:0));
  let baseTier='C',reason='未达到B级门槛';
  if(si.known&&samples>=6&&official&&f.modelCount>=3&&f.familyConsistency>=70&&quality>=60&&lead>=10&&reliability>=45){baseTier='A';reason='样本、独立模型家族、一致性、官方SP与方向优势均达到A级'}
  else if(si.known&&samples>=3&&official&&f.modelCount>=3&&f.familyConsistency>=55&&quality>=40&&lead>=6&&reliability>=30){baseTier='B';reason='具备独立模型家族和市场验证，但未达到A级完整要求'}
  else if(!si.known&&official&&f.modelCount>=3&&f.familyConsistency>=70&&quality>=55&&lead>=10&&reliability>=45){baseTier='B';reason='历史样本字段缺失，凭独立模型家族、官方SP和一致性暂列B级，不允许升级A级'}
  else if(si.known&&samples<3)reason=`历史样本不足（${samples}场）`;else if(!si.known)reason='历史样本字段缺失，等待上游补齐';else if(f.modelCount<3)reason=`独立模型家族不足（${f.modelCount}个）`;else if(f.familyConsistency<55)reason=`独立家族一致性不足（${f.familyConsistency.toFixed(0)}%）`;else if(!official)reason='缺少完整体彩SP';
  let tier=baseTier,trigger=null;if(w.upset.level==='高'){if(tier==='A'){tier='B';trigger='高冷门风险'}else if(tier==='B'){tier='C';trigger='高冷门风险'}}else if(w.draw.level==='高'&&w.upset.favorite!=='平局'&&tier==='A'){tier='B';trigger='高平局风险'}
  return{version:'V16-P14',tier,baseTier,reason:trigger?`${reason}；${trigger}降级`:reason,riskDowngraded:!!trigger,riskTrigger:trigger,sampleCount:samples,sampleKnown:si.known,sampleStatus:si.known?`${samples}场`:'字段缺失',reliability,quality:Math.round(quality),lead:Number(lead.toFixed(1)),familyCount:f.modelCount,componentCount:f.componentCount,familyConsistency:f.familyConsistency,supportingFamilies:f.supportingFamilies,officialSp:official};
}
function enrich(m){const f=buildFusion(m),w=riskWarnings(m,f),g=grade(m,f,w);return{...m,homeWinProb:f.probabilities[0],drawProb:f.probabilities[1],awayWinProb:f.probabilities[2],spf:{...(m.spf||{}),homeWinProb:f.probabilities[0],drawProb:f.probabilities[1],awayWinProb:f.probabilities[2],tier:g.tier},score:{...(m.score||{}),topScores:f.scores,probabilityUnit:'fraction'},modelFusion:f,riskWarnings:w,calibratedTier:g.tier,grading:g}}
export async function onRequestGet(context){const u=new URL(context.request.url),q=new URLSearchParams();for(const[k,v]of u.searchParams)if(k!=='x')q.set(k,v);if(!q.has('days'))q.set('days','4');try{const r=await fetch(`${UPSTREAM}?${q}`,{headers:{accept:'application/json','user-agent':'Mozilla/5.0'}}),text=await r.text(),payload=JSON.parse(text);if(!r.ok||payload.success===false)return json({success:false,error:payload.error||`upstream ${r.status}`,matches:[]},502);const matches=(Array.isArray(payload.matches)?payload.matches:[]).map(enrich),gradeCounts=matches.reduce((a,m)=>(a[m.grading.tier]++,a),{A:0,B:0,C:0});return json({...payload,success:true,total:matches.length,matches,gradeCounts,modelVersion:'V16-P14 Regression Safe Families',strategyAudit:{elo:'active-when-upstream-elo-exists',gxPoisson:'active-when-lambda-exists',dixonColes:'active-when-lambda-exists',legacy:'active-when-legacy-probability-exists',sportteryMarket:'active-when-three-sp-exist',drawWarning:'full-dixon-coles-and-family-support',upsetWarning:'family-consistency-risk-only',sampleHandling:'missing-is-not-zero-b-tier-cap',scoreProbability:'fraction-0-to-1',calibration:'collecting-full-review-samples',dynamicWeights:'disabled-until-sufficient-sample',modelFamily:'poisson-and-dixon-coles-merged',passContract:'V16-P14'}})}catch(e){return json({success:false,error:e.message,matches:[]},502)}}

const UPSTREAM="https://football-predict.pages.dev/api/daily-jingcai";
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*"};
const J=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
function score(m){const h=m.home_score??m.homeScore??m.score?.fullTime?.home??m.score?.home??m.goals?.home,a=m.away_score??m.awayScore??m.score?.fullTime?.away??m.score?.away??m.goals?.away;return Number.isFinite(Number(h))&&Number.isFinite(Number(a))?[Number(h),Number(a)]:null}
function half(m){const h=m.ht_home_score??m.halfTime?.home??m.score?.halfTime?.home,a=m.ht_away_score??m.halfTime?.away??m.score?.halfTime?.away;return Number.isFinite(Number(h))&&Number.isFinite(Number(a))?[Number(h),Number(a)]:null}
function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(fc|sc|cf|ec|afc|club|fk|ff)\b/g,'').replace(/[^a-z0-9\u4e00-\u9fff]/g,'')}
function row(m,source){const sc=score(m),ht=half(m);if(!sc)return null;return{source,id:String(m.id??m.fixture?.id??''),issue:m.jingcai_num||m.matchNumStr||m.issue||'',date:m.date||String(m.utcDate||m.fixture?.date||'').slice(0,10),home:m.home_team||m.home||m.homeTeam?.name||m.teams?.home?.name||'',away:m.away_team||m.away||m.awayTeam?.name||m.teams?.away?.name||'',homeScore:sc[0],awayScore:sc[1],halfHome:ht?.[0]??null,halfAway:ht?.[1]??null,status:m.status||m.fixture?.status?.short||'FINISHED'} }
function unique(a){const out=[];for(const x of a.filter(Boolean)){const key=x.issue||[x.date,norm(x.home),norm(x.away)].join('|');if(!out.some(y=>(y.issue&&y.issue===x.issue)||[y.date,norm(y.home),norm(y.away)].join('|')===key))out.push(x)}return out}
async function fetchText(url){const r=await fetch(url,{headers:{accept:'application/json','user-agent':'Mozilla/5.0'},cache:'no-store'}),t=await r.text();let j;try{j=JSON.parse(t)}catch{throw Error(`${url}非JSON:${t.slice(0,80)}`)}if(!r.ok||j.success===false)throw Error(j.error||`HTTP ${r.status}`);return j}
export async function onRequestGet(context){const u=new URL(context.request.url),origin=u.origin,date=u.searchParams.get('date')||new Date(Date.now()-86400000).toISOString().slice(0,10),sources=[],errors=[];
 const jobs=[
  ['lottery',`${UPSTREAM}?date=${encodeURIComponent(date)}&days=1&includeFinished=1`],
  ['fixtures',`${origin}/api/fixtures?date=${encodeURIComponent(date)}&days=1&includeFinished=1`],
  ['appData',`${origin}/api/app-data?date=${encodeURIComponent(date)}&includeFinished=1`],
  ['jingcaiFallback',`${origin}/api/jingcai?date=${encodeURIComponent(date)}&days=1&includeFinished=1&settlement=1`]
 ];
 const settled=await Promise.allSettled(jobs.map(x=>fetchText(x[1]))),all=[];
 settled.forEach((r,i)=>{const name=jobs[i][0];if(r.status==='rejected'){errors.push({source:name,error:r.reason.message});return}const j=r.value;let candidates=[];if(name==='lottery'||name==='jingcaiFallback')candidates=j.results||j.matches||[];if(name==='fixtures')candidates=[...(j.finished||[]),...(j.results||[])];if(name==='appData')candidates=j.finished||j.results||[];const rows=candidates.map(x=>row(x,name)).filter(Boolean);sources.push({source:name,raw:candidates.length,scored:rows.length});all.push(...rows)});
 const results=unique(all);return J({success:true,version:'V16-P15',date,total:results.length,results,sources,errors})}
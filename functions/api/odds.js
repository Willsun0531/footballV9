const H={"content-type":"application/json;charset=utf-8","cache-control":"public,max-age=900"};const J=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});async function G(u){const r=await fetch(u),j=await r.json();if(!r.ok)throw Error(j?.message||`HTTP ${r.status}`);return{j,r}}const ALLOWED_SPORT_KEYS = new Set([
2
"soccer_epl",
3
"soccer_efl_champ",
4
 
5
"soccer_spain_la_liga",
6
"soccer_germany_bundesliga",
7
"soccer_italy_serie_a",
8
"soccer_france_ligue_one",
9
 
10
"soccer_uefa_champs_league",
11
"soccer_uefa_europa_league",
12
 
13
"soccer_netherlands_eredivisie",
14
"soccer_portugal_primeira_liga",
15
 
16
"soccer_usa_mls",
17
 
18
"soccer_brazil_campeonato",
19
 
20
"soccer_norway_eliteserien",
21
"soccer_sweden_allsvenskan",
22
 
23
"soccer_japan_j_league",
24
"soccer_korea_kleague1",
25
 
26
"soccer_australia_aleague"
27
]);
28
 
29
const ok = s => ALLOWED_SPORT_KEYS.has(s.key);export async function onRequestGet(c){const k=c.env.THE_ODDS_API_KEY;if(!k)return J({error:'THE_ODDS_API_KEY未配置',events:[]},500);try{const sr=await G(`https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(k)}`),selected=sr.j.filter(x=>x.group==='Soccer'&&!x.has_outrights&&ok(x)),events=[],errors=[];let remaining=null,used=null;for(const s of selected){try{const q=await G(`https://api.the-odds-api.com/v4/sports/${s.key}/odds/?apiKey=${encodeURIComponent(k)}&regions=eu,au&markets=h2h,spreads&oddsFormat=decimal&dateFormat=iso`);remaining=q.r.headers.get('x-requests-remaining')||remaining;used=q.r.headers.get('x-requests-used')||used;for(const e of q.j)events.push({id:e.id,sportKey:e.sport_key,league:e.sport_title,home:e.home_team,away:e.away_team,commenceTime:e.commence_time,bookmakers:e.bookmakers||[]})}catch(e){errors.push({sportKey:s.key,message:e.message})}}return J({events,queriedSports:selected.map(x=>({key:x.key,title:x.title})),requestsRemaining:remaining,requestsUsed:used,partialErrors:errors,source:'the-odds-api',updatedAt:new Date().toISOString()})}catch(e){return J({error:e.message,events:[]},502)}}

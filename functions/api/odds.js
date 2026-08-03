const H={"content-type":"application/json;charset=utf-8","cache-control":"public,max-age=21600, s-maxage=21600"};
const J=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
async function G(u){const r=await fetch(u),j=await r.json();if(!r.ok)throw Error(j?.message||`HTTP ${r.status}`);return{j,r}}
const ALLOWED_SPORT_KEYS=new Set([
 "soccer_epl","soccer_efl_champ","soccer_spain_la_liga","soccer_germany_bundesliga","soccer_italy_serie_a","soccer_france_ligue_one",
 "soccer_uefa_champs_league","soccer_uefa_europa_league","soccer_netherlands_eredivisie","soccer_portugal_primeira_liga",
 "soccer_usa_mls","soccer_brazil_campeonato","soccer_norway_eliteserien","soccer_sweden_allsvenskan",
 "soccer_japan_j_league","soccer_korea_kleague1","soccer_australia_aleague"
]);
export async function onRequestGet(c){
 const k=c.env.THE_ODDS_API_KEY;if(!k)return J({error:"THE_ODDS_API_KEY未配置",events:[]},500);
 try{
  const sr=await G(`https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(k)}`);
  const selected=sr.j.filter(x=>x.group==="Soccer"&&!x.has_outrights&&ALLOWED_SPORT_KEYS.has(x.key));
  const events=[],errors=[];let remaining=null,used=null;
  for(const s of selected){
   try{
    const region=s.key==="soccer_australia_aleague"?"au":"eu";
    const q=await G(`https://api.the-odds-api.com/v4/sports/${s.key}/odds/?apiKey=${encodeURIComponent(k)}&regions=${region}&markets=h2h,spreads&oddsFormat=decimal&dateFormat=iso`);
    remaining=q.r.headers.get("x-requests-remaining")||remaining;used=q.r.headers.get("x-requests-used")||used;
    for(const e of q.j)events.push({id:e.id,sportKey:e.sport_key,league:e.sport_title,home:e.home_team,away:e.away_team,commenceTime:e.commence_time,bookmakers:e.bookmakers||[]});
   }catch(e){errors.push({sportKey:s.key,message:e.message})}
  }
  return J({events,queriedSports:selected.map(x=>({key:x.key,title:x.title})),requestsRemaining:remaining,requestsUsed:used,partialErrors:errors,allowedSportKeys:[...ALLOWED_SPORT_KEYS],source:"the-odds-api",updatedAt:new Date().toISOString()});
 }catch(e){return J({error:e.message,events:[]},502)}
}

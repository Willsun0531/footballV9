const UPSTREAM = "https://football-predict.pages.dev/api/daily-jingcai";
const HEADERS = {"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=300, s-maxage=300","access-control-allow-origin":"*"};
function out(data,status=200){return new Response(JSON.stringify(data),{status,headers:HEADERS})}
export async function onRequestOptions(){return new Response(null,{status:204,headers:HEADERS})}
export async function onRequestGet(context){
  const u=new URL(context.request.url); const days=Math.min(7,Math.max(1,Number(u.searchParams.get('days')||4)));
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(`${UPSTREAM}?days=${days}`,{signal:controller.signal,headers:{accept:'application/json','user-agent':'Mozilla/5.0'}});
    const text=await r.text(); let j; try{j=JSON.parse(text)}catch{throw Error(`upstream ${r.status}: ${text.slice(0,180)}`)}
    if(!r.ok||j.success===false)return out({success:false,error:j.error||j.message||`upstream ${r.status}`,matches:[]},502);
    const matches=Array.isArray(j.matches)?j.matches:[];
    return out({...j,success:true,total:matches.length,matches,proxied_at:new Date().toISOString(),upstream:UPSTREAM});
  }catch(e){return out({success:false,error:e.name==='AbortError'?'上游请求超时':e.message,matches:[],upstream:UPSTREAM},502)}
  finally{clearTimeout(timer)}
}

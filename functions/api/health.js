export async function onRequestGet(c){return Response.json({ok:true,footballData:Boolean(c.env.FOOTBALL_DATA_TOKEN),odds:Boolean(c.env.THE_ODDS_API_KEY)})}

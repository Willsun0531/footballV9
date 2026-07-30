const H = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=900"
};
const respond = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: H });

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message || `HTTP ${response.status}`);
  return { data, response };
}

const priorityWords = [
  "europa", "mls", "major league soccer", "norway", "eliteserien",
  "sweden", "allsvenskan", "brazil", "brasileiro", "champions league",
  "eredivisie", "primeira", "premier league", "la liga", "bundesliga",
  "serie a", "ligue 1", "championship"
];

function priorityScore(sport) {
  const text = `${sport.key} ${sport.title} ${sport.description || ""}`.toLowerCase();
  const index = priorityWords.findIndex((word) => text.includes(word));
  return index < 0 ? 999 : index;
}

export async function onRequestGet(context) {
  const key = context.env.THE_ODDS_API_KEY;
  if (!key) return respond({ error: "THE_ODDS_API_KEY未配置", events: [] }, 500);

  try {
    const sportsResult = await fetchJson(
      `https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(key)}`
    );
    const activeSoccer = sportsResult.data
      .filter((x) => x.group === "Soccer" && !x.has_outrights)
      .sort((a, b) => priorityScore(a) - priorityScore(b));

    const priority = activeSoccer.filter((x) => priorityScore(x) < 999);
    const others = activeSoccer.filter((x) => priorityScore(x) === 999);
    const selected = [...priority, ...others].slice(0, 22);

    const events = [];
    const partialErrors = [];
    let requestsRemaining = null;
    let requestsUsed = null;

    for (const sport of selected) {
      try {
        const url =
          `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/` +
          `?apiKey=${encodeURIComponent(key)}` +
          `&regions=eu&markets=h2h,spreads&oddsFormat=decimal&dateFormat=iso`;
        const result = await fetchJson(url);
        requestsRemaining = result.response.headers.get("x-requests-remaining") || requestsRemaining;
        requestsUsed = result.response.headers.get("x-requests-used") || requestsUsed;
        for (const e of result.data) {
          events.push({
            id: e.id,
            sportKey: e.sport_key,
            league: e.sport_title,
            home: e.home_team,
            away: e.away_team,
            commenceTime: e.commence_time,
            bookmakers: e.bookmakers || []
          });
        }
      } catch (error) {
        partialErrors.push({ sportKey: sport.key, message: error.message });
      }
    }

    return respond({
      events,
      activeSoccerCount: activeSoccer.length,
      queriedSports: selected.map((x) => ({ key: x.key, title: x.title })),
      requestsRemaining,
      requestsUsed,
      partialErrors,
      source: "the-odds-api",
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return respond({ error: error.message, events: [] }, 502);
  }
}

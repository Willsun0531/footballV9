const H = {
  "content-type": "application/json;charset=utf-8",
  // 1 hour cache: reduces quota usage without hiding same-day European fixtures for 6 hours
  "cache-control": "public,max-age=3600,s-maxage=3600"
};

const J = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: H });

async function getJson(url) {
  const response = await fetch(url);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Non-JSON response, HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(data?.message || `HTTP ${response.status}`);
  return { data, response };
}

const ALLOWED_SPORT_KEYS = new Set([
  "soccer_epl",
  "soccer_efl_champ",
  "soccer_spain_la_liga",
  "soccer_germany_bundesliga",
  "soccer_italy_serie_a",
  "soccer_france_ligue_one",
  "soccer_uefa_champs_league",
  "soccer_uefa_europa_league",
  "soccer_netherlands_eredivisie",
  "soccer_portugal_primeira_liga",
  "soccer_usa_mls",
  "soccer_brazil_campeonato",
  "soccer_norway_eliteserien",
  "soccer_sweden_allsvenskan",
  "soccer_japan_j_league",
  "soccer_korea_kleague1",
  "soccer_australia_aleague"
]);

function isoNoMillis(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function onRequestGet(context) {
  const apiKey = context.env.THE_ODDS_API_KEY;
  if (!apiKey) return J({ error: "THE_ODDS_API_KEY未配置", events: [] }, 500);

  try {
    // all=true is important during qualifying / preseason windows. It prevents a competition
    // from disappearing only because the sports catalog currently marks it inactive.
    const catalog = await getJson(
      `https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(apiKey)}&all=true`
    );

    const catalogByKey = new Map(catalog.data.map(s => [s.key, s]));
    const selectedKeys = [...ALLOWED_SPORT_KEYS].filter(key => catalogByKey.has(key));
    const missingKeys = [...ALLOWED_SPORT_KEYS].filter(key => !catalogByKey.has(key));

    const from = isoNoMillis(new Date(Date.now() - 2 * 60 * 60 * 1000));
    const to = isoNoMillis(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));

    const events = [];
    const partialErrors = [];
    let requestsRemaining = null;
    let requestsUsed = null;

    for (const sportKey of selectedKeys) {
      try {
        const region = sportKey === "soccer_australia_aleague" ? "au" : "eu";
        const url =
          `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/` +
          `?apiKey=${encodeURIComponent(apiKey)}` +
          `&regions=${region}` +
          `&markets=h2h,spreads` +
          `&oddsFormat=decimal` +
          `&dateFormat=iso` +
          `&commenceTimeFrom=${encodeURIComponent(from)}` +
          `&commenceTimeTo=${encodeURIComponent(to)}`;

        const result = await getJson(url);
        requestsRemaining = result.response.headers.get("x-requests-remaining") || requestsRemaining;
        requestsUsed = result.response.headers.get("x-requests-used") || requestsUsed;

        for (const event of result.data) {
          events.push({
            id: event.id,
            sportKey: event.sport_key,
            league: event.sport_title || catalogByKey.get(sportKey)?.title || sportKey,
            home: event.home_team,
            away: event.away_team,
            commenceTime: event.commence_time,
            bookmakers: event.bookmakers || []
          });
        }
      } catch (error) {
        partialErrors.push({ sportKey, message: error.message });
      }
    }

    events.sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));

    return J({
      events,
      queriedSports: selectedKeys.map(key => ({
        key,
        title: catalogByKey.get(key)?.title || key,
        active: Boolean(catalogByKey.get(key)?.active)
      })),
      missingSportKeys: missingKeys,
      requestsRemaining,
      requestsUsed,
      partialErrors,
      queryWindow: { from, to },
      source: "the-odds-api",
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return J({ error: error.message, events: [] }, 502);
  }
}

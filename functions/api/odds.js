const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=600"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || `The Odds API HTTP ${response.status}`);
  }
  return { data, response };
}

const priority = [
  "soccer_brazil_campeonato",
  "soccer_brazil_serie_b",
  "soccer_epl",
  "soccer_efl_champ",
  "soccer_spain_la_liga",
  "soccer_germany_bundesliga",
  "soccer_italy_serie_a",
  "soccer_france_ligue_one",
  "soccer_uefa_champs_league",
  "soccer_netherlands_eredivisie",
  "soccer_portugal_primeira_liga"
];

export async function onRequestGet(context) {
  const apiKey = context.env.THE_ODDS_API_KEY;
  if (!apiKey) return json({ error: "THE_ODDS_API_KEY未配置", events: [] }, 500);

  try {
    const sportsUrl =
      `https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(apiKey)}`;
    const { data: sports } = await getJson(sportsUrl);

    const activeSoccer = sports.filter(
      (sport) => sport.group === "Soccer" && !sport.has_outrights
    );

    const byKey = new Map(activeSoccer.map((sport) => [sport.key, sport]));
    const selected = [];

    for (const key of priority) {
      if (byKey.has(key)) selected.push(byKey.get(key));
    }

    for (const sport of activeSoccer) {
      if (!selected.some((item) => item.key === sport.key)) selected.push(sport);
      if (selected.length >= 16) break;
    }

    const events = [];
    const errors = [];
    let remaining = null;
    let used = null;

    for (const sport of selected) {
      try {
        const url =
          `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/` +
          `?apiKey=${encodeURIComponent(apiKey)}` +
          `&regions=eu&markets=h2h,spreads&oddsFormat=decimal&dateFormat=iso`;

        const { data, response } = await getJson(url);
        remaining = response.headers.get("x-requests-remaining") || remaining;
        used = response.headers.get("x-requests-used") || used;

        for (const event of data) {
          events.push({
            id: event.id,
            sportKey: event.sport_key,
            league: event.sport_title,
            home: event.home_team,
            away: event.away_team,
            commenceTime: event.commence_time,
            bookmakers: event.bookmakers || []
          });
        }
      } catch (error) {
        errors.push({ sportKey: sport.key, message: error.message });
      }
    }

    return json({
      events,
      queriedSports: selected.map((sport) => sport.key),
      source: "the-odds-api",
      requestsRemaining: remaining,
      requestsUsed: used,
      partialErrors: errors,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return json({ error: error.message, events: [] }, 502);
  }
}

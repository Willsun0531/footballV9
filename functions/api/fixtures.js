const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=1800, s-maxage=1800"
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: RESPONSE_HEADERS
  });
}

function hongKongDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function isFinished(shortStatus) {
  return ["FT", "AET", "PEN"].includes(shortStatus);
}

function normalizeFixture(item) {
  const fixture = item.fixture || {};
  const league = item.league || {};
  const teams = item.teams || {};
  const goals = item.goals || {};

  return {
    id: `apisports-${fixture.id}`,
    externalId: fixture.id,
    utcDate: fixture.date,
    status: isFinished(fixture.status?.short)
      ? "FINISHED"
      : "SCHEDULED",

    competition: {
      code: `APISPORTS-${league.id}`,
      name: league.name || "",
      area: league.country || "",
      sourceLeagueId: league.id,
      round: league.round || ""
    },

    home: {
      id: teams.home?.id,
      name: teams.home?.name || ""
    },

    away: {
      id: teams.away?.id,
      name: teams.away?.name || ""
    },

    score: {
      home: Number.isFinite(goals.home) ? goals.home : null,
      away: Number.isFinite(goals.away) ? goals.away : null
    },

    venue: {
      name: fixture.venue?.name || "",
      city: fixture.venue?.city || ""
    },

    source: "api-sports"
  };
}

function allowedCompetition(item) {
  const league = String(item.league?.name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const country = String(item.league?.country || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  // International competitions
  if (
    league.includes("uefa champions league") ||
    league.includes("champions league") ||
    league.includes("uefa europa league") ||
    league.includes("europa league")
  ) {
    return true;
  }

  // Exact country + competition rules avoid Russian Premier League,
  // Austrian Bundesliga, Serie B, Ligue 2 and Segunda Division.
  const rules = [
    ["england", ["premier league", "championship"]],
    ["spain", ["la liga"]],
    ["germany", ["bundesliga"]],
    ["italy", ["serie a"]],
    ["france", ["ligue 1"]],
    ["netherlands", ["eredivisie"]],
    ["portugal", ["primeira liga"]],
    ["usa", ["major league soccer"]],
    ["united states", ["major league soccer"]],
    ["brazil", ["serie a"]],
    ["norway", ["eliteserien"]],
    ["sweden", ["allsvenskan"]],
    ["japan", ["j1 league", "j-league"]],
    ["south-korea", ["k league 1"]],
    ["south korea", ["k league 1"]],
    ["australia", ["a-league"]]
  ];

  return rules.some(([wantedCountry, names]) =>
    country.includes(wantedCountry) &&
    names.some(name => league.includes(name))
  );
}

async function fetchDate(apiKey, date) {
  // API-Sports rejects from/to without league + season.
  // The date endpoint works for a daily cross-league fixture list.
  const url =
    "https://v3.football.api-sports.io/fixtures" +
    `?date=${encodeURIComponent(date)}` +
    "&timezone=Asia%2FHong_Kong";

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-apisports-key": apiKey
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message || `API-Sports HTTP ${response.status}`
    );
  }

  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(JSON.stringify(data.errors));
  }

  return {
    fixtures: Array.isArray(data.response) ? data.response : [],
    remaining: response.headers.get("x-ratelimit-requests-remaining")
  };
}

export async function onRequestGet(context) {
  const apiKey = context.env.API_SPORTS_KEY;

  if (!apiKey) {
    return jsonResponse(
      { error: "API_SPORTS_KEY未配置", fixtures: [] },
      500
    );
  }

  try {
    const requestUrl = new URL(context.request.url);
    const requestedDays = Number(
      requestUrl.searchParams.get("days") || 7
    );

    // Each date uses one API-Sports request. Cap at 14 to protect quota.
    const days = Math.min(14, Math.max(1, requestedDays));
    const now = new Date();
    const dates = Array.from({ length: days }, (_, index) =>
      hongKongDateKey(addDays(now, index))
    );

    const fixtures = [];
    const errors = [];
    let rawTotal = 0;
    let requestsRemaining = null;

    // Sequential calls are gentler on the per-minute rate limit.
    for (const date of dates) {
      try {
        const result = await fetchDate(apiKey, date);
        rawTotal += result.fixtures.length;
        requestsRemaining = result.remaining || requestsRemaining;
        fixtures.push(
          ...result.fixtures
            .filter(allowedCompetition)
            .map(normalizeFixture)
        );
      } catch (error) {
        errors.push({ date, message: error.message });
      }
    }

    // Deduplicate by API-Sports fixture id.
    const unique = Array.from(
      new Map(fixtures.map(item => [item.id, item])).values()
    ).sort(
      (a, b) => new Date(a.utcDate) - new Date(b.utcDate)
    );

    return jsonResponse({
      fixtures: unique,
      total: unique.length,
      rawTotal,
      dates,
      requestsUsedByThisCall: dates.length,
      requestsRemaining,
      partialErrors: errors,
      source: "api-sports",
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error.message || "API-Sports fixtures request failed",
        fixtures: []
      },
      502
    );
  }
}

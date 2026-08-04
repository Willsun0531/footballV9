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

function dateKey(date) {
  return date.toISOString().slice(0, 10);
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

    status:
      fixture.status?.short === "FT"
        ? "FINISHED"
        : fixture.status?.short === "AET"
        ? "FINISHED"
        : fixture.status?.short === "PEN"
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
      home:
        Number.isFinite(goals.home)
          ? goals.home
          : null,

      away:
        Number.isFinite(goals.away)
          ? goals.away
          : null
    },

    venue: {
      name: fixture.venue?.name || "",
      city: fixture.venue?.city || ""
    },

    source: "api-sports"
  };
}

function allowedCompetition(item) {
  const leagueName = String(
    item.league?.name || ""
  ).toLowerCase();

  const country = String(
    item.league?.country || ""
  ).toLowerCase();

  const allowedNames = [
    "uefa champions league",
    "champions league",
    "uefa europa league",
    "europa league",

    "premier league",
    "championship",
    "la liga",
    "bundesliga",
    "serie a",
    "ligue 1",

    "eredivisie",
    "primeira liga",

    "major league soccer",
    "mls",

    "serie a",
    "eliteserien",
    "allsvenskan",

    "j1 league",
    "j-league",
    "k league 1",
    "a-league"
  ];

  const blockedCombinations = [
    ["russia", "premier league"],
    ["austria", "bundesliga"],
    ["brazil", "serie b"],
    ["france", "ligue 2"],
    ["spain", "segunda"]
  ];

  const isBlocked = blockedCombinations.some(
    ([blockedCountry, blockedLeague]) => {
      return (
        country.includes(blockedCountry) &&
        leagueName.includes(blockedLeague)
      );
    }
  );

  if (isBlocked) {
    return false;
  }

  return allowedNames.some(name => {
    return leagueName.includes(name);
  });
}

async function apiSportsRequest(apiKey, url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-apisports-key": apiKey
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message ||
      `API-Sports HTTP ${response.status}`
    );
  }

  if (
    data.errors &&
    Object.keys(data.errors).length > 0
  ) {
    throw new Error(
      JSON.stringify(data.errors)
    );
  }

  return {
    data,
    remaining:
      response.headers.get(
        "x-ratelimit-requests-remaining"
      )
  };
}

export async function onRequestGet(context) {
  const apiKey = context.env.API_SPORTS_KEY;

  if (!apiKey) {
    return jsonResponse(
      {
        error: "API_SPORTS_KEY未配置",
        fixtures: []
      },
      500
    );
  }

  try {
    const requestUrl = new URL(
      context.request.url
    );

    const rawDays = Number(
      requestUrl.searchParams.get("days") || 7
    );

    const days = Math.min(
      14,
      Math.max(1, rawDays)
    );

    const now = new Date();

    const future = new Date(
      now.getTime() +
      days * 24 * 60 * 60 * 1000
    );

    const from = dateKey(now);
    const to = dateKey(future);

    const url =
      "https://v3.football.api-sports.io/fixtures" +
      `?from=${encodeURIComponent(from)}` +
      `&to=${encodeURIComponent(to)}` +
      "&timezone=Asia%2FHong_Kong";

    const result = await apiSportsRequest(
      apiKey,
      url
    );

    const rawFixtures =
      result.data.response || [];

    const fixtures = rawFixtures
      .filter(allowedCompetition)
      .map(normalizeFixture)
      .filter(item => {
        return (
          item.home.name &&
          item.away.name &&
          item.utcDate
        );
      })
      .sort((a, b) => {
        return (
          new Date(a.utcDate) -
          new Date(b.utcDate)
        );
      });

    return jsonResponse({
      fixtures,
      total: fixtures.length,
      rawTotal: rawFixtures.length,
      from,
      to,
      requestsRemaining: result.remaining,
      source: "api-sports",
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    return jsonResponse(
      {
        error:
          error.message ||
          "API-Sports fixtures request failed",
        fixtures: []
      },
      502
    );
  }
}

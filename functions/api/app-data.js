const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=900"
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function mapMatch(match) {
  return {
    id: match.id,
    utcDate: match.utcDate,
    status: match.status,

    competition: {
      code:
        match.competition?.code ||
        "",

      name:
        match.competition?.name ||
        "",

      area:
        match.area?.name ||
        match.competition?.area?.name ||
        ""
    },

    home: {
      id:
        match.homeTeam?.id ||
        null,

      name:
        match.homeTeam?.shortName ||
        match.homeTeam?.name ||
        ""
    },

    away: {
      id:
        match.awayTeam?.id ||
        null,

      name:
        match.awayTeam?.shortName ||
        match.awayTeam?.name ||
        ""
    },

    score: {
      home:
        match.score?.fullTime?.home ??
        null,

      away:
        match.score?.fullTime?.away ??
        null
    }
  };
}

async function callFootballData(token, path) {
  const url =
    "https://api.football-data.org/v4" +
    path;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Auth-Token": token,
      "Accept": "application/json"
    }
  });

  let data;

  try {
    data = await response.json();
  } catch (error) {
    throw new Error(
      "football-data.org returned a non-JSON response."
    );
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      `football-data.org HTTP ${response.status}`
    );
  }

  return data;
}

export async function onRequestGet(context) {
  const token =
    context.env.FOOTBALL_DATA_TOKEN;

  if (!token) {
    return jsonResponse(
      {
        error:
          "FOOTBALL_DATA_TOKEN is not configured in the Pages project."
      },
      500
    );
  }

  try {
    const now = new Date();

    const future = new Date(
      now.getTime() +
      7 * 24 * 60 * 60 * 1000
    );

    const past = new Date(
      now.getTime() -
      9 * 24 * 60 * 60 * 1000
    );

    const upcomingPath =
  "/matches" +
  `?dateFrom=${formatDate(now)}` +
  `&dateTo=${formatDate(future)}`;

const finishedPath =
  "/matches" +
  `?dateFrom=${formatDate(past)}` +
  `&dateTo=${formatDate(now)}` +
  "&status=FINISHED";

    const results = await Promise.all([
      callFootballData(
        token,
        upcomingPath
      ),

      callFootballData(
        token,
        finishedPath
      )
    ]);

    const upcomingResult = results[0];
    const finishedResult = results[1];

    const upcoming = (
      upcomingResult.matches || []
    )
      .filter((match) => {
        return (
          match.status !== "FINISHED" &&
          match.status !== "CANCELLED"
        );
      })
      .map(mapMatch);

    const finished = (
      finishedResult.matches || []
    ).map(mapMatch);

    return jsonResponse({
      upcoming,
      finished,
      source: "football-data.org",
      competitionFilter:
  "all-accessible-competitions",
      updatedAt:
        new Date().toISOString()
    });

  } catch (error) {
    return jsonResponse(
      {
        error:
          error.message ||
          "Unknown football data error.",

        source:
          "football-data.org",

        updatedAt:
          new Date().toISOString()
      },
      502
    );
  }
}

const jsonResponse = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=900"
    }
  });
};

const formatDate = (date) => {
  return date.toISOString().slice(0, 10);
};

const mapMatch = (match) => {
  return {
    id: match.id,
    utcDate: match.utcDate,
    status: match.status,

    competition: {
      code: match.competition?.code || "",
      name: match.competition?.name || "",
      area:
        match.area?.name ||
        match.competition?.area?.name ||
        ""
    },

    home: {
      id: match.homeTeam?.id,
      name:
        match.homeTeam?.shortName ||
        match.homeTeam?.name ||
        ""
    },

    away: {
      id: match.awayTeam?.id,
      name:
        match.awayTeam?.shortName ||
        match.awayTeam?.name ||
        ""
    },

    score: {
      home: match.score?.fullTime?.home,
      away: match.score?.fullTime?.away
    }
  };
};

async function callFootballData(token, path) {
  const response = await fetch(
    "https://api.football-data.org/v4" + path,
    {
      method: "GET",
      headers: {
        "X-Auth-Token": token,
        "Accept": "application/json"
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message ||
      `football-data.org HTTP ${response.status}`
    );
  }

  return data;
}

export async function onRequestGet(context) {
  const token = context.env.FOOTBALL_DATA_TOKEN;

  if (!token) {
    return jsonResponse(
      {
        error:
          "FOOTBALL_DATA_TOKEN has not been configured."
      },
      500
    );
  }

  try {
    const now = new Date();

    const future = new Date(
      now.getTime() + 7 * 24 * 60 * 60 * 1000
    );

    const past = new Date(
      now.getTime() - 120 * 24 * 60 * 60 * 1000
    );

    const competitions =
      context.env.COMPETITIONS ||
      "PL,PD,BL1,SA,FL1,CL,PPL,DED";

    const upcomingPath =
      `/matches?competitions=${competitions}` +
      `&dateFrom=${formatDate(now)}` +
      `&dateTo=${formatDate(future)}`;

    const finishedPath =
      `/matches?competitions=${competitions}` +
      `&dateFrom=${formatDate(past)}` +
      `&dateTo=${formatDate(now)}` +
      `&status=FINISHED`;

    const [upcomingResult, finishedResult] =
      await Promise.all([
        callFootballData(token, upcomingPath),
        callFootballData(token, finishedPath)
      ]);

    const upcoming = (
      upcomingResult.matches || []
    )
      .filter((match) => {
        return match.status !== "FINISHED";
      })
      .map(mapMatch);

    const finished = (
      finishedResult.matches || []
    ).map(mapMatch);

    return jsonResponse({
      upcoming,
      finished,
      source: "football-data.org",
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    return jsonResponse(
      {
        error: error.message,
        source: "football-data.org"
      },
      502
    );
  }
}
`

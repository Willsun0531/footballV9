const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=21600, s-maxage=21600"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

function pct(value) {
  if (value == null) return null;
  const number = Number(String(value).replace("%", ""));
  return Number.isFinite(number) ? number / 100 : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalize(item) {
  const prediction = item?.predictions || {};
  const percent = prediction?.percent || {};
  const goals = prediction?.goals || {};
  const comparison = item?.comparison || {};

  return {
    fixtureId: item?.fixture?.id || null,
    probabilities: {
      home: pct(percent.home),
      draw: pct(percent.draw),
      away: pct(percent.away)
    },
    expectedGoals: {
      home: numberOrNull(goals.home),
      away: numberOrNull(goals.away)
    },
    advice: prediction?.advice || "",
    overUnder: prediction?.under_over || "",
    winner: prediction?.winner?.name || "",
    winnerComment: prediction?.winner?.comment || "",
    comparison: {
      formHome: pct(comparison?.form?.home),
      formAway: pct(comparison?.form?.away),
      attackHome: pct(comparison?.att?.home),
      attackAway: pct(comparison?.att?.away),
      defenceHome: pct(comparison?.def?.home),
      defenceAway: pct(comparison?.def?.away),
      poissonHome: pct(comparison?.poisson_distribution?.home),
      poissonAway: pct(comparison?.poisson_distribution?.away),
      h2hHome: pct(comparison?.h2h?.home),
      h2hAway: pct(comparison?.h2h?.away),
      goalsHome: pct(comparison?.goals?.home),
      goalsAway: pct(comparison?.goals?.away),
      totalHome: pct(comparison?.total?.home),
      totalAway: pct(comparison?.total?.away)
    },
    source: "api-sports-predictions"
  };
}

async function requestPrediction(apiKey, fixtureId) {
  const response = await fetch(
    `https://v3.football.api-sports.io/predictions?fixture=${encodeURIComponent(fixtureId)}`,
    { headers: { "x-apisports-key": apiKey } }
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || `HTTP ${response.status}`);
  if (body?.errors && Object.keys(body.errors).length) {
    throw new Error(JSON.stringify(body.errors));
  }
  return {
    prediction: body?.response?.[0] ? normalize(body.response[0]) : null,
    remaining: response.headers.get("x-ratelimit-requests-remaining")
  };
}

export async function onRequestGet(context) {
  const apiKey = context.env.API_SPORTS_KEY;
  if (!apiKey) return json({ error: "API_SPORTS_KEY未配置", predictions: {} }, 500);

  const url = new URL(context.request.url);
  const ids = String(url.searchParams.get("ids") || "")
    .split(",")
    .map(x => x.trim().replace(/^apisports-/, ""))
    .filter(x => /^\d+$/.test(x))
    .slice(0, 12);

  if (!ids.length) return json({ predictions: {}, requested: 0, source: "api-sports" });

  const predictions = {};
  const partialErrors = [];
  let requestsRemaining = null;

  for (const id of ids) {
    try {
      const result = await requestPrediction(apiKey, id);
      if (result.prediction) predictions[`apisports-${id}`] = result.prediction;
      requestsRemaining = result.remaining || requestsRemaining;
    } catch (error) {
      partialErrors.push({ fixtureId: id, message: error.message });
    }
  }

  return json({
    predictions,
    requested: ids.length,
    returned: Object.keys(predictions).length,
    requestsRemaining,
    partialErrors,
    source: "api-sports",
    updatedAt: new Date().toISOString()
  });
}

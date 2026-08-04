const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=21600, s-maxage=21600"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: HEADERS });

const pct = value => {
  if (value == null) return null;
  const n = Number(String(value).replace("%", ""));
  return Number.isFinite(n) ? n / 100 : null;
};

const validGX = value => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0.05 && n <= 6 ? n : null;
};

async function apiGet(key, path) {
  const response = await fetch(
    `https://v3.football.api-sports.io${path}`,
    { headers: { "x-apisports-key": key } }
  );
  const text = await response.text(); let body; try { body = JSON.parse(text); } catch { throw new Error(`Upstream non-JSON HTTP ${response.status}: ${text.slice(0,120)}`); }
  if (!response.ok) throw new Error(body?.message || `HTTP ${response.status}`);
  if (body?.errors && Object.keys(body.errors).length) {
    throw new Error(JSON.stringify(body.errors));
  }
  return {
    body,
    remaining: response.headers.get("x-ratelimit-requests-remaining")
  };
}

function normalizePrediction(item) {
  const prediction = item?.predictions || {};
  const percent = prediction?.percent || {};
  const goals = prediction?.goals || {};
  const comparison = item?.comparison || {};

  return {
    probabilities: {
      home: pct(percent.home),
      draw: pct(percent.draw),
      away: pct(percent.away)
    },
    expectedGoals: {
      home: validGX(goals.home),
      away: validGX(goals.away)
    },
    rawGoals: {
      home: goals.home ?? null,
      away: goals.away ?? null
    },
    advice: prediction?.advice || "",
    overUnder: prediction?.under_over || "",
    winner: prediction?.winner?.name || "",
    comparison: {
      formHome: pct(comparison?.form?.home),
      formAway: pct(comparison?.form?.away),
      attackHome: pct(comparison?.att?.home),
      attackAway: pct(comparison?.att?.away),
      defenceHome: pct(comparison?.def?.home),
      defenceAway: pct(comparison?.def?.away),
      poissonHome: pct(comparison?.poisson_distribution?.home),
      poissonAway: pct(comparison?.poisson_distribution?.away),
      totalHome: pct(comparison?.total?.home),
      totalAway: pct(comparison?.total?.away)
    },
    source: "api-sports-predictions"
  };
}

function normalizeOdds(rows) {
  const h2hRows = [[], [], []];
  const handicaps = [];

  for (const row of rows || []) {
    for (const bookmaker of row.bookmakers || []) {
      for (const bet of bookmaker.bets || []) {
        const betName = String(bet.name || "").toLowerCase();

        if (
          betName.includes("match winner") ||
          betName === "1x2" ||
          betName.includes("home/draw/away")
        ) {
          for (const value of bet.values || []) {
            const key = String(value.value || "").toLowerCase();
            const odd = Number(value.odd);
            if (!Number.isFinite(odd)) continue;
            if (key === "home") h2hRows[0].push({ odd, book: bookmaker.name });
            if (key === "draw") h2hRows[1].push({ odd, book: bookmaker.name });
            if (key === "away") h2hRows[2].push({ odd, book: bookmaker.name });
          }
        }

        if (
          betName.includes("asian handicap") ||
          betName.includes("handicap result")
        ) {
          for (const value of bet.values || []) {
            const odd = Number(value.odd);
            if (!Number.isFinite(odd)) continue;
            handicaps.push({
              label: String(value.value || ""),
              handicap: value.handicap ?? null,
              odd,
              book: bookmaker.name
            });
          }
        }
      }
    }
  }

  let h2h = null;
  if (h2hRows.every(rows => rows.length)) {
    const avg = h2hRows.map(rows =>
      rows.reduce((sum, value) => sum + value.odd, 0) / rows.length
    );
    const implied = avg.map(value => 1 / value);
    const total = implied.reduce((a, b) => a + b, 0);
    h2h = {
      avg,
      probabilities: implied.map(value => value / total),
      books: Math.max(...h2hRows.map(rows => rows.length))
    };
  }

  return {
    h2h,
    handicaps: handicaps.slice(0, 12),
    source: "api-sports-odds"
  };
}

export async function onRequestGet(context) {
  const key = context.env.API_SPORTS_KEY;
  if (!key) {
    return json({ error: "API_SPORTS_KEY未配置", predictions: {} }, 500);
  }

  const url = new URL(context.request.url);
  const ids = String(url.searchParams.get("ids") || "")
    .split(",")
    .map(value => value.trim().replace(/^apisports-/, ""))
    .filter(value => /^\d+$/.test(value))
    .slice(0, 10);

  const predictions = {};
  const partialErrors = [];
  let requestsRemaining = null;

  for (const id of ids) {
    const predictionResult = await Promise.allSettled([
      apiGet(key, `/predictions?fixture=${id}`),
      apiGet(key, `/odds?fixture=${id}`)
    ]);

    const predictionCall = predictionResult[0];
    const oddsCall = predictionResult[1];

    let normalizedPrediction = null;
    let normalizedOdds = { h2h: null, handicaps: [], source: "api-sports-odds" };

    if (predictionCall.status === "fulfilled") {
      const item = predictionCall.value.body?.response?.[0];
      if (item) normalizedPrediction = normalizePrediction(item);
      requestsRemaining = predictionCall.value.remaining || requestsRemaining;
    } else {
      partialErrors.push({
        fixtureId: id,
        endpoint: "predictions",
        message: predictionCall.reason?.message || String(predictionCall.reason)
      });
    }

    if (oddsCall.status === "fulfilled") {
      normalizedOdds = normalizeOdds(oddsCall.value.body?.response || []);
      requestsRemaining = oddsCall.value.remaining || requestsRemaining;
    } else {
      partialErrors.push({
        fixtureId: id,
        endpoint: "odds",
        message: oddsCall.reason?.message || String(oddsCall.reason)
      });
    }

    // Crucial fix: keep valid predictions even when the odds endpoint fails.
    if (normalizedPrediction || normalizedOdds.h2h || normalizedOdds.handicaps.length) {
      predictions[`apisports-${id}`] = {
        ...(normalizedPrediction || {
          probabilities: null,
          expectedGoals: { home: null, away: null },
          source: "api-sports"
        }),
        odds: normalizedOdds
      };
    }
  }

  return json({
    predictions,
    requested: ids.length,
    returned: Object.keys(predictions).length,
    requestsRemaining,
    partialErrors,
    source: "api-sports",
    version: "V15.1 Resilient Data",
    updatedAt: new Date().toISOString()
  });
}

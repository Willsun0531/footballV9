const UPSTREAM = "https://football-predict.pages.dev/api/daily-jingcai";
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=300, s-maxage=300",
  "access-control-allow-origin": "*"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

function n(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getProbabilities(match) {
  const values = [
    n(match.homeWinProb ?? match.spf?.homeWinProb),
    n(match.drawProb ?? match.spf?.drawProb),
    n(match.awayWinProb ?? match.spf?.awayWinProb)
  ];
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? values.map(value => value / total * 100) : [0, 0, 0];
}

function getSampleCount(match) {
  const candidates = [
    match.sampleCount,
    match.historySample,
    match.history_samples,
    match.dataQuality?.sampleCount,
    match.dataQuality?.historySample,
    match.dataQuality?.samples,
    match.home_matches_count && match.away_matches_count
      ? n(match.home_matches_count) + n(match.away_matches_count)
      : null
  ];
  for (const value of candidates) {
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function recalibrateGrade(match) {
  const probabilities = getProbabilities(match);
  const ordered = [...probabilities].sort((a, b) => b - a);
  const lead = ordered[0] - ordered[1];
  const officialSp = [match.sp_win, match.sp_draw, match.sp_lose]
    .every(value => n(value) > 1);
  const sampleCount = getSampleCount(match);
  const reliability = n(match.dataQuality?.reliability ?? match.reliability);
  const originalConfidence = n(match.confidence);
  const hasPersonalizedModel = probabilities.some(value => value > 0) &&
    !(Math.abs(probabilities[0] - 39.9) < 0.3 &&
      Math.abs(probabilities[1] - 28.8) < 0.3 &&
      Math.abs(probabilities[2] - 31.3) < 0.3);

  const quality = Math.min(100,
    sampleCount * 4 +
    (officialSp ? 25 : 0) +
    (hasPersonalizedModel ? 15 : 0)
  );

  let tier = "C";
  let reason = "数据条件未达到B级门槛";

  if (
    officialSp &&
    hasPersonalizedModel &&
    sampleCount >= 6 &&
    reliability >= 45 &&
    quality >= 55 &&
    lead >= 10 &&
    originalConfidence >= 70
  ) {
    tier = "A";
    reason = "历史样本、官方SP、模型方向和可靠性均达到A级门槛";
  } else if (
    officialSp &&
    hasPersonalizedModel &&
    sampleCount >= 3 &&
    reliability >= 30 &&
    quality >= 35 &&
    lead >= 6 &&
    originalConfidence >= 55
  ) {
    tier = "B";
    reason = "具备官方SP和个性化方向，但样本或可靠性尚未达到A级";
  } else if (!officialSp) {
    reason = "缺少完整体彩胜平负SP";
  } else if (!hasPersonalizedModel) {
    reason = "仍在使用通用基础分布，不能进入A/B级";
  } else if (sampleCount < 3) {
    reason = `历史样本不足（${sampleCount}场）`;
  } else if (lead < 6) {
    reason = `首选领先差不足（${lead.toFixed(1)}pp）`;
  } else if (reliability < 30) {
    reason = `数据可靠性不足（${reliability.toFixed(0)}%）`;
  }

  return {
    ...match,
    spf: { ...(match.spf || {}), tier },
    calibratedTier: tier,
    grading: {
      version: "V16-P8.1",
      tier,
      reason,
      officialSp,
      personalizedModel: hasPersonalizedModel,
      sampleCount,
      reliability,
      quality: Math.round(quality),
      lead: Number(lead.toFixed(1)),
      originalConfidence
    }
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const query = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (key !== "x") query.set(key, value);
  }
  if (!query.has("days")) query.set("days", "4");

  try {
    const response = await fetch(`${UPSTREAM}?${query}`, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }
    });
    const text = await response.text();
    const payload = JSON.parse(text);
    if (!response.ok || payload.success === false) {
      return json({ success: false, error: payload.error || `upstream ${response.status}`, matches: [] }, 502);
    }
    const rawMatches = Array.isArray(payload.matches) ? payload.matches : [];
    const matches = rawMatches.map(recalibrateGrade);
    const counts = matches.reduce((acc, match) => {
      const tier = match.calibratedTier || "C";
      acc[tier] += 1;
      return acc;
    }, { A: 0, B: 0, C: 0 });

    return json({
      ...payload,
      success: true,
      matches,
      total: matches.length,
      gradeCounts: counts,
      gradingVersion: "V16-P8.1 strict grading",
      gradingNotice: "上游旧tier已被覆盖，A/B/C由样本、官方SP、个性化模型、可靠性和方向领先差重新计算。"
    });
  } catch (error) {
    return json({ success: false, error: error.message, matches: [] }, 502);
  }
}

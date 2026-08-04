/* V14.8 overlay: load after the main V14.7 script. */
(() => {
  const nativeFetch = window.fetch.bind(window);
  const originalPredict = window.predict;

  window.fetch = async function(input, init) {
    const response = await nativeFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (!url.includes("/api/fixtures") || !response.ok) return response;

    try {
      const payload = await response.clone().json();
      const fixtures = Array.isArray(payload.fixtures)
        ? payload.fixtures
        : [...(payload.upcoming || []), ...(payload.finished || [])];
      const ids = fixtures
        .map(x => String(x.id || ""))
        .filter(x => x.startsWith("apisports-"))
        .slice(0, 12);
      if (!ids.length) return response;

      const predictionResponse = await nativeFetch(
        `/api/predictions?ids=${encodeURIComponent(ids.join(","))}`
      );
      if (!predictionResponse.ok) return response;
      const predictionPayload = await predictionResponse.json();
      const map = predictionPayload.predictions || {};
      for (const fixture of fixtures) {
        if (map[fixture.id]) fixture.apiPrediction = map[fixture.id];
      }
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (error) {
      console.warn("V14.8 prediction enrichment skipped:", error);
      return response;
    }
  };

  if (typeof originalPredict === "function") {
    window.predict = function(g, F) {
      const result = originalPredict(g, F);
      const api = g?.apiPrediction;
      const p = api?.probabilities;
      if (!result?.insufficient || !p) return result;
      const values = [p.home, p.draw, p.away];
      if (!values.every(Number.isFinite)) return result;

      const total = values.reduce((a, b) => a + b, 0);
      if (!(total > 0)) return result;
      result.p = values.map(x => x / total);
      result.blend = result.p.slice();
      const order = [0, 1, 2].sort((a, b) => result.blend[b] - result.blend[a]);
      result.primary = ["主胜", "平局", "客胜"][order[0]];

      if (Number.isFinite(api.expectedGoals?.home)) result.x = api.expectedGoals.home;
      if (Number.isFinite(api.expectedGoals?.away)) result.y = api.expectedGoals.away;

      if (typeof window.mat === "function" && Number.isFinite(result.x) && Number.isFinite(result.y)) {
        const matrix = window.mat(result.x, result.y);
        result.tops = [...matrix].sort((a, b) => b[0] - a[0]).slice(0, 5);
        const totals = Array(15).fill(0);
        let btts = 0;
        matrix.forEach(([q, h, a]) => {
          totals[h + a] += q;
          if (h && a) btts += q;
        });
        const under = totals.slice(0, 3).reduce((a, b) => a + b, 0);
        result.ou = under >= 0.5 ? "小2.5" : "大2.5";
        result.btts = btts >= 0.5 ? "是" : "否";
      }

      result.reason = "API-Sports个性化基础预测，缺少本地历史或市场验证";
      result.apiPrediction = api;
      result.insufficient = true;
      result.score = null;
      result.risk = null;
      result.status = "C";
      return result;
    };
  }
})();

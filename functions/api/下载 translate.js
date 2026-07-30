const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

export async function onRequestPost(context) {
  const apiKey = context.env.AZURE_TRANSLATOR_KEY;
  const region = context.env.AZURE_TRANSLATOR_REGION || "eastasia";
  const endpoint =
    context.env.AZURE_TRANSLATOR_ENDPOINT ||
    "https://api.cognitive.microsofttranslator.com";

  if (!apiKey) {
    return jsonResponse({
      error: "AZURE_TRANSLATOR_KEY is not configured.",
      translations: {}
    }, 500);
  }

  try {
    const requestBody = await context.request.json();
    const texts = [
      ...new Set(
        (requestBody.texts || [])
          .map((text) => String(text || "").trim())
          .filter(Boolean)
      )
    ].slice(0, 100);

    if (!texts.length) {
      return jsonResponse({ translations: {} });
    }

    const url =
      endpoint.replace(/\/$/, "") +
      "/translate?api-version=3.0&from=en&to=zh-Hans";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Ocp-Apim-Subscription-Region": region,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        texts.map((Text) => ({ Text }))
      )
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
        `Azure Translator HTTP ${response.status}`
      );
    }

    const translations = {};

    texts.forEach((text, index) => {
      translations[text] =
        data[index]?.translations?.[0]?.text || text;
    });

    return jsonResponse({ translations });
  } catch (error) {
    return jsonResponse({
      error: error.message || "Translation request failed.",
      translations: {}
    }, 502);
  }
}

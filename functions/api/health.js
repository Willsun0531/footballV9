export async function onRequestGet(context) {
  return new Response(
    JSON.stringify({
      ok: true,
      tokenConfigured: Boolean(
        context.env.FOOTBALL_DATA_TOKEN
      )
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

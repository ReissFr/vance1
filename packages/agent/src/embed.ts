const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

export function makeVoyageEmbed(apiKey: string, model = "voyage-3"): (text: string) => Promise<number[]> {
  return async (text: string) => {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ input: [text], model }),
    });
    if (!res.ok) throw new Error(`Voyage embed failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    const first = json.data[0];
    if (!first) throw new Error("Voyage returned no embeddings");
    return first.embedding;
  };
}

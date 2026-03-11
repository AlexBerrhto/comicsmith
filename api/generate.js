const NSFW_WORDS = /\b(blood|gore|naked|nude|nudity|sexual|explicit|violent|violence|kill|killing|dead|death|corpse|weapon|guns|knife|knives|sword|swords|fight|fighting|attack|attacking|wound|wounded|scar|torture|murder|rape|decapitat|dismember)\b/gi;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { prompt, width = 512, height = 512 } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) return res.status(500).json({ error: "Cloudflare credentials not configured" });

  // Sanitize prompt to avoid Cloudflare NSFW filter
  const cleanPrompt = prompt.replace(NSFW_WORDS, "").replace(/\s+/g, " ").trim();
  const safePrompt = `${cleanPrompt}, comic book illustration, 2D art, family friendly`.slice(0, 2048);

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: safePrompt, num_steps: 4, width, height }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Cloudflare error:", response.status, errText);
      return res.status(200).json({ error: `CF ${response.status}: ${errText}` });
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await response.json();
      const base64 = json.result?.image || json.image;
      if (!base64) return res.status(200).json({ error: "No image in response" });
      return res.status(200).json({ image: `data:image/png;base64,${base64}` });
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return res.status(200).json({ image: `data:image/png;base64,${base64}` });

  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
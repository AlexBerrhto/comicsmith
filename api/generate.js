export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { prompt, width = 512, height = 512 } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) return res.status(500).json({ error: "Cloudflare credentials not configured" });

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          num_steps: 4,
          width,
          height,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("CF error:", errText);
      return res.status(200).json({ error: errText, cf_status: response.status });
    }

    const contentType = response.headers.get("content-type") || "";
    
    // Cloudflare returns JSON with base64 image
    if (contentType.includes("application/json")) {
      const json = await response.json();
      // CF returns { result: { image: "base64string" } }
      const base64 = json.result?.image || json.image;
      if (!base64) return res.status(200).json({ error: "No image in response", raw: JSON.stringify(json) });
      return res.status(200).json({ image: `data:image/png;base64,${base64}` });
    }

    // Fallback: raw binary
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return res.status(200).json({ image: `data:image/png;base64,${base64}` });

  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { prompt, width = 512, height = 512, referenceImage = null, strength = 0.65 } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) return res.status(500).json({ error: "Cloudflare credentials not configured" });

  const imageData = referenceImage
    ? referenceImage.replace(/^data:image\/\w+;base64,/, "")
    : null;

  const model = imageData
    ? "@cf/runwayml/stable-diffusion-v1-5-img2img"
    : "@cf/black-forest-labs/flux-1-schnell";

  const body = imageData
    ? { prompt, image: imageData, strength, num_steps: 20, width, height }
    : { prompt, num_steps: 4, width, height };

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
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

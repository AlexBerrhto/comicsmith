export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { prompt, width = 512, height = 512, referenceImage = null } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) return res.status(500).json({ error: "Cloudflare credentials not configured" });

  const headers = { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" };

  try {
    let response;

    if (referenceImage) {
      // img2img — use portrait as reference
      const base64Data = referenceImage.replace(/^data:image\/\w+;base64,/, "");
      const imageArray = Array.from(Buffer.from(base64Data, "base64"));
      response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/runwayml/stable-diffusion-v1-5-img2img`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ prompt, image: imageArray, strength: 0.65, num_steps: 20, width, height }),
        }
      );
    } else {
      // text2img — FLUX
      response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ prompt, num_steps: 4, width, height }),
        }
      );
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("CF error:", response.status, errText);
      // Fallback to text2img if img2img fails
      if (referenceImage) {
        const fallback = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
          { method: "POST", headers, body: JSON.stringify({ prompt, num_steps: 4, width, height }) }
        );
        const arr = await fallback.arrayBuffer();
        const b64 = Buffer.from(arr).toString("base64");
        return res.status(200).json({ image: `data:image/png;base64,${b64}` });
      }
      return res.status(200).json({ error: errText });
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
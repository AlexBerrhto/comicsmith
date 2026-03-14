export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { prompt, width = 512, height = 512, referenceImage = null } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) return res.status(500).json({ error: "Cloudflare credentials not configured" });

  const headers = { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" };
  const safePrompt = `${prompt}. No text, no speech bubbles, no words, no captions, no watermarks.`;
  const negativePrompt = "photorealistic, photography, photo, realistic, 3d render, CGI, stock photo, text, speech bubbles, watermark, words, letters";

  try {
    let response;

    if (referenceImage) {
      // img2img — SD v1.5 with reference image
      const cleanPrompt = safePrompt
        .replace(/\b(scar|scars|wound|wounds|blood|gore|dead|death|kill|killing|corpse|naked|nude|nudity|explicit|violent|violence|sword|swords|knife|knives|weapon|weapons|gun|guns|battle|fight|fighting|attack|attacking|murder|torture)\b/gi, "")
        .replace(/\s+/g, " ").trim();
      const base64Data = referenceImage.replace(/^data:image\/\w+;base64,/, "");
      const imageArray = Array.from(Buffer.from(base64Data, "base64"));
      response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/runwayml/stable-diffusion-v1-5-img2img`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt: cleanPrompt,
            negative_prompt: negativePrompt,
            image: imageArray,
            strength: 0.35,
            num_steps: 20,
            width,
            height,
          }),
        }
      );
    } else {
      // text2img — SDXL
      response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/stabilityai/stable-diffusion-xl-base-1.0`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt: safePrompt,
            negative_prompt: negativePrompt,
            num_steps: 20,
            width,
            height,
          }),
        }
      );
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("CF error:", response.status, errText);
      // Fallback to SDXL if img2img fails
      const fallback = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/stabilityai/stable-diffusion-xl-base-1.0`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ prompt: safePrompt, negative_prompt: negativePrompt, num_steps: 20, width, height }),
        }
      );
      const arr = await fallback.arrayBuffer();
      const b64 = Buffer.from(arr).toString("base64");
      return res.status(200).json({ image: `data:image/png;base64,${b64}` });
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
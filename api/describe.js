export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: "imageBase64 required" });

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  try {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const imageBytes = Array.from(Buffer.from(base64Data, "base64"));

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/llava-hf/llava-1.5-7b-hf`,
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          image: imageBytes,
          prompt: "Describe this comic character's visual appearance for image generation. Include: hair color and style, eye color, skin tone, clothing colors and style, accessories, distinguishing features. Be specific and concise.",
          max_tokens: 300,
        }),
      }
    );

    const data = await response.json();
    const description = data.result?.description || "";
    return res.status(200).json({ description });
  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
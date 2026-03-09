export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { prompt, width = 512, height = 512 } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const token = process.env.HF_TOKEN;
  if (!token) return res.status(500).json({ error: "HF_TOKEN not configured" });

  try {
    const response = await fetch(
      "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell/v1/images/generations",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
       body: JSON.stringify({
        prompt,
        num_inference_steps: 4,
        width,
        height,
        }),
      }
    );

    if (!response.ok) {
        const errText = await response.text();
        console.error("HF error:", response.status, errText);
        return res.status(response.status).json({ error: errText });
    }

    // Returns image as binary — convert to base64
   const data = await response.json();
   const base64 = data?.data?.[0]?.b64_json || data?.images?.[0];
   if (!base64) return res.status(500).json({ error: "No image returned" });
   return res.status(200).json({ image: `data:image/png;base64,${base64}` });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
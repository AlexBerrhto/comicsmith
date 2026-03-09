export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { prompt, width = 512, height = 512 } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const token = process.env.HF_TOKEN;
  if (!token) return res.status(500).json({ error: "HF_TOKEN not configured" });

  try {
    const response = await fetch(
      "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            width,
            height,
            num_inference_steps: 4,
          },
        }),
      }
    );

    if (!response.ok) {
  const errText = await response.text();
  return res.status(200).json({ error: errText, hf_status: response.status });
  }

  // Read as arrayBuffer to preserve binary data
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return res.status(200).json({ image: `data:image/jpeg;base64,${base64}` });

  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
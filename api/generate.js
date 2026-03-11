export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { prompt, width = 512, height = 512, seed } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  try {
    const encodedPrompt = encodeURIComponent(prompt);
    const seedParam = seed ? `&seed=${seed}` : "";
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&model=flux${seedParam}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Pollinations error: ${response.status}`);

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return res.status(200).json({ image: `data:image/jpeg;base64,${base64}` });

  } catch (err) {
    console.error("Generate error:", err.message);
    return res.status(200).json({ error: err.message });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  const token = process.env.HF_TOKEN;
  if (!token) return res.status(500).json({ error: "HF_TOKEN not configured" });

  try {
    const response = await fetch(
      "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/v1/feature-extraction",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: text }),
      }
    );

    if (!response.ok) {
        const err = await response.text();
        return res.status(200).json({ error: err, hf_status: response.status });
        }

    const data = await response.json();
    // Returns array of embeddings — take first
    const embedding = Array.isArray(data[0]) ? data[0] : data;
    return res.status(200).json({ embedding });

  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
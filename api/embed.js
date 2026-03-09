export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  const token = process.env.HF_TOKEN;
  if (!token) return res.status(500).json({ error: "HF_TOKEN not configured" });

  try {
    const response = await fetch(
      "https://router.huggingface.co/hf-inference/models/BAAI/bge-small-en-v1.5",
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
    const embedding = Array.isArray(data) ? data.flat() : data;
    return res.status(200).json({ embedding });

  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
// api/llm.js
// Vercel Serverless Function — proxies LLM calls to Groq
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { userMsg, systemMsg } = req.body;
  if (!userMsg) return res.status(400).json({ error: "userMsg is required" });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GROQ_API_KEY not configured" });

  try {
    const messages = [];
    if (systemMsg) messages.push({ role: "system", content: systemMsg });
    messages.push({ role: "user", content: userMsg });

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        max_tokens: 1000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || "Groq error" });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    return res.status(200).json({ text });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
// api/llm.js
const MODELS = [
  "llama-3.3-70b-versatile",           // 100K TPD — primary
  "meta-llama/llama-4-scout-17b-16e-instruct", // 500K TPD — best fallback
  "qwen/qwen3-32b",                     // 500K TPD — second fallback
  "moonshotai/kimi-k2-instruct",        // 300K TPD — third fallback
  "llama-3.1-8b-instant",               // 500K TPD — last resort, fastest
];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { userMsg, systemMsg, system, maxTokens } = req.body;
  const sysMsg = systemMsg || system;
  if (!userMsg) return res.status(400).json({ error: "userMsg is required" });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GROQ_API_KEY not configured" });

  const messages = [];
  if (sysMsg) messages.push({ role: "system", content: sysMsg });
  messages.push({ role: "user", content: userMsg });

  let lastError = null;

  for (const model of MODELS) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens || 1000,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const msg = err.error?.message || "Groq error";
        // Rate limited — try next model
        if (response.status === 429) {
          console.warn(`Model ${model} rate limited — trying next`);
          lastError = msg;
          continue;
        }
        return res.status(response.status).json({ error: msg });
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || "";
      // Log which model was used so you can see it in Vercel logs
      console.log(`✅ Served by: ${model}`);
      return res.status(200).json({ text, model });

    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  return res.status(429).json({
    error: `All models rate limited. Try again in a few minutes. Last error: ${lastError}`,
  });
}
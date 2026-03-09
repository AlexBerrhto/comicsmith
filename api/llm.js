// api/llm.js
// Vercel Serverless Function — proxies LLM calls to Google Gemini
// Keeps your API key secret (never exposed to the browser)

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { system, userMsg, maxTokens = 1000 } = req.body;

  if (!userMsg) {
    return res.status(400).json({ error: "userMsg is required" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
  }

  try {
    // Build Gemini request
    // System prompt goes into systemInstruction, user message into contents
    const geminiBody = {
      systemInstruction: system
        ? { parts: [{ text: system }] }
        : undefined,
      contents: [
        {
          role: "user",
          parts: [{ text: userMsg }],
        },
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.7,
      },
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
      }
    );

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error("Gemini API error:", errBody);
      return res.status(response.status).json({
        error: errBody?.error?.message || `Gemini error ${response.status}`,
      });
    }

    const data = await response.json();

    // Extract text from Gemini response format
    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("") || "";

    return res.status(200).json({ text });

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
}
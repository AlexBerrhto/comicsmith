export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { prompt, referenceImage = null } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const apiKey = process.env.GOOGLE_AI_KEY;
  if (!apiKey) return res.status(500).json({ error: "Google AI key not configured" });

  try {
    // Build content parts — add reference image if provided
    const parts = [];
    if (referenceImage) {
      const base64Data = referenceImage.replace(/^data:image\/\w+;base64,/, "");
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Data,
        }
      });
      parts.push({ text: `Using the character in this reference image, generate a comic book panel: ${prompt}. Keep the character's face, hair, and clothing exactly the same as the reference. Comic book art style, bold ink outlines, flat colors, 2D illustration.` });
    } else {
      parts.push({ text: `${prompt}. Comic book art style, bold ink outlines, flat colors, 2D illustration, NOT photographic.` });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
        }),
      }
    );

    const data = await response.json();
    if (data.error) {
      console.error("Gemini error:", data.error);
      return res.status(200).json({ error: data.error.message });
    }

    const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!imagePart) {
      console.error("No image in response:", JSON.stringify(data));
      return res.status(200).json({ error: "No image returned from Gemini" });
    }

    return res.status(200).json({
      image: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
    });

  } catch (err) {
    console.error("Generate error:", err.message);
    return res.status(200).json({ error: err.message });
  }
}
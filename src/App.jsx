import { useState, useCallback, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  || "";
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const C = {
  ink: "#0D0D0D", paper: "#F5EDD6", red: "#C0392B",
  gold: "#D4A017", blue: "#1A3A5C", gray: "#4A4A4A",
  lightGray: "#E8E0CC", white: "#FEFEFE", success: "#2D6A4F",
  warn: "#E67E22", danger: "#C0392B",
};
const FONTS = {
  display: "'Bangers','Impact',cursive",
  body: "'Special Elite','Courier New',monospace",
  ui: "'Courier New',monospace",
};

const CREDITS = { PORTRAIT: 2, PANEL: 3, STARTING: 20 };

async function callLLM(system, userMsg, maxTokens = 1000) {
  const res = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, userMsg, maxTokens }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `LLM proxy error ${res.status}`);
  }
  const data = await res.json();
  return data.text || "";
}

const TIME_OPTIONS = [
  { id: "dawn",  label: "🌅 Dawn",    desc: "Soft orange haze, long shadows" },
  { id: "day",   label: "☀️ Daytime", desc: "Bright, vivid, high contrast" },
  { id: "dusk",  label: "🌇 Dusk",    desc: "Golden hour, dramatic silhouettes" },
  { id: "night", label: "🌙 Night",   desc: "Deep blues, spotlight sources" },
  { id: "storm", label: "⛈️ Storm",   desc: "Ominous clouds, harsh rain" },
];
const TERRAIN_OPTIONS = [
  { id: "city",     label: "🏙️ City",     desc: "Skyscrapers, streets, neon" },
  { id: "forest",   label: "🌲 Forest",   desc: "Dense trees, dappled light" },
  { id: "desert",   label: "🏜️ Desert",   desc: "Sand dunes, cracked earth" },
  { id: "ocean",    label: "🌊 Ocean",    desc: "Waves, cliffs, seashore" },
  { id: "space",    label: "🚀 Space",    desc: "Stars, nebulae, planets" },
  { id: "dungeon",  label: "🏚️ Dungeon",  desc: "Torchlit stone halls" },
  { id: "mountain", label: "⛰️ Mountain", desc: "Peaks, snow, rocky paths" },
  { id: "village",  label: "🏘️ Village",  desc: "Cottages, market squares" },
];
const ART_OPTIONS = [
  { id: "classic",    label: "📰 Classic Comics", desc: "Bold outlines, Ben-Day dots, primary colors" },
  { id: "manga",      label: "⛩️ Manga",          desc: "Fine lines, speed lines, high contrast" },
  { id: "noir",       label: "🎭 Noir",            desc: "High contrast B&W, deep shadows" },
  { id: "watercolor", label: "🎨 Watercolor",      desc: "Soft edges, blended pastels" },
  { id: "retro",      label: "📺 Retro Sci-Fi",    desc: "1960s pulp, muted palette" },
  { id: "graffiti",   label: "🖌️ Graffiti",        desc: "Bold outlines, vibrant spray colors" },
];

// ─────────────────────────────────────────────
// AGENT 5 — ILLUSTRATOR AGENT (Vector Cache)
// ─────────────────────────────────────────────
function createIllustratorAgent() {
  const getEmbedding = async (text) => {
    const res = await fetch("/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    return data.embedding || null;
  };

  const findSimilar = async (embedding, threshold = 0.85) => {
    const { data, error } = await supabase.rpc("match_scene_embeddings", {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: 1,
    });
    if (error || !data?.length) return null;
    return data[0];
  };

  const storeEmbedding = async (storyId, type, description, embedding, imageData, metadata = {}) => {
    const { error } = await supabase.from("scene_embeddings").insert({
      story_id: storyId,
      type,
      description,
      embedding,
      image_data: imageData,
      metadata,
    });
    if (error) console.error("Failed to store embedding:", error);
  };

  const getOrGenerateImage = async (storyId, type, description, generateFn, metadata = {}) => {
    try {
      const embedding = await getEmbedding(description);
      if (!embedding) return await generateFn();
      const match = await findSimilar(embedding);
      if (match) {
        console.log(`Cache hit! Reusing image (similarity: ${match.similarity.toFixed(2)})`);
        return { type: "url", value: match.image_data, cached: true };
      }
      const result = await generateFn();
      if (result?.value) {
        await storeEmbedding(storyId, type, description, embedding, result.value, metadata);
      }
      return result;
    } catch (err) {
      console.error("Illustrator agent error:", err);
      return await generateFn();
    }
  };

  return { getOrGenerateImage, getEmbedding, storeEmbedding };
}

// ─────────────────────────────────────────────
// PUTER.JS LOADER
// ─────────────────────────────────────────────
function usePuter() {
  const [mode, setMode] = useState("loading");

  useEffect(() => {
    if (window.puter) { setMode("puter"); return; }

    let settled = false;
    const settle = (m) => { if (!settled) { settled = true; setMode(m); } };

    const timeout = setTimeout(() => {
      console.warn("Puter.js not available — using SVG fallback mode");
      settle("svg");
    }, 5000);

    const pollForPuter = (attempts = 0) => {
      if (window.puter) { clearTimeout(timeout); settle("puter"); return; }
      if (attempts > 60) return;
      setTimeout(() => pollForPuter(attempts + 1), 80);
    };

    const existing = document.querySelector('script[src="https://js.puter.com/v2/"]');
    if (existing) { pollForPuter(); return; }

    const s = document.createElement("script");
    s.src = "https://js.puter.com/v2/";
    s.async = true;
    s.onload  = () => pollForPuter();
    s.onerror = () => { clearTimeout(timeout); settle("svg"); };
    document.head.appendChild(s);

    return () => clearTimeout(timeout);
  }, []);

  return mode;
}

// ─────────────────────────────────────────────
// FIX #6: CREDIT SYSTEM — sync with Supabase profile credits on first load
// ─────────────────────────────────────────────
function useCreditSystem(username, initialCredits = null) {
  const [credits, setCredits] = useState(null);
  const storageKey = username ? `credits:${username}` : null;

  useEffect(() => {
    if (!storageKey) return;
    (async () => {
      try {
        const result = await window.storage.get(storageKey);
        if (result) {
          // Use the higher of stored vs Supabase value to avoid resetting
          const stored = parseInt(result.value);
          setCredits(initialCredits !== null ? Math.max(stored, initialCredits) : stored);
        } else {
          // First time: seed from Supabase profile credits
          const seed = initialCredits !== null ? initialCredits : CREDITS.STARTING;
          setCredits(seed);
          await window.storage.set(storageKey, String(seed));
        }
      } catch {
        setCredits(initialCredits !== null ? initialCredits : CREDITS.STARTING);
      }
    })();
  }, [storageKey, initialCredits]);

  const saveCredits = useCallback(async (amount) => {
    if (!storageKey) return;
    try { await window.storage.set(storageKey, String(amount)); } catch {}
  }, [storageKey]);

  const deduct = useCallback(async (cost) => {
    const current = credits ?? CREDITS.STARTING;
    if (current < cost) return false;
    const next = current - cost;
    setCredits(next);
    await saveCredits(next);
    return true;
  }, [credits, saveCredits]);

  const canAfford = useCallback((cost) => (credits ?? 0) >= cost, [credits]);

  const topUp = useCallback(async (amount = 10) => {
    const next = (credits ?? 0) + amount;
    setCredits(next);
    await saveCredits(next);
  }, [credits, saveCredits]);

  return { credits: credits ?? 0, deduct, canAfford, topUp };
}

// ─────────────────────────────────────────────
// AGENT 1: CONTEXT AGENT
// ─────────────────────────────────────────────
function useContextAgent() {
  const [user, setUser] = useState(null);
  const [scene, setScene] = useState({ timeOfDay: null, terrain: null, artStyle: null });
  const [characters, setCharacters] = useState([]);
  const [config, setConfig] = useState({ panelsPerPage: 4, hasBackground: false, backgroundDesc: "" });
  const [panelDescriptions, setPanelDescriptions] = useState([]);

  const login = useCallback((u) => setUser(u), []);
  const updateScene = useCallback((u) => setScene(s => ({ ...s, ...u })), []);
  const addCharacter = useCallback((c) => setCharacters(cs => [...cs, c]), []);
  const updateCharacter = useCallback((i, u) => setCharacters(cs => cs.map((c, idx) => idx === i ? { ...c, ...u } : c)), []);
  const updateConfig = useCallback((u) => setConfig(c => ({ ...c, ...u })), []);
  const updatePanelDesc = useCallback((i, t) => setPanelDescriptions(pd => { const a = [...pd]; a[i] = t; return a; }), []);
  const initPanels = useCallback((n) => setPanelDescriptions(Array(n).fill("")), []);

  return { user, scene, characters, config, panelDescriptions, login, updateScene, addCharacter, updateCharacter, updateConfig, updatePanelDesc, initPanels };
}

// ─────────────────────────────────────────────
// AGENT 3: TRANSLATOR AGENT
// ─────────────────────────────────────────────
function useTranslatorAgent() {
  const [translating, setTranslating] = useState(false);
  const translationLog = useRef([]);

  const callClaude = (system, userMsg, maxTokens = 300) =>
    callLLM(system, userMsg, maxTokens);

  const translatePortrait = useCallback(async (character, artStyle) => {
    setTranslating(true);
    const artKeywords = {
      classic: "classic American comic book art style, bold ink outlines, flat cel shading, primary colors, Ben-Day dot halftone texture, Jack Kirby inspired",
      manga: "manga panel, black and white only, no color, grayscale, clean linework, screen tone shading, dynamic composition, speed lines, ink only",
      noir:    "noir comic art style, stark black and white, heavy shadow blocking, dramatic chiaroscuro, Frank Miller Sin City style",
      watercolor: "watercolor comic illustration, soft wet edges, pastel color washes, loose brushwork, Moebius inspired",
      retro:   "1960s retro sci-fi pulp comic art, muted earthy palette, cross-hatch shading, vintage printing aesthetic",
      graffiti: "graffiti street art comic style, thick outlines, electric neon colors, spray paint texture, bold graphic shapes",
    }[artStyle] || "comic book illustration, bold outlines, flat colors";

    const system = `You are an expert image generation prompt engineer specializing in comic book art. 
Convert character descriptions into precise, vivid prompts for AI image generation.
Output ONLY the optimized prompt — no explanation, no quotes, no preamble.
Always include: ${artKeywords}
Format: [subject], [appearance details], [pose/expression], [lighting], [style keywords], [quality boosters]
Quality boosters to append: highly detailed, sharp focus, professional comic illustration, 2D art, NOT photographic, NOT realistic, ink outlines, flat cel shading`;

    try {
      const prompt = await callClaude(system,
        `Character: ${character.name}. Role: ${character.role}.
Visual details:
- Age: ${character.age || "adult"}, Gender: ${character.gender || "unspecified"}, Build: ${character.build || "average"}
- Skin tone: ${character.skinTone || "unspecified"}
- Hair: ${character.hairStyle || ""} ${character.hairColor || ""} hair
- Eyes: ${character.eyeColor || "brown"} eyes
- Outfit: ${character.outfit || character.description}
- Distinguishing features: ${character.distinguishing || "none"}
- Personality traits: ${character.traits}

Create a portrait prompt showing head and shoulders with a characteristic expression.`);
      translationLog.current.push({ type: "portrait", input: character.name, output: prompt });
      setTranslating(false);
      return prompt;
    } catch {
      setTranslating(false);
      return `${character.name}, ${character.skinTone || ""} skin, ${character.hairColor || ""} ${character.hairStyle || ""} hair, ${character.eyeColor || ""} eyes, wearing ${character.outfit || character.description}, ${character.role} character, comic book portrait, ${artKeywords}, highly detailed`;
    }
  }, []);

  const translatePanel = useCallback(async (panelDesc, panelIdx, scene, characters, config) => {
    const artKeywords = {
      classic: "classic American comic book panel, bold ink outlines, flat cel shading, primary color palette, Ben-Day dots",
      manga:   "manga panel, clean linework, screen tone shading, dynamic composition, speed lines",
      noir:    "noir comic panel, black and white, deep shadows, dramatic lighting, cinematic",
      watercolor: "watercolor comic panel, soft brushwork, loose painterly style, pastel tones",
      retro:   "retro sci-fi comic panel, 1960s pulp aesthetic, muted tones, vintage cross-hatching",
      graffiti: "street art comic panel, thick outlines, vivid neon spray colors, bold graphic",
    }[scene.artStyle] || "comic book panel";

    const timeAtmosphere = {
      dawn: "dawn lighting, warm orange-pink sky, long soft shadows",
      day: "bright daylight, clear sky, high contrast sharp shadows",
      dusk: "golden hour dusk, warm orange glow, dramatic long shadows",
      night: "night scene, dark sky, artificial light sources, deep shadows",
      storm: "stormy atmosphere, dark ominous clouds, rain, dramatic tension",
    }[scene.timeOfDay] || "natural lighting";

    const terrainDesc = {
      city: "urban cityscape, skyscrapers, concrete streets, urban environment",
      forest: "dense forest, tall trees, dappled light through canopy",
      desert: "arid desert, sand dunes, cracked earth, harsh sun",
      ocean: "ocean setting, waves, coastal cliffs, sea horizon",
      space: "outer space, stars, nebula colors, zero gravity environment",
      dungeon: "stone dungeon, torchlit walls, medieval underground",
      mountain: "mountain terrain, rocky peaks, snow, high altitude",
      village: "quaint village, cobblestone streets, cottages, market square",
    }[scene.terrain] || "generic environment";

    const charList = characters.map(c =>
      `${c.name} (${c.role}, ${c.skinTone || ""} skin, ${c.hairColor || ""} ${c.hairStyle || ""} hair, ${c.eyeColor || ""} eyes, wearing ${c.outfit || c.description})`
    ).join(", ");

    const charVisuals = characters
      .filter(c => panelDesc.toLowerCase().includes(c.name.toLowerCase()))
      .map(c => `${c.name}: ${c.visionDescription || `${c.skinTone||""} skin, ${c.hairColor||""} ${c.hairStyle||""} hair, ${c.eyeColor||""} eyes, wearing ${c.outfit||c.description}`}`)
      .join("; ");

    const bgVisual = config.backgroundVisionDesc || config.backgroundDesc || `${terrainDesc}, ${timeAtmosphere}`;
    const bgNote = `Background: ${bgVisual}`;

    const system = `You are an expert image generation prompt engineer for comic book panels.
Convert panel action descriptions into precise visual prompts for AI image generation.
Output ONLY the optimized prompt — no explanation, no quotes.
Context: ${artKeywords}, ${timeAtmosphere}, ${terrainDesc}
Characters in this world: ${charList}
${bgNote}
Scene style: ${artKeywords}, ${timeAtmosphere}
Analyze the action and emotion in the panel, then choose the most cinematic camera angle:
- CLOSE-UP: for intense emotion, dialogue, reaction shots
- MEDIUM SHOT: for action between 2 characters, confrontation
- WIDE SHOT: for establishing scene, epic moments, large environments
- LOW ANGLE: for powerful/threatening characters, dominance
- HIGH ANGLE: for vulnerability, overwhelmed characters
- DUTCH ANGLE: for tension, unease, villain moments
- OVER SHOULDER: for conversation, stalking, pursuit

Include in prompt: chosen camera angle, character facial expression (specific emotion), body language, eye direction, lighting that matches mood
${charVisuals ? `IMPORTANT: Visual character details: ${charVisuals.replace(/\b(scar|wound|battle|weapon|sword|knife|gun|blood)\b/gi, match => ({ scar: "marking", wound: "marking", battle: "worn", weapon: "accessory", sword: "prop", knife: "prop", gun: "prop", blood: "" })[match.toLowerCase()] || "")}` : ""}
Append: ${artKeywords}, highly detailed comic panel, professional comic book illustration, 2D illustration, NOT photographic${scene.artStyle === "manga" || scene.artStyle === "noir" ? ", black and white only, NO color, grayscale, monochrome" : ""}`;

    try {
      const prompt = await callClaude(system,
        `Panel ${panelIdx + 1} action: ${panelDesc}
        Identify the dominant emotion in this panel and choose the best camera angle to capture it.`
      );
      translationLog.current.push({ type: "panel", input: panelDesc, output: prompt });
      return prompt;
    } catch {
      return `${charVisuals ? charVisuals + ", " : ""}${panelDesc}, ${terrainDesc}, ${timeAtmosphere}, ${artKeywords}, comic book panel, highly detailed, NO photography, NO realistic, NO stock photo, illustration only`;
    }
  }, []);

  return { translating, translatePortrait, translatePanel, translationLog };
}

// ─────────────────────────────────────────────
// AGENT 2: IMAGE AGENT
// FIX #1: passage is now passed as a parameter instead of closed over
// ─────────────────────────────────────────────
function useImageAgent(translatorAgent, creditSystem, puterMode, storyId = null) {
  const illustratorRef = useRef(null);
  if (!illustratorRef.current) illustratorRef.current = createIllustratorAgent();
  const illustrator = illustratorRef.current;
  const characterSheets = useRef({});
  const [panelImages, setPanelImages] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [genLog, setGenLog] = useState([]);
  const log = useCallback((msg) => setGenLog(l => [...l, msg]), []);

  const extractSvg = (raw) => {
    const m = raw.match(/<svg[\s\S]*<\/svg>/i);
    return m ? m[0] : null;
  };

  const generateViaHuggingFace = async (prompt, isPortrait) => {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, width: isPortrait ? 512 : 768, height: isPortrait ? 512 : 512 }),
    });
    if (!res.ok) throw new Error("Image generation failed");
    const data = await res.json();
    return data.image;
  };

  const generateViaSVG = async (prompt, isPortrait) => {
    const dims = isPortrait
      ? `viewBox="0 0 200 240" width="100%" height="240"`
      : `viewBox="0 0 300 190" width="100%" height="190"`;
    const subject = isPortrait
      ? "a character portrait (head + shoulders). Include: background fill, head circle, hair, eyes (two filled circles), nose, mouth arc, neck, shirt collar."
      : "a comic book scene panel. Include: sky/background fill, ground or floor, at least one character figure, environment details.";
    const system = `You are an SVG comic artist. Output ONLY a raw SVG element — no markdown, no explanation.
- Start with <svg ${dims} xmlns="http://www.w3.org/2000/svg">
- End with </svg>
- Draw ${subject}
- Comic art: bold stroke="#111111" stroke-width="2.5" on all shapes, flat fills, clear silhouettes
- Fill entire canvas background first
- NO <text> or <script> elements`;
    const raw = await callLLM(system, `Draw: ${prompt}`, 900);
    return extractSvg(raw);
  };

  const generateImage = async (prompt, isPortrait, description = null) => {
    const generateFn = async () => {
      try {
        const url = await generateViaHuggingFace(prompt, isPortrait);
        return { type: "url", value: url };
      } catch {
        const svg = await generateViaSVG(prompt, isPortrait);
        return { type: "svg", value: svg };
      }
    };
    if (storyId && description) {
      return await illustrator.getOrGenerateImage(
        storyId,
        isPortrait ? "character" : "panel",
        description,
        generateFn,
        { prompt }
      );
    }
    return await generateFn();
  };

  const generateCharacterPortrait = useCallback(async (character, artStyle) => {
    const ok = await creditSystem.deduct(CREDITS.PORTRAIT);
    if (!ok) throw new Error(`Not enough credits. Portrait costs ${CREDITS.PORTRAIT} credits.`);
    const backend = puterMode === "puter" ? "Puter.js 🎨" : "Claude SVG ✏️";
    log(`🔤 Translator: optimizing prompt for "${character.name}"...`);
    const optimizedPrompt = await translatorAgent.translatePortrait(character, artStyle);
    log(`${backend} generating portrait for "${character.name}"...`);
    const result = await generateImage(optimizedPrompt, true, character.description);
    if (result.value) {
      characterSheets.current[character.name] = {
        ...result, description: character.description,
        traits: character.traits, optimizedPrompt,
      };
      log(`✅ Portrait done for "${character.name}" (-${CREDITS.PORTRAIT}cr)`);
    }
    return result;
  }, [translatorAgent, creditSystem, log, puterMode]);

  // FIX #1: passage is now received as a parameter here
  const generateComic = useCallback(async (scene, characters, config, panelDescriptions, storyTitle, passage) => {
    setGenerating(true);
    setGenLog([]);
    setPanelImages([]);
    const totalCost = panelDescriptions.length * CREDITS.PANEL;
    if (!creditSystem.canAfford(totalCost)) {
      log(`❌ Need ${totalCost} credits for ${panelDescriptions.length} panels. You have ${creditSystem.credits}.`);
      setGenerating(false);
      return null;
    }
    try {
      log("📝 Writing dialogue...");
      const dialogueRaw = await callLLM(
        `You are a comic book script writer. Your ONLY job is to convert a passage into panel descriptions. Output ONLY valid JSON, no markdown, no explanation.`,
        `STRICT RULES:
1. Every panel MUST describe a moment that actually happens in the passage below
2. Use the EXACT character names from the passage
3. Use the EXACT locations from the passage
4. Do NOT invent new events, characters, or settings
5. Preserve the exact mood and tone of the passage

PASSAGE (adapt this faithfully):
"${passage}"

CHARACTERS:
${characters.map(c => `${c.name}: ${c.description}`).join("\n")}

SETTING: ${scene.terrain}, ${scene.timeOfDay}
ART STYLE: ${scene.artStyle}

Return ONLY this JSON:
{
  "title": "TITLE FROM PASSAGE IN CAPS",
  "panelCount": <2-8>,
  "panels": [
    {
      "description": "exact moment from passage",
      "background": "specific location",
      "characters": ["ExactName1"]
    }
  ]
}`,
        1200
      );
      let dialogueData;
      try { dialogueData = JSON.parse(dialogueRaw.replace(/```json|```/g, "").trim()); }
      catch { dialogueData = { panels: panelDescriptions.map(() => ({ sfx: null, dialogue: [] })) }; }
      log("✅ Dialogue written");

      log(`🔤 Translator Agent: optimizing ${panelDescriptions.length} prompts...`);
      const translatedPrompts = await Promise.all(
        panelDescriptions.map((desc, i) =>
          translatorAgent.translatePanel(desc, i, scene, characters, config)
        )
      );
      log("✅ Prompts optimized");

      const backend = puterMode === "puter" ? "Puter.js 🎨" : "Claude SVG ✏️";
      log(`${backend} generating ${panelDescriptions.length} panel images...`);
      const results = await Promise.all(
        translatedPrompts.map(async (prompt, i) => {
          try {
            await creditSystem.deduct(CREDITS.PANEL);
            const result = await generateImage(prompt, false, panelDescriptions[i]);
            log(`✅ Panel ${i+1} done (-${CREDITS.PANEL}cr)`);
            return result;
          } catch (err) {
            log(`⚠️ Panel ${i+1} failed: ${err.message}`);
            return { type: "svg", value: null };
          }
        })
      );

      const panels = panelDescriptions.map((desc, i) => ({
        description: desc,
        imageResult: results[i],
        optimizedPrompt: translatedPrompts[i],
        sfx: dialogueData.panels?.[i]?.sfx || null,
        dialogue: dialogueData.panels?.[i]?.dialogue || [],
      }));

      setPanelImages(panels);
      log("🎉 Comic complete!");
      return panels;
    } finally {
      setGenerating(false);
    }
  }, [translatorAgent, creditSystem, log, puterMode]);

  return { characterSheets, panelImages, generating, genLog, generateCharacterPortrait, generateComic };
}

// ─────────────────────────────────────────────
// UNIVERSAL IMAGE RENDERER
// ─────────────────────────────────────────────
function ComicImage({ result, alt, style = {} }) {
  if (!result || !result.value) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#e0d8c0", ...style }}>
        <span style={{ fontSize: "24px" }}>⚠️</span>
        <span style={{ fontFamily: "'Courier New',monospace", fontSize: "10px", color: "#777", marginTop: "4px" }}>No image</span>
      </div>
    );
  }
  if (result.type === "url") {
    return <img src={result.value} alt={alt} style={{ display: "block", objectFit: "cover", ...style }} />;
  }
  return (
    <div style={{ lineHeight: 0, overflow: "hidden", ...style }}
      dangerouslySetInnerHTML={{ __html: result.value }} />
  );
}

// ─────────────────────────────────────────────
// UI COMPONENTS
// ─────────────────────────────────────────────
function Btn({ children, onClick, variant = "primary", disabled, small, style = {} }) {
  const v = {
    primary:   { bg: C.red,     color: C.white,  border: `3px solid ${C.ink}`, shadow: `3px 3px 0 ${C.ink}` },
    secondary: { bg: C.paper,   color: C.ink,    border: `3px solid ${C.ink}`, shadow: `3px 3px 0 ${C.ink}` },
    ghost:     { bg: "transparent", color: C.paper, border: `2px solid ${C.paper}`, shadow: "none" },
    gold:      { bg: C.gold,    color: C.ink,    border: `3px solid ${C.ink}`, shadow: `3px 3px 0 ${C.ink}` },
    success:   { bg: C.success, color: C.white,  border: `3px solid ${C.ink}`, shadow: `3px 3px 0 ${C.ink}` },
    danger:    { bg: C.danger,  color: C.white,  border: `3px solid ${C.ink}`, shadow: `3px 3px 0 ${C.ink}` },
  }[variant] || {};
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? "#888" : v.bg, color: disabled ? "#ccc" : v.color,
      border: v.border, boxShadow: disabled ? "none" : v.shadow,
      padding: small ? "6px 14px" : "10px 22px",
      fontFamily: FONTS.display, fontSize: small ? "14px" : "18px",
      letterSpacing: "2px", cursor: disabled ? "not-allowed" : "pointer",
      transform: disabled ? "translate(2px,2px)" : "none",
      transition: "all 0.1s", textTransform: "uppercase", ...style,
    }}
    onMouseEnter={e => !disabled && (e.currentTarget.style.transform = "translate(-1px,-1px)")}
    onMouseLeave={e => !disabled && (e.currentTarget.style.transform = "none")}
    >{children}</button>
  );
}

function Card({ children, style = {}, onClick }) {
  return <div onClick={onClick} style={{ background: C.paper, border: `4px solid ${C.ink}`, padding: "24px", boxShadow: `6px 6px 0 ${C.ink}`, ...style }}>{children}</div>;
}

function Input({ label, value, onChange, placeholder, type = "text", multiline }) {
  const shared = { width: "100%", background: "#FFFDF5", border: `3px solid ${C.ink}`, padding: "10px 14px", fontFamily: FONTS.body, fontSize: "15px", color: C.ink, outline: "none", boxSizing: "border-box", resize: multiline ? "vertical" : "none" };
  return (
    <div style={{ marginBottom: "16px" }}>
      {label && <label style={{ fontFamily: FONTS.display, fontSize: "16px", letterSpacing: "1px", color: C.paper, display: "block", marginBottom: "6px" }}>{label}</label>}
      {multiline
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} style={shared} />
        : <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={shared} />
      }
    </div>
  );
}

function OptionGrid({ options, selected, onSelect, cols = 3 }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "10px" }}>
      {options.map(opt => {
        const sel = selected === opt.id;
        return (
          <div key={opt.id} onClick={() => onSelect(opt.id)} style={{
            background: sel ? C.red : C.paper, border: `3px solid ${sel ? C.red : C.ink}`,
            padding: "12px 14px", cursor: "pointer",
            boxShadow: sel ? "inset 2px 2px 0 rgba(0,0,0,0.3)" : `3px 3px 0 ${C.ink}`,
            transform: sel ? "translate(2px,2px)" : "none", transition: "all 0.15s",
          }}>
            <div style={{ fontFamily: FONTS.display, fontSize: "15px", color: sel ? C.white : C.ink, letterSpacing: "1px" }}>{opt.label}</div>
            {opt.desc && <div style={{ fontFamily: FONTS.ui, fontSize: "11px", color: sel ? "#ffcccc" : C.gray, marginTop: "3px" }}>{opt.desc}</div>}
          </div>
        );
      })}
    </div>
  );
}

// FIX #3 & #5: Corrected step numbers to match actual navigation order
// Flow: story-choice(1) → style(2) → passage(3) → confirm(4) → studio(5)
function StepHeader({ step, total, title, subtitle }) {
  return (
    <div style={{ marginBottom: "28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ width: i < step ? "28px" : "10px", height: "10px", background: i < step ? C.red : i === step - 1 ? C.gold : "#555", border: `2px solid ${C.ink}`, transition: "all 0.3s" }} />
        ))}
        <span style={{ fontFamily: FONTS.ui, fontSize: "11px", color: C.gold, letterSpacing: "2px" }}>STEP {step} / {total}</span>
      </div>
      <h2 style={{ fontFamily: FONTS.display, fontSize: "clamp(26px,4vw,42px)", color: C.paper, margin: "0 0 4px", letterSpacing: "3px", textShadow: `3px 3px 0 ${C.ink}` }}>{title}</h2>
      {subtitle && <p style={{ fontFamily: FONTS.body, color: C.lightGray, margin: 0, fontSize: "14px" }}>{subtitle}</p>}
    </div>
  );
}

function SpeechBubble({ text, type = "speech" }) {
  const s = {
    speech:    { bg: C.white,   border: `3px solid ${C.ink}`, radius: "14px", tail: true },
    thought:   { bg: C.white,   border: `3px dashed #555`,   radius: "50px", tail: false },
    shout:     { bg: "#FFE566", border: `4px solid ${C.ink}`, radius: "4px",  tail: true },
    narration: { bg: "#FFFDE7", border: `3px solid #8B7355`, radius: "4px",  tail: false },
  }[type] || { bg: C.white, border: `3px solid ${C.ink}`, radius: "14px", tail: true };
  return (
    <div style={{ position: "relative", background: s.bg, border: s.border, borderRadius: s.radius, padding: "5px 9px", maxWidth: "92%", margin: "3px auto", fontFamily: FONTS.display, fontSize: "11px", lineHeight: 1.3, color: C.ink, boxShadow: "1px 1px 0 #11111166" }}>
      {type === "shout" && <span style={{ color: C.red }}>💥 </span>}
      {text}
      {s.tail && <div style={{ position: "absolute", bottom: "-11px", left: "14px", fontSize: "13px", color: C.ink, lineHeight: 1 }}>▼</div>}
    </div>
  );
}

const resizeBase64 = (base64, maxSize = 256) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = maxSize;
    canvas.height = maxSize;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, maxSize, maxSize);
    resolve(canvas.toDataURL("image/jpeg", 0.7));
  };
  img.src = base64;
});

function CreditBadge({ credits, cost, label }) {
  const color = credits <= 3 ? C.danger : credits <= 8 ? C.warn : C.success;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
      <div style={{ background: C.ink, border: `2px solid ${color}`, padding: "5px 12px", fontFamily: FONTS.display, fontSize: "15px", color, letterSpacing: "1px", boxShadow: `0 0 8px ${color}44` }}>
        ⚡ {credits} CREDITS
      </div>
      {cost && (
        <div style={{ fontFamily: FONTS.ui, fontSize: "11px", color: C.lightGray }}>
          {label}: <span style={{ color: C.gold }}>{cost}cr</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN 1: LOGIN
// ─────────────────────────────────────────────
function LoginScreen({ onLogin, puterMode }) {
  const [tab, setTab] = useState("login");
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      if (tab === "register") {
        if (!form.username.trim()) { setError("Username required."); setLoading(false); return; }
        if (!form.email.includes("@")) { setError("Valid email required."); setLoading(false); return; }
        if (form.password.length < 6) { setError("Password must be at least 6 characters."); setLoading(false); return; }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { username: form.username } },
        });
        if (signUpError) { setError(signUpError.message); setLoading(false); return; }

        await new Promise(r => setTimeout(r, 800));
        const { data: profile } = await supabase
          .from("profiles").select("*").eq("id", data.user.id).single();

        onLogin({
          id: data.user.id,
          username: form.username,
          email: form.email,
          trial_ends_at: profile?.trial_ends_at,
          credits: profile?.credits ?? CREDITS.STARTING,
          trialExpired: false,
        });
      } else {
        if (!form.email.includes("@")) { setError("Valid email required."); setLoading(false); return; }
        if (!form.password) { setError("Password required."); setLoading(false); return; }

        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
        if (signInError) {
          const msg = signInError.message.toLowerCase();
          if (msg.includes("invalid") || msg.includes("not found")) {
            setError("No account found. New here? Click REGISTER above to create your free 7-day trial.");
          } else {
            setError(signInError.message);
          }
          setLoading(false);
          return;
        }

        const { data: profile } = await supabase
          .from("profiles").select("*").eq("id", data.user.id).single();

        const trialExpired = profile?.trial_ends_at
          ? new Date() > new Date(profile.trial_ends_at)
          : false;

        onLogin({
          id: data.user.id,
          username: profile?.username || form.email,
          email: data.user.email,
          trial_ends_at: profile?.trial_ends_at,
          credits: profile?.credits ?? CREDITS.STARTING,
          trialExpired,
        });
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.ink, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px", backgroundImage: `repeating-linear-gradient(0deg,transparent,transparent 39px,#1a1a1a 39px,#1a1a1a 40px),repeating-linear-gradient(90deg,transparent,transparent 39px,#1a1a1a 39px,#1a1a1a 40px)` }}>
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <div style={{ display: "inline-block", background: C.gold, border: `5px solid ${C.ink}`, padding: "10px 32px", transform: "rotate(-2deg)", boxShadow: `6px 6px 0 ${C.ink}`, marginBottom: "12px" }}>
          <div style={{ fontFamily: FONTS.display, fontSize: "clamp(36px,6vw,64px)", color: C.red, letterSpacing: "6px", textShadow: `3px 3px 0 ${C.ink}`, transform: "rotate(2deg)" }}>COMICSMITH</div>
        </div>
        <div style={{ fontFamily: FONTS.ui, fontSize: "11px", color: C.lightGray, letterSpacing: "4px" }}>✦ AI-POWERED COMIC CREATION STUDIO ✦</div>
        <div style={{ marginTop: "8px", fontFamily: FONTS.ui, fontSize: "11px", letterSpacing: "2px", color: puterMode === "puter" ? C.success : puterMode === "svg" ? C.warn : C.gray }}>
          {puterMode === "loading" && "○ Detecting image backend..."}
          {puterMode === "puter"   && "● PUTER.JS READY — real AI images"}
          {puterMode === "svg"     && "✏️ SVG MODE — preview only"}
        </div>
      </div>

      <Card style={{ width: "100%", maxWidth: "420px" }}>
        <div style={{ display: "flex", marginBottom: "24px", border: `3px solid ${C.ink}` }}>
          {["login", "register"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "10px", background: tab === t ? C.ink : C.paper, color: tab === t ? C.gold : C.ink, fontFamily: FONTS.display, fontSize: "16px", letterSpacing: "2px", border: "none", cursor: "pointer" }}>
              {t === "login" ? "SIGN IN" : "REGISTER"}
            </button>
          ))}
        </div>
        {tab === "register" && <Input label="USERNAME" value={form.username} onChange={v => setForm(f => ({ ...f, username: v }))} placeholder="your_handle" />}
        <Input label="EMAIL" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="you@example.com" type="email" />
        <Input label="PASSWORD" value={form.password} onChange={v => setForm(f => ({ ...f, password: v }))} placeholder="••••••••" type="password" />
        {tab === "register" && (
          <div style={{ background: "#E8F5E9", border: `2px solid ${C.success}`, padding: "10px 12px", marginBottom: "16px", fontFamily: FONTS.ui, fontSize: "12px", color: C.success, lineHeight: 1.6 }}>
            🎁 New accounts get <strong>7 days free</strong> + <strong>{CREDITS.STARTING} credits</strong><br/>
            Portrait = {CREDITS.PORTRAIT} cr · Panel image = {CREDITS.PANEL} cr
          </div>
        )}
        {error && (
          <div style={{ background: "#FFEBEE", border: `2px solid ${C.red}`, padding: "10px 12px", fontFamily: FONTS.ui, fontSize: "12px", color: C.red, marginBottom: "12px", lineHeight: 1.6 }}>
            ⚠️ {error}
            {error.includes("REGISTER") && (
              <span onClick={() => { setTab("register"); setError(""); }}
                style={{ display: "block", marginTop: "6px", color: C.blue, cursor: "pointer", textDecoration: "underline" }}>
                → Switch to Register now
              </span>
            )}
          </div>
        )}
        <Btn onClick={handleSubmit} disabled={loading} style={{ width: "100%" }}>
          {loading ? "⟳ PLEASE WAIT..." : tab === "login" ? "▶ ENTER THE STUDIO" : "✦ CREATE ACCOUNT"}
        </Btn>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN 2.1: STORY CHOICE
// ─────────────────────────────────────────────
function StoryChoiceScreen({ onNewStory, onOldStory }) {
  return (
    <div>
      {/* FIX #3: Story choice is step 1 */}
      <StepHeader step={1} total={5} title="YOUR STORY" subtitle="Start fresh or continue where you left off." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginTop: "12px" }}>
        <Card style={{ textAlign: "center", cursor: "pointer", border: `4px solid ${C.gold}`, background: "#111" }} onClick={onNewStory}>
          <div style={{ fontSize: "52px", marginBottom: "12px" }}>✨</div>
          <div style={{ fontFamily: FONTS.display, fontSize: "28px", color: C.gold, letterSpacing: "3px" }}>NEW STORY</div>
          <div style={{ fontFamily: FONTS.body, fontSize: "13px", color: C.lightGray, marginTop: "8px", lineHeight: 1.6 }}>
            Describe your scene in your own words.<br/>AI will extract characters & setting automatically.
          </div>
          <div style={{ marginTop: "20px" }}>
            <Btn variant="gold" onClick={onNewStory}>START CREATING ▶</Btn>
          </div>
        </Card>

        <Card style={{ textAlign: "center", background: "#111", border: `4px solid ${C.gold}`, cursor: "pointer" }} onClick={onOldStory}>
          <div style={{ fontSize: "52px", marginBottom: "12px" }}>📖</div>
          <div style={{ fontFamily: FONTS.display, fontSize: "28px", color: C.gold, letterSpacing: "3px" }}>OLD STORY</div>
          <div style={{ fontFamily: FONTS.body, fontSize: "13px", color: C.lightGray, marginTop: "8px", lineHeight: 1.6 }}>
            Resume a previously saved comic.<br/>Your characters and scenes will be restored.
          </div>
          <div style={{ marginTop: "20px" }}>
            <Btn variant="secondary" onClick={onOldStory}>CONTINUE ▶</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN 2.2: ScenePassageScreen
// FIX #2: Added onBack to props destructuring
// FIX #4: passage is stored inside extracted object so it propagates correctly
// ─────────────────────────────────────────────
function ScenePassageScreen({ onNext, onBack }) {
  const [passage, setPassage] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const analyzePassage = async () => {
    if (passage.trim().length < 20) {
      setError("Please write a bit more — at least a sentence or two.");
      return;
    }
    setAnalyzing(true);
    setError("");
    try {
      const raw = await callLLM(
        `You are a comic book scene analyzer. Extract scene details from the user's passage and return ONLY valid JSON, no markdown, no explanation.
Return this exact structure:
{
  "timeOfDay": "dawn|day|dusk|night|storm",
  "terrain": "city|forest|desert|ocean|space|dungeon|mountain|village",
  "characters": [
    {
      "name": "string",
      "role": "hero|villain|sidekick|mentor|neutral",
      "age": "child|teen|young adult|adult|middle-aged|elderly",
      "gender": "male|female|non-binary",
      "build": "slim|athletic|average|stocky|muscular|petite",
      "skinTone": "pale|fair|olive|tan|brown|dark brown|ebony",
      "hairColor": "black|brown|blonde|red|grey|white|auburn|silver|blue|green|pink",
      "hairStyle": "string",
      "eyeColor": "brown|blue|green|grey|hazel|amber|black",
      "outfit": "string",
      "distinguishing": "string",
      "description": "string",
      "traits": "string"
    }
  ],
  "backgroundDesc": "string",
  "hasBackground": true
}`,
        `Scene passage: ${passage}`,
        800
      );
      let clean = raw.replace(/```json|```/g, "").trim();
      const start = clean.indexOf("{");
      const end = clean.lastIndexOf("}");
      if (start !== -1 && end !== -1) clean = clean.slice(start, end + 1);
      clean = clean.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\x00-\x1F\x7F]/g, " ");
      const data = JSON.parse(clean);
      // FIX #4: include passage in the extracted object so downstream screens have access
      onNext({ passage, extracted: { ...data, passage } });
    } catch (err) {
      setError("Could not analyze the scene. Try adding more detail.");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div>
      {/* FIX #3: Passage entry is step 3 (after story-choice + style) */}
      <StepHeader step={3} total={5} title="DESCRIBE YOUR SCENE" subtitle="Write your scene in plain English. AI will do the rest." />
      <Card style={{ marginBottom: "20px" }}>
        <div style={{ fontFamily: FONTS.display, fontSize: "16px", color: C.ink, marginBottom: "10px", letterSpacing: "1px" }}>
          ✍️ YOUR SCENE PASSAGE
        </div>
        <textarea
          value={passage}
          onChange={e => setPassage(e.target.value)}
          placeholder={`Example: "It's a stormy night in Neo Tokyo. Commander Aria, a silver-haired warrior in red armor, faces off against the villain Krell on top of a rain-soaked skyscraper. Lightning illuminates their battle."`}
          rows={8}
          style={{ width: "100%", background: "#FFFDF5", border: `3px solid ${C.ink}`, padding: "12px", fontFamily: FONTS.body, fontSize: "14px", color: C.ink, outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.7 }}
        />
        <div style={{ fontFamily: FONTS.ui, fontSize: "11px", color: C.gray, marginTop: "8px" }}>
          Include: setting, time of day, characters (names + appearance), mood, action
        </div>
      </Card>

      {error && <div style={{ background: "#FFEBEE", border: `2px solid ${C.red}`, padding: "10px", fontFamily: FONTS.ui, fontSize: "12px", color: C.red, marginBottom: "16px" }}>⚠️ {error}</div>}

      {analyzing && (
        <Card style={{ background: "#111", border: `3px solid ${C.gold}`, marginBottom: "16px", textAlign: "center", padding: "20px" }}>
          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
          <div style={{ fontFamily: FONTS.display, fontSize: "20px", color: C.gold, animation: "pulse 1s infinite", letterSpacing: "3px" }}>
            🔍 ANALYSING YOUR SCENE...
          </div>
        </Card>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        {/* FIX #2: onBack is now properly used from props */}
        <Btn onClick={onBack} variant="secondary">◀ BACK</Btn>
        <Btn onClick={analyzePassage} disabled={!passage.trim() || analyzing} variant="gold">
          {analyzing ? "⟳ ANALYSING..." : "🔍 ANALYSE SCENE ▶"}
        </Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN 2.3: SceneConfirmScreen
// ─────────────────────────────────────────────
function SceneConfirmScreen({ extracted, onConfirm, onBack }) {
  const [data, setData] = useState(extracted);
  const [previews, setPreviews] = useState({});
  const [loading, setLoading] = useState({});

  useEffect(() => {
    const restorePortraits = async () => {
      const restoredPreviews = {};
      await Promise.all(
        (extracted.characters || []).map(async (c, i) => {
          try {
            const embedRes = await fetch("/api/embed", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: `${c.name}, ${c.role}, ${c.skinTone || ""} skin, ${c.hairColor || ""} ${c.hairStyle || ""} hair, ${c.eyeColor || ""} eyes, ${c.outfit || c.description}, ${c.distinguishing || ""}`.trim() }),
            });
            const embedData = await embedRes.json();
            if (!embedData.embedding) return;
            const { data: matches } = await supabase.rpc("match_scene_embeddings", {
              query_embedding: embedData.embedding,
              match_threshold: 0.75,
              match_count: 1,
            });
            if (matches?.length) {
              restoredPreviews[`char_${i}`] = matches[0].image_data;
            }
          } catch (e) {
            console.warn(`Could not restore portrait for ${c.name}:`, e);
          }
        })
      );
      if (Object.keys(restoredPreviews).length) {
        setPreviews(p => ({ ...p, ...restoredPreviews }));
      }
    };
    restorePortraits();
  }, []);

  const generatePreview = async (key, prompt, description = null) => {
    setLoading(l => ({ ...l, [key]: true }));
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `${prompt}, comic book illustration, bold ink outlines, flat colors, NOT photographic`, width: 256, height: 256 }),
      });
      const d = await res.json();
      if (d.image) {
        setPreviews(p => ({ ...p, [key]: d.image }));

        try {
          const descRes = await fetch("/api/describe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageBase64: d.image }),
          });
          const descData = await descRes.json();
          if (descData.description) {
            if (key === "bg") {
              setData(prev => ({ ...prev, backgroundVisionDesc: descData.description }));
            } else if (key.startsWith("char_")) {
              const idx = parseInt(key.split("_")[1]);
              setData(prev => {
                const chars = [...(prev.characters || [])];
                if (chars[idx]) chars[idx] = { ...chars[idx], visionDescription: descData.description };
                return { ...prev, characters: chars };
              });
            }
          }
        } catch (e) {
          console.warn("LLaVA describe failed:", e);
        }

        if (description) {
          try {
            const embedRes = await fetch("/api/embed", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: description }),
            });
            const embedData = await embedRes.json();
            if (embedData.embedding) {
              await supabase.from("scene_embeddings").insert({
                type: key === "bg" ? "background" : "character",
                description,
                embedding: embedData.embedding,
                image_data: d.image,
                metadata: { prompt, key },
              });
            }
          } catch (e) {
            console.warn("Could not store embedding:", e);
          }
        }
      }
    } catch {}
    setLoading(l => ({ ...l, [key]: false }));
  };

  const updateChar = (i, field, val) => {
    const chars = [...data.characters];
    chars[i] = { ...chars[i], [field]: val };
    setData(d => ({ ...d, characters: chars }));
  };

  const removeChar = (i) => {
    setData(d => ({ ...d, characters: d.characters.filter((_, idx) => idx !== i) }));
  };

  return (
    <div>
      {/* FIX #3: Confirm is step 4 */}
      <StepHeader step={4} total={5} title="CONFIRM SCENE" subtitle="AI extracted this from your passage. Edit anything that's off." />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
        <Card>
          <div style={{ fontFamily: FONTS.display, fontSize: "16px", color: C.ink, marginBottom: "12px" }}>⏰ TIME OF DAY</div>
          <select value={data.timeOfDay} onChange={e => setData(d => ({ ...d, timeOfDay: e.target.value }))}
            style={{ width: "100%", padding: "10px", fontFamily: FONTS.body, fontSize: "14px", border: `3px solid ${C.ink}`, background: "#FFFDF5", color: C.ink }}>
            {["dawn","day","dusk","night","storm"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Card>
        <Card>
          <div style={{ fontFamily: FONTS.display, fontSize: "16px", color: C.ink, marginBottom: "12px" }}>🗺️ TERRAIN</div>
          <select value={data.terrain} onChange={e => setData(d => ({ ...d, terrain: e.target.value }))}
            style={{ width: "100%", padding: "10px", fontFamily: FONTS.body, fontSize: "14px", border: `3px solid ${C.ink}`, background: "#FFFDF5", color: C.ink }}>
            {["city","forest","desert","ocean","space","dungeon","mountain","village"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Card>
      </div>

      <Card style={{ marginBottom: "16px" }}>
        <div style={{ fontFamily: FONTS.display, fontSize: "16px", color: C.ink, marginBottom: "8px" }}>🌆 BACKGROUND</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", alignItems: "start" }}>
          <div>
            <textarea value={data.backgroundDesc} onChange={e => setData(d => ({ ...d, backgroundDesc: e.target.value }))}
              rows={4} placeholder="Describe the background environment..."
              style={{ width: "100%", background: "#FFFDF5", border: `3px solid ${C.ink}`, padding: "10px", fontFamily: FONTS.body, fontSize: "13px", color: C.ink, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
            <Btn onClick={() => generatePreview("bg", `${data.backgroundDesc}, ${data.terrain}, ${data.timeOfDay}, establishing shot, wide angle, comic book illustration`, data.backgroundDesc)} variant="secondary"
              style={{ marginTop: "8px", fontSize: "11px", padding: "6px 12px", opacity: loading["bg"] ? 0.6 : 1 }}>
              {loading["bg"] ? "⟳ GENERATING..." : previews["bg"] ? "↺ REGENERATE" : "🖼 PREVIEW"}
            </Btn>
          </div>
          <div>
            {previews["bg"]
              ? <img src={previews["bg"]} alt="background" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", border: `3px solid ${C.ink}`, display: "block" }} />
              : <div style={{ width: "100%", aspectRatio: "1", background: "#E8E0CC", border: `3px dashed ${C.gray}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONTS.display, fontSize: "14px", color: C.gray }}>NO PREVIEW</div>
            }
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: "16px" }}>
        <div style={{ fontFamily: FONTS.display, fontSize: "16px", color: C.ink, marginBottom: "12px" }}>👥 CHARACTERS FOUND</div>
        {data.characters.map((c, i) => (
          <div key={i} style={{ background: "#F9F5E8", border: `2px solid ${C.ink}`, padding: "12px", marginBottom: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ fontFamily: FONTS.display, fontSize: "16px", color: C.ink }}>{c.name || `Character ${i+1}`}</div>
              <span onClick={() => removeChar(i)} style={{ cursor: "pointer", color: C.danger, fontFamily: FONTS.ui, fontSize: "11px" }}>✕ REMOVE</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <input value={c.name} onChange={e => updateChar(i, "name", e.target.value)} placeholder="Name"
                style={{ padding: "6px 10px", fontFamily: FONTS.body, fontSize: "13px", border: `2px solid ${C.ink}`, background: "#FFFDF5", color: C.ink }} />
              <select value={c.role} onChange={e => updateChar(i, "role", e.target.value)}
                style={{ padding: "6px 10px", fontFamily: FONTS.body, fontSize: "13px", border: `2px solid ${C.ink}`, background: "#FFFDF5", color: C.ink }}>
                {["hero","villain","sidekick","mentor","neutral"].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <input value={c.description} onChange={e => updateChar(i, "description", e.target.value)} placeholder="Appearance"
              style={{ width: "100%", marginTop: "6px", padding: "6px 10px", fontFamily: FONTS.body, fontSize: "13px", border: `2px solid ${C.ink}`, background: "#FFFDF5", color: C.ink, boxSizing: "border-box" }} />
            <input value={c.traits} onChange={e => updateChar(i, "traits", e.target.value)} placeholder="Personality traits"
              style={{ width: "100%", marginTop: "6px", padding: "6px 10px", fontFamily: FONTS.body, fontSize: "13px", border: `2px solid ${C.ink}`, background: "#FFFDF5", color: C.ink, boxSizing: "border-box" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "10px", alignItems: "start" }}>
              <Btn onClick={() => generatePreview(`char_${i}`, `${c.name}, ${c.description}, ${c.role}, portrait, comic book character, bold ink outlines, flat colors`, `${c.name}, ${c.description}, ${c.role}`)} variant="secondary"
                style={{ fontSize: "11px", padding: "6px 12px", opacity: loading[`char_${i}`] ? 0.6 : 1 }}>
                {loading[`char_${i}`] ? "⟳ GENERATING..." : previews[`char_${i}`] ? "↺ REGENERATE" : "🖼 PREVIEW"}
              </Btn>
              <div>
                {previews[`char_${i}`]
                  ? <img src={previews[`char_${i}`]} alt={c.name} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", border: `3px solid ${C.ink}`, display: "block" }} />
                  : <div style={{ width: "100%", aspectRatio: "1", background: "#E8E0CC", border: `3px dashed ${C.gray}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONTS.display, fontSize: "14px", color: C.gray }}>NO PREVIEW</div>
                }
              </div>
            </div>
          </div>
        ))}
        <div onClick={() => setData(d => ({ ...d, characters: [...d.characters, { name: "", description: "", traits: "", role: "hero" }] }))}
          style={{ border: `2px dashed ${C.ink}`, padding: "10px", textAlign: "center", cursor: "pointer", fontFamily: FONTS.display, fontSize: "14px", color: C.gray, letterSpacing: "2px" }}>
          + ADD CHARACTER
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn onClick={onBack} variant="secondary">◀ BACK</Btn>
        <Btn onClick={() => onConfirm(data, previews)} variant="gold" disabled={data.characters.length === 0}>
          LOOKS GOOD ▶
        </Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN: OldStoryScreen
// ─────────────────────────────────────────────
function OldStoryScreen({ user, onSelect, onBack }) {
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("stories")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (!error) setStories(data || []);
      setLoading(false);
    })();
  }, [user.id]);

  return (
    <div>
      <StepHeader step={1} total={5} title="YOUR STORIES" subtitle="Pick a story to continue." />
      {loading && (
        <div style={{ textAlign: "center", fontFamily: FONTS.display, fontSize: "24px", color: C.gold, padding: "40px" }}>
          ⟳ LOADING...
        </div>
      )}
      {!loading && stories.length === 0 && (
        <Card style={{ textAlign: "center", padding: "40px" }}>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>📭</div>
          <div style={{ fontFamily: FONTS.display, fontSize: "24px", color: C.ink }}>NO STORIES YET</div>
          <div style={{ fontFamily: FONTS.body, fontSize: "13px", color: C.gray, marginTop: "8px" }}>Create your first story to see it here.</div>
        </Card>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px", marginBottom: "24px" }}>
        {stories.map(story => (
          <Card key={story.id} style={{ cursor: "pointer", padding: "20px" }} onClick={() => onSelect(story)}>
            <div style={{ fontFamily: FONTS.display, fontSize: "20px", color: C.ink, marginBottom: "6px" }}>{story.title}</div>
            <div style={{ fontFamily: FONTS.ui, fontSize: "11px", color: C.gray, marginBottom: "10px" }}>
              {story.scene?.terrain} · {story.scene?.timeOfDay} · {story.scene?.artStyle}
            </div>
            <div style={{ fontFamily: FONTS.ui, fontSize: "11px", color: C.gray, marginBottom: "10px" }}>
              👥 {story.characters?.length || 0} characters · {story.panels?.length || 0} panels
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontFamily: FONTS.ui, fontSize: "10px", color: story.status === "complete" ? C.success : C.warn }}>
                {story.status === "complete" ? "✓ COMPLETE" : "◌ DRAFT"}
              </div>
              <div style={{ fontFamily: FONTS.ui, fontSize: "10px", color: "#888" }}>
                {new Date(story.updated_at).toLocaleDateString()}
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Btn onClick={onBack} variant="secondary">◀ BACK</Btn>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN: ART STYLE (was "SceneScreen")
// FIX #3: This is now correctly step 2 in the new-story flow
// ─────────────────────────────────────────────
function SceneScreen({ scene, onUpdate, onNext, onBack }) {
  const ready = scene.artStyle;
  return (
    <div>
      {/* FIX #5: Art style is step 2, not step 4 */}
      <StepHeader step={2} total={5} title="CHOOSE ART STYLE" subtitle="Pick the visual style for your comic." />
      <Card style={{ marginBottom: "24px" }}>
        <OptionGrid options={ART_OPTIONS} selected={scene.artStyle} onSelect={v => onUpdate({ artStyle: v })} cols={3} />
      </Card>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn onClick={onBack} variant="secondary">◀ BACK</Btn>
        <Btn onClick={onNext} disabled={!ready} variant="gold">NEXT: DESCRIBE SCENE ▶</Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// FIX #8: getPanelLayout now handles 7 and 8 panels
// ─────────────────────────────────────────────
const PANEL_COLORS = [
  { bg: "#FFF9E6", accent: "#FFD700", shadow: "#B8860B" },
  { bg: "#E8F4FD", accent: "#2196F3", shadow: "#0D47A1" },
  { bg: "#FCE4EC", accent: "#E91E63", shadow: "#880E4F" },
  { bg: "#E8F5E9", accent: "#4CAF50", shadow: "#1B5E20" },
  { bg: "#F3E5F5", accent: "#9C27B0", shadow: "#4A148C" },
  { bg: "#FFF3E0", accent: "#FF5722", shadow: "#BF360C" },
  { bg: "#E0F7FA", accent: "#00BCD4", shadow: "#006064" },
  { bg: "#FBE9E7", accent: "#FF7043", shadow: "#BF360C" },
];

const getPanelLayout = (n) => {
  if (n === 1) return [[0]];
  if (n === 2) return [[0, 1]];
  if (n === 3) return [[0], [1, 2]];
  if (n === 4) return [[0, 1], [2, 3]];
  if (n === 5) return [[0, 1], [2, 3, 4]];
  if (n === 6) return [[0, 1, 2], [3, 4, 5]];
  // FIX #8: Added cases for 7 and 8 panels
  if (n === 7) return [[0, 1, 2], [3, 4], [5, 6]];
  return [[0, 1, 2, 3], [4, 5, 6, 7]]; // 8
};

// ─────────────────────────────────────────────
// SCREEN 5: Comic Studio
// FIX #7: passage and other key props are in useEffect dependency array
// ─────────────────────────────────────────────
function ComicStudio({ scene, characters, config, panelDescriptions, onUpdate, initPanels, imageAgent, translator, creditSystem, passage, currentStoryId, onBack, onReset, comicTitle, setComicTitle, updateStory, confirmedPreviews = {} }) {
  const [title, setTitle] = useState(comicTitle || "");
  const [localPanels, setLocalPanels] = useState([]);
  const [editDesc, setEditDesc] = useState({});
  const [regenerating, setRegenerating] = useState({});
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genLog, setGenLog] = useState([]);
  const [phase, setPhase] = useState("writing");
  const log = (msg) => setGenLog(l => [...l, msg]);

  // FIX #7: useEffect now depends on passage so it runs with correct data
  // Using a ref to prevent double-firing in StrictMode
  const hasStarted = useRef(false);
  useEffect(() => {
    if (hasStarted.current) return;
    if (!passage || !scene.artStyle || characters.length === 0) return;
    hasStarted.current = true;
    autoWriteAndGenerate();
  }, [passage, scene.artStyle, characters.length]);

  const autoWriteAndGenerate = async () => {
    setPhase("writing");
    setAutoGenerating(true);
    setGenLog([]);
    setLocalPanels([]);
    log("✍️ AI writing panel descriptions...");
    try {
      const hasExplicitPanels = /panel\s*\d+|^\*\s|\d+\.\s/im.test(passage || "");

      const systemPrompt = `You are a comic book writer. Output ONLY valid JSON, no markdown.`;

      const userPrompt = hasExplicitPanels
        ? `The user has written a fully scripted scene with explicit panel descriptions.
Your ONLY job is to extract them faithfully into JSON.

STRICT RULES:
1. Use EXACTLY the panels as written — same order, same count.
2. Copy all dialogue word for word, including speaker names.
3. Preserve all locations exactly.
4. Preserve all character names exactly as written.

PASSAGE:
"${passage}"

Characters: ${characters.map(c => `${c.name} (${c.role})`).join(", ")}

Return: { "title": "TITLE IN CAPS", "panelCount": <number>, "panels": ["panel 1 full description", ...] }`

        : `The user has described a scene in general terms. Adapt it into a compelling comic.

CREATIVE RULES:
1. Stay true to the characters, setting, and mood described.
2. Invent natural, in-character dialogue.
3. Choose panel count (2–8) based on scene complexity.
4. Each panel: 1–2 sentences, cinematic camera angle, action + emotion.

PASSAGE:
"${passage}"

Characters: ${characters.map(c => `${c.name} (${c.role}, ${c.description})`).join(", ")}
Setting: ${scene.terrain}, ${scene.timeOfDay}
Art style: ${scene.artStyle}

Return: { "title": "TITLE IN CAPS", "panelCount": <number>, "panels": ["panel 1 description with dialogue if any", ...] }`;

      const raw = await callLLM(systemPrompt, userPrompt, 1400);
      log(hasExplicitPanels ? "📜 Explicit panels detected — following script exactly" : "✨ Scene description detected — AI writing creatively");
      const data = JSON.parse(raw.replace(/```json|```/g, "").trim());
      const newTitle = data.title || "UNTITLED";
      const rawPanels = data.panels || [];

      const newPanels = rawPanels.map(p =>
        typeof p === "string"
          ? { description: p, background: null, characters: [] }
          : p
      );

      setTitle(newTitle);
      setComicTitle(newTitle);
      initPanels(newPanels.length);
      newPanels.forEach((p, i) => onUpdate(i, p.description));
      log(`✅ ${newPanels.length} panels written`);
      setAutoGenerating(false);
      await generateAllPanels(newPanels, newTitle);
    } catch (err) {
      log("⚠️ Auto-write failed: " + err.message);
      setAutoGenerating(false);
      setPhase("done");
    }
  };

  const generateAllPanels = async (panels, t) => {
    const descs = panels.map(p => typeof p === "string" ? p : p.description);
    const panelBgs = panels.map(p => (typeof p === "object" && p.background) ? p.background : null);

    setPhase("generating");
    setGenerating(true);
    const totalCost = descs.length * CREDITS.PANEL;
    if (!creditSystem.canAfford(totalCost)) {
      log(`❌ Need ${totalCost} credits. You have ${creditSystem.credits}.`);
      setGenerating(false);
      setPhase("done");
      return;
    }

    log("📝 Writing dialogue...");
    let dialogueData;
    try {
      const dialogueRaw = await callLLM(
        "You are a comic book writer. Output ONLY valid JSON, no markdown.",
        `Comic: "${t}". Style: ${scene.artStyle}. Setting: ${scene.terrain}, ${scene.timeOfDay}. Characters: ${characters.map(c => c.name).join(", ")}.
Panels: ${descs.map((d, i) => `Panel ${i+1}: ${d}`).join(" | ")}
Return: { "panels": [ { "sfx": "WORD or null", "dialogue": [ { "speaker": "Name or NARRATOR", "text": "...", "type": "speech|thought|shout|narration" } ] } ] }`,
        1200
      );
      dialogueData = JSON.parse(dialogueRaw.replace(/```json|```/g, "").trim());
    } catch {
      dialogueData = { panels: descs.map(() => ({ sfx: null, dialogue: [] })) };
    }
    log("✅ Dialogue written");

    log("🔤 Optimizing prompts...");
    const translatedPrompts = await Promise.all(
      descs.map((desc, i) => translator.translatePanel(
        desc, i, scene, characters, {
          ...config,
          backgroundVisionDesc: panelBgs[i]
            ? panelBgs[i]
            : (config.backgroundVisionDesc || config.backgroundDesc),
        }
      ))
    );
    log("✅ Prompts optimized");

    log(`🎨 Generating ${descs.length} panel images...`);
    const results = await Promise.all(
      translatedPrompts.map(async (prompt, i) => {
        try {
          await creditSystem.deduct(CREDITS.PANEL);

          const panelText = descs[i].toLowerCase();
          const matchedChar = characters.find(c => c.name && panelText.includes(c.name.toLowerCase()));
          let referenceImage = null;

          if (matchedChar) {
            const matchedCharIdx = characters.indexOf(matchedChar);
            if (confirmedPreviews[`char_${matchedCharIdx}`]) {
              referenceImage = await resizeBase64(confirmedPreviews[`char_${matchedCharIdx}`], 256);
              log(`↩ Using session portrait for ${matchedChar.name}`);
            } else {
              try {
                const embedRes = await fetch("/api/embed", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ text: `${matchedChar.name}, ${matchedChar.role}, ${matchedChar.description}` }),
                });
                const embedData = await embedRes.json();
                if (embedData.embedding) {
                  const { data: matches } = await supabase.rpc("match_scene_embeddings", {
                    query_embedding: embedData.embedding,
                    match_threshold: 0.75,
                    match_count: 1,
                  });
                  if (matches?.length) {
                    referenceImage = await resizeBase64(matches[0].image_data, 256);
                    confirmedPreviews[`char_${matchedCharIdx}`] = matches[0].image_data;
                    log(`↩ Restored portrait for ${matchedChar.name} from DB`);
                  }
                }
              } catch (e) {
                console.warn("Character registry lookup failed:", e);
              }
            }
          } else if (confirmedPreviews["bg"]) {
            referenceImage = await resizeBase64(confirmedPreviews["bg"], 256);
          }

          const res = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, width: 768, height: 512, referenceImage, strength: 0.65 }),
          });
          const d = await res.json();

          try {
            const embedRes = await fetch("/api/embed", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: descs[i] }),
            });
            const embedData = await embedRes.json();
            if (d.image && embedData.embedding) {
              await supabase.from("scene_embeddings").insert({
                story_id: currentStoryId,
                type: "panel",
                description: descs[i],
                embedding: embedData.embedding,
                image_data: d.image,
                metadata: { prompt },
              });
            }
          } catch (e) {
            console.warn("Vector store failed:", e);
          }

          log(`✅ Panel ${i + 1} done (-${CREDITS.PANEL}cr)`);
          return { type: "url", value: d.image };
        } catch (err) {
          log(`⚠️ Panel ${i + 1} failed`);
          return { type: "svg", value: null };
        }
      })
    );

    const builtPanels = descs.map((desc, i) => ({
      description: desc,
      imageResult: results[i],
      optimizedPrompt: translatedPrompts[i],
      sfx: dialogueData.panels?.[i]?.sfx || null,
      dialogue: dialogueData.panels?.[i]?.dialogue || [],
    }));

    setLocalPanels(builtPanels);
    setGenerating(false);
    setPhase("done");
    log("🎉 Comic complete!");

    if (currentStoryId) {
      const panelsToSave = builtPanels.map(p => ({
        description: p.description,
        sfx: p.sfx,
        dialogue: p.dialogue,
        optimizedPrompt: p.optimizedPrompt,
      }));
      await updateStory(currentStoryId, {
        title: t,
        panels: panelsToSave,
        status: "complete",
      });
    }
  };

  const regeneratePanel = async (i) => {
    setRegenerating(r => ({ ...r, [i]: true }));
    try {
      const desc = editDesc[i] ?? localPanels[i].description;
      const prompt = await translator.translatePanel(desc, i, scene, characters, config);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, width: 768, height: 512 }),
      });
      const d = await res.json();
      setLocalPanels(p => p.map((panel, idx) =>
        idx === i ? { ...panel, description: desc, imageResult: { type: "url", value: d.image } } : panel
      ));
    } catch (err) {
      console.error("Regen failed:", err);
    }
    setRegenerating(r => ({ ...r, [i]: false }));
  };

  const addPanel = () => {
    const newLen = localPanels.length + 1;
    initPanels(newLen);
    onUpdate(newLen - 1, "");
    setLocalPanels(p => [...p, { description: "", imageResult: null, sfx: null, dialogue: [] }]);
  };

  const removePanel = (idx) => {
    const updated = localPanels.filter((_, i) => i !== idx);
    setLocalPanels(updated);
    initPanels(updated.length);
    updated.forEach((p, i) => onUpdate(i, p.description));
  };

  if (phase === "writing" || (phase === "generating" && !localPanels.length)) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
        <div style={{ fontFamily: FONTS.display, fontSize: "clamp(24px,4vw,40px)", color: C.gold, letterSpacing: "4px", marginBottom: "24px", animation: "pulse 1.5s infinite", textAlign: "center" }}>
          {phase === "writing" ? "✍️ WRITING YOUR STORY..." : "⚡ GENERATING COMIC..."}
        </div>
        <Card style={{ width: "100%", maxWidth: "500px", background: "#111", border: `3px solid ${C.gold}` }}>
          <div style={{ fontFamily: FONTS.ui, fontSize: "11px", color: C.gold, letterSpacing: "2px", marginBottom: "12px" }}>◆ AGENT LOG &nbsp;|&nbsp; ⚡ {creditSystem.credits} CREDITS</div>
          {genLog.map((msg, i) => (
            <div key={i} style={{ fontFamily: FONTS.ui, fontSize: "12px", color: i === genLog.length - 1 ? C.gold : "#666", marginBottom: "6px", borderLeft: `2px solid ${i === genLog.length - 1 ? C.gold : "#333"}`, paddingLeft: "10px" }}>{msg}</div>
          ))}
        </Card>
      </div>
    );
  }

  return (
    <div>
      <style>{`@keyframes comicIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}`}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <h1 style={{ fontFamily: FONTS.display, fontSize: "clamp(20px,3vw,36px)", color: C.gold, margin: 0, letterSpacing: "4px" }}>{title}</h1>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <CreditBadge credits={creditSystem.credits} />
          <Btn onClick={() => { hasStarted.current = false; autoWriteAndGenerate(); }} disabled={autoGenerating || generating} variant="secondary" small>↺ REGENERATE ALL</Btn>
          <Btn onClick={onBack} variant="secondary" small>◀ BACK</Btn>
          <Btn onClick={onReset} variant="secondary" small>🔄 NEW COMIC</Btn>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: "20px", alignItems: "start" }}>

        {/* LEFT — Panel editor */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontFamily: FONTS.display, fontSize: "13px", color: C.gold, letterSpacing: "2px" }}>✏️ EDIT PANELS</div>
          {localPanels.map((panel, i) => (
            <Card key={i} style={{ padding: "12px", background: "#1a1a1a", border: `2px solid ${regenerating[i] ? C.gold : "#333"}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <div style={{ width: "20px", height: "20px", background: C.ink, color: C.gold, fontFamily: FONTS.display, fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", border: `2px solid ${C.gold}` }}>{i + 1}</div>
                  <span style={{ fontFamily: FONTS.display, fontSize: "12px", color: C.paper, letterSpacing: "1px" }}>PANEL {i + 1}</span>
                </div>
                {localPanels.length > 1 && (
                  <span onClick={() => removePanel(i)} style={{ cursor: "pointer", color: C.danger, fontFamily: FONTS.ui, fontSize: "10px" }}>✕</span>
                )}
              </div>
              <textarea
                value={editDesc[i] ?? panel.description}
                onChange={e => setEditDesc(d => ({ ...d, [i]: e.target.value }))}
                rows={5}
                style={{ width: "100%", background: "#111", border: `2px solid #444`, padding: "6px", fontFamily: FONTS.body, fontSize: "11px", color: C.paper, outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.5 }}
              />
              <Btn onClick={() => regeneratePanel(i)} disabled={regenerating[i]} variant="secondary" small style={{ marginTop: "6px", width: "100%", fontSize: "10px" }}>
                {regenerating[i] ? "⟳ REGENERATING..." : "↺ REGENERATE"}
              </Btn>
            </Card>
          ))}

          {localPanels.length < 8 && (
            <div onClick={addPanel} style={{ border: `2px dashed #444`, display: "flex", alignItems: "center", justifyContent: "center", padding: "14px", cursor: "pointer", color: "#555", fontFamily: FONTS.display, fontSize: "12px", letterSpacing: "2px", transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.color = C.gold; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.color = "#555"; }}>
              + ADD PANEL
            </div>
          )}
        </div>

        {/* RIGHT — Comic page */}
        <div style={{ background: "#F5EDD6", border: `6px solid ${C.ink}`, padding: "24px", minWidth: "700px", boxShadow: `10px 10px 0 #333`, animation: "comicIn 0.5s ease-out" }}>
          <div style={{ textAlign: "center", borderBottom: `4px solid ${C.ink}`, paddingBottom: "14px", marginBottom: "16px" }}>
            <h2 style={{ fontFamily: FONTS.display, fontSize: "clamp(20px,4vw,40px)", color: C.red, margin: 0, letterSpacing: "5px", textShadow: `3px 3px 0 ${C.gold}, 5px 5px 0 ${C.ink}`, textTransform: "uppercase" }}>{title}</h2>
            <div style={{ fontFamily: FONTS.ui, fontSize: "11px", color: "#888", marginTop: "4px", letterSpacing: "3px" }}>◆ {scene.artStyle?.toUpperCase()} · {scene.terrain?.toUpperCase()} · {scene.timeOfDay?.toUpperCase()} ◆</div>
          </div>

          {generating && (
            <div style={{ textAlign: "center", padding: "20px", fontFamily: FONTS.display, fontSize: "16px", color: C.gold }}>
              <style>{`@keyframes pulse2{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
              <div style={{ animation: "pulse2 1s infinite" }}>⚡ GENERATING IMAGES...</div>
            </div>
          )}

          {(() => {
            const rows = getPanelLayout(Math.min(localPanels.length, 8)); // FIX #8: up to 8
            return rows.map((row, rowIdx) => (
              <div key={rowIdx} style={{ display: "grid", gridTemplateColumns: `repeat(${row.length}, 1fr)`, gap: "10px", marginBottom: "10px" }}>
                {row.map((panelIdx) => {
                  const panel = localPanels[panelIdx];
                  if (!panel) return null;
                  const i = panelIdx;
                  const col = PANEL_COLORS[i % PANEL_COLORS.length];
                  const minHeight = row.length === 1 ? "480px" : row.length === 2 ? "380px" : "300px";
                  return (
                    <div key={i} style={{ background: col.bg, border: `4px solid ${regenerating[i] ? C.gold : C.ink}`, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: `5px 5px 0 ${col.shadow}`, position: "relative", transition: "border 0.3s", minHeight }}>
                      <div style={{ position: "absolute", inset: 0, backgroundImage: `radial-gradient(circle, ${col.accent}15 1px, transparent 1px)`, backgroundSize: "10px 10px", pointerEvents: "none", zIndex: 1 }} />
                      <div style={{ position: "absolute", top: "6px", left: "6px", background: C.ink, color: col.accent, fontFamily: FONTS.display, fontSize: "14px", width: "22px", height: "22px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, border: `2px solid ${col.accent}` }}>{i + 1}</div>
                      {panel.sfx && <div style={{ position: "absolute", top: "26px", right: "4px", fontFamily: FONTS.display, fontSize: "16px", color: col.shadow, transform: "rotate(10deg)", textShadow: `2px 2px 0 ${col.accent}`, zIndex: 10 }}>{panel.sfx}</div>}
                      {regenerating[i] && (
                        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }}>
                          <div style={{ fontFamily: FONTS.display, fontSize: "14px", color: C.gold, animation: "pulse 1s infinite" }}>⟳</div>
                        </div>
                      )}
                      <div style={{ padding: "28px 6px 4px", zIndex: 2, flex: 1 }}>
                        <ComicImage result={panel.imageResult} alt={`Panel ${i+1}`} style={{ width: "100%", minHeight: "220px", border: `2px solid ${col.accent}` }} />
                      </div>
                      <div style={{ padding: "4px 8px 10px", zIndex: 2, display: "flex", flexDirection: "column", gap: "3px" }}>
                        {panel.dialogue?.map((d, j) => (
                          <div key={j}>
                            {d.speaker && d.type !== "narration" && <div style={{ fontFamily: FONTS.display, fontSize: "9px", color: col.shadow, paddingLeft: "6px", textTransform: "uppercase", letterSpacing: "1px" }}>{d.speaker}:</div>}
                            <SpeechBubble text={d.text} type={d.type || "speech"} />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ));
          })()}
          <div style={{ textAlign: "center", marginTop: "14px", paddingTop: "10px", borderTop: `3px solid ${C.ink}`, fontFamily: FONTS.display, fontSize: "14px", color: "#888", letterSpacing: "4px" }}>★ TO BE CONTINUED... ★</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function ComicSmith() {
  const [step, setStep] = useState("login");
  const [comicTitle, setComicTitle] = useState("");
  const puterMode = usePuter();
  const ctx = useContextAgent();
  // FIX #6: pass ctx.user?.credits as initialCredits so returning users keep their balance
  const creditSystem = useCreditSystem(ctx.user?.username, ctx.user?.credits ?? null);
  const translator = useTranslatorAgent();
  const [extractedScene, setExtractedScene] = useState(null);
  const [currentStoryId, setCurrentStoryId] = useState(null);
  const [confirmedPreviews, setConfirmedPreviews] = useState({});
  const [isOldStory, setIsOldStory] = useState(false);
  const img = useImageAgent(translator, creditSystem, puterMode, currentStoryId);

  const saveStory = async (storyData) => {
    if (!ctx.user?.id) return null;
    const { data, error } = await supabase.from("stories").insert({
      user_id: ctx.user.id,
      title: storyData.title || "Untitled",
      passage: storyData.passage,
      scene: storyData.scene,
      characters: storyData.characters,
      config: storyData.config,
      status: "draft",
    }).select().single();
    if (error) console.error("Save story error:", error);
    return data;
  };

  const updateStory = async (storyId, updates) => {
    if (!storyId) return;
    await supabase.from("stories").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", storyId);
  };

  return (
    <div style={{ minHeight: "100vh", background: step === "login" ? C.ink : "#1C0E00", backgroundImage: step !== "login" ? `repeating-linear-gradient(0deg,transparent,transparent 59px,#2a1500 59px,#2a1500 60px),repeating-linear-gradient(90deg,transparent,transparent 59px,#2a1500 59px,#2a1500 60px)` : undefined, padding: step === "login" ? "0" : "28px 20px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Special+Elite&display=swap" rel="stylesheet" />

      {step === "login" && (
        <LoginScreen
          onLogin={(u) => {
            ctx.login(u);
            setStep(u.trialExpired ? "expired" : "story-choice");
          }}
          puterMode={puterMode}
        />
      )}

      {step === "expired" && (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.ink }}>
          <div style={{ textAlign: "center", padding: "40px", maxWidth: "480px" }}>
            <div style={{ fontSize: "64px", marginBottom: "16px" }}>⏰</div>
            <div style={{ fontFamily: FONTS.display, fontSize: "48px", color: C.gold, letterSpacing: "4px", marginBottom: "8px" }}>TRIAL ENDED</div>
            <div style={{ fontFamily: FONTS.body, fontSize: "16px", color: C.paper, lineHeight: 1.8, marginBottom: "32px" }}>
              Your 7-day free trial has expired.<br/>Check back soon for updates!
            </div>
            <div style={{ fontFamily: FONTS.ui, fontSize: "12px", color: "#666", letterSpacing: "2px" }}>— COMICSMITH BETA —</div>
            <div onClick={() => { supabase.auth.signOut(); setStep("login"); }}
              style={{ marginTop: "32px", fontFamily: FONTS.ui, fontSize: "11px", color: "#444", cursor: "pointer", textDecoration: "underline" }}>
              Sign out
            </div>
          </div>
        </div>
      )}

      {step !== "login" && step !== "expired" && (
        <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
          {/* Top bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px", flexWrap: "wrap", gap: "12px" }}>
            <div style={{ fontFamily: FONTS.display, fontSize: "26px", color: C.gold, letterSpacing: "4px", textShadow: `2px 2px 0 ${C.ink}` }}>COMICSMITH</div>
            <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
              <CreditBadge credits={creditSystem.credits} />
              <div style={{ fontFamily: FONTS.ui, fontSize: "11px", color: C.lightGray }}>👤 {ctx.user?.username}</div>
            </div>
          </div>

          {step === "story-choice" && (
            <StoryChoiceScreen
              onNewStory={() => setStep("style")}
              onOldStory={() => setStep("old-story")}
            />
          )}

          {step === "old-story" && (
            <OldStoryScreen
              user={ctx.user}
              onBack={() => setStep("story-choice")}
              onSelect={(story) => {
                if (story.scene) ctx.updateScene(story.scene);
                if (story.config) ctx.updateConfig(story.config);
                setCurrentStoryId(story.id);
                setIsOldStory(true);
                setStep("passage");
              }}
            />
          )}

          {/* FIX #3/#5: art style is step 2, comes before passage */}
          {step === "style" && (
            <SceneScreen
              scene={ctx.scene}
              onUpdate={ctx.updateScene}
              onBack={() => setStep("story-choice")}
              onNext={() => setStep("passage")}
            />
          )}

          {step === "passage" && (
            <ScenePassageScreen
              onBack={() => isOldStory ? setStep("old-story") : setStep("style")}
              onNext={({ passage, extracted }) => {
                // FIX #4: store passage alongside extracted data
                setExtractedScene({ ...extracted, passage });
                setStep("confirm");
              }}
            />
          )}

          {step === "confirm" && extractedScene && (
            <SceneConfirmScreen
              extracted={extractedScene}
              onBack={() => setStep("passage")}
              onConfirm={async (data, previews) => {
                ctx.updateScene({ timeOfDay: data.timeOfDay, terrain: data.terrain });
                ctx.updateConfig({
                  hasBackground: data.hasBackground,
                  backgroundDesc: data.backgroundDesc,
                  backgroundVisionDesc: data.backgroundVisionDesc || data.backgroundDesc,
                });
                data.characters.forEach(c => ctx.addCharacter(c));

                const story = await saveStory({
                  passage: extractedScene.passage,
                  scene: { ...ctx.scene, timeOfDay: data.timeOfDay, terrain: data.terrain },
                  characters: data.characters,
                  config: ctx.config,
                });
                if (story) setCurrentStoryId(story.id);
                setConfirmedPreviews(previews || {});
                setStep("studio");
              }}
            />
          )}

          {step === "studio" && (
            <ComicStudio
              scene={ctx.scene}
              characters={ctx.characters}
              config={ctx.config}
              panelDescriptions={ctx.panelDescriptions}
              onUpdate={ctx.updatePanelDesc}
              initPanels={ctx.initPanels}
              imageAgent={img}
              translator={translator}
              creditSystem={creditSystem}
              // FIX #7: passage is now reliably passed from extractedScene
              passage={extractedScene?.passage}
              currentStoryId={currentStoryId}
              onBack={() => setStep("confirm")}
              onReset={() => {
                setStep("story-choice");
                setExtractedScene(null);
                setCurrentStoryId(null);
                setConfirmedPreviews({});
                setIsOldStory(false);
                setComicTitle("");
              }}
              comicTitle={comicTitle}
              setComicTitle={setComicTitle}
              updateStory={updateStory}
              confirmedPreviews={confirmedPreviews}
            />
          )}
        </div>
      )}
    </div>
  );
}
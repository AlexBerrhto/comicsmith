import io
import os
import re
import json
import sqlite3
import textwrap
import requests
from datetime import datetime, timezone
from PIL import Image, ImageDraw, ImageFont
from dotenv import load_dotenv

# Load .env from the project root (one level up from src/)
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))

# -------------------------
# CONFIG
# -------------------------

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
API_TOKEN  = os.environ.get("CLOUDFLARE_API_TOKEN", "")

if not ACCOUNT_ID or not API_TOKEN:
    raise RuntimeError(
        "Missing Cloudflare credentials.\n"
        "Ensure your .env file contains CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN."
    )

LLM_MODEL    = "@cf/meta/llama-3-8b-instruct"
IMAGE_MODEL  = "@cf/stabilityai/stable-diffusion-xl-base-1.0"
VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, "characters.db")


# -------------------------
# STYLE REGISTRY
# -------------------------
# Each style defines:
#   genre       - used in LLM prompts for story/dialogue
#   image_tags  - appended to every image generation prompt
#   char_tags   - extra tags specific to character images
#   bg_tags     - extra tags specific to background images
#   default_bg  - fallback background description if scene has none

STYLES = {
    "cyberpunk": {
        "genre":       "cyberpunk",
        "image_tags":  "dramatic cinematic lighting, neon colors, comic book style",
        "char_tags":   "white background, full body, cyberpunk aesthetic",
        "bg_tags":     "neon lights, rain-soaked streets, futuristic city",
        "default_bg":  "cyberpunk city at night",
    },
    "manga": {
        "genre":       "manga",
        "image_tags":  "black and white, high contrast ink, manga style, screen tone shading",
        "char_tags":   "white background, full body, manga line art",
        "bg_tags":     "detailed ink background, manga panel background",
        "default_bg":  "Japanese street at dusk",
    },
    "noir": {
        "genre":       "noir detective",
        "image_tags":  "black and white, heavy shadows, film noir, 1940s style, high contrast",
        "char_tags":   "white background, full body, noir aesthetic, trench coat era",
        "bg_tags":     "rainy alley, dimly lit, fog, vintage city",
        "default_bg":  "rain-soaked city alley at night",
    },
    "superhero": {
        "genre":       "superhero comic",
        "image_tags":  "bold colors, dynamic pose, Marvel/DC comic style, cel shading",
        "char_tags":   "white background, full body, superhero costume, action pose",
        "bg_tags":     "city skyline, dramatic sky, action scene",
        "default_bg":  "modern city skyline at dusk",
    },
    "fantasy": {
        "genre":       "fantasy",
        "image_tags":  "painterly, epic fantasy, magical lighting, detailed illustration",
        "char_tags":   "white background, full body, fantasy armor or robes",
        "bg_tags":     "enchanted forest, ancient castle, mystical atmosphere",
        "default_bg":  "enchanted forest clearing",
    },
    "horror": {
        "genre":       "horror",
        "image_tags":  "dark, eerie, unsettling, horror comic style, desaturated colors",
        "char_tags":   "white background, full body, horror aesthetic",
        "bg_tags":     "dark shadows, abandoned building, moonlight, creepy atmosphere",
        "default_bg":  "abandoned house at midnight",
    },
    "western": {
        "genre":       "western",
        "image_tags":  "dusty, sun-bleached colors, western comic style, gritty",
        "char_tags":   "white background, full body, cowboy or frontier clothing",
        "bg_tags":     "desert landscape, saloon, dusty town, golden hour",
        "default_bg":  "dusty frontier town at high noon",
    },
}

DEFAULT_STYLE = "cyberpunk"

def get_style(style_name):
    """Return style dict, falling back to cyberpunk if unknown."""
    s = STYLES.get(style_name.lower() if style_name else DEFAULT_STYLE)
    if not s:
        print(f"  Unknown style '{style_name}' — falling back to cyberpunk.")
        return STYLES[DEFAULT_STYLE]
    return s


# -------------------------
# DATABASE
# -------------------------

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS characters (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            name               TEXT UNIQUE NOT NULL,
            llm_description    TEXT,
            vision_description TEXT,
            image_path         TEXT,
            created_at         TEXT
        )
    """)
    init_background_table(conn)
    conn.commit()
    conn.close()


def lookup_character(name):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT * FROM characters WHERE LOWER(name) = LOWER(?)", (name,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def save_character(name, llm_description, vision_description, image_path):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        INSERT INTO characters (name, llm_description, vision_description, image_path, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            llm_description    = excluded.llm_description,
            vision_description = excluded.vision_description,
            image_path         = excluded.image_path,
            created_at         = excluded.created_at
    """, (name, llm_description, vision_description, image_path, datetime.now(timezone.utc).isoformat()))
    conn.commit()
    conn.close()
    print(f"  Saved '{name}' to DB.")


# -------------------------
# BACKGROUND DB
# -------------------------

# -------------------------
# EMBEDDING HELPERS
# -------------------------

EMBED_MODEL       = "@cf/baai/bge-base-en-v1.5"
SIMILARITY_THRESHOLD = 0.60   # tune: lower = more reuse, higher = stricter match


def embed_text(text):
    """Call Cloudflare embedding API. Returns a list of floats or None."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{EMBED_MODEL}"
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"},
        json={"text": [text]}
    )
    if response.status_code != 200:
        print(f"  Embedding error {response.status_code}: {response.text[:200]}")
        return None
    try:
        data = response.json()
        result = data.get("result", {})
        # Cloudflare BGE returns either result.data[0] or result.embeddings[0]
        vec = (
            result.get("data", [None])[0]
            or result.get("embeddings", [None])[0]
        )
        if not vec:
            print(f"  Embedding: unexpected response shape: {str(data)[:200]}")
            return None
        return vec
    except Exception as e:
        print(f"  Embedding parse error: {e}")
        return None


def cosine_similarity(a, b):
    """Cosine similarity between two equal-length float lists."""
    dot   = sum(x * y for x, y in zip(a, b))
    mag_a = sum(x * x for x in a) ** 0.5
    mag_b = sum(x * x for x in b) ** 0.5
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def vec_to_blob(vec):
    """Serialize a float list to bytes for SQLite storage."""
    import struct
    return struct.pack(f"{len(vec)}f", *vec)


def blob_to_vec(blob):
    """Deserialize bytes from SQLite back to a float list."""
    import struct
    n = len(blob) // 4
    return list(struct.unpack(f"{n}f", blob))


# -------------------------
# BACKGROUND DB (VECTOR)
# -------------------------

def init_background_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS backgrounds (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            name               TEXT UNIQUE NOT NULL,
            llm_description    TEXT,
            vision_description TEXT,
            image_path         TEXT,
            embedding          BLOB,
            created_at         TEXT
        )
    """)
    # Migration: add embedding column if the table already existed without it
    existing_cols = [row[1] for row in conn.execute("PRAGMA table_info(backgrounds)").fetchall()]
    if "embedding" not in existing_cols:
        conn.execute("ALTER TABLE backgrounds ADD COLUMN embedding BLOB")
        print("  Migrated backgrounds table: added embedding column.")


def find_similar_background(query_vec, threshold=SIMILARITY_THRESHOLD):
    """
    Search all stored background embeddings for the closest match.
    Returns the best-matching row dict if similarity >= threshold, else None.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM backgrounds WHERE embedding IS NOT NULL"
    ).fetchall()
    conn.close()

    best_row  = None
    best_score = 0.0
    for row in rows:
        vec   = blob_to_vec(row["embedding"])
        score = cosine_similarity(query_vec, vec)
        if score > best_score:
            best_score = score
            best_row   = row

    if best_row and best_score >= threshold:
        print(f"  ✓ Matched background '{best_row['name']}' (similarity {best_score:.3f})")
        return dict(best_row)

    if best_row:
        print(f"  ✗ Closest background '{best_row['name']}' score {best_score:.3f} < threshold {threshold} — generating new")
    return None


def save_background(name, llm_description, vision_description, image_path, embedding=None):
    blob = vec_to_blob(embedding) if embedding else None
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        INSERT INTO backgrounds (name, llm_description, vision_description, image_path, embedding, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            llm_description    = excluded.llm_description,
            vision_description = excluded.vision_description,
            image_path         = excluded.image_path,
            embedding          = excluded.embedding,
            created_at         = excluded.created_at
    """, (name, llm_description, vision_description, image_path, blob,
          datetime.now(timezone.utc).isoformat()))
    conn.commit()
    conn.close()
    print(f"  Saved background '{name}' to DB.")


def generate_background_image(description, style):
    """Generate a background image. Returns raw bytes or None — no disk write."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{IMAGE_MODEL}"
    s   = get_style(style)
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {API_TOKEN}"},
        json={"prompt": f"{s['genre']} comic background, no characters, {description}, {s['image_tags']}, {s['bg_tags']}"}
    )
    if response.status_code != 200:
        print(f"  Background image error {response.status_code}: {response.text[:200]}")
        return None
    content_type = response.headers.get("Content-Type", "")
    if "image" not in content_type and len(response.content) <= 1000:
        print(f"  Background non-image response: {response.text[:200]}")
        return None
    print(f"  Background image generated ({len(response.content)} bytes)")
    return response.content  # raw bytes, not saved to disk


def describe_background_with_vision(image_bytes):
    """Use LLaVA to describe background image. Accepts raw bytes — no file path needed."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{VISION_MODEL}"
    image_byte_list = list(image_bytes)
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"},
        json={
            "image": image_byte_list,
            "prompt": (
                "Describe this comic book background scene for use in image generation prompts. "
                "Include: lighting, colors, architectural details, atmosphere, weather, time of day. "
                "No characters. Be specific and concise."
            ),
            "max_tokens": 512
        }
    )
    if response.status_code != 200:
        print(f"  Vision error {response.status_code}: {response.text[:200]}")
        return ""
    try:
        return response.json().get("result", {}).get("description", "")
    except Exception as e:
        print(f"  Vision parse error: {e}")
        return ""


def resolve_background(raw_description, style=DEFAULT_STYLE):
    """
    Semantic lookup: embed the description, find a similar stored background.
    If none found above threshold, generate a new one and store with its embedding.
    Returns a background row dict.
    """
    if not raw_description:
        return None

    print(f"\n  Resolving background: '{raw_description[:60]}'")

    # Embed the incoming description
    query_vec = embed_text(raw_description)

    if query_vec:
        match = find_similar_background(query_vec)
        if match:
            return match
    else:
        print("  Embedding failed — falling back to exact name lookup")
        # Fallback: exact slug match
        slug = re.sub(r"\s+", "_", raw_description.lower().strip())[:80]
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        row  = conn.execute("SELECT * FROM backgrounds WHERE name = ?", (slug,)).fetchone()
        conn.close()
        if row:
            return dict(row)

    # Nothing found — generate new background
    print(f"  Generating new background...")
    slug = re.sub(r"[^\w\s]", "", raw_description.lower())
    slug = re.sub(r"\s+", "_", slug.strip())[:60]

    llm_description = call_llm(f"""
Describe this comic book background in 3-4 visual sentences for image generation.
Setting: {raw_description}
Include: lighting, colors, time of day, weather, architectural details. No characters.
""") or raw_description

    image_bytes      = generate_background_image(llm_description, style)
    vision_description = ""
    if image_bytes:
        print("  Running LLaVA on background image...")
        vision_description = describe_background_with_vision(image_bytes) or llm_description
    else:
        vision_description = llm_description

    # Embed the final vision description for future similarity lookups
    final_text = vision_description or llm_description
    embedding  = embed_text(final_text)

    # image_path is empty — backgrounds are not saved to disk
    save_background(slug, llm_description, vision_description, "", embedding)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row  = conn.execute("SELECT * FROM backgrounds WHERE name = ?", (slug,)).fetchone()
    conn.close()
    return dict(row) if row else None


    # LLM expands the raw description into a rich visual prompt
    llm_description = call_llm(f"""
Describe the following comic book background setting in 3-4 visual sentences for image generation.
Setting: {raw_description}
Include: lighting, colors, time of day, weather, architectural or environmental details.
No characters. Be specific and visual.
""") or raw_description

    image_path = generate_background_image(name, llm_description)
    if not image_path:
        # Still save what we have so we don't retry on every run
        save_background(name, llm_description, llm_description, "")
        return lookup_background(name)

    print("  Running LLaVA on background image...")
    vision_description = describe_background_with_vision(image_path) or llm_description

    save_background(name, llm_description, vision_description, image_path)
    return lookup_background(name)


# -------------------------
# LLM
# -------------------------

def call_llm(prompt, max_tokens=1024):
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{LLM_MODEL}"
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"},
        json={
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens
        }
    )
    if response.status_code != 200:
        print(f"LLM error {response.status_code}: {response.text[:200]}")
        return ""
    try:
        return response.json()["result"]["response"].strip()
    except Exception as e:
        print(f"LLM parse error: {e}")
        return ""


def call_llm_json(prompt):
    """Call LLM with a high token limit and parse the response as JSON."""
    raw = call_llm(prompt, max_tokens=2048)
    if not raw:
        return None

    # Strip markdown fences if present
    clean = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()

    # Extract JSON by finding outermost { } — handles prose preambles and postambles
    start = clean.find("{")
    end   = clean.rfind("}")
    if start != -1 and end != -1 and end > start:
        clean = clean[start:end + 1]

    try:
        return json.loads(clean)
    except Exception as e:
        print(f"JSON parse error: {e}\nRaw response:\n{raw[:400]}")
        return None


# -------------------------
# VISION (LLaVA)
# -------------------------

def describe_image_with_vision(image_path):
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{VISION_MODEL}"
    with open(image_path, "rb") as f:
        image_bytes = list(f.read())

    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"},
        json={
            "image": image_bytes,
            "prompt": (
                "Describe this comic character for use in image generation prompts. "
                "Include: hair color and style, eye color, skin tone, exact clothing items and colors, "
                "cybernetic or mechanical parts and their locations on the body, "
                "accessories, and any distinguishing visual features. Be specific and concise."
            ),
            "max_tokens": 512
        }
    )
    if response.status_code != 200:
        print(f"Vision error {response.status_code}: {response.text[:200]}")
        return ""
    try:
        return response.json().get("result", {}).get("description", "")
    except Exception as e:
        print(f"Vision parse error: {e}")
        return ""


# -------------------------
# CHARACTER IMAGE GENERATION
# -------------------------

def generate_character_image(name, description, style):
    s   = get_style(style)
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{IMAGE_MODEL}"
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {API_TOKEN}"},
        json={"prompt": f"{s['genre']} comic character, {description}, {s['char_tags']}, {s['image_tags']}"}
    )
    if response.status_code != 200:
        print(f"Image gen error {response.status_code}: {response.text[:200]}")
        return None
    content_type = response.headers.get("Content-Type", "")
    if "image" not in content_type and len(response.content) <= 1000:
        print(f"Image gen returned non-image: {response.text[:200]}")
        return None
    safe_name  = name.lower().replace(" ", "_")
    image_path = os.path.join(BASE_DIR, f"character_{safe_name}.png")
    with open(image_path, "wb") as f:
        f.write(response.content)
    print(f"  Character image saved: {image_path}")
    return image_path



# -------------------------
# CHARACTER CREATION
# -------------------------

def create_character(name, hint="", style=DEFAULT_STYLE):
    """
    Generate a brand-new character named `name`.
    `hint` is any description from the scene to guide the LLM.
    """
    print(f"  Creating new character: '{name}'")

    llm_description = call_llm(f"""
Create a {get_style(style)['genre']} comic character named {name}.
{f"Scene context: {hint}" if hint else ""}
Describe their appearance, clothing, and cybernetic elements in 3-4 visual sentences.
Be specific: exact colors, materials, and body locations of implants or gear.
""")
    if not llm_description:
        return None

    print(f"  LLM description: {llm_description[:120]}...")

    image_path = generate_character_image(name, llm_description, style)
    if not image_path:
        return None

    print("  Running LLaVA on character image...")
    vision_description = describe_image_with_vision(image_path) or llm_description

    save_character(name, llm_description, vision_description, image_path)
    return lookup_character(name)


def force_regenerate_character(name, style=DEFAULT_STYLE):
    """Delete existing character from DB and recreate from scratch."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM characters WHERE LOWER(name) = LOWER(?)", (name,))
    conn.commit()
    conn.close()
    print(f"  Deleted '{name}' from DB — regenerating...")
    return create_character(name, style=style)


def force_regenerate_background(raw_description, style=DEFAULT_STYLE):
    """Delete existing background from DB and recreate from scratch."""
    slug = re.sub(r"[^\w\s]", "", raw_description.lower())
    slug = re.sub(r"\s+", "_", slug.strip())[:60]

    # Also delete any semantically similar entry that would be matched
    query_vec = embed_text(raw_description)
    if query_vec:
        match = find_similar_background(query_vec, threshold=SIMILARITY_THRESHOLD)
        if match:
            slug = match["name"]  # delete the actual matched entry

    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM backgrounds WHERE name = ?", (slug,))
    conn.commit()
    conn.close()
    print(f"  Deleted background '{slug}' from DB — regenerating...")
    return resolve_background(raw_description, style=style)


# -------------------------
# SCENE ANALYSIS
# -------------------------

def normalise_scene(text):
    """
    Clean up scene text before sending to the LLM.
    - Replaces underscores with spaces (handles slug-style location names)
    - Collapses multiple spaces
    - Strips leading/trailing whitespace
    """
    import re
    text = text.replace("_", " ")
    text = re.sub(r" {2,}", " ", text)
    return text.strip()


def analyse_scene(scene_text, style=DEFAULT_STYLE):
    """
    Ask the LLM to extract structured info from the user's scene:
      - characters: list of {name, description_hint}
      - background: visual setting description
      - panels: list of {visual, characters, dialogue} — count decided by LLM (1-6)
    Returns a dict or None.
    """
    prompt = f"""
You are a {get_style(style)['genre']} comic book editor. Analyse the following scene and return a JSON object.

SCENE:
{scene_text}

First, decide how many panels this scene needs (between 1 and 6) based on:
- 1-2 panels: a single moment, one beat, minimal action
- 3-4 panels: a short sequence with a clear beginning, middle, end
- 5-6 panels: complex action, multiple location changes, or rich dialogue exchanges

Return this exact JSON structure (no extra text, no markdown):
{{
  "panel_count": <integer between 1 and 6>,
  "panel_count_reason": "<one sentence explaining why you chose this number>",
  "background": "<one sentence visual description of the setting>",
  "background_name": "<2-4 word label for the main setting, e.g. 'rainy rooftop', 'neon alley'>",
  "characters": [
    {{
      "name": "<character name>",
      "description_hint": "<any appearance details mentioned in the scene, or empty string>"
    }}
  ],
  "panels": [
    {{
      "visual": "<one sentence describing what is visually happening in this panel>",
      "characters": ["<name1>", "<name2>"],
      "background": "<setting specific to this panel, or same as main background>",
      "background_name": "<2-4 word label for this panel's setting>",
      "dialogue": "<exact dialogue from the scene for this panel, or empty string if none>"
    }}
  ]
}}

Rules:
- The panels array must contain exactly panel_count items.
- If dialogue exists in the scene, extract it verbatim into the matching panel.
- If a panel has no dialogue, leave the dialogue field as an empty string.
- characters list should contain every unique character in the scene.
"""
    return call_llm_json(prompt)


def fill_missing_dialogue(panels, background, character_names, style=DEFAULT_STYLE):
    """
    Write dialogue for all panels that are missing it in a single LLM call.
    Falls back to per-panel calls if batch parsing fails.
    """
    missing = [i for i, p in enumerate(panels) if not p.get("dialogue")]
    if not missing:
        return

    panel_summaries = "\n".join(
        f"Panel {i+1}: {p.get('visual', '')} | characters: {', '.join(p.get('characters', character_names))}"
        for i, p in enumerate(panels)
    )
    total       = len(panels)
    missing_list = "\n".join(
        f"Panel {i+1}: {panels[i].get('visual', '')}"
        for i in missing
    )

    raw = call_llm(f"""
You are writing dialogue for a {get_style(style)['genre']} comic.

Full story context (all {total} panels):
{panel_summaries}

Setting: {background}
Characters: {', '.join(character_names)}

Write one short dialogue line (max 15 words) for EACH of these panels.
Each line must be different and match what is happening visually.

{missing_list}

Return ONLY lines in this exact format, no extra text:
Panel 1: SpeakerName: "dialogue line"
Panel 2: SpeakerName: "dialogue line"
Panel 3: SpeakerName: "dialogue line"
""")

    # Robust parser: match any "Panel N:" prefix regardless of spacing/case
    import re
    parsed = {}
    for line in raw.strip().split("\n"):
        line = line.strip()
        m = re.match(r"panel\s*(\d+)\s*:\s*(.+)", line, re.IGNORECASE)
        if m:
            panel_num = int(m.group(1)) - 1   # convert to 0-indexed
            dialogue  = m.group(2).strip().strip('"\'')
            parsed[panel_num] = dialogue

    # Assign parsed lines
    for i in missing:
        if i in parsed:
            panels[i]["dialogue"] = parsed[i]
            print(f"  Panel {i+1} dialogue: {parsed[i]}")
        else:
            # Fallback: ask the LLM for just this one panel
            print(f"  Panel {i+1} not parsed from batch — retrying individually...")
            chars = ', '.join(panels[i].get('characters', character_names))
            single = call_llm(f"""
Write ONE short comic dialogue line (max 15 words) for this {get_style(style)['genre']} comic panel.
Visual: {panels[i].get('visual', '')}
Characters: {chars}
Return ONLY: SpeakerName: "dialogue line"
""").strip().strip('"\'')
            panels[i]["dialogue"] = single
            print(f"  Panel {i+1} dialogue (fallback): {single}")


# -------------------------
# PANEL IMAGE GENERATION
# -------------------------

# -------------------------
# CAPTION STRIP
# -------------------------

def apply_caption_strip(img, dialogue):
    """
    Append a dark caption bar below a PIL Image and return the combined image.
    Works entirely in memory — no file I/O.
    """
    if not dialogue:
        return img

    img_w     = img.size[0]
    font_size = 20
    font      = None
    for font_path in [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]:
        try:
            font = ImageFont.truetype(font_path, size=font_size)
            break
        except Exception:
            continue
    if font is None:
        font = ImageFont.load_default()

    text      = dialogue.strip().strip('"\' ')
    dummy     = ImageDraw.Draw(img)
    avg_w     = dummy.textlength("A", font=font)
    max_chars = max(20, int((img_w - 32) / avg_w))
    wrapped   = textwrap.wrap(text, width=max_chars) or [text]

    line_h  = font_size + 6
    padding = 12
    strip_h = len(wrapped) * line_h + padding * 2

    strip = Image.new("RGB", (img_w, strip_h), color=(15, 15, 15))
    draw  = ImageDraw.Draw(strip)
    for i, line in enumerate(wrapped):
        draw.text((padding, padding + i * line_h), line, fill=(220, 220, 220), font=font)

    combined = Image.new("RGB", (img_w, img.size[1] + strip_h))
    combined.paste(img, (0, 0))
    combined.paste(strip, (0, img.size[1]))
    return combined



def generate_panel(panel, index, character_registry, background_registry, global_background, style=DEFAULT_STYLE):
    """
    Generate a single panel image.
    Pulls character visuals and background visuals from their respective DB registries.
    """
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{IMAGE_MODEL}"

    # Character visuals from DB
    char_visuals = []
    for name in panel.get("characters", []):
        char = character_registry.get(name.lower())
        if char:
            visual = (char.get("vision_description") or char.get("llm_description") or "")[:200]
            char_visuals.append(f"{name}: {visual}")

    # Background visual — look up by raw description, fall back to global
    panel_bg_key = (panel.get("background") or panel.get("background_name") or "").lower().strip()
    global_bg_key = global_background.lower().strip()
    bg_entry     = background_registry.get(panel_bg_key) or background_registry.get(global_bg_key)
    bg_visual    = (
        (bg_entry.get("vision_description") or bg_entry.get("llm_description") or "")[:300]
        if bg_entry else (panel.get("background") or global_background)
    )

    character_block = "; ".join(char_visuals) if char_visuals else ""
    visual_action   = panel.get("visual", "")
    dialogue        = panel.get("dialogue", "")

    # Do NOT pass dialogue to Stable Diffusion — it can't render readable text.
    # Bubbles are drawn on top by Pillow after the image is generated.
    prompt_parts = [
        f"{get_style(style)['genre']} comic book panel, {get_style(style)['image_tags']}",
        f"Scene: {visual_action}",
        f"Background: {bg_visual}",
    ]
    if character_block:
        prompt_parts.append(f"Characters: {character_block}")

    prompt = ". ".join(prompt_parts)
    print(f"\n  Panel {index} prompt (truncated):\n  {prompt[:300]}...")

    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"},
        json={"prompt": prompt}
    )

    if response.status_code == 200:
        content_type = response.headers.get("Content-Type", "")
        if "image" in content_type or len(response.content) > 1000:
            # Load into memory — no disk write for individual panels
            img = Image.open(io.BytesIO(response.content)).convert("RGB")
            print(f"  Panel {index} generated ({img.size[0]}x{img.size[1]})")
            if dialogue:
                img = apply_caption_strip(img, dialogue)
            return img
        else:
            print(f"  Panel {index} non-image response: {response.text[:200]}")
    else:
        print(f"  Panel {index} failed: {response.status_code} - {response.text[:200]}")
    return None


# -------------------------
# COMIC PAGE STITCHER
# -------------------------

def stitch_comic_page(panel_images, output_path):
    """
    Arrange panel images into a comic page grid and save as a single file.

    Layout rules:
      1 panel  → 1×1
      2 panels → 1×2 (side by side)
      3 panels → 1×3 or 2+1 (wide top, two below)
      4 panels → 2×2
      5 panels → 2+3 (two on top, three on bottom)
      6 panels → 2×3

    All panels are resized to the same dimensions before stitching.
    A white gutter of 8px separates each panel.
    """
    panels = [p for p in panel_images if p is not None]
    if not panels:
        print("No panels to stitch.")
        return

    n       = len(panels)
    GUTTER  = 8
    BORDER  = 16
    BG      = (240, 240, 240)

    # Normalise all panels to the same size (use the most common size)
    sizes   = [p.size for p in panels]
    target_w = max(s[0] for s in sizes)
    target_h = max(s[1] for s in sizes)
    panels  = [p.resize((target_w, target_h), Image.LANCZOS) for p in panels]

    # Define grid layout: list of rows, each row is a list of panel indices
    if n == 1:
        rows = [[0]]
    elif n == 2:
        rows = [[0, 1]]
    elif n == 3:
        rows = [[0], [1, 2]]          # wide top panel, two below
    elif n == 4:
        rows = [[0, 1], [2, 3]]
    elif n == 5:
        rows = [[0, 1], [2, 3, 4]]
    else:  # 6
        rows = [[0, 1, 2], [3, 4, 5]]

    # Calculate canvas size
    row_heights = []
    row_widths  = []
    for row in rows:
        cols     = len(row)
        row_w    = cols * target_w + (cols - 1) * GUTTER
        row_heights.append(target_h)
        row_widths.append(row_w)

    canvas_w = max(row_widths) + BORDER * 2
    canvas_h = sum(row_heights) + (len(rows) - 1) * GUTTER + BORDER * 2

    page = Image.new("RGB", (canvas_w, canvas_h), color=BG)

    y = BORDER
    for row_idx, row in enumerate(rows):
        cols  = len(row)
        # Centre narrower rows horizontally
        row_w = cols * target_w + (cols - 1) * GUTTER
        x     = (canvas_w - row_w) // 2

        for col_idx, panel_idx in enumerate(row):
            panel = panels[panel_idx]
            # Scale wide panels to fill the row if it's a single-panel row
            if cols == 1:
                scale  = (canvas_w - BORDER * 2) / target_w
                new_w  = int(target_w * scale)
                new_h  = int(target_h * scale)
                panel  = panel.resize((new_w, new_h), Image.LANCZOS)
                page.paste(panel, (BORDER, y))
            else:
                page.paste(panel, (x, y))
                x += target_w + GUTTER

        y += target_h + GUTTER

    page.save(output_path)
    print(f"\n  Comic page saved: {output_path}  ({canvas_w}×{canvas_h}px, {n} panels)")


# -------------------------
# PIPELINE
# -------------------------

def run_pipeline(scene_text,
                 style=DEFAULT_STYLE,
                 regenerate_characters=None,
                 regenerate_backgrounds=None,
                 regenerate_panels=None):
    """
    style                 : one of 'cyberpunk', 'manga', 'noir', 'superhero', 'fantasy', 'horror', 'western'
    regenerate_characters : list of names e.g. ["Rohan"], or True for all
    regenerate_backgrounds: list of descriptions e.g. ["pharmacy"], or True for all
    regenerate_panels     : list of 1-based panel numbers e.g. [2, 3], or True for all
    """
    s = get_style(style)
    print(f"\nStyle: {style.upper()} — {s['genre']}")

    scene_text = normalise_scene(scene_text)
    print(f"\nScene (normalised):\n{scene_text[:300]}")
    init_db()

    print("\n" + "="*60)
    print("STEP 1: Analysing scene")
    print("="*60)
    scene_data = analyse_scene(scene_text, style=style)

    if not scene_data:
        print("Scene analysis failed. Aborting.")
        return

    global_background  = scene_data.get("background", get_style(style)["default_bg"])
    characters         = scene_data.get("characters", [])
    panels             = scene_data.get("panels", [])
    panel_count_reason = scene_data.get("panel_count_reason", "")

    panels = panels[:6]

    print(f"\nBackground: {global_background}")
    print(f"Characters found: {[c['name'] for c in characters]}")
    print(f"Panels decided: {len(panels)}" + (f" — {panel_count_reason}" if panel_count_reason else ""))

    # ---- STEP 2: Resolve characters ----
    print("\n" + "="*60)
    print("STEP 2: Resolving characters")
    print("="*60)

    # Deduplicate: keep first occurrence of each name (case-insensitive)
    seen_names      = set()
    unique_characters = []
    for c in characters:
        key = c.get("name", "").strip().lower()
        if key and key not in seen_names:
            seen_names.add(key)
            unique_characters.append(c)
    if len(unique_characters) < len(characters):
        print(f"  Deduplicated {len(characters)} → {len(unique_characters)} characters")
    characters = unique_characters

    character_registry = {}
    for char_info in characters:
        name = char_info.get("name", "").strip()
        hint = char_info.get("description_hint", "")
        if not name:
            continue
        if name.lower() in character_registry:
            print(f"\n  ↩ '{name}' already resolved this run — skipping")
            continue

        should_regen = (
            regenerate_characters is True or
            (isinstance(regenerate_characters, list) and
             any(n.lower() == name.lower() for n in regenerate_characters))
        )

        if should_regen:
            print(f"\n  ♻ Regenerating '{name}'...")
            created = force_regenerate_character(name, style=style)
            if created:
                character_registry[name.lower()] = created
        else:
            existing = lookup_character(name)
            if existing:
                print(f"\n  ✓ '{name}' found in DB")
                character_registry[name.lower()] = existing
            else:
                print(f"\n  ✗ '{name}' not found — creating...")
                created = create_character(name, hint=hint, style=style)
                if created:
                    character_registry[name.lower()] = created
                else:
                    print(f"  Failed to create '{name}' — skipping.")

    # ---- STEP 3: Resolve backgrounds (semantic vector lookup) ----
    print("\n" + "="*60)
    print("STEP 3: Resolving backgrounds")
    print("="*60)

    # background_registry keyed by raw description for this run's cache
    background_registry = {}

    def _resolve_and_cache(desc):
        if not desc:
            return
        key = desc.lower().strip()
        if key in background_registry:
            return

        should_regen = (
            regenerate_backgrounds is True or
            (isinstance(regenerate_backgrounds, list) and
             any(r.lower() in key for r in regenerate_backgrounds))
        )

        if should_regen:
            print(f"\n  ♻ Regenerating background '{desc[:50]}'...")
            entry = force_regenerate_background(desc, style=style)
            if entry:
                background_registry[key] = entry
            return

        # Check within-run cache for semantic match
        query_vec = embed_text(desc)
        if query_vec:
            for cached_key, cached_entry in background_registry.items():
                cached_vec = blob_to_vec(cached_entry["embedding"]) if cached_entry.get("embedding") else None
                if cached_vec:
                    score = cosine_similarity(query_vec, cached_vec)
                    if score >= SIMILARITY_THRESHOLD:
                        print(f"  ↩ '{desc[:50]}' reuses cached '{cached_key[:50]}' (score {score:.3f})")
                        background_registry[key] = cached_entry
                        return

        entry = resolve_background(desc, style=style)
        if entry:
            background_registry[key] = entry

    _resolve_and_cache(global_background)
    for panel in panels:
        _resolve_and_cache(panel.get("background") or panel.get("background_name") or global_background)

    # ---- STEP 4: Fill missing dialogue ----
    print("\n" + "="*60)
    print("STEP 4: Dialogue")
    print("="*60)

    all_names = [c["name"] for c in characters]
    fill_missing_dialogue(panels, global_background, all_names, style=style)
    for i, panel in enumerate(panels):
        print(f"  Panel {i+1}: {panel.get('dialogue', '(no dialogue)')}")

    # ---- STEP 5: Generate panels & stitch ----
    print("\n" + "="*60)
    print("STEP 5: Generating panels")
    print("="*60)

    panel_images = []
    for i, panel in enumerate(panels):
        panel_num = i + 1
        should_regen_panel = (
            regenerate_panels is True or
            (isinstance(regenerate_panels, list) and panel_num in regenerate_panels)
        )
        if should_regen_panel:
            print(f"\n♻ Regenerating panel {panel_num}/{len(panels)}: {panel.get('visual', '')[:80]}...")
        else:
            print(f"\nGenerating panel {panel_num}/{len(panels)}: {panel.get('visual', '')[:80]}...")
        img = generate_panel(panel, panel_num, character_registry, background_registry, global_background, style=style)
        panel_images.append(img)

    print("\n" + "="*60)
    print("STEP 6: Stitching comic page")
    print("="*60)

    output_path = os.path.join(BASE_DIR, "comic_page.png")
    stitch_comic_page(panel_images, output_path)

    print("\n" + "="*60)
    print("Done.")
    print("="*60)


# -------------------------
# START
# -------------------------

if __name__ == "__main__":

    scene = """
    (Image Description: This is a single, dramatic comic book splash page. The art style is gritty and shadowed, utilizing heavy black linework and watercolor-style colors. The scene is split across three main visual 'beats' or frames integrated into one large composition within the cathedral.)

(Top Frame/Foreground - Beat 1: The Embrace)

Visual: Close-up on Elias and Clara. Elias is in the foreground, his back mostly to us. He is hunched over, his singed and bloodied officer’s coat pulled tightly around him. His forehead is pressed firmly against Clara's, their eyes closed. He holds her right hand, pale and limp, pressed against the medals on his chest. Clara is pale, her eyes slightly open, staring into the middle distance, reflecting the warm orange and red light of the fire.

SFX: TIGHT CHOKE (small, internal sound, near Elias's chest)

Dialogue (Elias - whispered): "...A life we'll never see. But you must wait there for me, Clara."

(Middle Section - Beat 2: The Standoff)

Visual: The scene pulls back, showing the context. They are in the center of the vast, ruined nave of Oakhaven Cathedral. The vaulted ceiling is mostly collapsed, exposing a choked, grey sky and jagged stained glass. Debris—broken pews, twisted metal, stone—is scattered everywhere. The overall lighting is dark, dominated by deep shadows, but punctuated by fierce, flickering orange and red light spilling in from the broken walls (from the burning city). We see Julian at the shattered arched doorway. He is a dark silhouette, standing guard, facing away from them, looking into the darkness. His back is to the reader. His rifle is leveled, steady. He is counting bullets.

SFX: (A distant THOOM and a nearer CRACK-A-BOOM of artillery)

Thought Balloon (Julian): (Near his head, perhaps black with jagged white text): "One... three left. They will cross the square in five minutes. Buy them five more minutes. Just five."

(Bottom Section - Beat 3: The Danger)

Visual: A close-up looking past Julian, into the square outside. It is dark, misty with ash and smoke. We see blurry, advancing silhouettes of soldiers (the 'advancing shadows') crossing the ruined square, moving toward the cathedral. Small pops of muzzle flash are visible. A small mortar tube is being set up in the distance. The orange glow of the burning city is intense here.

Dialogue (Julian - spoken without turning): "The shadows are moving in, Elias. They are bringing a mortar."

(Composition Note: The panel layout is fluid. The top (Elias/Clara) flows seamlessly into the mid-ground (Julian) and background (The Enemy). The page should feel unified, with a heavy emphasis on the contrast between the intimate, quiet sorrow of the lovers and the immediate, kinetic violence of the war invading their space. The color palette is restricted to grim greys, deep blacks, and violent, fiery oranges/reds. The font for dialogue should be typed but slightly distressed.)
    """

    # Pick any style:
    # "cyberpunk" | "manga" | "noir" | "superhero" | "fantasy" | "horror" | "western"

    # run_pipeline(scene, style="manga")

    # Regeneration still works exactly the same, just pass style too:
    # run_pipeline(scene, style="manga", regenerate_characters=["Rohan"])
    # run_pipeline(scene, style="fantasy", regenerate_backgrounds=True)
    run_pipeline(scene, style="superhero", regenerate_panels=[2])
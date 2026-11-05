#!/usr/bin/env bash
# The Vandar Mart tutorial video, start to finish (Bangla male voice, HyperFrames). From the repo root:
#   GEMINI_API_KEY=… bash video/make.sh
# Output in video/work/out: the MP4, the thumbnail, Bangla subtitles (.srt), the YouTube title and description,
# and voice-check.md (what Gemini heard in every take, beside the script).
set -euo pipefail
cd "$(dirname "$0")/.."
W=video/work
HF=hyperframes@0.9.16
mkdir -p "$W/out"

[ -n "${GEMINI_API_KEY:-${GOOGLE_API_KEY:-}}" ] || { echo "GEMINI_API_KEY is not set (see video/README.md)."; exit 1; }
[ -d node_modules ] || npm ci

python3 video/scenes.py "$W/scenes.json"
python3 video/scenes.py video/SCRIPT-BN.md

# 1. Screens: a private local copy of the shop with sample orders, every page photographed.
[ -f "$W/shots/meta.json" ] || node video/capture.mjs "$W/shots"

# 2. Tools: Bangla font and GSAP from npm, the sound effects from the HyperFrames repository, Chrome for rendering.
[ -d "$W/npm/node_modules/@fontsource/hind-siliguri" ] || npm i --prefix "$W/npm" --no-audit --no-fund @fontsource/hind-siliguri gsap@3.15.0
if [ ! -f "$W/sfx/pop.mp3" ]; then
  rm -rf "$W/hf"
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/heygen-com/hyperframes.git "$W/hf"
  git -C "$W/hf" sparse-checkout set skills/media-use/audio/assets/sfx
  mkdir -p "$W/sfx"
  cp "$W/hf/skills/media-use/audio/assets/sfx/"{whoosh,whoosh-short,click-soft,pop}.mp3 "$W/sfx/"
fi
[ -x "$W/venv/bin/python" ] || { python3 -m venv "$W/venv" && "$W/venv/bin/pip" install -q numpy; }
npx -y "$HF" browser ensure >/dev/null

# 3. The voice (cached: a rerun only reads what is missing).
"$W/venv/bin/python" video/voice_gemini.py "$W/scenes.json" "$W" "$@"

# 4. The film.
python3 video/build.py "$W"
(cd "$W/guide" && npx -y "$HF" check)
(cd "$W/guide" && npx -y "$HF" render . -o ../out/VandarMart-Full-Guide-BN.mp4 --crf 20 --fps 30 --skill=hyperframes)
node video/thumbnail.mjs "$W"
ls -la "$W/out"

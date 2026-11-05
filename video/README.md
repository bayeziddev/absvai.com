# Vandar Mart tutorial video

A full YouTube guide to the shop and the admin dashboard, in Bangla, with a male voice, Bangla captions and the
**connect with Bayezid** channel mark. Built with [HyperFrames](https://github.com/heygen-com/hyperframes)
(HTML rendered to video).

## বাংলায় সংক্ষেপে

1. ফ্রি Gemini API key নিন: <https://aistudio.google.com/apikey> → **Create API key**।
2. Claude Code-এর সেশনের ওপরের **cloud environment** মেনু → **Edit** → **Network secrets** (বা Environment variables)
   → নাম `GEMINI_API_KEY`, মান আপনার key। key কখনো চ্যাটে পেস্ট করবেন না।
3. নতুন সেশন খুলে লিখুন: **“video/README.md অনুযায়ী male voice দিয়ে ভিডিওটা বানাও”**।
4. প্রায় ৩০ মিনিটে `video/work/out` ফোল্ডারে ভিডিও, থাম্বনেইল, বাংলা সাবটাইটেল আর YouTube-এর বিবরণ তৈরি হয়।

ভিডিওতে কী বলা হবে, তা [SCRIPT-BN.md](SCRIPT-BN.md)-এ পড়া যায়; বদলাতে হলে `scenes.py`-তে সেই লাইনটি বদলান।

## For the agent making it

```bash
bash video/make.sh          # needs GEMINI_API_KEY; about 30 minutes, most of it the render
```

It runs, in order (each step is skipped when its output is already there, so a rerun continues):

| Step | Script | Output in `video/work` |
|---|---|---|
| Script | `scenes.py` | `scenes.json`, and `SCRIPT-BN.md` for people to read |
| Screens | `capture.mjs` (a private local copy of the shop with sample orders, never the live site) | `shots/*.png`, `shots/meta.json` |
| Voice | `voice_gemini.py` (Gemini text-to-speech, male voice **Charon**) | `voice/*.wav`, `timing.json`, `voice-check.md` |
| Film | `build.py`, then `hyperframes check` and `render` | `guide/`, `out/VandarMart-Full-Guide-BN.mp4` |
| Extras | `build.py`, `thumbnail.mjs` | `out/VandarMart-thumbnail.png`, `out/VandarMart-subtitles-bn.srt`, `out/YouTube-title-description.txt` |

**Check the voice before you deliver.** `voice-check.md` has Gemini's own transcript of every scene beside the script,
with a match percentage and the differing words. Read it (you can read Bangla); for any scene with a wrong or missing
word, read just those scenes again line by line, rebuild and render:

```bash
video/work/venv/bin/python video/voice_gemini.py video/work/scenes.json video/work --only wa1,edit2 --mode line
python3 video/build.py video/work
(cd video/work/guide && npx -y hyperframes@0.9.16 render . -o ../out/VandarMart-Full-Guide-BN.mp4 --crf 20 --fps 30)
```

A transcript can disagree on spelling alone (ওপরে / উপরে) without anything being wrong; a different or missing word
is what matters. If one word keeps coming out wrong, change how it is spoken without changing the caption: make that
line a pair `('caption', 'spoken')` in `scenes.py`.

- Another male voice: `--voice Orus` (firm), `Iapetus` (clear), `Sadaltager` (knowledgeable), `Puck` (upbeat). Takes
  are cached per voice and text, so switching back costs nothing.
- Models: the newest text-to-speech model the key can use is picked by itself; `GEMINI_TTS_MODEL` overrides it.
- Free keys have a small daily limit. The voice is read in a few long takes (one per part of the film, cut at its
  pauses) to stay inside it; if the limit stops it, run the same command the next day and it carries on.
- No background music is added (none is available offline). It can be added in YouTube Studio → Editor → Audio.
- To keep editing by hand, the HyperFrames desktop app opens `video/work/guide`:
  <https://hyperframes.studio/studio/download>.

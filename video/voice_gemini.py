#!/usr/bin/env python3
"""
The narration in a natural male Bangla voice (Google Gemini text-to-speech), then a check of what was said.

  GEMINI_API_KEY=… python3 video/voice_gemini.py work/scenes.json work [--mode group|scene|line] [--only id,id] [--voice Charon]

Writes work/voice/<scene>.wav (one file per scene, loudness-matched), work/timing.json (when each sentence starts and
ends, for the captions) and work/voice-check.md (Gemini's own transcript of every take beside the script, so wrong
words show up without anyone having to listen first).

Requests are kept few for the free tier: by default one request per part of the film, each read with long pauses
between sentences, then cut at those pauses. A part whose cut does not come out right is read again scene by scene.
Every take is cached in work/voice-cache, so a rerun after a quota stop carries on where it stopped.
"""
import argparse, base64, difflib, hashlib, json, os, re, subprocess, sys, time, urllib.error, urllib.request, wave

import numpy as np

API = 'https://generativelanguage.googleapis.com/v1beta'
KEY = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
RATE = 24000  # Gemini speech is 16-bit mono PCM at 24 kHz

STYLE = (
    'You are a professional male narrator from Dhaka recording a YouTube tutorial. Read the lines below in pure, '
    'standard Bangladeshi Bangla (প্রমিত চলিত বাংলা) with perfectly correct pronunciation, the way a careful TV news '
    'presenter would: warm, clear, friendly and confident, at a calm teaching pace. Say English button and menu names '
    '(for example Orders, Open WhatsApp, Save changes) naturally in English. Read every line exactly as written, '
    'without adding, skipping or changing any word. After each line, stay silent for two full seconds before the next one. '
    'The lines:'
)


def call(url, body, tries=8):
    data = json.dumps(body).encode()
    for k in range(tries):
        req = urllib.request.Request(url, data=data, headers={'content-type': 'application/json', 'x-goog-api-key': KEY})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors='replace')
            if e.code == 429 or e.code >= 500:
                wait = 20 * (k + 1)
                m = re.search(r'"retryDelay":\s*"(\d+)', msg)
                if m: wait = int(m.group(1)) + 2
                if 'PerDay' in msg or 'per day' in msg.lower():
                    sys.exit(f'Gemini daily quota used up. Run the same command again tomorrow (finished takes are cached), or enable billing on the key.\n{msg[:400]}')
                print(f'  busy ({e.code}), waiting {wait}s'); time.sleep(wait); continue
            sys.exit(f'Gemini error {e.code}: {msg[:800]}')
        except (urllib.error.URLError, TimeoutError) as e:
            print('  network:', e); time.sleep(10)
    sys.exit('Gemini did not answer after several tries.')


def pick_models():
    names = [m['name'].split('/')[-1] for m in call_get(f'{API}/models?pageSize=200').get('models', [])]
    tts = [n for n in names if 'tts' in n]
    tts.sort(key=lambda n: (('pro' not in n), ('preview' in n), n))  # pro before flash, stable before preview
    text = [n for n in names if 'flash' in n and 'tts' not in n and 'image' not in n and 'live' not in n and 'audio' not in n and 'embed' not in n]
    text.sort(key=lambda n: (('lite' in n), ('preview' in n or 'exp' in n), [-int(x) for x in re.findall(r'\d+', n)][:2]))
    if not tts: sys.exit(f'No text-to-speech model is open to this key. Models seen: {names[:30]}')
    return os.environ.get('GEMINI_TTS_MODEL') or tts[0], os.environ.get('GEMINI_CHECK_MODEL') or (text[0] if text else None)


def call_get(url):
    req = urllib.request.Request(url, headers={'x-goog-api-key': KEY})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f'Gemini error {e.code}: {e.read().decode(errors="replace")[:600]}')


def speak(model, voice, lines, cache):
    text = STYLE + '\n\n' + '\n\n'.join(lines)
    key = hashlib.sha256(f'{model}|{voice}|{text}'.encode()).hexdigest()[:24]
    path = f'{cache}/{key}.npy'
    if os.path.exists(path): return np.load(path)
    r = call(f'{API}/models/{model}:generateContent', {
        'contents': [{'parts': [{'text': text}]}],
        'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}}},
    })
    try:
        part = r['candidates'][0]['content']['parts'][0]['inlineData']
    except (KeyError, IndexError):
        sys.exit(f'Gemini sent no audio: {json.dumps(r)[:600]}')
    x = np.frombuffer(base64.b64decode(part['data']), dtype='<i2').astype(np.float32) / 32768
    np.save(path, x)
    return x


def cut(x, n):
    """Splits a take into n sentences at its n − 1 longest pauses, or None when the pauses don't read as sentence breaks."""
    if n == 1: return [trim(x)]
    hop = int(RATE * 0.02)
    env = np.sqrt(np.convolve(x ** 2, np.ones(hop) / hop, mode='same'))[::hop]
    thr = max(env.max() * 0.03, 0.003)
    quiet = env < thr
    runs, i = [], 0
    while i < len(quiet):
        if quiet[i]:
            j = i
            while j < len(quiet) and quiet[j]: j += 1
            if i > 0 and j < len(quiet): runs.append((j - i, i, j))
            i = j
        else: i += 1
    runs.sort(reverse=True)
    if len(runs) < n - 1: return None
    chosen = sorted(runs[: n - 1], key=lambda r: r[1])
    # a sentence break must be clearly longer than a breath inside a sentence
    if chosen and min(r[0] for r in chosen) * 0.02 < 0.55: return None
    if len(runs) >= n and runs[n - 1][0] * 0.02 > 0.8 * min(r[0] for r in chosen) * 0.02 and runs[n - 1][0] * 0.02 > 0.9: return None
    marks = [0] + [((a + b) // 2) * hop for _, a, b in chosen] + [len(x)]
    parts = [trim(x[marks[k]: marks[k + 1]]) for k in range(n)]
    if any(len(p) < RATE * 0.5 for p in parts): return None
    return parts


def trim(x):
    nz = np.where(np.abs(x) > 0.01)[0]
    return x[max(0, nz[0] - int(0.03 * RATE)): nz[-1] + int(0.08 * RATE)] if len(nz) else x


def plausible(parts, texts):
    """Sentence length should follow its text length: a misplaced cut shows up as a wild seconds-per-letter."""
    rates = [len(p) / RATE / max(8, len(t)) for p, t in zip(parts, texts)]
    med = sorted(rates)[len(rates) // 2]
    return all(0.45 * med < r < 2.2 * med for r in rates)


def wav_bytes(x):
    import io
    b = io.BytesIO()
    with wave.open(b, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
    return b.getvalue()


def transcribe(model, x):
    r = call(f'{API}/models/{model}:generateContent', {'contents': [{'parts': [
        {'inline_data': {'mime_type': 'audio/wav', 'data': base64.b64encode(wav_bytes(x)).decode()}},
        {'text': 'Transcribe this Bangla speech exactly as spoken, word for word, in Bangla script; write English words in English letters. Do not correct anything. Output only the transcript.'},
    ]}], 'generationConfig': {'temperature': 0}})
    try: return ''.join(p.get('text', '') for p in r['candidates'][0]['content']['parts']).strip()
    except (KeyError, IndexError): return ''


def norm(t):
    t = t.replace('ড়', 'ড়').replace('ঢ়', 'ঢ়').replace('য়', 'য়').lower()
    return re.sub(r'[^\wঀ-৿]+', ' ', t).split()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scenes'); ap.add_argument('work')
    ap.add_argument('--mode', default='group', choices=['group', 'scene', 'line'])
    ap.add_argument('--only', default='', help='scene ids to read again, comma separated')
    ap.add_argument('--voice', default=os.environ.get('GEMINI_VOICE', 'Charon'))
    ap.add_argument('--no-check', action='store_true')
    a = ap.parse_args()
    if not KEY: sys.exit('Set GEMINI_API_KEY (Google AI Studio → Get API key) in the environment first.')
    scenes = json.load(open(a.scenes, encoding='utf-8'))
    os.makedirs(f'{a.work}/voice-cache', exist_ok=True); os.makedirs(f'{a.work}/voice', exist_ok=True)
    tts_model, check_model = pick_models()
    print('voice', a.voice, '· speech model', tts_model, '· check model', check_model)

    takes = {}  # scene id → list of sentence arrays
    tpath = f'{a.work}/takes.json'
    done = json.load(open(tpath)) if os.path.exists(tpath) else {}
    only = set(filter(None, a.only.split(',')))

    def by_scene(group):
        for s in group:
            texts = [l['say'] for l in s['lines']]
            if a.mode == 'line':
                takes[s['id']] = [trim(speak(tts_model, a.voice, [t], f'{a.work}/voice-cache')) for t in texts]
                continue
            x = speak(tts_model, a.voice, texts, f'{a.work}/voice-cache')
            parts = cut(x, len(texts))
            if not parts or not plausible(parts, texts):
                print(f'  {s["id"]}: pauses unclear, reading line by line')
                parts = [trim(speak(tts_model, a.voice, [t], f'{a.work}/voice-cache')) for t in texts]
            takes[s['id']] = parts

    # Parts of the film: the intro with part 1, then each chapter on its own (long parts are split in two).
    groups, cur = [], []
    for s in scenes:
        if s['kind'] == 'chapter' and cur and cur[0]['kind'] != 'title': groups.append(cur); cur = []
        cur.append(s)
        if sum(len(l['say']) for x in cur for l in x['lines']) > 1400: groups.append(cur); cur = []
    if cur: groups.append(cur)
    for g in groups:
        todo = [s for s in g if (s['id'] in only) or (not only and s['id'] not in done)]
        if not todo: continue
        ids = ', '.join(s['id'] for s in todo)
        print('reading', ids)
        if a.mode != 'group' or only or len(todo) < len(g):
            by_scene(todo); continue
        texts = [l['say'] for s in g for l in s['lines']]
        x = speak(tts_model, a.voice, texts, f'{a.work}/voice-cache')
        parts = cut(x, len(texts))
        if not parts or not plausible(parts, texts):
            print('  pauses unclear, reading this part scene by scene')
            by_scene(g); continue
        k = 0
        for s in g:
            takes[s['id']] = parts[k: k + len(s['lines'])]; k += len(s['lines'])
    # keep every sentence take on disk, so a later rerun of a few scenes keeps the rest
    tdir = f'{a.work}/voice-takes'; os.makedirs(tdir, exist_ok=True)
    for sid, parts in takes.items():
        for k, p in enumerate(parts): np.save(f'{tdir}/{sid}-{k}.npy', p)
        done[sid] = len(parts)
    json.dump(done, open(tpath, 'w'))

    # One file per scene with our own pauses, the sentence times for the captions, and loudness matched to −16 LUFS.
    LEAD = {'title': 1.2, 'chapter': 0.7, 'shot': 0.7, 'outro': 0.8}
    GAP, TAIL = 0.42, {'title': 1.0, 'chapter': 0.8, 'shot': 0.9, 'outro': 3.5}
    MIN = {'title': 9, 'chapter': 3.6, 'shot': 5.5, 'outro': 8}
    timing, report = {}, ['# Voice check', '', f'Voice {a.voice}, model {tts_model}. Script on the left, what Gemini hears in the take on the right.', '']
    for s in scenes:
        sid = s['id']
        parts = [np.load(f'{tdir}/{sid}-{k}.npy') for k in range(len(s['lines']))]
        t = LEAD[s['kind']]
        pieces, lines = [np.zeros(int(RATE * t), np.float32)], []
        for l, p in zip(s['lines'], parts):
            d = len(p) / RATE
            lines.append({'text': l['text'], 'start': round(t, 3), 'end': round(t + d, 3)})
            pieces += [p, np.zeros(int(RATE * GAP), np.float32)]
            t += d + GAP
        dur = max(MIN[s['kind']], round(t + TAIL[s['kind']] - GAP, 2))
        audio = np.concatenate(pieces)
        audio = np.concatenate([audio, np.zeros(max(0, int(RATE * dur) - len(audio)), np.float32)])[: int(RATE * dur)]
        raw = f'{a.work}/voice/{sid}.raw.wav'
        open(raw, 'wb').write(wav_bytes(audio))
        subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=7,aresample=44100', '-ac', '1', f'{a.work}/voice/{sid}.wav'], check=True)
        os.remove(raw)
        timing[sid] = {'duration': dur, 'lines': lines}
        if check_model and not a.no_check and (not only or sid in only):
            heard = transcribe(check_model, np.concatenate([np.concatenate([p, np.zeros(int(RATE * 0.5), np.float32)]) for p in parts]))
            want = ' '.join(l['say'] for l in s['lines'])
            sm = difflib.SequenceMatcher(None, norm(want), norm(heard))
            diffs = [f"«{' '.join(norm(want)[i1:i2])}» → «{' '.join(norm(heard)[j1:j2])}»" for op, i1, i2, j1, j2 in sm.get_opcodes() if op != 'equal']
            report += [f'## {sid} · {round(sm.ratio() * 100)}% match', f'- script: {want}', f'- heard: {heard}'] + ([f'- differences: {"; ".join(diffs)}'] if diffs else []) + ['']
            print(f'  {sid}: {round(sm.ratio() * 100)}% match{"" if not diffs else " · " + "; ".join(diffs)[:160]}')
    json.dump(timing, open(f'{a.work}/timing.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    if len(report) > 4: open(f'{a.work}/voice-check.md', 'w', encoding='utf-8').write('\n'.join(report))
    print('total', round(sum(v['duration'] for v in timing.values()), 1), 's')


if __name__ == '__main__':
    main()

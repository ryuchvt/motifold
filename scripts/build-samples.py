#!/usr/bin/env python3
"""Builds public/samples from Versilian Studios' VSCO 2 Community Edition, which is public domain (CC0).

Takes a recording on each pitch it has, one sustained and one short where the library has both, cuts it down and encodes it
for the web. The files don't all number their octaves the same way, so each instrument's pitches are measured and not trusted
from the names. Needs ffmpeg and numpy. Usage: build-samples.py <git tree json> <download folder> <output folder> <ffmpeg>
"""
import json, re, subprocess, sys, urllib.parse
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

COMMIT = "master"
RAW = f"https://raw.githubusercontent.com/sgossner/VSCO-2-CE/{COMMIT}/"
NOTE = re.compile(r"(?:^|[_-])([A-G]#?)(-?\d)(?=[_.-])")
NAMES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}

# Instrument: the folder of its sustained or ringing notes, and of its short ones.
PITCHED = {
    "violins": ("Strings/Violin Section/susVib", "Strings/Violin Section/Spic"),
    "violas": ("Strings/Viola Section/susvib", "Strings/Viola Section/spic"),
    "cellos": ("Strings/Cello Section/susvib", "Strings/Cello Section/spic"),
    "basses": ("Strings/Solo Contrabass/SusVib", "Strings/Solo Contrabass/Spic"),
    "flute": ("Woodwinds/Flute/susNV", "Woodwinds/Flute/stac"),
    "piccolo": ("Woodwinds/Piccolo/Sus", "Woodwinds/Piccolo/Stac"),
    "oboe": ("Woodwinds/Oboe/Sus", "Woodwinds/Oboe/Stacc"),
    "clarinet": ("Woodwinds/Clarinet/susLong", "Woodwinds/Clarinet/stac"),
    "bassoon": ("Woodwinds/Bassoon/sus", "Woodwinds/Bassoon/stac"),
    "horn": ("Brass/F Horn/sus", "Brass/F Horn/stac"),
    "trumpet": ("Brass/Trumpet/sus", "Brass/Trumpet/stac"),
    "trombone": ("Brass/Tenor Trombone/sus", "Brass/Tenor Trombone/stac"),
    "tuba": ("Brass/Tuba/sus", "Brass/Tuba/stac"),
    "harp": ("Strings/Harp", None),
    "glockenspiel": ("Percussion/Glock", None),
    "xylophone": ("Percussion/Xylo", None),
    "marimba": ("Percussion/Marimba", None),
    "piano": ("Keys/Upright Nr1", None),
}
# Plucked strings, each on its own track when it's exported.
PLUCKED = {"violins": "Strings/Violin Section/Pizz", "violas": "Strings/Viola Section/pizz", "cellos": "Strings/Cello Section/pizzT", "basses": "Strings/Solo Contrabass/Pizz"}
# One recording that plays whatever note is asked for.
HITS = {
    "snare": "Percussion/Snare2-HitNS_v3_rr1_Sum.wav",
    "bassdrum": "Percussion/BDrumNewhit_v4_rr1_Sum.wav",
    "cymbals": "Percussion/cymbal-crash1_mf_rr1.wav",
    "tamtam": "Percussion/gongHit_mf.wav",
    "triangle": "Percussion/Triangle3-Hit_v1_rr1_Sum.wav",
}
SECONDS = {"long": 6.0, "short": 1.2, "ring": 5.0, "hit": 4.0}
# Autocorrelation can't be trusted on these: a reed's strong third partial, bells above its range. Their spectra were read by hand and the octave set here.
SHIFT = {"piccolo": 12, "oboe": 12, "glockenspiel": 12, "xylophone": 12}
# A timpani's strongest partial isn't always the note heard. The principal tone of each drum, read from its partials at about 1, 1.5 and 2, in fractional MIDI.
TIMPANI = {1: 41.5, 2: 46.8, 3: 49.5, 4: 52.4, 5: 54.5}


def named_midi(path):
    m = NOTE.search(Path(path).name)
    return (int(m[2]) + 1) * 12 + NAMES[m[1]] if m else None


def layer(path):
    m = re.search(r"_v(\d)", Path(path).name) or re.search(r"_(pp|mf|f)_", Path(path).name)
    return m[1] if m else "1"


def round_robin_first(paths):
    """One recording per pitch: the first take of the middle layer, which keeps a sound steady across the range."""
    by_pitch = defaultdict(list)
    for p in paths:
        midi = named_midi(p)
        if midi is not None:
            by_pitch[midi].append(p)
    chosen = {}
    for midi, options in by_pitch.items():
        layers = sorted({layer(o) for o in options})
        wanted = "mf" if "mf" in layers else layers[len(layers) // 2]
        chosen[midi] = sorted(o for o in options if layer(o) == wanted)[0]
    return chosen


def fetch(path, cache):
    target = cache / path
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["curl", "-sSfL", "-m", "90", "-o", str(target), RAW + urllib.parse.quote(path)], check=True)
    return target


def measure(path, ffmpeg):
    """The sounding pitch by autocorrelation over the steady part of the note, or None if it's unclear."""
    raw = subprocess.run([ffmpeg, "-v", "error", "-i", str(path), "-ac", "1", "-ar", "22050", "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    if len(x) < 8000:
        return None
    start = int(np.argmax(np.abs(x) > 0.2 * np.abs(x).max())) + 1500
    x = x[start : start + 8192]
    if len(x) < 4096:
        return None
    x = (x - x.mean()) * np.hanning(len(x))
    ac = np.fft.irfft(np.abs(np.fft.rfft(x, 2 * len(x))) ** 2)[: len(x)]
    low, high = int(22050 / 2200), int(22050 / 25)
    lag = low + int(np.argmax(ac[low:high]))
    if ac[lag] < 0.3 * ac[0]:
        return None
    return 69 + 12 * np.log2((22050 / lag) / 440)


def encode(source, target, seconds, ffmpeg, fade=0.08):
    target.parent.mkdir(parents=True, exist_ok=True)
    chain = f"atrim=0:{seconds},afade=t=out:st={max(seconds - fade, 0)}:d={fade}"
    subprocess.run([ffmpeg, "-y", "-v", "error", "-i", str(source), "-af", chain, "-ac", "2", "-ar", "44100", "-c:a", "aac", "-b:a", "80k", str(target)], check=True)


def main():
    tree, cache, out, ffmpeg = sys.argv[1:5]
    cache, out = Path(cache), Path(out)
    paths = [x["path"] for x in json.load(open(tree))["tree"] if x["type"] == "blob" and x["path"].lower().endswith(".wav")]
    manifest = {}
    for name, (long_dir, short_dir) in PITCHED.items():
        ring = short_dir is None
        longs = round_robin_first([p for p in paths if str(Path(p).parent) == long_dir])
        shorts = round_robin_first([p for p in paths if short_dir and str(Path(p).parent) == short_dir])
        # Octave numbering differs between files, so the median of what's measured settles it for the instrument.
        gaps = []
        for midi, p in longs.items():
            found = measure(fetch(p, cache), ffmpeg)
            if found is not None:
                gaps.append(found - midi)
        shift = SHIFT.get(name, 12 * round(float(np.median(gaps)) / 12) if gaps else 0)
        spread = float(np.median(np.abs(np.array(gaps) - shift))) if gaps else -1
        print(f"{name:13} {len(longs):3} long {len(shorts):3} short  octave shift {shift:+4}  median error {spread:.2f} semitones over {len(gaps)}", flush=True)
        entry = {"long": [], "short": []}
        for midi, p in sorted(longs.items()):
            encode(fetch(p, cache), out / name / f"{midi + shift}.m4a", SECONDS["ring" if ring else "long"], ffmpeg)
            entry["long"].append(midi + shift)
        for midi, p in sorted(shorts.items()):
            encode(fetch(p, cache), out / name / f"s{midi + shift}.m4a", SECONDS["short"], ffmpeg)
            entry["short"].append(midi + shift)
        if name in PLUCKED:
            plucked = round_robin_first([p for p in paths if str(Path(p).parent) == PLUCKED[name]])
            for midi, p in sorted(plucked.items()):
                encode(fetch(p, cache), out / name / f"p{midi + shift}.m4a", 1.5, ffmpeg)
            entry["pizz"] = [midi + shift for midi in sorted(plucked)]
        manifest[name] = entry
    # Timpani files name a drum and not a note.
    for n, midi in TIMPANI.items():
        options = sorted(p for p in paths if p.startswith(f"Percussion/Timpani/Timpani{n}_Hit_") and "rr1" in p)
        encode(fetch(options[len(options) // 2], cache), out / "timpani" / f"{midi}.m4a", SECONDS["ring"], ffmpeg, 0.3)
    manifest["timpani"] = {"long": sorted(TIMPANI.values()), "short": []}
    for name, p in HITS.items():
        encode(fetch(p, cache), out / name / "hit.m4a", SECONDS["hit"], ffmpeg, 0.3)
        manifest[name] = {"hit": True}
        print(f"{name:13} one hit", flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")))


main()

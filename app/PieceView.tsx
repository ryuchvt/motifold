import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ROLES, type PieceReading } from "../server/shapes";
import type { RoleFocus } from "./arrange";
import { createPreview, beatClock } from "./audio/preview";
import { loadManifest } from "./audio/samples";
import { timeWords, type PlacedCue } from "./cues";
import { familyOf, notesToHear, type NoteKind, type PieceData, type PieceRow } from "./pieceData";

const ROLE_NAMES: Record<(typeof ROLES)[number], string> = {
  melody: "Melody",
  countermelody: "Countermelody",
  bass: "Bass",
  harmony: "Harmony",
  rhythm: "Rhythm",
  pedal: "Held note",
  doubling: "Doubling",
};

/** A beat's place along the piece, for anything laid over it. */
const along = (beat: number, total: number) => `${(beat / Math.max(total, 1)) * 100}%`;

const UNITS = 12;
const heightOf = (row: PieceRow) => (row.notes.length === 0 ? 14 : row.tall ? 46 : 24);

/** Notes as one path for each thing they're doing, because a long score is thousands of notes. */
function rowPaths(row: PieceRow) {
  const pad = 4;
  const h = heightOf(row);
  const span = Math.max(row.high - row.low, 1);
  const yOf = (height: number) => (row.high === row.low ? h / 2 : pad + ((row.high - height) / span) * (h - pad * 2));
  const byKind = new Map<NoteKind, string[]>();
  const fresh = new Set<NoteKind>();
  for (const n of row.notes) {
    const parts = byKind.get(n.kind) ?? [];
    parts.push(`M${(n.start * UNITS).toFixed(1)} ${yOf(n.height).toFixed(1)}h${Math.max(n.length * UNITS - 1, 2).toFixed(1)}`);
    byKind.set(n.kind, parts);
    if (n.fresh) fresh.add(n.kind);
  }
  // The shape of the tune, drawn between its notes, so it reads as a line someone could sing.
  const tune = row.notes.filter((n) => n.kind === "melody").sort((a, b) => a.start - b.start || b.height - a.height);
  const contour: string[] = [];
  tune.forEach((n, k) => {
    const next = tune[k + 1];
    if (next && next.start > n.start && next.start - (n.start + n.length) < 2) contour.push(`M${((n.start + n.length) * UNITS).toFixed(1)} ${yOf(n.height).toFixed(1)}L${(next.start * UNITS).toFixed(1)} ${yOf(next.height).toFixed(1)}`);
  });
  return { h, byKind, fresh, family: familyOf(row.label), contour: contour.join("") };
}

/**
 * The whole piece at once, and the way to hear it. Each track is a row of its real notes, so the shape of the music shows before any of it is read, and
 * the colours arrive with the reading. Pressing a place picks those bars for the notation below.
 */
export function PieceView(props: {
  data: PieceData;
  sections: PieceReading["sections"];
  moments: PlacedCue[];
  selected: { from: string; to: string };
  focus: RoleFocus;
  solo: string[];
  instrumentOf: (label: string) => string;
  hasNew: boolean;
  /** A bounce of this version to play instead of the browser's instruments. */
  render?: string;
  onSelect: (bar: string) => void;
  onSelectRange: (from: string, to: string) => void;
  onFocus: (focus: RoleFocus) => void;
  onSolo: (label: string) => void;
}) {
  const { data, sections, moments, selected, focus, solo, instrumentOf, hasNew, render, onSelect, onSelectRange, onFocus, onSolo } = props;
  const { rows, bars, totalBeats } = data;
  const [playing, setPlaying] = useState(false);
  const [from, setFrom] = useState(0);
  const preview = useRef<ReturnType<typeof createPreview> | null>(null);
  const bounce = useRef<HTMLAudioElement | null>(null);
  const heard = useRef(0);
  const head = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  /** Bars being dragged across, which become what's on the page when the press ends. */
  const pressedBar = useRef<string | null>(null);
  const [dragged, setDragged] = useState<{ from: string; to: string } | null>(null);
  const justDragged = useRef(false);
  const clock = useMemo(() => beatClock(data.tempos), [data.tempos]);
  const barOf = (beat: number) => [...bars].reverse().find((b) => b.start <= beat + 1e-6) ?? bars[0];
  const words = (beat: number) => `Bar ${barOf(beat)?.number ?? 1}, ${timeWords(clock.seconds(beat))}`;
  const moveHead = (beat: number) => {
    if (head.current) head.current.style.left = along(beat, totalBeats);
    if (readout.current) readout.current.textContent = words(beat);
  };

  useEffect(() => {
    moveHead(from);
  }, [from, totalBeats]);
  useEffect(() => () => {
    preview.current?.stop();
    bounce.current?.pause();
  }, []);
  useEffect(() => {
    bounce.current?.pause();
    bounce.current = null;
  }, [render]);
  // So the first press of play can already use real instruments.
  useEffect(() => void loadManifest(), []);
  // What's heard follows what's in view, so changing it carries on from where the line is.
  useEffect(() => {
    if (playing) start(heard.current);
  }, [focus, solo, data]);

  const start = (beat: number) => {
    if (render) {
      const audio = (bounce.current ??= new Audio(render));
      audio.currentTime = clock.seconds(beat);
      heard.current = beat;
      setPlaying(true);
      void audio.play();
      const follow = () => {
        if (audio.paused) return;
        heard.current = clock.beat(audio.currentTime);
        moveHead(heard.current);
        requestAnimationFrame(follow);
      };
      requestAnimationFrame(follow);
      audio.onended = () => {
        setPlaying(false);
        setFrom(0);
      };
      return;
    }
    preview.current ??= createPreview();
    heard.current = beat;
    setPlaying(true);
    preview.current.play(
      notesToHear(data, instrumentOf, focus, solo),
      data.tempos,
      beat,
      (now) => {
        heard.current = now;
        moveHead(now);
      },
      () => {
        setPlaying(false);
        setFrom(0);
      },
      (loading) => {
        if (loading && readout.current) readout.current.textContent = "Loading the instruments";
      },
    );
  };
  const stop = () => {
    bounce.current?.pause();
    preview.current?.stop();
    setPlaying(false);
    // It carries on from the bar it stopped in.
    setFrom(barOf(heard.current)?.start ?? 0);
  };
  const beatAt = (e: ReactPointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return (Math.max(0, Math.min(1, (e.clientX - box.left) / Math.max(box.width, 1))) * totalBeats);
  };

  const drawn = useMemo(() => rows.map((row) => ({ row, ...rowPaths(row) })), [rows]);
  const tall = drawn.reduce((sum, d) => sum + d.h, 0);
  const most = Math.max(1, ...data.fullness.yours.map((v, k) => v + (data.fullness.added[k] ?? 0)));
  const shape = (values: number[], under: number[] = []) => {
    const y = (k: number, v: number) => (40 - ((v + (under[k] ?? 0)) / most) * 38).toFixed(1);
    const top = values.map((v, k) => `L${k} ${y(k, v)}`).join("");
    const bottom = values.map((_, k) => `L${values.length - 1 - k} ${y(values.length - 1 - k, 0)}`).join("");
    return `M0 ${y(0, 0)}${top}${bottom}Z`;
  };
  const dim = (kind: NoteKind) => !!focus && focus !== kind;
  const present = ROLES.filter((role) => rows.some((r) => r.notes.some((n) => n.kind === role)));
  const beatOfBar = (number: string) => bars.find((b) => b.number === number)?.start ?? 0;
  const endOfBar = (number: string) => {
    const bar = bars.find((b) => b.number === number);
    return bar ? bar.start + bar.length : totalBeats;
  };
  const chip = (value: Exclude<RoleFocus, null>, name: string) => (
    <button key={value} className={`stage-chip${focus === value ? " on" : ""}`} aria-pressed={focus === value} onClick={() => onFocus(focus === value ? null : value)}>
      <span className={`stage-swatch kind-${value}`} aria-hidden /> {name}
    </button>
  );

  return (
    <section className="stage" aria-label="The whole piece">
      <div className="stage-bar">
        <button className="stage-play" aria-label={playing ? "Stop" : "Play"} onClick={() => (playing ? stop() : start(from))}>
          {playing ? "■" : "▶"}
        </button>
        <span className="stage-readout" ref={readout} />
        {(present.length > 0 || hasNew) && (
          <span className="stage-key" role="group" aria-label="What the colours mean. Press one to see and hear only that.">
            {present.map((role) => chip(role, ROLE_NAMES[role]))}
            {hasNew && chip("new", "New")}
            {hasNew && (
              <span className="stage-families" aria-label="What the other colours mean">
                {["winds", "brass", "percussion", "harp", "strings"].map((family) => (
                  <span key={family} className="stage-family">
                    <i className={`fam-${family}`} aria-hidden /> {family[0]!.toUpperCase() + family.slice(1)}
                  </span>
                ))}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="stage-grid">
        <span className="stage-label stage-label-quiet">How full</span>
        <svg className="stage-shape" viewBox={`0 0 ${Math.max(data.fullness.yours.length - 1, 1)} 40`} preserveAspectRatio="none" aria-hidden>
          <path className="shape-yours" d={shape(data.fullness.yours)} />
          <path className="shape-added" d={shape(data.fullness.added, data.fullness.yours)} />
        </svg>

        <span className="stage-label stage-label-quiet" />
        <div className="stage-sections">
          {sections.length > 0
            ? sections.map((s) => {
                const left = beatOfBar(s.from);
                return (
                  <button
                    key={`${s.from}-${s.to}`}
                    className={`stage-section${selected.from === s.from && selected.to === s.to ? " on" : ""}`}
                    style={{ left: along(left, totalBeats), width: along(endOfBar(s.to) - left, totalBeats) }}
                    title={`Bars ${s.from} to ${s.to}`}
                    onClick={() => onSelect(s.from)}
                  >
                    {s.name || `${s.from} to ${s.to}`}
                  </button>
                );
              })
            : bars.flatMap((b, k) =>
                k % 4 === 0 ? [
                  <span key={b.number} className="stage-barnumber" style={{ left: along(b.start, totalBeats) }}>
                    {b.number}
                  </span>,
                ] : [],
              )}
        </div>

        <div className="stage-names">
          {drawn.map(({ row, h }) => (
            <button key={row.label} className={`stage-name${solo.includes(row.label) ? " on" : ""}${solo.length && !solo.includes(row.label) ? " off" : ""}`} style={{ height: h }} aria-pressed={solo.includes(row.label)} title={`${row.label}: press to hear and see only this`} onClick={() => onSolo(row.label)}>
              {row.label}
            </button>
          ))}
        </div>
        <div
          className="stage-rows"
          onPointerDown={(e) => {
            pressedBar.current = barOf(beatAt(e))?.number ?? null;
            justDragged.current = false;
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!playing && readout.current) readout.current.textContent = words(beatAt(e));
            const [a, b] = [pressedBar.current, barOf(beatAt(e))?.number];
            if (!a || !b || (a === b && !dragged)) return;
            setDragged(beatOfBar(a) <= beatOfBar(b) ? { from: a, to: b } : { from: b, to: a });
          }}
          onPointerUp={() => {
            pressedBar.current = null;
            if (!dragged) return;
            justDragged.current = true;
            setDragged(null);
            setFrom(beatOfBar(dragged.from));
            onSelectRange(dragged.from, dragged.to);
            if (playing) start(beatOfBar(dragged.from));
          }}
          onPointerCancel={() => {
            pressedBar.current = null;
            setDragged(null);
          }}
          onPointerLeave={() => {
            if (!playing) moveHead(from);
          }}
          onClick={(e) => {
            // The end of a drag isn't a press on a bar.
            if (justDragged.current) {
              justDragged.current = false;
              return;
            }
            const beat = beatAt(e as unknown as ReactPointerEvent<HTMLElement>);
            const bar = barOf(beat);
            if (!bar) return;
            setFrom(bar.start);
            onSelect(bar.number);
            if (playing) start(bar.start);
          }}
        >
          <div className="stage-picked" style={{ left: along(beatOfBar((dragged ?? selected).from), totalBeats), width: along(endOfBar((dragged ?? selected).to) - beatOfBar((dragged ?? selected).from), totalBeats) } as CSSProperties} />
          <svg viewBox={`0 0 ${Math.max(totalBeats * UNITS, 1)} ${Math.max(tall, 1)}`} preserveAspectRatio="none" style={{ height: tall }} role="img" aria-label={`${rows.length} tracks over ${bars.length} bars`}>
            {drawn.map(({ row, h, byKind, fresh, family, contour }, k) => {
              const y = drawn.slice(0, k).reduce((sum, d) => sum + d.h, 0);
              const quiet = solo.length > 0 && !solo.includes(row.label);
              return (
                <g key={row.label} transform={`translate(0 ${y})`} className={quiet ? "quiet" : undefined}>
                  <line className="stage-rule" x1="0" x2={totalBeats * UNITS} y1={h} y2={h} vectorEffect="non-scaling-stroke" />
                  {contour && <path className={`contour${dim("melody") ? " dim" : ""}`} d={contour} vectorEffect="non-scaling-stroke" />}
                  {[...byKind].map(([kind, parts]) => (
                    <path key={String(kind)} className={`note kind-${kind ?? "plain"}${kind === "melody" || kind === "countermelody" ? " accent" : fresh.has(kind) ? ` support fam-${family}` : ""}${dim(kind) ? " dim" : ""}`} d={parts.join("")} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
              );
            })}
          </svg>
          {moments.map((m) => (
            <div key={`${m.beats}-${m.what}`} className="stage-moment" style={{ left: along(m.beats, totalBeats) }} title={`${timeWords(m.seconds)}, bar ${m.bar}`}>
              <span>{m.what || timeWords(m.seconds)}</span>
            </div>
          ))}
          <div className="stage-head" ref={head} />
        </div>
      </div>
    </section>
  );
}

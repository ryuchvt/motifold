import { useEffect, useMemo, useRef, useState } from "react";
import type { FreePiece } from "./FreeBars";
import { barFacts } from "./timing";


const WIDTH = 900;
const ROLL = 150;
const LANE = 64;
const GAP = 14;

/**
 * Shown while finding the bars, before they're accepted: the bar lines over the notes as struck. How it was played, on the clock it was played on: the notes as struck, darker when softer, then how fast each bar went, how far it sits from a steady pulse, which
 * shows whether time taken comes back, and how hard it was played. All measured. What it means is the player's.
 */
export function PlayedChart({ piece, levels, audio, onBar }: { piece: FreePiece; levels: number[] | null; audio: string | null; onBar: (bar: string) => void }) {
  const { played, attacks, reading } = piece;
  const facts = useMemo(() => barFacts(attacks, reading), [attacks, reading]);
  const total = Math.max(...played.notes.map((n) => n.end), 1);
  const x = (seconds: number) => (seconds / total) * WIDTH;
  const heights = played.notes.map((n) => n.height);
  const [low, high] = [Math.min(...heights), Math.max(...heights)];
  const y = (height: number) => 4 + ((high - height) / Math.max(high - low, 1)) * (ROLL - 8);
  const lane = (values: number[], top: number) => {
    const [least, most] = [Math.min(...values), Math.max(...values)];
    const place = (v: number) => top + LANE - 4 - ((v - least) / Math.max(most - least, 1e-6)) * (LANE - 8);
    return { place, least, most };
  };
  const speedTop = ROLL + GAP;
  const pulseTop = speedTop + LANE + GAP;
  const loudTop = pulseTop + LANE + GAP;
  const speed = lane(facts.map((b) => b.qpm), speedTop);
  const pulse = lane(facts.map((b) => b.behindMs), pulseTop);
  const shown = levels ?? facts.map((b) => b.level);
  const loud = lane(shown, loudTop);
  const line = (place: (v: number) => number, values: number[]) => facts.map((b, k) => `${k ? "L" : "M"}${x(b.at + b.seconds / 2).toFixed(1)} ${place(values[k]!).toFixed(1)}`).join("");
  const tall = loudTop + LANE + 16;

  const sound = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const element = sound.current;
    if (!element) return;
    const moved = () => setNow(element.currentTime);
    element.addEventListener("timeupdate", moved);
    return () => element.removeEventListener("timeupdate", moved);
  }, [audio]);

  const barAt = (seconds: number) => [...facts].reverse().find((b) => b.at <= seconds) ?? facts[0];
  return (
    <section className="played-chart" aria-label="How it was played">
      {audio && <audio ref={sound} controls preload="none" src={audio} />}
      <svg
        viewBox={`0 0 ${WIDTH} ${tall}`}
        role="img"
        aria-label={`${facts.length} bars, ${Math.round(total)} seconds. Press a place to go to that bar.`}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const seconds = ((e.clientX - box.left) / Math.max(box.width, 1)) * total;
          const bar = barAt(seconds);
          if (bar) onBar(String(bar.number));
          if (sound.current) sound.current.currentTime = seconds;
        }}
      >
        {facts.map((b) => (
          <g key={b.number}>
            <line className="played-bar" x1={x(b.at)} x2={x(b.at)} y1={0} y2={tall - 16} />
            {(b.number - 1) % 4 === 0 && (
              <text className="played-number" x={x(b.at) + 2} y={tall - 4}>
                {b.number}
              </text>
            )}
          </g>
        ))}
        {played.notes.map((n) => (
          <rect key={n.id} className="played-note" x={x(n.at)} y={y(n.height) - 2} width={Math.max(x(n.end) - x(n.at), 2)} height={4} style={{ opacity: 0.25 + (n.velocity / 127) * 0.75 }} />
        ))}
        <text className="played-lane" x={4} y={speedTop + 10}>
          Crotchets a minute, {Math.round(speed.least)} to {Math.round(speed.most)}
        </text>
        <path className="played-line" d={line(speed.place, facts.map((b) => b.qpm))} />
        <text className="played-lane" x={4} y={pulseTop + 10}>
          Against a steady pulse, {Math.round(pulse.least)} to {Math.round(pulse.most)} ms
        </text>
        <line className="played-zero" x1={0} x2={WIDTH} y1={pulse.place(0)} y2={pulse.place(0)} />
        <path className="played-line" d={line(pulse.place, facts.map((b) => b.behindMs))} />
        <text className="played-lane" x={4} y={loudTop + 10}>
          {levels ? "How loud the recording is in each bar" : "How hard each bar was struck"}
        </text>
        <path className="played-line" d={line(loud.place, shown)} />
        {audio && <line className="played-head" x1={x(now)} x2={x(now)} y1={0} y2={tall - 16} />}
      </svg>
    </section>
  );
}

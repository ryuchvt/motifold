import { useEffect, useMemo, useState } from 'react';
import type { PieceBar } from './pieceData';
import './tempo-lane.css';

export function tempoPoints(tempos: { beat:number; qpm:number }[]) {
  const ordered=tempos.filter(t=>Number.isFinite(t.beat)&&t.beat>=0&&Number.isFinite(t.qpm)&&t.qpm>0).sort((a,b)=>a.beat-b.beat);
  const points=ordered.length ? ordered : [{beat:0,qpm:120}];
  return points[0]!.beat>0 ? [{beat:0,qpm:points[0]!.qpm},...points] : points;
}
export function tempoAt(points: {beat:number;qpm:number}[],beat:number) {
  return [...points].reverse().find(t=>t.beat<=beat+1e-6)?.qpm ?? points[0]?.qpm ?? 120;
}

/** The tempo actually marked in the score. Inspection selects a passage; it never edits a note or a tempo. */
export function TempoLane({tempos,bars,total,onInspect}:{tempos:{beat:number;qpm:number}[];bars:PieceBar[];total:number;onInspect:(beat:number,bar:string)=>void}) {
  const points=useMemo(()=>tempoPoints(tempos),[tempos]);
  const [beat,setBeat]=useState(0);
  useEffect(()=>setBeat(0),[tempos]);
  const qpm=tempoAt(points,beat);
  const bar=[...bars].reverse().find(b=>b.start<=beat+1e-6)??bars[0];
  const low=Math.min(...points.map(t=>t.qpm)),high=Math.max(...points.map(t=>t.qpm));
  const y=(value:number)=>high===low?16:29-(value-low)/(high-low)*25;
  const x=(at:number)=>Math.max(0,Math.min(1000,at/Math.max(total,1)*1000));
  const path=points.map((point,index)=>`${index?'H':'M'}${x(point.beat).toFixed(2)}${index?'V':' '}${y(point.qpm).toFixed(2)}`).join('')+`H1000`;
  const inspect=(next:number)=>{const at=Math.max(0,Math.min(total,next));setBeat(at);const found=[...bars].reverse().find(b=>b.start<=at+1e-6)??bars[0];if(found)onInspect(at,found.number)};
  const value=`Bar ${bar?.number??'1'}, ${Math.round(qpm*10)/10} beats per minute`;
  return <>
    <span className="stage-label tempo-label">Tempo<output aria-live="polite">♩ {Math.round(qpm*10)/10}</output></span>
    <div className="stage-tempo-lane" data-tutorial="tempo">
      <svg viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden="true"><path d={path}/><line x1={x(beat)} x2={x(beat)} y1="0" y2="32"/></svg>
      <input type="range" aria-label="Inspect the tempo map" aria-valuetext={value} min={0} max={Math.max(total,0.25)} step={0.25} value={beat} onChange={event=>inspect(Number(event.target.value))} onPointerUp={event=>inspect(Number(event.currentTarget.value))}/>
      <span className="tempo-inspection" aria-hidden="true">{value}</span>
    </div>
  </>;
}

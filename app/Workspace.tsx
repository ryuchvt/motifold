import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Layers, PanelRightClose, PanelRightOpen, Minus, Plus, GripVertical, Undo2 } from 'lucide-react';
import type { LoadedSketch } from './Studio';
import type { Arranged } from './useArrange';
import type { DemoPiece } from './demo';
import type { Selection } from './selection';
import { ArrangePanel, type InitialSetup } from './ArrangePanel';
import { Compare } from './Compare';
import { PieceView } from './PieceView';
import { ScoreView, type ScoreViewHandle, type Tap } from './ScoreView';
import { attentionOf, writingProgress } from './attention';
import { playhead } from './playhead';
import { scoreCursor } from './scoreCursor';
import type { BarHighlight } from '../render/barOverlay';
import { useTutorialGuide } from './Tutorial';

const NO_MARKS: never[] = [];

/** Move a complete existing block without changing its contents. */
export function moveBlock<T>(blocks: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return blocks;
  const next = [...blocks];
  next.splice(to, 0, next.splice(from, 1)[0]!);
  return next;
}

function SectionRail({ arranged, onTrial }: { arranged: Arranged; onTrial: () => void }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const trial = arranged.trying?.kind === 'structure' && arranged.trying.index === -1;
  const row = arranged.orders.find((o) => o.index === (trial ? -1 : null));
  const blocks = row?.blocks ?? [];
  const sourceNumbers = arranged.standing?.parts[0]?.measures.map((m) => m.number) ?? [];
  const coverage = blocks.flatMap((block) => { const a = sourceNumbers.indexOf(block.from), b = sourceNumbers.indexOf(block.to); return a < 0 || b < a ? [] : sourceNumbers.slice(a, b + 1); });
  if (coverage.length !== sourceNumbers.length || new Set(coverage).size !== sourceNumbers.length || blocks.length < 2 || arranged.options.status !== 'none' || arranged.placed.status === 'asking' || new Set(sourceNumbers).size !== sourceNumbers.length) return null;
  const move = (from: number, to: number) => {
    if (from === to) return;
    onTrial();
    arranged.setHandOrder(moveBlock(blocks, from, to).map(({ from, to }) => ({ from, to })));
    arranged.setTrying({ kind: 'structure', index: -1 });
    setDragging(null);
    setOver(null);
  };
  return <div className="section-rail" aria-label="Section order">
    <div className="rail-label"><span>Section order</span><span>{trial ? 'Previewing a different order' : 'Move a section earlier or later'}</span></div>
    <div className="rail-blocks">
      {blocks.map((block, index) => <div key={`${block.from}-${index}`} className={`rail-block${over === index ? ' drop-over' : ''}${dragging === index ? ' dragging' : ''}`} style={{ flexGrow: block.beats }} draggable
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; setDragging(index); }}
        onDragOver={(e) => { if (dragging === null) return; e.preventDefault(); setOver(index); }}
        onDrop={(e) => { e.preventDefault(); if (dragging !== null) move(dragging, index); }}
        onDragEnd={() => { setDragging(null); setOver(null); }}>
        <GripVertical size={12} aria-hidden/><span title={`Source bars ${block.from} to ${block.to}`}>{block.name || `Bars ${block.from}–${block.to}`}</span>
        <span className="rail-moves"><button aria-label={`Move section ${index + 1} earlier`} disabled={index === 0} onClick={() => move(index, index - 1)}><ChevronLeft size={12}/></button><button aria-label={`Move section ${index + 1} later`} disabled={index === blocks.length - 1} onClick={() => move(index, index + 1)}><ChevronRight size={12}/></button></span>
      </div>)}
    </div>
    {trial && <div className="rail-confirm"><button onClick={() => { onTrial(); arranged.setTrying(null); }}><Undo2 size={13}/> Original order</button><button onClick={() => { onTrial(); arranged.keep(); }}>Keep this order</button></div>}
  </div>;
}

export function Workspace({ arranged, loaded, busy, demo, prepared, render, sourceNote, onStage, initialSetup, onExplore }: { arranged: Arranged; loaded: LoadedSketch; busy: boolean; demo: boolean; prepared: DemoPiece['runs']; render?: string; sourceNote: string | null; onStage: (stage: string) => void; initialSetup?: InitialSetup; onExplore?: () => void }) {
  const guide=useTutorialGuide();
  const [picked, setPicked] = useState<Selection | null>(null);
  const [mode, setMode] = useState<'arrange' | 'expand' | 'recompose'>('arrange');
  const [chosen, setChosen] = useState<number | null>(arranged.trying?.kind==='option'?arranged.trying.index:null);
  const [stage, setStage] = useState('Study');
  const previousStage = useRef('Study');
  const [zoom, setZoom] = useState(.8);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [layers, setLayers] = useState({ sections: true, chords: true, marks: true });
  const [navigationHost, setNavigationHost] = useState<HTMLElement | null>(null);
  const [actionHost, setActionHost] = useState<HTMLDivElement | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  const scoreView = useRef<ScoreViewHandle>(null);
  const resetStepScroll = () => {
    const pane = document.querySelector<HTMLElement>('.inspector-scroll');
    if (pane) { pane.scrollTop = 0; pane.scrollTo?.({ top: 0, behavior: 'auto' }); }
    if (window.matchMedia?.('(max-width: 760px)').matches) document.querySelector('.composer-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const changeStage = (name: string) => {
    setStage(name); onStage(name);
    if (previousStage.current !== name) requestAnimationFrame(resetStepScroll);
    previousStage.current = name;
  };
  const pendingAudition = useRef<{ index: number; beat: number; generation: object | null } | null>(null);
  const auditionFrame = useRef<number | null>(null);
  const waitingChoice = useRef<{ index: number; generation: object | null } | null>(null);
  const data = arranged.overview;
  const page = arranged.page ?? loaded;
  const cursor = useMemo(() => scoreCursor(page.score, data?.bars ?? []), [page.score, data]);
  const attention = useMemo(() => attentionOf(arranged), [arranged.piece, arranged.answered, arranged.options, arranged.trying, arranged.tracks, arranged.tracksConfirmed]);
  const shownAttention = stage === 'Study' || stage === 'Setup' ? attention : attention.filter((a) => a.kind !== 'missing');
  const progress = useMemo(() => writingProgress(arranged), [arranged.options, arranged.trying]);
  const matchingOptions = arranged.options.status !== 'ready' || !arranged.options.input.intent || arranged.options.input.intent === mode;
  const plans = mode === 'recompose' ? (arranged.recompose.status === 'ready' && !arranged.recomposed ? arranged.recompose.plans : null) : arranged.options.status === 'ready' && matchingOptions && !arranged.recomposed ? arranged.options.plans : null;
  const generation = mode !== 'recompose' ? (arranged.options.status === 'ready' ? arranged.options.input : null) : (arranged.recompose.status === 'ready' ? arranged.recompose.input : null);
  const clearAudition = () => { waitingChoice.current = null; pendingAudition.current = null; if (auditionFrame.current !== null) cancelAnimationFrame(auditionFrame.current); };
  useEffect(() => {
    setChosen(null); clearAudition();
    if (generation && window.matchMedia?.("(max-width: 760px)").matches) requestAnimationFrame(() => document.querySelector('.idea-comparison')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [mode, generation]);
  const written = mode !== 'recompose' && matchingOptions && arranged.options.status === 'ready' ? Object.entries(arranged.options.notes).flatMap(([k, n]) => n.status === 'ready' ? [Number(k)] : []) : [];
  const previewed = mode !== 'recompose' && matchingOptions && arranged.options.status === 'ready' ? Object.entries(arranged.options.notes).flatMap(([k, n]) => n.status === 'ready' && n.preview ? [Number(k)] : []) : [];
  const marks = arranged.studyMarks && { ...arranged.studyMarks, sections: layers.sections ? arranged.studyMarks.sections : [], chords: layers.chords ? arranged.studyMarks.chords : [], passages: layers.marks ? arranged.studyMarks.passages : [] };
  const pick = (selection: Selection | null) => { clearAudition(); setPicked(selection); if (selection) { setInspectorOpen(true); if (window.matchMedia?.("(max-width: 760px)").matches) requestAnimationFrame(() => document.querySelector(".composer-inspector")?.scrollIntoView({ behavior: "smooth", block: "start" })); } };
  const choose = (index: number, audition = false) => {
    if (mode !== 'recompose' && !matchingOptions) return;
    const beat = playhead.beat;
    clearAudition();
    setChosen(index);
    guide?.mark('plan-chosen',guide.completeOptions.includes(index as 0|1),true);
    if(audition)guide?.mark(index===0?'audition-a':'audition-b',true,true);
    setPicked(null);
    setInspectorOpen(true);
    const notes = arranged.options.status === 'ready' ? arranged.options.notes[index] : null;
    if (mode !== 'recompose' && notes?.status === 'ready') {
      arranged.setTrying({ kind: 'option', index }, true);
      waitingChoice.current = null;
      if (audition) pendingAudition.current = { index, beat, generation };
    } else if (mode !== 'recompose') {
      waitingChoice.current = { index, generation };
      if (audition) { pendingAudition.current = { index, beat, generation }; if (notes?.status !== 'asking' && !demo) void arranged.askPreview(index); }
    }
  };
  useEffect(() => {
    const pending = waitingChoice.current;
    if (!pending || pending.generation !== generation || arranged.options.status !== 'ready' || arranged.options.notes[pending.index]?.status !== 'ready') return;
    const index = pending.index;
    waitingChoice.current = null;
    arranged.setTrying({ kind: 'option', index }, true);
  }, [arranged.options]);
  useEffect(() => {
    const pending = pendingAudition.current;
    if (!pending || pending.generation !== generation || arranged.trying?.kind !== 'option' || arranged.trying.index !== pending.index) return;
    pendingAudition.current = null;
    // The overview has committed this version before its shared transport is asked to play it.
    auditionFrame.current = requestAnimationFrame(() => { playhead.seek(pending.beat); if (!playhead.get().playing) playhead.play(); });
  }, [arranged.trying, data]);
  useEffect(() => () => { if (auditionFrame.current !== null) cancelAnimationFrame(auditionFrame.current); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPicked(null); return; }
      if ((e.target as Element)?.closest('input,textarea,select,button,[contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); playhead.get().playing ? playhead.pause() : playhead.play(); }
      if (e.key === 'Escape') setPicked(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { if (picked?.kind === 'attention' && !attention.some((a) => a.id === picked.id)) setPicked(null); }, [attention, picked]);
  const tap = (at: Tap) => {
    if (!at?.bar) return setPicked(null);
    const measure = page.score.parts.find((p) => p.id === at.bar!.partId)?.measures[at.bar.measureIndex];
    if (!measure || data?.bars.filter((b) => b.number === measure.number).length !== 1) return;
    clearAudition();
    pick({ kind: 'bars', from: measure.number, to: measure.number });
    const beat = data.bars.find((b) => b.number === measure.number)!.start;
    playhead.seek(beat);
  };
  const highlights: BarHighlight[] = picked && (picked.kind === 'bars' || picked.kind === 'section') ? page.score.parts.flatMap((part) => {
    const all = data?.bars.map((b) => b.number) ?? [];
    const start = all.indexOf(picked.from), end = all.indexOf(picked.to);
    return part.measures.flatMap((m, measureIndex) => start >= 0 && all.indexOf(m.number) >= start && all.indexOf(m.number) <= end ? [{ id: 'picked', partId: part.id, measureIndex, kind: 'selected' }] : []);
  }) : [];
  const numbers = data?.bars.map((b) => b.number) ?? [];
  const selectRange = (from: string, to: string) => { clearAudition(); arranged.selectRange(from, to); pick({ kind: 'bars', from, to }); };
  const shift = (direction: number) => {
    if (!arranged.view) return;
    const from = numbers.indexOf(arranged.view.from), to = numbers.indexOf(arranged.view.to), count = Math.max(1, to - from + 1);
    const start = Math.max(0, Math.min(numbers.length - count, from + direction * count));
    selectRange(numbers[start]!, numbers[Math.min(start + count - 1, numbers.length - 1)]!);
  };
  const candidate = arranged.recomposed ? 0 : mode !== 'recompose' ? (arranged.trying?.kind === 'option' ? arranged.trying.index : chosen ?? written[0]) : undefined;
  const switchable = candidate !== undefined && arranged.options.status === 'ready' && arranged.options.notes[candidate]?.status === 'ready' ? candidate : undefined;
  const hasVersions = matchingOptions && (mode !== 'recompose' || !!arranged.recomposed) && arranged.options.status === 'ready' && Object.values(arranged.options.notes).some((n) => n.status === 'ready');
  const writing = progress.find((p) => p.state === 'writing');
  return <div className={`workspace${inspectorOpen ? '' : ' inspector-hidden'}${expanded ? ' overview-expanded' : ''}`}>
    <nav className="workflow" aria-label="Composition workflow" ref={setNavigationHost}/>
    <div className="workspace-body">
      <main className="music-space">
        <div className="overview-shell">
          <div className="overview-title"><span>Whole piece <span className="music-meta">{numbers.length} bars / {data?.rows.length ?? 0} tracks</span></span><div>{stage === "Study" && <button className="text-control" aria-expanded={reordering} onClick={() => setReordering(!reordering)}>Reorder sections</button>}<button className="text-control" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Compact overview' : 'Expand overview'}</button><button className="icon-control" aria-label={inspectorOpen ? 'Hide controls' : 'Show controls'} onClick={() => setInspectorOpen(!inspectorOpen)}>{inspectorOpen ? <PanelRightClose size={16}/> : <PanelRightOpen size={16}/>}</button></div></div>
          <div className="overview-scroll">{data && arranged.view && <PieceView data={data} sections={arranged.sections} moments={arranged.moments} selected={arranged.view} focus={arranged.focus} solo={arranged.solo} instrumentOf={arranged.instrumentOf} hasNew={arranged.trying?.kind === 'option'} render={render} onSelect={(bar) => { clearAudition(); arranged.select(bar); }} onSelectRange={selectRange} onFocus={arranged.setFocus} onSolo={arranged.toggleSolo} onBeat={(beat) => scoreView.current?.showPlaying(cursor(beat))} onTempoInspect={()=>guide?.mark('tempo-inspected',true,true)} attention={shownAttention} forms={arranged.study.status === 'ready' ? arranged.study.answer.sections : []} progress={progress} picked={picked} onPick={pick}/>}</div>
          {stage === 'Study' && reordering && <SectionRail arranged={arranged} onTrial={() => { clearAudition(); setPicked(null); }}/>}
        </div>
        {data && <Compare data={data} sections={arranged.sections} orders={[]} ordered={arranged.trying?.kind === 'structure' ? arranged.trying.index : null} onOrder={(index) => { clearAudition(); setPicked(null); arranged.setTrying(index === null ? null : { kind: 'structure', index }); }} onKeepOrder={() => { clearAudition(); setPicked(null); arranged.keep(); }} plans={stage === 'Pick' ? plans : null} recompose={mode === 'recompose'} chosen={chosen} onChoose={(index) => choose(index)} onAudition={(index) => choose(index, true)} compact written={written} previewed={previewed} onPreview={demo ? undefined : (index) => void arranged.askPreview(index)} busy={busy} onShowBars={selectRange}/>}
        <section className="score-desk" aria-label="Notation">
          <div className="score-toolbar">
            <div className="passage-controls"><span>Bars</span><select aria-label="First visible bar" value={arranged.view?.from ?? numbers[0] ?? ''} onChange={(e) => selectRange(e.target.value, numbers.indexOf(e.target.value) > numbers.indexOf(arranged.view?.to ?? '') ? e.target.value : arranged.view!.to)}>{numbers.map((n) => <option key={n}>{n}</option>)}</select><span>to</span><select aria-label="Last visible bar" value={arranged.view?.to ?? numbers.at(-1) ?? ''} onChange={(e) => selectRange(numbers.indexOf(e.target.value) < numbers.indexOf(arranged.view?.from ?? '') ? e.target.value : arranged.view!.from, e.target.value)}>{numbers.map((n) => <option key={n}>{n}</option>)}</select><button className="icon-control" aria-label="Previous passage" disabled={arranged.view?.from === numbers[0]} onClick={() => shift(-1)}><ChevronLeft size={15}/></button><button className="icon-control" aria-label="Next passage" disabled={arranged.view?.to === numbers.at(-1)} onClick={() => shift(1)}><ChevronRight size={15}/></button><button className="text-control" onClick={() => { if (numbers.length) { clearAudition(); arranged.selectRange(numbers[0]!, numbers.at(-1)!); setPicked(null); } }}>All bars</button></div>
            <div className="score-tools"><details className="layer-menu"><summary aria-label="Score layers"><Layers size={15}/><span>Layers</span></summary><div>{(['sections', 'chords', 'marks'] as const).map((layer) => <label key={layer}><input type="checkbox" checked={layers[layer]} onChange={() => setLayers({ ...layers, [layer]: !layers[layer] })}/>{layer[0]!.toUpperCase() + layer.slice(1)}</label>)}</div></details><button className="icon-control" aria-label="Smaller" disabled={zoom <= .5} onClick={() => setZoom(Math.max(.5, zoom - .1))}><Minus size={14}/></button><button className="zoom-reset" aria-label="Reset zoom" onClick={() => setZoom(.8)}>{Math.round(zoom * 100)}%</button><button className="icon-control" aria-label="Bigger" disabled={zoom >= 1.4} onClick={() => setZoom(Math.min(1.4, zoom + .1))}><Plus size={14}/></button></div>
          </div>
          <div className="score-caption"><span className="score-name">{loaded.fileName.replace(/\.[^.]+$/, '')}</span><span className="score-provenance"><i className="source-dot"/>Your notes <i className="new-dot"/>New notes</span>{hasVersions && <span className="sheet-switch" role="group" aria-label="What's on the score"><button aria-pressed={!arranged.trying} className={!arranged.trying ? 'on' : ''} onClick={() => { clearAudition(); arranged.setTrying(null, true); }}>Original</button><button disabled={switchable === undefined} aria-pressed={arranged.trying?.kind === 'option'} className={arranged.trying?.kind === 'option' ? 'on' : ''} onClick={() => { if (switchable !== undefined) choose(switchable); }}>With new notes</button></span>}</div>
          <div className="notation-scroll">{drawError && <p className="score-error" role="alert">The notation couldn't be drawn. {drawError}</p>}<ScoreView ref={scoreView} xmlText={page.xmlText} noTitle score={page.score} zoom={zoom} highlights={highlights} noteMarks={NO_MARKS} studyMarks={marks} onTap={tap} onDrawn={(_, error) => setDrawError(error)}/></div>
          <div className="score-status" role="status"><span>{writing ? `Writing bars ${writing.from} to ${writing.to}` : sourceNote || (render ? 'Playing the saved instrument bounce' : 'Select a passage to explore or change it')}</span><span>{picked?.kind === 'bars' ? `Selected bar ${picked.from}${picked.to !== picked.from ? ` to ${picked.to}` : ''}` : 'Space to play / Escape to close'}</span></div>
        </section>
      </main>
      <aside className="composer-inspector" aria-label="Composition controls"><div className="inspector-topline"><span>{picked ? 'Your selection' : stage === 'Setup' ? 'Your direction' : stage === 'Pick' ? 'Your choice' : stage === 'Export' ? 'Your score' : 'Composition'}</span><button className="icon-control" aria-label="Hide controls" onClick={() => setInspectorOpen(false)}><PanelRightClose size={16}/></button></div><div className="inspector-scroll"><ArrangePanel onExplore={onExplore} initialSetup={initialSetup} arranged={arranged} busy={busy} demo={demo} prepared={prepared} onStage={changeStage} selection={picked} attention={attention} onPick={pick} onMode={(next) => { if (next !== mode) { clearAudition(); setMode(next); if (!arranged.recomposed) arranged.setTrying(null, true); } }} chosenPlan={chosen} onChoosePlan={(index) => { clearAudition(); setChosen(index); }} navigationHost={navigationHost} actionHost={actionHost} comparisonHosted onNavigate={() => { clearAudition(); setPicked(null); setInspectorOpen(true); requestAnimationFrame(resetStepScroll); }}/></div></aside>
    </div>
    <div className="inspector-action" ref={setActionHost}/>
  </div>;
}

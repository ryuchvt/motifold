import { useEffect, useMemo, useRef, useState } from 'react';
import { parseScore, type Score } from '../score';
import { onlyBars, scoreTracks } from './arrange';
import { loadDemoCatalog, type DemoCatalog, type DemoOutcome, type DemoPiece } from './demo';
import { TEMPLATES, instrumentFromName } from './orchestra';
import { pieceData } from './pieceData';
import { PieceView } from './PieceView';
import { ScoreView, type ScoreViewHandle } from './ScoreView';
import { scoreCursor } from './scoreCursor';
import { passagePlanHarmony } from './planHarmony';
import { playhead, usePlayhead } from './playhead';
import './outcome-explorer.css';

type Filters={intent:DemoOutcome['intent'];ensemble:string;mood:string;option:0|1};
type Loaded={outcome:DemoOutcome;xmlText:string;score:Score;hash:string};
const NONE:never[]=[];
const mood=(value:string)=>value.trim().toLowerCase()==='neutral'||!value.trim()?'Neutral':value;
export const sameOutcomeRecipe=(a:DemoOutcome,b:DemoOutcome)=>a.runKey===b.runKey&&a.intent===b.intent&&a.ensemble===b.ensemble&&mood(a.mood)===mood(b.mood)&&a.freedom===b.freedom&&a.bars===b.bars&&a.sourceBars===b.sourceBars;
export const boundOutcomeRender=(outcome:DemoOutcome,actualHash:string)=>outcome.status==='complete'&&outcome.render&&outcome.renderXmlSha256===actualHash?outcome.render:undefined;
const digest=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
/** Use the exported playback tracks so printed dynamics, joined ties and pizzicato match the MIDI. */
export function recordedPieceData(score:Score) {
  const data=pieceData(score,[],[]);
  data.rows=scoreTracks(score).map(track=>{
    const heights=track.notes.map(note=>note.height);
    return{label:track.name,low:Math.min(...heights),high:Math.max(...heights),tall:false,notes:track.notes.map(note=>({...note,kind:null,...(track.program===45?{pizz:true}:{})}))};
  });
  return data;
}

/** Prepared scores only. This component has no analysis or generation hook and never installs a live transport. */
export function OutcomeExplorer({piece,onExit}:{piece:DemoPiece;onExit:()=>void}) {
  const [catalog,setCatalog]=useState<DemoCatalog|null>(null),[catalogDone,setCatalogDone]=useState(false);
  const [filters,setFilters]=useState<Filters>({intent:'arrange',ensemble:'String orchestra',mood:'Neutral',option:0});
  const [record,setRecord]=useState<Loaded|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false);
  const [view,setView]=useState({from:'1',to:'8'}),[solo,setSolo]=useState<string[]>([]),[zoom,setZoom]=useState(.8);
  const [drawError,setDrawError]=useState<string|null>(null);
  const current=useRef<Loaded|null>(null),ticket=useRef(0),resume=useRef<{id:string;beat:number;playing:boolean}|null>(null);
  const scoreView=useRef<ScoreViewHandle>(null);
  const transport=usePlayhead();
  useEffect(()=>{let active=true;setCatalogDone(false);void loadDemoCatalog(piece).then(value=>{if(!active)return;setCatalog(value);setCatalogDone(true);const first=value?.outcomes.find(item=>item.status==='complete');if(first)setFilters({intent:first.intent,ensemble:first.ensemble,mood:mood(first.mood),option:first.option})});return()=>{active=false}},[piece]);
  const selected=catalog?.outcomes.find(item=>item.intent===filters.intent&&item.ensemble===filters.ensemble&&mood(item.mood)===filters.mood&&item.option===filters.option);
  useEffect(()=>{
    const mine=++ticket.current,stop=new AbortController();
    const previous=current.current,comparing=!!previous&&!!selected&&sameOutcomeRecipe(previous.outcome,selected);
    const at=comparing?playhead.beat:0,wasPlaying=comparing&&playhead.get().playing;
    playhead.pause();setRecord(null);setError(null);setSolo([]);setDrawError(null);resume.current=null;
    if(!selected||selected.status==='unavailable'||!selected.xml){setLoading(false);return()=>stop.abort()}
    setLoading(true);
    void (async()=>{
      try{
        const response=await fetch(selected.xml!,{signal:stop.signal});if(!response.ok)throw Error('The recorded score could not be opened.');
        const bytes=new Uint8Array(await response.arrayBuffer()),hash=await digest(bytes);
        if(selected.xmlSha256&&hash!==selected.xmlSha256)throw Error('This score does not match its recorded export. Choose another prepared outcome.');
        const xmlText=new TextDecoder().decode(bytes),score=parseScore(xmlText);
        if(!score.parts.length||!score.parts.some(part=>part.notes.some(note=>!note.rest&&!note.grace))||score.parts.some(part=>part.measures.length!==selected.bars))throw Error('The recorded score is incomplete. Choose another prepared outcome.');
        if(ticket.current!==mine||stop.signal.aborted)return;
        const next={outcome:selected,xmlText,score,hash};current.current=next;
        const labels=score.parts[0]!.measures.map(bar=>bar.number);
        setView(old=>comparing&&labels.includes(old.from)&&labels.includes(old.to)?old:{from:labels[0]!,to:labels[Math.min(7,labels.length-1)]!});
        resume.current={id:selected.id,beat:at,playing:wasPlaying};setRecord(next);setLoading(false);
      }catch(failure){if(ticket.current===mine&&!stop.signal.aborted){setLoading(false);setError(failure instanceof Error?failure.message:'The recorded score could not be opened.')}}
    })();
    return()=>stop.abort();
  },[selected?.id]);
  const data=useMemo(()=>record?recordedPieceData(record.score):null,[record]);
  const page=useMemo(()=>{if(!record)return null;const xmlText=onlyBars(record.xmlText,view.from,view.to);return{xmlText,score:parseScore(xmlText)}},[record,view]);
  const harmony=useMemo(()=>record?.outcome.planHarmony?.length?passagePlanHarmony(record.score,view,record.outcome.planHarmony):null,[record,view]);
  const cursor=useMemo(()=>page&&data?scoreCursor(page.score,data.bars):()=>null,[page,data]);
  useEffect(()=>{const held=resume.current;if(!data||!record||held?.id!==record.outcome.id)return;resume.current=null;const frame=requestAnimationFrame(()=>{playhead.seek(Math.max(0,Math.min(data.totalBeats,held.beat)));if(held.playing)playhead.play()});return()=>cancelAnimationFrame(frame)},[record,data]);
  useEffect(()=>()=>{ticket.current++;playhead.stop()},[]);
  const available=catalog?.outcomes.filter(item=>item.status==='complete').length??0;
  const choices=catalog?.outcomes.filter(item=>item.intent===filters.intent&&item.ensemble===filters.ensemble&&mood(item.mood)===filters.mood)??[];
  const moods=[...new Set((catalog?.outcomes.filter(item=>item.intent==='recompose')??[]).map(item=>mood(item.mood)))];
  const boundRender=record?boundOutcomeRender(record.outcome,record.hash):undefined;
  const exactRender=solo.length===0?boundRender:undefined;
  const selectRange=(from:string,to:string)=>setView({from,to});
  const changeDirection=(intent:Filters['intent'])=>setFilters(old=>{
    const complete=catalog?.outcomes.filter(item=>item.intent===intent&&item.status==='complete')??[];
    const neutral=complete.filter(item=>mood(item.mood)==='Neutral');
    const local=neutral.filter(item=>item.ensemble===old.ensemble);
    const pool=local.length?local:neutral.length?neutral:complete;
    const prepared=pool.find(item=>item.option===0)??pool[0];
    return prepared?{intent,ensemble:prepared.ensemble,mood:mood(prepared.mood),option:prepared.option}:{...old,intent,mood:'Neutral',option:0};
  });
  return <main className="outcome-explorer">
    <div className="explorer-heading"><div><h1>Explore the recorded outcomes</h1><p>Choose a prepared score, compare A and B, and take the complete result into your DAW. No credit is used.</p></div><button className="button" onClick={onExit}>Back to the start</button></div>
    <div className="explorer-filters">
      <label>Direction<select aria-label="Recorded direction" value={filters.intent} onChange={event=>changeDirection(event.target.value as Filters['intent'])}><option value="arrange">Arrange · original bars</option><option value="expand">Expand · longer, same character</option><option value="recompose">Recompose · recognisable tune, new harmony</option></select></label>
      <label>Players<select aria-label="Recorded ensemble" value={filters.ensemble} onChange={event=>setFilters(old=>({...old,ensemble:event.target.value,option:0}))}>{TEMPLATES.map(item=><option key={item.name}>{item.name}</option>)}</select></label>
      {filters.intent==='recompose'&&<label>Mood<select aria-label="Recorded mood" value={filters.mood} onChange={event=>setFilters(old=>({...old,mood:event.target.value,option:0}))}>{moods.map(value=><option key={value}>{value}</option>)}</select></label>}
      <span className="explorer-availability" role="status">{!catalogDone?'Loading the recorded catalog':catalog?`${available} of ${catalog.outcomes.length} outcomes prepared`:'The outcome catalog is not available yet.'}</span>
    </div>
    {selected&&<p className="explorer-preset">{selected.status==='unavailable'?'Planned preset':'Recorded preset'}: {selected.bars} bars. {selected.intent==='arrange'?'Neutral, original bars.':selected.intent==='expand'?`Neutral, same character, ${selected.bars-selected.sourceBars} added bars.`:selected.freedom===2?'Reshaped 2: recognisable melody with new harmony.':`Freedom ${selected.freedom??'not specified'}.`} {selected.status==='unavailable'?'There is no recording for this preset yet.':'These settings are fixed in this recorded run.'}</p>}
    <div className="explorer-choices" role="group" aria-label="Recorded A and B">
      {([0,1]as const).map(option=>{const item=choices.find(row=>row.option===option);return <button key={option} className={`explorer-choice${filters.option===option?' on':''}`} aria-pressed={filters.option===option} onClick={()=>setFilters(old=>({...old,option}))}><span>{option===0?'A':'B'}</span><strong>{item?.status!=='unavailable'&&item?.name?item.name:`Option ${option===0?'A':'B'}`}</strong><small>{item?.status==='complete'?`${item.bars} bars, complete`:item?.status==='preview'?'Recorded preview only':'Not prepared'}</small></button>})}
    </div>
    {selected?.status==='unavailable'&&<p className="explorer-unavailable" role="status">{selected.reason??'This outcome has not been recorded.'} Choose another prepared outcome. No request will be sent to a model.</p>}
    {catalogDone&&catalog&&!selected&&<p role="status">This combination has no recorded outcome. Choose another prepared choice.</p>}
    {loading&&<p role="status">Opening the recorded score.</p>}{error&&<p className="error" role="alert">{error}</p>}
    {record&&data&&page&&<>
      <div className="explorer-transport"><strong>{record.outcome.name}</strong><button className="button" onClick={()=>transport.playing?playhead.pause():playhead.play()}>{transport.playing?'Pause':exactRender?'Play DAW render':'Play browser instruments'}</button><button className="button" onClick={()=>playhead.stop()}>Stop</button><span>{transport.words}</span><span className="explorer-render-slot">{exactRender?'DAW render for this exact score':boundRender?'Solo playback uses browser instruments.':record.outcome.render?'DAW render does not match this export. Browser instruments.':'DAW render not added. Browser instruments.'}</span></div>
      <p className="explorer-audio-explanation">{boundRender?'The model answers and MIDI are recorded. This DAW audio is bound to the same exported score.':'The model answers and MIDI are recorded. Playback uses browser instruments. DAW audio has not been added. It can be rendered later from this exact outcome MIDI.'}{boundRender&&record.outcome.renderCredit&&` ${record.outcome.renderCredit}`}</p>
      <p className="explorer-score-label">Prepared final score · overview colors do not identify authorship.</p>
      <div className="explorer-overview"><PieceView key={record.outcome.id} data={data} sections={[]} moments={[]} selected={view} focus={null} solo={solo} instrumentOf={label=>instrumentFromName(label)??label} hasNew={false} render={exactRender} onSelect={bar=>{const index=data.bars.findIndex(item=>item.number===bar);setView({from:bar,to:data.bars[Math.min(index+7,data.bars.length-1)]!.number})}} onSelectRange={selectRange} onFocus={()=>{}} onSolo={label=>setSolo(old=>old.includes(label)?old.filter(item=>item!==label):[...old,label])} onBeat={beat=>scoreView.current?.showPlaying(cursor(beat))}/></div>
      <section className="score-desk explorer-score" aria-label="Recorded notation"><div className="score-toolbar"><label>Bars <select aria-label="First recorded bar" value={view.from} onChange={event=>{const i=data.bars.findIndex(bar=>bar.number===event.target.value);setView({from:event.target.value,to:data.bars[Math.min(i+7,data.bars.length-1)]!.number})}}>{data.bars.map(bar=><option key={bar.number}>{bar.number}</option>)}</select></label><span>to {view.to}</span><button className="button small" onClick={()=>setZoom(value=>Math.max(.35,value-.1))}>Smaller</button><button className="button small" onClick={()=>setZoom(value=>Math.min(1.5,value+.1))}>Bigger</button><span>{record.outcome.bars} bars in the complete export</span></div>{harmony&&<div className="explorer-harmony" role="region" aria-label="Planned harmony" tabIndex={0}><p><strong>Planned harmony</strong><span>From this option’s recorded plan. Compare with the notes.</span></p>{harmony.spans.length?<dl>{harmony.spans.map((span,index)=><div key={index}><dt>Bars {span.from} to {span.to}</dt><dd>{span.chords}</dd></div>)}</dl>:<p>{harmony.unaddressable?"The planned bar labels cannot be matched to this score.":"No planned harmony was saved for these bars."}</p>}</div>}<div className="notation-scroll"><ScoreView ref={scoreView} xmlText={page.xmlText} score={page.score} zoom={zoom} noTitle highlights={NONE} noteMarks={NONE} onTap={()=>{}} onDrawn={(_drawn,failure)=>setDrawError(failure)}/>{drawError&&<p className="error">{drawError}</p>}</div></section>
      <footer className="explorer-downloads">{record.outcome.status==='complete'?<><a className="button primary" href={record.outcome.zip} download>Download MIDI and score</a><a className="button" href={record.outcome.midi} download>Full MIDI</a><a className="button" href={record.outcome.xml} download>MusicXML</a><p>Downloads contain this complete recorded score. Soloing a part only changes browser playback.</p></>:<p>This is a preview. Its complete arrangement has not been recorded.</p>}</footer>
    </>}
  </main>;
}

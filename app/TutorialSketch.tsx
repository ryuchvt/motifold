import { useEffect, useMemo, useRef, useState } from 'react';
import { createPreview, beatClock, type HeardNote } from './audio/preview';
import { loadManifest } from './audio/samples';
import { readMidi } from './midi';
import { playedFromMidi } from './timing';
import { onlyBars } from './arrange';
import { parseScore } from '../score';
import { recordedPieceData } from './OutcomeExplorer';
import { PieceView } from './PieceView';
import { ScoreView, type ScoreViewHandle } from './ScoreView';
import { scoreCursor } from './scoreCursor';
import type { DemoPiece } from './demo';
import type { LoadedSketch } from './Studio';
import { useTutorialGuide } from './Tutorial';

const NONE:never[]=[];
const clock=(seconds:number)=>`${Math.floor(seconds/60)}:${(seconds%60).toFixed(1).padStart(4,'0')}`;
export function rawSketchData(bytes:Uint8Array){
  const midi=readMidi(bytes),played=playedFromMidi(bytes);
  const offset=beatClock(midi.tempos.map(point=>({beat:point.tick/midi.ppq,qpm:point.qpm}))).seconds(midi.firstTick/midi.ppq);
  const notes:HeardNote[]=played.notes.map(note=>({start:note.at,length:note.end-note.at,height:note.height,velocity:note.velocity,voice:'pluck',instrument:'Piano',level:1}));
  const playbackNotes:HeardNote[]=played.notes.map(note=>{
    const pedal=[...played.pedal].reverse().find(point=>point.at<=note.end);
    const release=pedal?.down?played.pedal.find(point=>point.at>note.end&&!point.down)?.at:undefined;
    return{start:note.at,length:Math.max(note.end,release??note.end)-note.at,height:note.height,velocity:note.velocity,voice:'pluck',instrument:'Piano',level:1};
  });
  const total=Math.max(1,...notes.map(note=>note.start+note.length));
  return{notes,playbackNotes,total,offset,claimed:played.claimed};
}

/** The raw MIDI is read and played locally, with its unquantised timing. No bar-finding answer is invented. */
export function RawSketch({piece,onAccept,busy}:{piece:DemoPiece;onAccept:()=>void;busy:boolean}){
  const guide=useTutorialGuide();
  const[data,setData]=useState<ReturnType<typeof rawSketchData>|null>(null),[error,setError]=useState<string|null>(null),[playing,setPlaying]=useState(false);
  const sound=useRef<ReturnType<typeof createPreview>|null>(null),heard=useRef(0),head=useRef<SVGLineElement>(null),where=useRef<HTMLOutputElement>(null),audition=useRef(0);
  useEffect(()=>{const stop=new AbortController();setData(null);setError(null);void loadManifest();void fetch(piece.midi,{signal:stop.signal}).then(async response=>{if(!response.ok)throw Error('The original MIDI could not be opened.');const parsed=rawSketchData(new Uint8Array(await response.arrayBuffer()));if(!stop.signal.aborted)setData(parsed)}).catch(failure=>{if(!stop.signal.aborted)setError(failure instanceof Error?failure.message:'The original MIDI could not be opened.')});return()=>{stop.abort();audition.current++;sound.current?.stop()}},[piece.midi]);
  const move=(at:number)=>{heard.current=at;if(head.current&&data){head.current.setAttribute('x1',String(Math.min(at,data.total)/data.total*1000));head.current.setAttribute('x2',String(Math.min(at,data.total)/data.total*1000))}if(where.current)where.current.textContent=clock(at)};
  const play=()=>{
    if(!data)return;
    const mine=++audition.current,from=heard.current;let marked=false;
    try{
      sound.current??=createPreview();setPlaying(true);
      sound.current.play(data.playbackNotes,[{beat:0,qpm:60}],from,at=>{
        if(audition.current!==mine)return;
        move(at);
        // resume/sample loading is asynchronous. A void play() return is not proof of playback.
        if(!marked&&at>from){marked=true;guide?.mark('raw-played',true,true)}
      },()=>{if(audition.current===mine){setPlaying(false);move(0)}});
    }catch{audition.current++;setPlaying(false);setError('Browser playback is unavailable. You can download the original MIDI and continue with its accepted bars.')}
  };
  const stop=(reset=false)=>{audition.current++;sound.current?.stop();setPlaying(false);if(reset)move(0)};
  const low=data?Math.min(...data.notes.map(note=>note.height)):48,high=data?Math.max(...data.notes.map(note=>note.height)):84;
  return <main className="tutorial-sketch"><h1>My piano sketch, before analysis</h1><p>This is the original MIDI. I played without a click. Its note positions and note lengths are uneven, and its file metadata still says {data?`${data.claimed.beats}/${data.claimed.beatType}`:'the DAW metre'}.</p>
    {data&&<><div className="tutorial-source-facts"><span>{data.notes.length} original note attacks</span><span>{clock(data.total)} of key events</span><span>{clock(data.offset)} original DAW offset</span></div><div className="tutorial-raw-chart"><svg viewBox="0 0 1000 210" role="img" aria-label="The original notes on their freely played clock, before musical bars">{Array.from({length:Math.floor(data.total/10)+1},(_,index)=><g key={index}><line x1={index*10/data.total*1000} x2={index*10/data.total*1000} y1={0} y2={185}/><text x={index*10/data.total*1000+3} y={205}>{clock(index*10)}</text></g>)}{data.notes.map((note,index)=><rect key={index} x={note.start/data.total*1000} y={8+(high-note.height)/Math.max(high-low,1)*165} width={Math.max(1,note.length/data.total*1000)} height={3} opacity={.2+(note.velocity??80)/127*.8}/>)}<line className="raw-playhead" ref={head} x1={0} x2={0} y1={0} y2={185}/></svg></div><div className="tutorial-sketch-actions"><button data-tutorial="raw-play" className="button" onClick={()=>playing?stop():play()}>{playing?'Pause original MIDI':'Play original MIDI'}</button><button className="button" onClick={()=>stop(true)}>Stop</button><output ref={where}>0:00.0</output><a className="button" href={piece.midi} download>Download original MIDI</a></div><p className="tutorial-provenance">Playback uses a browser piano and begins at the file's first event, so you do not wait through its DAW offset. The chart shows the original key releases. Browser playback also follows the MIDI pedal. The downloaded original keeps the offset and all {data.notes.length} attacks.</p></>}
    {!data&&!error&&<p role="status">Opening the original MIDI locally.</p>}{error&&<p className="error" role="alert">{error}</p>}
    <div className="tutorial-sketch-actions"><button data-tutorial="accept-bars" className="button primary" disabled={busy} onClick={()=>{stop(true);onAccept()}}>{busy?'Opening accepted bars':'Open the saved accepted bars'}</button></div>
  </main>;
}

/** The accepted source before analysis. The tempo map is already saved and labelled as such. */
export function AcceptedSketch({loaded,piece,onInspect,onStudy,canStudy=true}:{loaded:LoadedSketch;piece:DemoPiece;onInspect:()=>void;onStudy:()=>void;canStudy?:boolean}){
  const data=useMemo(()=>recordedPieceData(loaded.score),[loaded]);
  const[view,setView]=useState({from:data.bars[0]!.number,to:data.bars[Math.min(7,data.bars.length-1)]!.number});
  const page=useMemo(()=>{const xmlText=onlyBars(loaded.xmlText,view.from,view.to);return{xmlText,score:parseScore(xmlText)}},[loaded,view]);
  const scoreView=useRef<ScoreViewHandle>(null),cursor=useMemo(()=>scoreCursor(page.score,data.bars),[page,data]);
  const notes=data.rows.reduce((total,row)=>total+row.notes.length,0);
  return <main className="tutorial-sketch"><h1>The accepted score</h1><p>{piece.tutorial?.acceptedLabel??'Saved accepted bar analysis.'} The {notes} accepted attacks sit in {data.bars.length} musical bars. Nearby attacks were grouped and note releases were interpreted for notation. The tempo map is part of that saved reading. The original MIDI keeps the played timing and every attack.</p><p className="tutorial-provenance">This is the saved interpreted bar reading. Moving across the map only inspects its tempo and opens those bars. No model call is made.</p>
    <div className="tutorial-accepted-overview"><PieceView data={data} sections={[]} moments={[]} selected={view} focus={null} solo={NONE} instrumentOf={()=>'Piano'} hasNew={false} onSelect={bar=>{const index=data.bars.findIndex(item=>item.number===bar);setView({from:bar,to:data.bars[Math.min(index+7,data.bars.length-1)]!.number})}} onSelectRange={(from,to)=>setView({from,to})} onFocus={()=>{}} onSolo={()=>{}} onBeat={beat=>scoreView.current?.showPlaying(cursor(beat))} onTempoInspect={onInspect}/></div>
    <section className="score-desk tutorial-accepted-score" aria-label="Accepted notation"><div className="score-toolbar">Saved bars {view.from} to {view.to}</div><div className="notation-scroll"><ScoreView ref={scoreView} xmlText={page.xmlText} score={page.score} zoom={.8} noTitle highlights={NONE} noteMarks={NONE} onTap={()=>{}} onDrawn={()=>{}}/></div></section>
    <div className="tutorial-sketch-actions"><button data-tutorial="study-start" className="button primary" disabled={!canStudy} onClick={onStudy}>Study these bars</button><a className="button" href={piece.xml} download>Accepted notation MusicXML</a>{piece.acceptedMidi&&<a className="button" href={piece.acceptedMidi} download>Interpreted notation MIDI, 114 attacks</a>}{piece.mappedMidi&&<a className="button" href={piece.mappedMidi} download>Mapped performance MIDI, 117 attacks</a>}</div>
  </main>;
}

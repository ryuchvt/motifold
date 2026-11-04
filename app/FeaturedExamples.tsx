import { useEffect, useMemo, useRef, useState } from 'react';
import type { DemoPiece } from './demo';
import { localDemoAsset } from './demo';
import { OutcomeExplorer } from './OutcomeExplorer';
import { createPreview } from './audio/preview';
import { loadManifest } from './audio/samples';
import { rawSketchData } from './TutorialSketch';
import { playhead, usePlayhead } from './playhead';
import './featured-examples.css';

type Example = { id:string; title:string; words:string; action:string; resultPlay:string; outcomeId:string; piece:Pick<DemoPiece,'id'|'catalog'>; originalMidi:string; settings:string };
export function featuredExamples(piano:DemoPiece):Example[] {
  return [
    { id:'arrange',title:'Keep my piece',words:'My piano sketch becomes a string arrangement. The original bars, harmony and timing stay.',action:'Hear the arrangement',resultPlay:'Play the arrangement',outcomeId:'arrange-neutral-string-orchestra-a',piece:piano,originalMidi:piano.midi,settings:'Arrange. Neutral. String orchestra. 24 bars.' },
    { id:'expand',title:'Make it longer',words:'The same sketch develops into a longer piece. Follow the added music on the score.',action:'Hear the longer piece',resultPlay:'Play the longer piece',outcomeId:'expand-neutral-string-orchestra-a',piece:piano,originalMidi:piano.midi,settings:'Expand. Neutral. String orchestra. 40 bars.' },
    { id:'cute-sad',title:'Change its character',words:'I started with a cute theme and asked for a sad recomposition. Hear the original idea in a different setting.',action:'Hear Cute become Sad',resultPlay:'Play the Sad version',outcomeId:'recompose-sad-full-a',piece:{id:'cute-test',catalog:'/demo/cute-test/catalog.json'},originalMidi:'/demo/cute-test/source/original.mid',settings:'Recompose. Sad. Full orchestra. Reshaped. 26 bars.' },
  ];
}

/** Reference audio is used only when its manifest names the actual source MIDI. */
export function originalAudioFor(value:unknown,pieceId:string,midiHash:string):string|undefined {
  if(!value||typeof value!=='object')return;
  const item=(value as Record<string,unknown>)[pieceId];
  if(!item||typeof item!=='object')return;
  const row=item as Record<string,unknown>;
  return row.midiSha256===midiHash&&localDemoAsset(row.url)?row.url:undefined;
}

function OriginalPreview({example}:{example:Example}) {
  const[data,setData]=useState<ReturnType<typeof rawSketchData>|null>(null),[reference,setReference]=useState<string>(),[playing,setPlaying]=useState(false),[error,setError]=useState<string>();
  const sound=useRef<ReturnType<typeof createPreview>|null>(null),audio=useRef<HTMLAudioElement>(null),at=useRef(0),generation=useRef(0);
  const result=usePlayhead();
  const stop=()=>{generation.current++;sound.current?.stop();audio.current?.pause();setPlaying(false)};
  useEffect(()=>{
    const controller=new AbortController();setData(null);setReference(undefined);setError(undefined);at.current=0;
    void(async()=>{
      try{
        const response=await fetch(example.originalMidi,{signal:controller.signal});if(!response.ok)throw Error('The original MIDI could not be opened.');
        const bytes=new Uint8Array(await response.arrayBuffer());const parsed=rawSketchData(bytes);
        const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
        let manifest:unknown=null;
        try{const r=await fetch('/demo/original-audio.json',{signal:controller.signal});if(r.ok)manifest=await r.json()}catch{ /* The original MIDI remains playable. */ }
        if(controller.signal.aborted)return;
        setReference(originalAudioFor(manifest,example.piece.id,hash));setData(parsed);
      }catch(failure){if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'Original playback is unavailable.')}
    })();
    return()=>{controller.abort();generation.current++;sound.current?.stop();audio.current?.pause()};
  },[example.originalMidi,example.piece.id]);
  useEffect(()=>{if(result.playing)stop()},[result.playing]);
  const play=()=>{
    if(playing){stop();return}if(!data)return;
    playhead.pause();setError(undefined);
    if(reference){void audio.current?.play().catch(()=>setError('Audio playback is unavailable. Download the original MIDI to hear it in your DAW.'));return}
    const mine=++generation.current;void loadManifest();sound.current??=createPreview();setPlaying(true);
    try{sound.current.play(data.playbackNotes,[{beat:0,qpm:60}],at.current,beat=>{if(mine===generation.current)at.current=beat},()=>{if(mine===generation.current){at.current=0;setPlaying(false)}})}catch{stop();setError('Browser playback is unavailable. Download the original MIDI to hear it in your DAW.')}
  };
  return <section className="example-original" aria-label="Original sketch">
    <div><strong>My original sketch</strong><p>{reference?'My original audio, separate from the recorded result.':'The original played timing using a browser piano.'}</p></div>
    <button className="button" disabled={!data} onClick={play}>{playing?'Pause original':'Play original'}</button>
    <button className="button" disabled={!data} onClick={()=>{stop();at.current=0;if(audio.current)audio.current.currentTime=0}}>Stop original</button>
    <a href={example.originalMidi} download>Original MIDI</a>
    {reference&&<audio ref={audio} src={reference} preload="none" onPlay={()=>{playhead.pause();setPlaying(true)}} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onError={()=>setError('The original audio could not be opened. The original MIDI is still available.')}/>}
    {error&&<p className="error" role="alert">{error}</p>}
  </section>;
}

/** Three curated listening examples, separate from the hands-on tutorial and all live calls. */
export function FeaturedExamples({piano,onExit,afterTutorial=false}:{piano:DemoPiece;onExit:()=>void;afterTutorial?:boolean}) {
  const[chosen,setChosen]=useState<string|null>(null);
  const examples=useMemo(()=>featuredExamples(piano),[piano]),example=examples.find(item=>item.id===chosen);
  const top=useRef<HTMLDivElement>(null);
  const choose=(id:string|null)=>{playhead.stop();setChosen(id);if(top.current)top.current.scrollTop=0};
  if(example)return <div className="featured-viewer" ref={top}>
    <header className="featured-intro"><div><h1>{example.title}</h1><p>{example.words}</p><p className="example-settings">{example.settings}</p></div><button className="button" onClick={()=>choose(null)}>Back to examples</button></header>
    <OriginalPreview key={example.id} example={example}/>
    <OutcomeExplorer key={example.id} piece={example.piece} outcomeId={example.outcomeId} playLabel={example.resultPlay} onExit={()=>choose(null)}/>
  </div>;
  return <main className="featured-examples" ref={top}>
    <div className="featured-intro"><div><h1>{afterTutorial?'Your arrangement is ready':'Hear what can change'}</h1><p>{afterTutorial?'You have taken a sketch through to an exported score. Try another musical direction.':'Three recorded examples of how a sketch can grow. Listen, inspect the notes and download the MIDI.'}</p></div><button className="button" onClick={onExit}>Back to the start</button></div>
    <div className="featured-list">{examples.map(item=><article className={`featured-example example-${item.id}`} key={item.id}><div><h2>{item.title}</h2><p>{item.words}</p><p className="example-settings">{item.settings}</p></div><button className="button" onClick={()=>choose(item.id)}>{item.action}</button></article>)}</div>
    <p className="featured-recording">These are recorded Muse Spark results. No live model call is running and no credit is used. Playback identifies whether you are hearing browser instruments or a DAW render.</p>
  </main>;
}

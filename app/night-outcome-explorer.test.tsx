// @vitest-environment jsdom
import { act, forwardRef, useImperativeHandle } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { OutcomeExplorer, boundOutcomeRender, sameOutcomeRecipe, recordedPieceData } from './OutcomeExplorer';
import { parseScore } from '../score';
import type { DemoCatalog, DemoOutcome, DemoPiece } from './demo';
import { playhead } from './playhead';
const audio=vi.hoisted(()=>({play:vi.fn(),stop:vi.fn()}));
vi.mock('./audio/preview',async original=>({...await original<typeof import('./audio/preview')>(),createPreview:()=>audio}));
vi.mock('./audio/samples',()=>({loadManifest:async()=>null}));
vi.mock('./ScoreView',()=>({ScoreView:forwardRef((props:{xmlText:string},ref)=>{useImperativeHandle(ref,()=>({showPlaying:()=>{}}));return <div>{props.xmlText.includes('Local B')?'Local B notation':'Recorded notation'}</div>})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const original=strFromU8(unzipSync(new Uint8Array(readFileSync('public/demo/sample-sketch/neutral-strings-a.zip')))['score.musicxml']!);
const xmlB=original.replace('<score-partwise','<!-- Local B --><score-partwise');
const hash=(xml:string)=>createHash('sha256').update(xml).digest('hex');
const a:DemoOutcome={id:'arrange-a',runKey:'arrange-neutral',intent:'arrange',ensemble:'String orchestra',mood:'Neutral',option:0,name:'Local A',bars:24,sourceBars:24,status:'complete',xml:'/demo/sample-sketch/a.musicxml',midi:'/demo/sample-sketch/a.mid',zip:'/demo/sample-sketch/a.zip',xmlSha256:hash(original)};
const b:DemoOutcome={...a,id:'arrange-b',option:1,name:'Local B',xml:'/demo/sample-sketch/b.musicxml',midi:'/demo/sample-sketch/b.mid',zip:'/demo/sample-sketch/b.zip',xmlSha256:hash(xmlB)};
const piece:DemoPiece={id:'sample-sketch',name:'Local recorded test',words:'Local files only.',midi:'/demo/sample-sketch/Sample_sketch.mid',xml:'/demo/sample-sketch/sample-sketch.musicxml',catalog:'/demo/sample-sketch/catalog.json',recipe:{intent:'arrange',ensemble:'String orchestra',moreBars:0,where:'inside',useMelodyOnly:false},guide:['Use recorded choices.'],runs:[{key:'arrange-neutral',mode:'arrange',mood:''}]};
let root:Root|null=null;
afterEach(()=>{act(()=>root?.unmount());root=null;document.body.replaceChildren();vi.unstubAllGlobals();vi.clearAllMocks()});
async function setup(rows:DemoOutcome[]=[a,b],heldA?:Promise<Response>){
  vi.stubGlobal('crypto',webcrypto);
  const frames=new Map<number,FrameRequestCallback>();let next=0;
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++next,callback);return next});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  const catalog:DemoCatalog={version:1,pieceId:piece.id,recorded:'2026-11-04',outcomes:rows};
  const fetcher=vi.fn(async(url:string)=>{if(url===piece.catalog)return Response.json(catalog);if(url===a.xml)return heldA??new Response(original);if(url===b.xml)return new Response(xmlB);throw Error(`Unexpected request ${url}`)});vi.stubGlobal('fetch',fetcher);
  const host=document.body.appendChild(document.createElement('div'));root=createRoot(host);await act(async()=>root!.render(<OutcomeExplorer piece={piece} onExit={()=>{}}/>));
  const flush=()=>act(()=>{for(const callback of frames.values())callback(0);frames.clear()});
  return{host,fetcher,flush};
}
const ready=async(host:Element,name='Local A')=>{await vi.waitFor(()=>expect(host.querySelector('.explorer-transport>strong')?.textContent).toBe(name));await act(async()=>{})};
async function pick(host:Element,name:string){const button=[...host.querySelectorAll<HTMLButtonElement>('.explorer-choice')].find(button=>button.textContent?.includes(name))!;await act(async()=>button.click())}

it('opens actual complete exports directly and explains unrecorded combinations without any API call',async()=>{
  const missing={...a,id:'expand-a',runKey:'expand-neutral',intent:'expand' as const,name:'Option A',bars:40,status:'unavailable' as const,reason:'Not recorded.',xml:undefined,midi:undefined,zip:undefined};
  const screen=await setup([a,b,missing]);await ready(screen.host);screen.flush();
  expect(screen.host.querySelector('[href="/demo/sample-sketch/a.zip"]')).not.toBeNull();
  expect(screen.host.querySelector('.explorer-score-label')?.textContent).toContain('colors do not identify authorship');
  const style=readFileSync('app/outcome-explorer.css','utf8');
  expect(style).toMatch(/\.studio \.outcome-explorer \.note\.kind-plain\s*\{\s*stroke: #a7b6c9/);
  const field=screen.host.querySelector('[aria-label="Recorded direction"]') as unknown as HTMLSelectElement;
  await act(async()=>{field.value='expand';field.dispatchEvent(new Event('change',{bubbles:true}))});
  expect(screen.host.querySelector('.explorer-preset')?.textContent).toContain('40 bars. Neutral, same character, 16 added bars.');
  expect(screen.host.textContent).toContain('Not recorded.');expect(screen.host.querySelector('.explorer-downloads')).toBeNull();
  expect(screen.fetcher.mock.calls.map(row=>row[0])).toEqual([piece.catalog,a.xml]);
});

it('keeps the latest selected outcome when an older local score finishes loading late',async()=>{
  let finish!:(response:Response)=>void;const held=new Promise<Response>(resolve=>finish=resolve);
  const screen=await setup([a,b],held);await vi.waitFor(()=>expect(screen.fetcher).toHaveBeenCalledWith(a.xml,expect.anything()));
  await pick(screen.host,'Local B');await ready(screen.host,'Local B');
  await act(async()=>finish(new Response(original)));
  expect(screen.host.querySelector('.explorer-transport>strong')?.textContent).toBe('Local B');
  expect(screen.host.querySelector('[href="/demo/sample-sketch/b.zip"]')).not.toBeNull();
  expect(screen.host.querySelector('.notation-scroll')?.textContent).toContain('Local B notation');
});

it('compares the two outcomes at the actual heard beat, retaining the printed passage',async()=>{
  const screen=await setup();await ready(screen.host);screen.flush();
  const field=screen.host.querySelector('[aria-label="First recorded bar"]') as unknown as HTMLSelectElement;
  await act(async()=>{field.value='9';field.dispatchEvent(new Event('change',{bubbles:true}))});
  act(()=>{playhead.seek(25.5);playhead.play()});
  act(()=>audio.play.mock.calls.at(-1)![3](26.25));
  expect(playhead.beat).toBe(26.25);
  await pick(screen.host,'Local B');await ready(screen.host,'Local B');screen.flush();
  expect((screen.host.querySelector('[aria-label="First recorded bar"]') as unknown as HTMLSelectElement).value).toBe('9');
  expect(audio.play.mock.calls.at(-1)![2]).toBe(26.25);
});

it('refuses a changed exported score and never offers an unrelated DAW render',async()=>{
  const screen=await setup([{...a,xmlSha256:'f'.repeat(64)}]);
  await vi.waitFor(()=>expect(screen.host.querySelector('[role="alert"]')?.textContent).toContain('does not match'));
  expect(screen.host.querySelector('.explorer-downloads')).toBeNull();
  expect(boundOutcomeRender({...a,render:'/demo/sample-sketch/render.wav',renderXmlSha256:hash(xmlB)},hash(original))).toBeUndefined();
  expect(boundOutcomeRender({...a,render:'/demo/sample-sketch/render.wav',renderXmlSha256:hash(original)},hash(original))).toBe('/demo/sample-sketch/render.wav');
  expect(sameOutcomeRecipe(a,{...b,ensemble:'Brass quintet'})).toBe(false);
});

it('plays the exported dynamics, joined ties and pizzicato rather than discarding them in the overview',()=>{
  const score=parseScore('<score-partwise><part-list><score-part id="P1"><part-name>Viola</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><words>pizz.</words></direction-type><sound dynamics="30" tempo="92"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><tie type="start"/></note></measure><measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><tie type="stop"/></note></measure></part></score-partwise>');
  const data=recordedPieceData(score);
  expect(data.rows).toHaveLength(1);expect(data.rows[0]!.label).toBe('Viola pizz');
  expect(data.rows[0]!.notes).toEqual([{start:0,length:6,height:60,velocity:27,kind:null,pizz:true}]);
  expect(data.tempos).toEqual([{beat:0,qpm:92}]);
});

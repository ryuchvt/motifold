// @vitest-environment jsdom
import { act, forwardRef, useImperativeHandle } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { unzipSync } from 'fflate';
import { FeaturedExamples, originalAudioFor } from './FeaturedExamples';
import { OutcomeExplorer } from './OutcomeExplorer';
import { recordedDemoCatalog, type DemoPiece } from './demo';
const audio=vi.hoisted(()=>({play:vi.fn(),stop:vi.fn()}));
vi.mock('./audio/preview',async original=>({...await original<typeof import('./audio/preview')>(),createPreview:()=>audio}));
vi.mock('./audio/samples',()=>({loadManifest:async()=>null}));
vi.mock('./ScoreView',()=>({ScoreView:forwardRef((_props,ref)=>{useImperativeHandle(ref,()=>({showPlaying:()=>{}}));return <div>Recorded notation</div>})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const piano=JSON.parse(readFileSync('public/demo/index.json','utf8')).pieces[0] as DemoPiece;
let root:Root|null=null;
afterEach(()=>{act(()=>root?.unmount());root=null;document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals()});
async function mount(element:React.ReactNode){
  vi.stubGlobal('crypto',webcrypto);vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  const fetched:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    fetched.push(url);if(!url.startsWith('/demo/')||url.includes('..'))throw Error(`No live request allowed: ${url}`);
    const bytes=readFileSync(`public${url}`);
    return new Response(bytes,{headers:{'content-type':url.endsWith('.json')?'application/json':'application/octet-stream'}});
  }));
  vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',()=>{});
  const host=document.body.appendChild(document.createElement('div'));root=createRoot(host);
  await act(async()=>root!.render(element));return{host,fetched};
}
async function press(host:Element,name:string){const b=[...host.querySelectorAll('button')].find(b=>b.textContent===name);expect(b,name).toBeTruthy();await act(async()=>b!.click())}

it('opens only the selected Cute A recording, then the selected piano expansion, without live requests or irrelevant variants',async()=>{
  const s=await mount(<FeaturedExamples piano={piano} onExit={()=>{}} afterTutorial/>);
  expect(s.host.querySelectorAll('.featured-example')).toHaveLength(3);expect(s.fetched).toEqual([]);
  await press(s.host,'Hear Cute become Sad');
  await vi.waitFor(()=>expect(s.host.querySelector('.explorer-transport>strong')?.textContent).toBe('Ashen Lullaby'));
  expect(s.host.querySelector('[aria-label="Recorded A and B"]')).toBeNull();
  expect(s.host.querySelector('[aria-label="Recorded mood"]')).toBeNull();
  expect(s.host.querySelector<HTMLAudioElement>('audio')?.preload).toBe('none');
  expect(s.host.querySelector('audio')?.getAttribute('src')).toBe('/demo/cute-test/source/original.mp3');
  expect(s.fetched.some(url=>url.endsWith('.mp3'))).toBe(false);
  expect(s.host.querySelector('[href="/demo/cute-test/outcomes/recompose-sad-full-a/arrangement.zip"]')).toBeTruthy();
  await press(s.host,'Back to examples');await press(s.host,'Hear the longer piece');
  await vi.waitFor(()=>expect(s.host.querySelector('[href="/demo/sample-sketch/outcomes/expand-neutral-string-orchestra-a/arrangement.zip"]')).toBeTruthy());
  expect(s.host.querySelector('.explorer-preset')?.textContent).toContain('40 bars');
  expect(s.fetched.every(url=>url.startsWith('/demo/'))).toBe(true);
});

it('does not replace a missing fixed example with another available recording',async()=>{
  const s=await mount(<OutcomeExplorer piece={piano} outcomeId="not-a-recording" onExit={()=>{}}/>);
  await vi.waitFor(()=>expect(s.host.textContent).toContain('no recorded outcome'));
  expect(s.host.querySelector('.explorer-downloads')).toBeNull();expect(s.fetched).toEqual([piano.catalog]);
});

it('refuses unrelated source audio and external audio addresses',()=>{
  const hash='a'.repeat(64),url='/demo/cute-test/source/original.mp3';
  expect(originalAudioFor({'cute-test':{url,midiSha256:hash}},'cute-test',hash)).toBe(url);
  expect(originalAudioFor({'cute-test':{url,midiSha256:'b'.repeat(64)}},'cute-test',hash)).toBeUndefined();
  expect(originalAudioFor({'cute-test':{url:'https://example.invalid/audio.mp3',midiSha256:hash}},'cute-test',hash)).toBeUndefined();
});

it('publishes the exact authenticated Cute Sad native payloads and actual selected plan harmony',()=>{
  const catalog=recordedDemoCatalog(JSON.parse(readFileSync('public/demo/cute-test/catalog.json','utf8')),'cute-test');expect(catalog).not.toBeNull();
  expect(catalog!.outcomes).toHaveLength(1);const row=catalog!.outcomes[0]!;
  const zip=readFileSync(`public${row.zip}`),files=unzipSync(zip),xml=readFileSync(`public${row.xml}`),midi=readFileSync(`public${row.midi}`);
  const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
  expect(hash(zip)).toBe('933c90e5ed913096ec68b5725b23526256ddf4f475a05ea4cf878897e81b5d3f');
  expect(hash(xml)).toBe(row.xmlSha256);expect(hash(midi)).toBe(row.midiSha256);
  expect(files['score.musicxml']).toEqual(new Uint8Array(xml));expect(files['all-parts.mid']).toEqual(new Uint8Array(midi));
  const run=JSON.parse(readFileSync(`public${row.run}`,'utf8'));
  const plan=run.find((call:any)=>call.shape==='plan_recompose').reply.answer.options[0];
  expect(row.planHarmony).toEqual(plan.why.filter((span:any)=>span.chords!==undefined).map(({from,to,chords}:any)=>({from,to,chords})));
  expect(row.name).toBe(plan.name);expect(row).toMatchObject({option:0,bars:26,sourceBars:26,mood:'Sad',freedom:2});
});

// @vitest-environment jsdom
import {act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {RawSketch} from './TutorialSketch';
import {TutorialCoach,TutorialProvider,type TutorialEvent,type TutorialGuide} from './Tutorial';
import {createPreview} from './audio/preview';
import {createRenderedPlayback} from './audio/rendered';
import type {DemoPiece} from './demo';
vi.mock('./audio/samples',()=>({loadManifest:async()=>null}));
vi.mock('./audio/preview',async original=>({...await original<typeof import('./audio/preview')>(),createPreview:vi.fn()}));
vi.mock('./audio/rendered',()=>({createRenderedPlayback:vi.fn()}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const piece=JSON.parse(readFileSync('public/demo/index.json','utf8')).pieces[0] as DemoPiece;
let root:Root|null=null;
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{act(()=>root?.unmount());root=null;document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()});
async function mount(recorded=false){
 if(recorded)vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',async(url:string)=>{if(url==='/demo/original-audio.json')return Response.json(recorded?JSON.parse(readFileSync(`public${url}`,'utf8')):{});expect(url).toBe(piece.midi);return new Response(readFileSync(`public${piece.midi}`))});
 const mark=vi.fn(),accept=vi.fn();
 function Harness(){
  const[played,setPlayed]=useState(false);
  const guide:TutorialGuide={piece,recipe:piece.recipe,run:1,step:0,stepId:'raw',stage:null,events:played?{'raw-played':true}:{},completeOptions:[0,1],mark:(event:TutorialEvent,complete,user)=>{mark(event,complete,user);if(event==='raw-played')setPlayed(true)}};
  return <TutorialProvider value={guide}><TutorialCoach guide={guide} onBack={()=>{}} onContinue={()=>{}} onSkip={()=>{}} onExit={()=>{}}/><RawSketch piece={piece} busy={false} onAccept={accept}/></TutorialProvider>;
 }
 const host=document.body.appendChild(document.createElement('div'));host.className='studio';root=createRoot(host);
 await act(async()=>root!.render(<Harness/>));
 await act(async()=>vi.advanceTimersByTimeAsync(1000));
 return {host,mark,accept};
}
it('spotlights the actual Play control first, then accepted bars only after user-started playback',async()=>{
 const sound={play:vi.fn(),stop:vi.fn()};vi.mocked(createPreview).mockReturnValue(sound as ReturnType<typeof createPreview>);
 const {host,mark,accept}=await mount();
 expect(host.querySelector('.tutorial-target')?.getAttribute('data-tutorial')).toBe('raw-play');
 expect(createPreview).not.toHaveBeenCalled();expect(mark).not.toHaveBeenCalled(); // no autoplay or invented listening
 const play=host.querySelector<HTMLButtonElement>('[data-tutorial="raw-play"]')!,accepted=host.querySelector<HTMLButtonElement>('[data-tutorial="accept-bars"]')!;
 let top=900;accepted.getBoundingClientRect=()=>({left:12,right:363,top,bottom:top+36,width:351,height:36}as DOMRect);
 const reveal=vi.fn(()=>{top=580});accepted.scrollIntoView=reveal;play.focus();
 await act(async()=>play.click());
 expect(sound.play).toHaveBeenCalledOnce();expect(mark).not.toHaveBeenCalled();
 const move=sound.play.mock.calls[0]![3] as (at:number)=>void;
 act(()=>move(0));expect(mark).not.toHaveBeenCalled();
 act(()=>move(.25));expect(mark).toHaveBeenCalledExactlyOnceWith('raw-played',true,true);
 expect(host.querySelector('.tutorial-target')?.getAttribute('data-tutorial')).toBe('accept-bars');
 expect(reveal).toHaveBeenCalledExactlyOnceWith({behavior:'smooth',block:'center',inline:'nearest'});
 expect(accepted.getBoundingClientRect().bottom).toBeLessThan(innerHeight);expect(document.activeElement).toBe(play);
 expect(host.querySelector('.tutorial-count')?.textContent).toBe('1 of 7');expect(accept).not.toHaveBeenCalled();
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-tutorial="raw-play"]')!.click());
 expect(mark).toHaveBeenCalledOnce();expect(sound.stop).toHaveBeenCalledOnce();
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-tutorial="accept-bars"]')!.click());expect(accept).toHaveBeenCalledOnce();
});
it('uses the original DAW recording without autoplay and advances the guide only when its clock moves',async()=>{
 const sound={play:vi.fn(),stop:vi.fn()};vi.mocked(createRenderedPlayback).mockReturnValue(sound);
 const {host,mark}=await mount(true);
 await vi.waitFor(()=>expect(host.querySelector('[data-tutorial="raw-play"]')?.textContent).toBe('Play original recording'));
 expect(sound.play).not.toHaveBeenCalled();
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-tutorial="raw-play"]')!.click());
 expect(sound.play.mock.calls[0]![0]).toEqual(['/demo/sample-sketch/source/original.mp3']);
 expect(mark).not.toHaveBeenCalled();
 const move=sound.play.mock.calls[0]![2] as(at:number)=>void;
 act(()=>move(.25));expect(mark).toHaveBeenCalledExactlyOnceWith('raw-played',true,true);
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-tutorial="raw-play"]')!.click());
 act(()=>move(.5));expect(mark).toHaveBeenCalledOnce();expect(sound.stop).toHaveBeenCalledOnce();
});
it('keeps Play highlighted while audio is not advancing and ignores a late callback after pause',async()=>{
 const sound={play:vi.fn(),stop:vi.fn()};vi.mocked(createPreview).mockReturnValue(sound as ReturnType<typeof createPreview>);
 const {host,mark}=await mount();
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-tutorial="raw-play"]')!.click());
 const move=sound.play.mock.calls[0]![3] as (at:number)=>void;
 expect(mark).not.toHaveBeenCalled();expect(host.querySelector('.tutorial-target')?.getAttribute('data-tutorial')).toBe('raw-play');
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-tutorial="raw-play"]')!.click());
 act(()=>move(.5));expect(mark).not.toHaveBeenCalled();expect(sound.stop).toHaveBeenCalledOnce();
});
it('does not claim listening after failed playback and still permits an explicit accepted-bars action',async()=>{
 vi.mocked(createPreview).mockImplementation(()=>{throw Error('Audio unavailable')});
 const {host,mark,accept}=await mount();
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-tutorial="raw-play"]')!.click());
 expect(mark).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')?.textContent).toContain('Browser playback is unavailable');
 expect(host.querySelector('.tutorial-target')?.getAttribute('data-tutorial')).toBe('raw-play');
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-tutorial="accept-bars"]')!.click());expect(accept).toHaveBeenCalledOnce();
});

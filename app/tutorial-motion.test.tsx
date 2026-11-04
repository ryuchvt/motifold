// @vitest-environment jsdom
import {act,createRef} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {TutorialCoach,type TutorialGuide} from './Tutorial';
import {TutorialSpotlight} from './TutorialSpotlight';
import type {DemoPiece} from './demo';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const piece=JSON.parse(readFileSync('public/demo/index.json','utf8')).pieces[0] as DemoPiece;
const guide=(run=3,step=0):TutorialGuide=>({piece,recipe:piece.recipe,run,step,stepId:'test',stage:null,events:{},completeOptions:[0,1],mark:vi.fn()});
const rect=(left:number,top:number,width:number,height:number)=>({left,top,right:left+width,bottom:top+height,width,height,x:left,y:top,toJSON:()=>({})})as DOMRect;
const nativeAnimate=HTMLElement.prototype.animate;
let root:Root|null=null;
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{act(()=>root?.unmount());root=null;document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();if(nativeAnimate)HTMLElement.prototype.animate=nativeAnimate;else delete(HTMLElement.prototype as any).animate});
const advance=async(ms:number)=>{await act(async()=>vi.advanceTimersByTimeAsync(ms))};
const actions={onBack:vi.fn(),onContinue:vi.fn(),onSkip:vi.fn(),onExit:vi.fn()};
function stage(){
 const host=document.body.appendChild(document.createElement('div'));host.className='studio';
 const button=host.appendChild(document.createElement('button'));button.dataset.tutorial='raw-play';button.getBoundingClientRect=()=>rect(20,400,160,36);
 const mount=host.appendChild(document.createElement('div'));root=createRoot(mount);
 return {host,button};
}
function nativeTravels(){
 const calls:{frames:Keyframe[];options:KeyframeAnimationOptions;animation:Animation}[]=[];
 HTMLElement.prototype.animate=vi.fn((frames,options)=>{
  const animation={onfinish:null,cancel:vi.fn()} as unknown as Animation;
  calls.push({frames:frames as Keyframe[],options:options as KeyframeAnimationOptions,animation});return animation;
 });
 return calls;
}
const finish=(animation:Animation)=>act(()=>animation.onfinish?.call(animation,{}as AnimationPlaybackEvent));

it('shows a normal page first and introduces a cue without performing the required action or moving focus',async()=>{
 const {host,button}=stage(),state=guide();button.focus();
 await act(async()=>root!.render(<TutorialCoach guide={state} {...actions}/>));
 expect(document.querySelector('.tutorial-scrim')).toBeNull();expect(button.classList.contains('tutorial-target')).toBe(false);
 await advance(799);expect(document.querySelector('.tutorial-spotlight-ring')).toBeNull();
 await advance(201);expect(document.querySelector('.tutorial-scrim')).not.toBeNull();expect(button.classList.contains('tutorial-target')).toBe(true);
 expect(document.activeElement).toBe(button);expect(state.mark).not.toHaveBeenCalled();
 expect(host.querySelector('.tutorial-count')?.textContent).toBe('1 of 7');
});

it('gently reveals initial offscreen Play after the introduction, but lets a user inspect the source instead',async()=>{
 const {host,button}=stage();let top=900;button.getBoundingClientRect=()=>rect(20,top,160,36);
 const reveal=vi.fn(()=>{top=450});button.scrollIntoView=reveal;
 const outside=host.appendChild(document.createElement('button'));outside.focus();
 await act(async()=>root!.render(<TutorialCoach guide={guide()} {...actions}/>));
 await advance(799);expect(reveal).not.toHaveBeenCalled();
 await advance(201);expect(reveal).toHaveBeenCalledExactlyOnceWith({behavior:'smooth',block:'center',inline:'nearest'});expect(document.activeElement).toBe(outside);
 reveal.mockClear();top=900;
 await act(async()=>root!.render(<TutorialCoach guide={guide(4)} {...actions}/>));
 act(()=>document.dispatchEvent(new WheelEvent('wheel',{deltaY:80,bubbles:true})));
 await advance(1000);expect(reveal).not.toHaveBeenCalled();expect(document.activeElement).toBe(outside);
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Show control')!.click());
 expect(reveal).toHaveBeenCalledOnce();expect(document.activeElement).toBe(button);
});

it('moves the retained light from the last real control to the next, shines on arrival, and tracks later scrolling without new motion',async()=>{
 const calls=nativeTravels(),controls=createRef<HTMLElement>();controls.current=document.body.appendChild(document.createElement('aside'));controls.current.getBoundingClientRect=()=>rect(0,0,800,90);
 const first=document.body.appendChild(document.createElement('button'));first.getBoundingClientRect=()=>rect(20,200,120,36);
 const next=document.body.appendChild(document.createElement('button'));let top=500;next.getBoundingClientRect=()=>rect(450,top,200,42);
 const mount=document.body.appendChild(document.createElement('div'));root=createRoot(mount);
 await act(async()=>root!.render(<TutorialSpotlight target={first} identity="export-step" controls={controls} instruction="Export"/>));
 await advance(150);expect(calls).toHaveLength(1);finish(calls[0]!.animation);
 const ring=document.querySelector('.tutorial-spotlight-ring'),shine=document.querySelector('.tutorial-arrival-shine');
 await act(async()=>root!.render(<TutorialSpotlight target={next} identity="export-step" controls={controls} instruction="Download"/>));
 expect(document.querySelector('.tutorial-spotlight-ring')).toBe(ring); // keeps a visible path across the handoff
 await advance(150);expect(calls).toHaveLength(2);
 expect(calls[1]!.frames[0]).toMatchObject({left:'15px',top:'195px',width:'130px',height:'46px'});
 expect(calls[1]!.frames[1]).toMatchObject({left:'445px',top:'495px',width:'210px',height:'52px'});
 expect(Number(calls[1]!.options.duration)).toBeGreaterThan(300);expect(Number(calls[1]!.options.duration)).toBeLessThan(700);
 expect([...document.querySelectorAll('mask path')].some(p=>p.getAttribute('d')?.startsWith('M445,495'))).toBe(true); // real target is clear even during travel
 finish(calls[1]!.animation);expect(document.querySelector('.tutorial-arrival-shine')).not.toBe(shine);
 const arrived=document.querySelector('.tutorial-arrival-shine');top=400;
 act(()=>window.dispatchEvent(new Event('scroll')));await advance(30);
 expect(calls).toHaveLength(2);expect(document.querySelector<HTMLElement>('.tutorial-spotlight-ring')?.style.top).toBe('395px');expect(document.querySelector('.tutorial-arrival-shine')).toBe(arrived);
});

it('replays arrival when Export becomes Download on the same DOM button and same lesson',async()=>{
 const calls=nativeTravels(),{host,button}=stage();button.dataset.tutorial='export';let left=20;button.getBoundingClientRect=()=>rect(left,350,160,36);
 await act(async()=>root!.render(<TutorialCoach guide={guide(3,6)} {...actions}/>));
 await advance(1000);await advance(200);expect(calls).toHaveLength(1);finish(calls[0]!.animation);
 const shine=document.querySelector('.tutorial-arrival-shine');
 await act(async()=>{left=500;button.dataset.tutorial='download'});
 await advance(150);expect(calls).toHaveLength(2);finish(calls[1]!.animation);
 expect(document.querySelector('.tutorial-arrival-shine')).not.toBe(shine);
 expect(host.querySelector('.tutorial-coach p')?.textContent).toContain('Download this complete arrangement');
 expect(host.querySelector('.tutorial-count')?.textContent).toBe('7 of 7');
});

it('uses immediate static cues for reduced motion and retains keyboard focus on target changes',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true}));const calls=nativeTravels(),controls=createRef<HTMLElement>();
 const first=document.body.appendChild(document.createElement('button'));first.getBoundingClientRect=()=>rect(20,200,120,36);first.focus();
 const next=document.body.appendChild(document.createElement('button'));next.getBoundingClientRect=()=>rect(400,500,150,36);
 const mount=document.body.appendChild(document.createElement('div'));root=createRoot(mount);
 await act(async()=>root!.render(<TutorialSpotlight target={first} controls={controls} instruction="First"/>));
 await advance(1000);expect(calls).toHaveLength(0);
 await act(async()=>root!.render(<TutorialSpotlight target={next} controls={controls} instruction="Next"/>));
 expect(document.querySelector<HTMLElement>('.tutorial-spotlight-ring')?.style.left).toBe('395px');expect(document.querySelector('.tutorial-spotlight')?.getAttribute('data-motion')).toBe('arrived');expect(document.activeElement).toBe(first);expect(calls).toHaveLength(0);
});

it('cancels old travel, delayed cues and callbacks when a new target or exit supersedes them',async()=>{
 const calls=nativeTravels(),controls=createRef<HTMLElement>();
 const first=document.body.appendChild(document.createElement('button'));first.getBoundingClientRect=()=>rect(20,200,120,36);
 const next=document.body.appendChild(document.createElement('button'));next.getBoundingClientRect=()=>rect(400,500,150,36);
 const mount=document.body.appendChild(document.createElement('div'));root=createRoot(mount);
 await act(async()=>root!.render(<TutorialSpotlight target={first} controls={controls} instruction="First"/>));await advance(150);
 const stale=calls[0]!.animation.onfinish;
 await act(async()=>root!.render(<TutorialSpotlight target={next} controls={controls} instruction="Next"/>));
 expect(calls[0]!.animation.cancel).toHaveBeenCalled();act(()=>stale?.call(calls[0]!.animation,{}as AnimationPlaybackEvent));
 expect(document.querySelector('.tutorial-arrival-shine')).toBeNull();await advance(150);expect(calls).toHaveLength(2);
 act(()=>root!.unmount());root=null;expect(calls[1]!.animation.cancel).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);expect(document.querySelector('.tutorial-spotlight')).toBeNull();
});

// @vitest-environment jsdom
import {act,createRef} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {TutorialCoach,tutorialCue,type TutorialGuide} from './Tutorial';
import {spotlightHint,TutorialSpotlight} from './TutorialSpotlight';
import type {DemoPiece} from './demo';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const piece=JSON.parse(readFileSync('public/demo/index.json','utf8')).pieces[0] as DemoPiece;
const guide=(step:number,events:TutorialGuide['events']={}):TutorialGuide=>({piece,recipe:piece.recipe,run:9,step,stepId:'test',stage:null,events,completeOptions:[0,1],mark:vi.fn()});
let root:Root|null=null;
afterEach(()=>{act(()=>root?.unmount());root=null;document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals()});
const rect=(left:number,top:number,width:number,height:number)=>({left,top,right:left+width,bottom:top+height,width,height,x:left,y:top,toJSON:()=>({})})as DOMRect;

it('targets the next real action and waits instead of inventing an actionable control',()=>{
 expect(tutorialCue(guide(2)).selectors).toEqual(['[data-tutorial="study-start"]']);
 expect(tutorialCue(guide(2,{'study-started':true})).selectors).toEqual([]);
 expect(tutorialCue(guide(2,{'study-started':true,'study-ready':true})).selectors).toEqual(['[data-tutorial="tracks"]']);
 expect(tutorialCue(guide(2,{'study-started':true,'study-ready':true,'tracks-confirmed':true})).selectors).toEqual(['[data-tutorial="question-skip"]']);
 expect(tutorialCue(guide(4)).selectors).toEqual([]);
 expect(tutorialCue(guide(4,{'previews-ready':true})).selectors).toEqual(['button[aria-label="Audition plan A"]']);
 expect(tutorialCue(guide(4,{'previews-ready':true,'audition-a':true})).selectors).toEqual(['button[aria-label="Audition plan B"]']);
 expect(tutorialCue(guide(5,{'write-started':true})).selectors).toEqual([]);
});

it('places a phone hint wholly in the viewport without covering the target or guide, and omits it when no safe space exists',()=>{
 const viewport={left:0,top:0,right:390,bottom:844},target={left:12,top:650,right:378,bottom:690},controls={left:0,top:56,right:390,bottom:170};
 expect(spotlightHint(target,270,65,viewport,[target,controls])).toEqual({left:12,top:573,right:282,bottom:638});
 expect(spotlightHint(target,380,700,viewport,[target,controls])).toBeNull();
 // Visual viewport offsets, such as a zoomed/keyboard-reduced viewport, are respected too.
 const zoomed={left:100,top:200,right:490,bottom:600};
 const at={left:120,top:450,right:470,bottom:490};
 expect(spotlightHint(at,270,65,zoomed,[at])?.top).toBe(373);
});

it('updates for late controls and sub-actions without marking an action or stealing keyboard focus; reduced-motion reveal focuses the real control',async()=>{
 const host=document.body.appendChild(document.createElement('div'));host.className='studio';
 const outside=host.appendChild(document.createElement('button'));outside.textContent='Outside';outside.focus();
 const stage=host.appendChild(document.createElement('section'));
 const mount=host.appendChild(document.createElement('div'));root=createRoot(mount);
 const state=guide(4,{'previews-ready':true}),back=vi.fn(),skip=vi.fn();
 const props={onBack:back,onSkip:skip,onContinue:vi.fn(),onExit:vi.fn()};
 await act(async()=>root!.render(<TutorialCoach guide={state} {...props}/>));
 const a=document.createElement('button'),b=document.createElement('button');
 a.setAttribute('aria-label','Audition plan A');b.setAttribute('aria-label','Audition plan B');
 const reveal=vi.fn();b.scrollIntoView=reveal;
 await act(async()=>{stage.appendChild(a);stage.appendChild(b)});
 expect(a.classList.contains('tutorial-target')).toBe(true);expect(b.classList.contains('tutorial-target')).toBe(false);
 expect(document.activeElement).toBe(outside);expect(state.mark).not.toHaveBeenCalled();
 await act(async()=>root!.render(<TutorialCoach guide={{...state,events:{...state.events,'audition-a':true}}} {...props}/>));
 expect(a.classList.contains('tutorial-target')).toBe(false);expect(a.hasAttribute('aria-describedby')).toBe(false);
 expect(b.classList.contains('tutorial-target')).toBe(true);
 vi.stubGlobal('matchMedia',()=>({matches:true}));
 await act(async()=>[...mount.querySelectorAll('button')].find(button=>button.textContent==='Show control')!.click());
 expect(reveal).toHaveBeenCalledExactlyOnceWith({behavior:'instant',block:'center',inline:'nearest'});
 expect(document.activeElement).toBe(b);expect(state.mark).not.toHaveBeenCalled();
 act(()=>[...mount.querySelectorAll('button')].find(button=>button.textContent==='Back')!.click());
 act(()=>[...mount.querySelectorAll('button')].find(button=>button.textContent==='Skip guide')!.click());
 expect(back).toHaveBeenCalledOnce();expect(skip).toHaveBeenCalledOnce();
 act(()=>root!.unmount());root=null;expect(b.hasAttribute('aria-describedby')).toBe(false);expect(document.querySelector('.tutorial-spotlight')).toBeNull();
});

it('clips the spotlight to a scroll pane, remeasures scrolling and focused controls, and cancels pending work on unmount',async()=>{
 const frames=new Map<number,FrameRequestCallback>();let serial=0;
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++serial,callback);return serial});
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
 const flush=()=>{const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(0)};
 const pane=document.body.appendChild(document.createElement('div'));pane.style.overflowY='auto';pane.getBoundingClientRect=()=>rect(0,100,390,400);
 const target=pane.appendChild(document.createElement('button'));target.setAttribute('aria-describedby','existing');let top=450;target.getBoundingClientRect=()=>rect(20,top,200,70);
 const controls=createRef<HTMLElement>();controls.current=document.body.appendChild(document.createElement('aside'));controls.current.getBoundingClientRect=()=>rect(0,0,390,90);
 const host=document.body.appendChild(document.createElement('div'));root=createRoot(host);
 await act(async()=>root!.render(<TutorialSpotlight target={target} controls={controls} instruction="Use the real control."/>));
 const ring=()=>document.querySelector<HTMLElement>('.tutorial-spotlight-ring');
 expect(ring()?.style.top).toBe('445px');expect(ring()?.style.height).toBe('60px'); // visible only to pane bottom 500
 expect(document.querySelector('mask')?.querySelectorAll('path')).toHaveLength(2); // the default body focus must not clear the whole scrim
 expect(target.getAttribute('aria-describedby')).toContain('existing ');
 top=250;act(()=>{pane.dispatchEvent(new Event('scroll'));flush()});expect(ring()?.style.top).toBe('245px');
 const other=document.body.appendChild(document.createElement('button'));other.getBoundingClientRect=()=>rect(10,600,80,30);
 act(()=>{other.focus();flush()});expect(document.activeElement).toBe(other);
 expect(document.querySelector('mask')?.querySelectorAll('path')).toHaveLength(3); // target, guide, keyboard focus
 top=650;act(()=>{window.dispatchEvent(new Event('resize'));flush()});expect(ring()).toBeNull();
 act(()=>window.dispatchEvent(new Event('resize')));expect(frames.size).toBe(1);
 act(()=>root!.unmount());root=null;expect(frames.size).toBe(0);expect(target.getAttribute('aria-describedby')).toBe('existing');
});

it('retargets retained controls when their own or ancestor visibility changes and restores their descriptions',async()=>{
 const host=document.body.appendChild(document.createElement('div'));host.className='studio';
 const earlier=host.appendChild(document.createElement('section'));
 const exportButton=earlier.appendChild(document.createElement('button'));exportButton.dataset.tutorial='export';
 const later=host.appendChild(document.createElement('section'));
 const download=later.appendChild(document.createElement('button'));download.dataset.tutorial='download';download.setAttribute('aria-describedby','download-help');
 later.hidden=true;
 const mount=host.appendChild(document.createElement('div'));root=createRoot(mount);
 await act(async()=>root!.render(<TutorialCoach guide={guide(6)} onBack={()=>{}} onContinue={()=>{}} onSkip={()=>{}} onExit={()=>{}}/>));
 expect(exportButton.classList.contains('tutorial-target')).toBe(true);
 await act(async()=>{later.hidden=false;earlier.setAttribute('aria-hidden','true')});
 expect(download.classList.contains('tutorial-target')).toBe(true);expect(exportButton.hasAttribute('aria-describedby')).toBe(false);
 await act(async()=>{download.style.visibility='hidden';earlier.removeAttribute('aria-hidden')});
 expect(exportButton.classList.contains('tutorial-target')).toBe(true);expect(download.getAttribute('aria-describedby')).toBe('download-help');
 await act(async()=>{download.style.visibility='visible'});expect(download.classList.contains('tutorial-target')).toBe(true);
 await act(async()=>{later.style.display='none'});expect(exportButton.classList.contains('tutorial-target')).toBe(true);
});

it('remeasures the retained target and protected dock when activity changes the layout without resizing the target',async()=>{
 let pending:FrameRequestCallback|null=null;
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{pending=callback;return 1});
 vi.stubGlobal('cancelAnimationFrame',()=>{pending=null});
 const observed=new Set<Element>();let resized:()=>void=()=>{};
 vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){resized=callback}observe(element:Element){observed.add(element)}disconnect(){observed.clear()}});
 const pane=document.body.appendChild(document.createElement('main'));
 const target=pane.appendChild(document.createElement('button'));let top=500;target.getBoundingClientRect=()=>rect(20,top,180,36);
 const dock=document.body.appendChild(document.createElement('aside'));dock.setAttribute('aria-label','What Muse Spark is doing');let dockTop=650;dock.getBoundingClientRect=()=>rect(0,dockTop,390,750-dockTop);
 const host=document.body.appendChild(document.createElement('div'));root=createRoot(host);const controls=createRef<HTMLElement>();
 await act(async()=>root!.render(<TutorialSpotlight target={target} controls={controls} instruction="Download this score."/>));
 expect(observed.has(dock)).toBe(true);expect(observed.has(pane)).toBe(true);
 expect(document.querySelector<HTMLElement>('.tutorial-spotlight-ring')?.style.top).toBe('495px');
 act(()=>{top=420;dockTop=570;resized();pending?.(0);pending=null});
 expect(document.querySelector<HTMLElement>('.tutorial-spotlight-ring')?.style.top).toBe('415px');
 expect([...document.querySelectorAll('mask path')].some(path=>path.getAttribute('d')?.includes('M-5,565'))).toBe(true);
});

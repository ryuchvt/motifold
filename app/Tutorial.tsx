import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DemoPiece, DemoRecipe } from './demo';
import { TutorialSpotlight } from './TutorialSpotlight';
import './tutorial.css';

export type TutorialEvent='raw-played'|'accepted-bars'|'tempo-inspected'|'study-started'|'study-ready'|'tracks-confirmed'|'questions-done'|'created'|'previews-ready'|'audition-a'|'audition-b'|'plan-chosen'|'write-started'|'write-ready'|'downloaded';
export const TUTORIAL_STEPS=[
  {id:'raw',title:'Start with the unedited performance',words:'Play my original MIDI and look at its uneven timing. Then open the saved accepted bars. The file keeps its original DAW offset.',requires:['accepted-bars'],target:'[data-tutorial="accept-bars"]',stage:null},
  {id:'tempo',title:'Inspect the accepted bars and tempo',words:'Move across the tempo map. It shows the saved interpretation of tempo inside 24 bars. Nearby attacks and notated releases were interpreted. This is saved accepted analysis, with no new model call.',requires:['tempo-inspected'],target:'[data-tutorial="tempo"]',stage:null},
  {id:'study',title:'Study the sketch and check its tracks',words:'Start the recorded analysis. Check the chords and sections, confirm both piano tracks, then skip the questions for this recorded take. In a live run you can give your own answers.',requires:['study-started','study-ready','tracks-confirmed','questions-done'],target:'[data-tutorial="tracks"],[data-tutorial="question-skip"],[data-tutorial="study-start"]',stage:'Study'},
  {id:'setup',title:'Choose the direction and players',words:'This take uses Arrange and String orchestra. Arrange stays neutral and keeps the original bars and harmony. Mood changes belong in Recompose. Check the setup and press Create.',requires:['created'],target:'[data-tutorial="create"]',stage:'Setup'},
  {id:'compare',title:'Hear the two real opening previews',words:'Wait for both previews, audition A and B, then choose a complete plan. Your choice decides which continuation is opened. No new model call is made.',requires:['previews-ready','audition-a','audition-b','plan-chosen'],target:'.idea-comparison,.idea-choose',stage:'Pick'},
  {id:'write',title:'Finish the plan you chose',words:'Press Write the rest of this one. The saved continuation arrives section by section. Your original notes remain in the finished score.',requires:['write-started','write-ready'],target:'[data-tutorial="write"]',stage:'Pick'},
  {id:'export',title:'Take the complete result into your DAW',words:'Open Export and download the selected arrangement. The ZIP contains the complete MIDI, notation and separate parts. After the download, explore the other prepared outcomes for free.',requires:['downloaded'],target:'[data-tutorial="export"],[data-tutorial="download"]',stage:'Write'},
]as const;
type Events=Partial<Record<TutorialEvent,boolean>>;
interface TutorialState {piece:DemoPiece|null;run:number;step:number;events:Events}
type Action={kind:'event';run:number;event:TutorialEvent;complete:boolean;user:boolean}|{kind:'back'}|{kind:'continue'};
export function tutorialTransition(state:TutorialState,action:Action):TutorialState {
  const step=TUTORIAL_STEPS[state.step];
  if(action.kind==='back')return{...state,step:Math.max(0,state.step-1)};
  if(action.kind==='continue')return step&&step.requires.every(event=>state.events[event])?{...state,step:state.step+1}:state;
  if(action.run!==state.run||!state.piece)return state;
  const events={...state.events,[action.event]:action.complete};
  // A new Create starts a new result. Earlier auditions and downloads cannot satisfy it.
  if(action.event==='created'&&action.complete&&action.user){
    for(const event of ['previews-ready','audition-a','audition-b','plan-chosen','write-started','write-ready','downloaded']as const)delete events[event];
    return{...state,events,step:4};
  }
  const done=step?.requires.every(event=>events[event]);
  const wasDone=step?.requires.every(event=>state.events[event]);
  const belongs=step?.requires.some(event=>event===action.event);
  return{...state,events,step:done&&belongs&&(!wasDone||action.user)?state.step+1:state.step};
}
export interface TutorialGuide {piece:DemoPiece;recipe:DemoRecipe;run:number;step:number;stepId:string;stage:string|null;events:Events;completeOptions:(0|1)[];mark:(event:TutorialEvent,complete?:boolean,user?:boolean)=>void}
const GuideContext=createContext<TutorialGuide|null>(null);
export const TutorialProvider=GuideContext.Provider;
export const useTutorialGuide=()=>useContext(GuideContext);
export function useTutorialController(){
  const nonce=useRef(0);
  const[state,setState]=useState<TutorialState>({piece:null,run:0,step:0,events:{}});
  const mark=useCallback((event:TutorialEvent,complete=true,user=false)=>setState(now=>now.events[event]===complete&&!user?now:tutorialTransition(now,{kind:'event',run:state.run,event,complete,user})),[state.run]);
  const start=(piece:DemoPiece)=>setState({piece,run:++nonce.current,step:0,events:{}});
  const exit=()=>setState(now=>({...now,piece:null}));
  const guide=useMemo<TutorialGuide|null>(()=>state.piece?{piece:state.piece,recipe:state.piece.recipe,run:state.run,step:state.step,stepId:TUTORIAL_STEPS[state.step]?.id??'complete',stage:TUTORIAL_STEPS[state.step]?.stage??null,events:state.events,completeOptions:state.piece.tutorial?.completeOptions??[0],mark}:null,[state,mark]);
  return{guide,start,exit,back:()=>setState(now=>tutorialTransition(now,{kind:'back'})),next:()=>setState(now=>tutorialTransition(now,{kind:'continue'})),complete:!!state.piece&&state.step>=TUTORIAL_STEPS.length};
}

/** The next real action, including the separate actions inside a longer lesson. */
export function tutorialCue(guide:TutorialGuide):{selectors:string[];instruction:string}{
  const events=guide.events;
  switch(TUTORIAL_STEPS[guide.step]?.id){
    case 'raw':return events['raw-played']?{selectors:['[data-tutorial="accept-bars"]'],instruction:'When you are ready, open the saved accepted bars.'}:{selectors:['[data-tutorial="raw-play"]'],instruction:'Play the original piano sketch to hear its freely played timing.'};
    case 'tempo':return{selectors:['[data-tutorial="tempo"] input[type="range"]','[data-tutorial="tempo"]'],instruction:'Move across the tempo map to inspect the accepted bars.'};
    case 'study':
      if(!events['study-started'])return{selectors:['[data-tutorial="study-start"]'],instruction:'Start the recorded Study of these bars.'};
      if(!events['study-ready'])return{selectors:[],instruction:'The recorded Study is arriving. Wait for the track check.'};
      if(!events['tracks-confirmed'])return{selectors:['[data-tutorial="tracks"]'],instruction:'Check both piano tracks, then confirm them.'};
      return{selectors:['[data-tutorial="question-skip"]'],instruction:'Skip each question to follow this recorded take.'};
    case 'setup':return{selectors:['[data-tutorial="create"]'],instruction:'Keep Arrange and String orchestra, then press Create.'};
    case 'compare':
      if(!events['previews-ready'])return{selectors:[],instruction:'Wait for both recorded opening previews.'};
      if(!events['audition-a'])return{selectors:['button[aria-label="Audition plan A"]'],instruction:'Play the opening of A.'};
      if(!events['audition-b'])return{selectors:['button[aria-label="Audition plan B"]'],instruction:'Now play the opening of B to compare.'};
      return{selectors:['.idea-choose'],instruction:'Choose the complete plan you want to finish.'};
    case 'write':return events['write-started']?{selectors:[],instruction:'The saved continuation is arriving. Your chosen plan stays selected.'}:{selectors:['[data-tutorial="write"]'],instruction:'Write the rest of the plan you chose.'};
    case 'export':return{selectors:['[data-tutorial="download"]','[data-tutorial="export"]'],instruction:'Open Export, then download the complete result.'};
    default:return{selectors:[],instruction:''};
  }
}

/** Guide controls stay in the layout. The spotlight never intercepts input. */
export function TutorialCoach({guide,onBack,onContinue,onSkip,onExit}:{guide:TutorialGuide;onBack:()=>void;onContinue:()=>void;onSkip:()=>void;onExit:()=>void}){
  const step=TUTORIAL_STEPS[guide.step];
  const done=step?.requires.every(event=>guide.events[event]);
  const cue=tutorialCue(guide),owner=`${guide.run}:${guide.step}:${cue.selectors.join('|')}`;
  const [selected,setSelected]=useState<{owner:string;target:HTMLElement}|null>(null);
  const target=selected?.owner===owner?selected.target:null;
  const coach=useRef<HTMLElement>(null);
  const showControl=useCallback((target:HTMLElement|null,explicit=false,focus=explicit)=>{
    if(!target)return;
    const behavior=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
    // An explicit request must reveal the control in the viewport too. A pane can
    // extend below the screen without having any internal scroll range of its own.
    if(explicit){target.scrollIntoView({behavior,block:'center',inline:'nearest'});const control=target.matches('button,input,select,textarea,a[href],[tabindex]')?target:target.querySelector<HTMLElement>('button,input,select,textarea,a[href],[tabindex]');if(focus)control?.focus({preventScroll:true});return}
    let pane=target.parentElement;
    while(pane&&!/(auto|scroll)/.test(getComputedStyle(pane).overflowY))pane=pane.parentElement;
    if(pane){const at=target.getBoundingClientRect(),box=pane.getBoundingClientRect();if(at.top<box.top||at.bottom>box.bottom)pane.scrollTo({top:Math.max(0,pane.scrollTop+at.top-box.top-24),behavior})}
  },[]);
  useEffect(()=>{
    if(!step)return;
    let live=true,target:HTMLElement|null=null;
    const scope=document.querySelector('.studio')??document.body;
    const discover=()=>{
      if(!live)return;
      const next=cue.selectors.flatMap(selector=>[...scope.querySelectorAll<HTMLElement>(selector)]).find(element=>{
        if(element.closest('[hidden],[aria-hidden="true"]'))return false;
        for(let at:HTMLElement|null=element;at;at=at.parentElement){const style=getComputedStyle(at);if(style.display==='none'||style.visibility==='hidden')return false}
        return true;
      })??null;
      if(next===target)return;
      target?.classList.remove('tutorial-target');target=next;target?.classList.add('tutorial-target');
      setSelected(target?{owner,target}:null);
      if(step.id!=='raw')showControl(target);
      else if(target&&guide.events['raw-played']){
        const box=target.getBoundingClientRect(),top=coach.current?.getBoundingClientRect().bottom??0;
        const dock=document.querySelector<HTMLElement>('[aria-label="What Muse Spark is doing"]')?.getBoundingClientRect().top??innerHeight;
        if(box.top<top+10||box.bottom>Math.min(innerHeight,dock)-10)showControl(target,true,false);
      }
    };
    discover();
    const observer=new MutationObserver(discover);observer.observe(scope,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','aria-hidden','class','style']});
    return()=>{live=false;observer.disconnect();target?.classList.remove('tutorial-target')};
  },[owner,showControl]);
  if(!step)return null;
  const instruction=target?.dataset.tutorial==='download'?'Download this complete arrangement as MIDI and notation.':cue.instruction;
  return <><aside ref={coach} className="tutorial-coach" aria-label="Hands-on tutorial"><div><span className="tutorial-count">{guide.step+1} of {TUTORIAL_STEPS.length}</span><strong>{step.title}</strong><p aria-live="polite">{instruction}</p><details><summary>About this step</summary><p>{step.words}</p></details></div><div className="tutorial-coach-actions"><button onClick={onBack} disabled={guide.step===0}>Back</button>{done&&<button onClick={onContinue}>Continue</button>}<button disabled={!target} onClick={()=>showControl(target,true)}>Show control</button><button onClick={onSkip}>Skip guide</button><button onClick={onExit}>Exit tutorial</button></div></aside><TutorialSpotlight key={owner} target={target} controls={coach} instruction={instruction}/></>;
}

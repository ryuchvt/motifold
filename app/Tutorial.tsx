import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DemoPiece, DemoRecipe } from './demo';
import './tutorial.css';

export type TutorialEvent='accepted-bars'|'tempo-inspected'|'study-started'|'study-ready'|'tracks-confirmed'|'questions-done'|'created'|'previews-ready'|'audition-a'|'audition-b'|'plan-chosen'|'write-started'|'write-ready'|'downloaded';
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

/** A coachmark in the layout. The highlighted real control stays clickable and nothing covers the score actions. */
export function TutorialCoach({guide,onBack,onContinue,onSkip,onExit}:{guide:TutorialGuide;onBack:()=>void;onContinue:()=>void;onSkip:()=>void;onExit:()=>void}){
  const step=TUTORIAL_STEPS[guide.step];
  const done=step?.requires.every(event=>guide.events[event]);
  const showControl=useCallback((target:HTMLElement|null,explicit=false)=>{
    if(!target)return;
    // An explicit request must reveal the control in the viewport too. A pane can
    // extend below the screen without having any internal scroll range of its own.
    if(explicit){target.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});return}
    let pane=target.parentElement;
    while(pane&&!/(auto|scroll)/.test(getComputedStyle(pane).overflowY))pane=pane.parentElement;
    if(pane){const at=target.getBoundingClientRect(),box=pane.getBoundingClientRect();if(at.top<box.top||at.bottom>box.bottom)pane.scrollTo({top:Math.max(0,pane.scrollTop+at.top-box.top-24),behavior:'smooth'})}
  },[]);
  useEffect(()=>{
    if(!step)return;
    let live=true,target:HTMLElement|null=null;
    const scope=document.querySelector('.studio')??document.body;
    const discover=()=>{if(!live)return;const next=scope.querySelector<HTMLElement>(step.target);if(next===target)return;target?.classList.remove('tutorial-target');target=next;target?.classList.add('tutorial-target');if(step.id!=='raw')showControl(target)};
    discover();
    const observer=new MutationObserver(discover);observer.observe(scope,{childList:true,subtree:true});
    return()=>{live=false;observer.disconnect();target?.classList.remove('tutorial-target')};
  },[guide.run,guide.step,guide.events,showControl]);
  if(!step)return null;
  return <aside className="tutorial-coach" aria-label="Hands-on tutorial"><div><span className="tutorial-count">{guide.step+1} of {TUTORIAL_STEPS.length}</span><strong>{step.title}</strong><p>{step.words}</p></div><div className="tutorial-coach-actions"><button onClick={onBack} disabled={guide.step===0}>Back</button>{done&&<button onClick={onContinue}>Continue</button>}<button onClick={()=>showControl(document.querySelector<HTMLElement>(step.target),true)}>Show control</button><button onClick={onSkip}>Skip guide</button><button onClick={onExit}>Exit tutorial</button></div></aside>;
}

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

interface Box {left:number;top:number;right:number;bottom:number}
const overlaps=(a:Box,b:Box)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const clamp=(n:number,low:number,high:number)=>Math.max(low,Math.min(n,high));
/** Keep the hint beside the control, never on top of the control or another protected region. */
export function spotlightHint(target:Box,width:number,height:number,viewport:Box,protectedBoxes:Box[]):Box|null{
  const gap=12,margin=8;
  const x=clamp(target.left,viewport.left+margin,viewport.right-width-margin);
  const y=clamp(target.top,viewport.top+margin,viewport.bottom-height-margin);
  const candidates=[
    {left:x,top:target.top-height-gap},
    {left:x,top:target.bottom+gap},
    {left:target.left-width-gap,top:y},
    {left:target.right+gap,top:y},
  ];
  for(const start of candidates){
    const box={...start,right:start.left+width,bottom:start.top+height};
    if(box.left>=viewport.left+margin&&box.right<=viewport.right-margin&&box.top>=viewport.top+margin&&box.bottom<=viewport.bottom-margin&&!protectedBoxes.some(other=>overlaps(box,other)))return box;
  }
  return null; // The in-layout instruction remains available on a crowded screen.
}
function visibleBox(element:HTMLElement,viewport:Box):Box|null{
  if(!element.isConnected)return null;
  const ownStyle=getComputedStyle(element);
  if(ownStyle.display==='none'||ownStyle.visibility==='hidden')return null;
  let box:Box={left:Math.max(viewport.left,element.getBoundingClientRect().left),top:Math.max(viewport.top,element.getBoundingClientRect().top),right:Math.min(viewport.right,element.getBoundingClientRect().right),bottom:Math.min(viewport.bottom,element.getBoundingClientRect().bottom)};
  for(let parent=element.parentElement;parent;parent=parent.parentElement){
    const style=getComputedStyle(parent),rect=parent.getBoundingClientRect();
    if(style.display==='none'||style.visibility==='hidden')return null;
    if(/auto|scroll|hidden|clip/.test(style.overflowX)){box.left=Math.max(box.left,rect.left);box.right=Math.min(box.right,rect.right)}
    if(/auto|scroll|hidden|clip/.test(style.overflowY)){box.top=Math.max(box.top,rect.top);box.bottom=Math.min(box.bottom,rect.bottom)}
  }
  return box.right>box.left&&box.bottom>box.top?box:null;
}
const path=(box:Box,padding=0)=>`M${box.left-padding},${box.top-padding}H${box.right+padding}V${box.bottom+padding}H${box.left-padding}Z`;

/** Purely visual: all real controls, normal keyboard order and scrolling remain in the page. */
export function TutorialSpotlight({target,controls,instruction}:{target:HTMLElement|null;controls:RefObject<HTMLElement|null>;instruction:string}){
  const id=useId(),hint=useRef<HTMLDivElement>(null);
  const [geometry,setGeometry]=useState<{viewport:Box;target:Box;holes:Box[];hint:Box|null}|null>(null);
  useEffect(()=>{
    if(!target)return;
    const previous=target.getAttribute('aria-describedby');
    target.setAttribute('aria-describedby',[previous,id].filter(Boolean).join(' '));
    return()=>{const remaining=target.getAttribute('aria-describedby')?.split(/\s+/).filter(value=>value!==id).join(' ');if(remaining)target.setAttribute('aria-describedby',remaining);else target.removeAttribute('aria-describedby')};
  },[target,id]);
  useLayoutEffect(()=>{
    if(!target){setGeometry(null);return}
    let frame=0;
    const measure=()=>{
      frame=0;
      const visual=window.visualViewport;
      const viewport={left:visual?.offsetLeft??0,top:visual?.offsetTop??0,right:(visual?.offsetLeft??0)+(visual?.width??innerWidth),bottom:(visual?.offsetTop??0)+(visual?.height??innerHeight)};
      const box=visibleBox(target,viewport);
      if(!box){setGeometry(null);return}
      const focused=document.activeElement instanceof HTMLElement&&document.activeElement.matches('button,input,select,textarea,a[href],summary,[tabindex]')?document.activeElement:null;
      const protectedElements=[controls.current,focused,document.querySelector<HTMLElement>('[aria-label="What Muse Spark is doing"]')].filter((element):element is HTMLElement=>!!element);
      const holes=protectedElements.map(element=>visibleBox(element,viewport)).filter((box):box is Box=>!!box);
      const hintBox=hint.current?.getBoundingClientRect();
      setGeometry({viewport,target:box,holes,hint:spotlightHint(box,hintBox?.width??260,hintBox?.height??70,viewport,[box,...holes])});
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure)};
    measure();
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);
    for(let element:HTMLElement|null=target;element;element=element.parentElement)observer?.observe(element);
    if(controls.current)observer?.observe(controls.current);if(hint.current)observer?.observe(hint.current);
    const dock=document.querySelector<HTMLElement>('[aria-label="What Muse Spark is doing"]');if(dock)observer?.observe(dock);
    window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
    document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
    window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
    return()=>{cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);document.removeEventListener('focusin',schedule);document.removeEventListener('focusout',schedule);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule)};
  },[target,controls,instruction]);
  if(!target)return null;
  const box=geometry?.target,at=geometry?.hint;
  return createPortal(<div className="tutorial-spotlight" aria-hidden="true">
    {geometry&&<svg className="tutorial-scrim" width="100%" height="100%"><defs><mask id={`${id}-mask`}><rect width="100%" height="100%" fill="white"/>{[geometry.target,...geometry.holes].map((hole,index)=><path key={index} d={path(hole,5)} fill="black"/>)}</mask></defs><rect width="100%" height="100%" fill="#02060c" fillOpacity=".62" mask={`url(#${id}-mask)`}/></svg>}
    {box&&<div className="tutorial-spotlight-ring" style={{left:box.left-5,top:box.top-5,width:box.right-box.left+10,height:box.bottom-box.top+10}}/>}
    <div ref={hint} className="tutorial-spotlight-hint" style={{left:at?.left??8,top:at?.top??0,visibility:at?'visible':'hidden'}}>{instruction}</div>
    {/* A stable description exists even when there is no safe visual hint position. */}
    <span id={id} className="tutorial-accessible-cue">{instruction}</span>
  </div>,document.body);
}

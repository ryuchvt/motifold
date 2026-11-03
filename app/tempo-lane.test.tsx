// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TempoLane, tempoPoints, tempoAt } from './TempoLane';
import { PieceView } from './PieceView';
import { playhead } from './playhead';
import type { PieceData } from './pieceData';
vi.mock('./audio/samples',()=>({loadManifest:async()=>null}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|null=null;
afterEach(()=>{act(()=>root?.unmount());root=null;document.body.replaceChildren();vi.unstubAllGlobals()});
const tempos=[{beat:0,qpm:90},{beat:5.5,qpm:72},{beat:8,qpm:108}];
const bars=[{number:'1',start:0,length:4},{number:'2',start:4,length:3},{number:'3',start:7,length:5}];
function change(input:HTMLInputElement,value:string){act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})}

it('inspects actual within-bar tempo changes across unequal bar lengths without editing the map',()=>{
  const inspect=vi.fn(),host=document.body.appendChild(document.createElement('div'));
  root=createRoot(host);act(()=>root!.render(<TempoLane tempos={tempos} bars={bars} total={12} onInspect={inspect}/>));
  const slider=host.querySelector('input')!;
  change(slider,'6');expect(inspect).toHaveBeenLastCalledWith(6,'2');expect(slider.getAttribute('aria-valuetext')).toBe('Bar 2, 72 beats per minute');
  change(slider,'8.5');expect(inspect).toHaveBeenLastCalledWith(8.5,'3');expect(slider.getAttribute('aria-valuetext')).toBe('Bar 3, 108 beats per minute');
  expect(tempos).toEqual([{beat:0,qpm:90},{beat:5.5,qpm:72},{beat:8,qpm:108}]);
});
it('has a finite constant default and excludes invalid display points',()=>{
  expect(tempoPoints([])).toEqual([{beat:0,qpm:120}]);
  expect(tempoAt(tempoPoints([{beat:2,qpm:60},{beat:3,qpm:NaN},{beat:-1,qpm:30}]),0)).toBe(60);
});
it('seeks the inspected mid-bar beat after the selected passage commits, without a fake playing cursor',()=>{
  const frames=new Map<number,FrameRequestCallback>();let next=0;
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++next,callback);return next});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  const heard=vi.fn();const data:PieceData={rows:[],bars,totalBeats:12,tempos,fullness:{yours:[],added:[]}};
  function Host(){const[selected,setSelected]=useState({from:'1',to:'1'});return <PieceView data={data} sections={[]} moments={[]} selected={selected} focus={null} solo={[]} instrumentOf={()=>''} hasNew={false} onSelect={bar=>setSelected({from:bar,to:bar})} onSelectRange={()=>{}} onFocus={()=>{}} onSolo={()=>{}} onBeat={heard}/>}
  root=createRoot(document.body.appendChild(document.createElement('div')));act(()=>root!.render(<Host/>));
  change(document.querySelector('input')!,'6');
  act(()=>{for(const callback of frames.values())callback(0);frames.clear()});
  expect(playhead.beat).toBe(6);expect(heard).not.toHaveBeenCalled();
  change(document.querySelector('input')!,'8.5');
  act(()=>root!.unmount());root=null;
  expect(frames.size).toBe(0);
});

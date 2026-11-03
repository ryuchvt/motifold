// @vitest-environment jsdom
// Original synthetic score and local responses. Create must keep one request's settings throughout its chain.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import type { ArrangeInput, DistributeInput, WriteInput } from "../server/shapes";
import { ArrangePanel } from "./ArrangePanel";
import { useArrange, type Arranged } from "./useArrange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText=readFileSync("test-fixtures/contract-score.musicxml","utf8");
const score=parseScore(xmlText);
const part=score.parts[0]!;
const loaded={fileName:"contract-score.musicxml",xmlText,score};
const range={from:0,to:part.measures.length-1};
const response=(answer:unknown)=>new Response(JSON.stringify({status:"ok",answer}));
let unmount=()=>{};
afterEach(()=>{act(unmount);document.body.replaceChildren();vi.unstubAllGlobals();});

function setup(){
  const layouts:DistributeInput[]=[];
  const plans:ArrangeInput[]=[];
  const writes:WriteInput[]=[];
  let holdLayout=false;
  let holdPlan=false;
  let release=()=>{};
  vi.stubGlobal("fetch",async(url:string,init:RequestInit)=>{
    const input=JSON.parse(init.body as string).input;
    if(url.endsWith("study_score"))return new Response(JSON.stringify({status:"fallback",reason:"empty"}));
    if(url.endsWith("read_piece"))return response({summary:"The supplied sketch",sections:[],roles:[],thin:[],missing:[],structures:[]});
    if(url.endsWith("distribute")){
      const asked=input as DistributeInput;
      layouts.push(asked);
      const answer={idea:"The chosen players",plan:[{from:asked.written[0]!.bar,to:asked.written.at(-1)!.bar,line:asked.lines![0]!,voice:"all",part:asked.instruments[0]!,octave:0,why:"Keep the source line"}]};
      if(holdLayout)return await new Promise<Response>(resolve=>{release=()=>resolve(response(answer));});
      return response(answer);
    }
    if(url.endsWith("plan_options")){
      const asked=input as ArrangeInput;
      plans.push(asked);
      const number=plans.length;
      const answer={options:["A","B"].map(letter=>({name:`Run ${number} ${letter}`,idea:"An answer",why:[{from:asked.written[0]!.bar,to:asked.written.at(-1)!.bar,what:"An answer",principle:"Follow the sketch"}]}))};
      if(holdPlan)return await new Promise<Response>(resolve=>{release=()=>resolve(response(answer));});
      return response(answer);
    }
    if(!url.endsWith("arrange"))throw Error("Unexpected request");
    const asked=input as WriteInput;
    writes.push(asked);
    return response({adds:[{part:asked.instruments?.[1]??"Flute",bar:asked.window!.from,events:"C5@0+1",dyn:"mf"}],doubles:[]});
  });
  let current!:Arranged;
  function Host(){current=useArrange(loaded,part,range,null);return <ArrangePanel arranged={current} busy={false}/>;}
  const host=document.body.appendChild(document.createElement("div"));
  const root=createRoot(host);
  act(()=>root.render(<Host/>));
  unmount=()=>root.unmount();
  return {host,get now(){return current;},layouts,plans,writes,holdLayout:()=>{holdLayout=true;},holdPlan:()=>{holdPlan=true;},release:()=>release()};
}
async function press(host:Element,text:string){
  const button=[...host.querySelectorAll("button")].find(b=>b.textContent?.trim()===text);
  if(!button)throw Error(`No button ${text}`);
  await act(async()=>button.click());
}
async function opened(screen:ReturnType<typeof setup>){
  await act(()=>screen.now.askPiece());
  await press(screen.host,"Confirm tracks");
  await press(screen.host,"Next: Setup");
}
async function finished(screen:ReturnType<typeof setup>,run:number){
  await vi.waitFor(async()=>{
    await act(async()=>{});
    const options=screen.now.options;
    expect(options.status).toBe("ready");
    if(options.status!=="ready")return;
    expect(options.plans[0]!.name).toBe(`Run ${run} A`);
    expect(options.plans.every((_,index)=>options.notes[index]?.status==="ready")).toBe(true);
  });
}

it("Create snapshots its recipe and waits for a fresh layout before planning over previous ready results",async()=>{
  const screen=setup();
  await opened(screen);
  await press(screen.host,"Create");
  await finished(screen,1);
  await press(screen.host,"Setup");
  await press(screen.host,"Brass quintet");
  await press(screen.host,"Sad");
  screen.holdLayout();
  await press(screen.host,"Create");
  expect(screen.layouts).toHaveLength(2);
  expect(screen.plans).toHaveLength(1);
  expect(screen.writes).toHaveLength(2);
  await press(screen.host,"Setup");
  await press(screen.host,"Hopeful");
  await act(async()=>{screen.release();});
  await finished(screen,2);
  expect(screen.layouts[1]!.ask).toBe("The mood I want: sad.");
  expect(screen.plans[1]!.ask).toBe("The mood I want: sad.");
  expect(screen.plans[1]!.lines).toContain("Trumpet 1");
  expect(screen.plans[1]!.lines).not.toContain("Violin I");
  expect(screen.writes.slice(2).map(w=>w.chosen.name)).toEqual(["Run 2 A","Run 2 B"]);
});

it("keeping tracks waits for a new plan response before previewing instead of consuming an old ready plan",async()=>{
  const screen=setup();
  await opened(screen);
  await press(screen.host,"Create");
  await finished(screen,1);
  await press(screen.host,"Setup");
  const keep=[...screen.host.querySelectorAll<HTMLInputElement>('.arrange-check input')].find(input=>input.parentElement?.textContent?.includes("Keep my own tracks"))!;
  await act(async()=>keep.click());
  screen.holdPlan();
  await press(screen.host,"Create");
  expect(screen.layouts).toHaveLength(1);
  expect(screen.plans).toHaveLength(2);
  expect(screen.writes).toHaveLength(2);
  await act(async()=>{screen.release();});
  await finished(screen,2);
  expect(screen.writes.slice(2).map(w=>w.chosen.name)).toEqual(["Run 2 A","Run 2 B"]);
});

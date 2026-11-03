// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import type { ArrangeInput, WriteInput } from "../server/shapes";
import { onlyBars } from "./arrange";
import { useArrange, type Arranged } from "./useArrange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const contractScore = readFileSync("test-fixtures/contract-score.musicxml","utf8");
const response = (answer: unknown) => new Response(JSON.stringify({status:"ok",answer}));
let unmount = () => {};
afterEach(() => { act(unmount); document.body.replaceChildren(); vi.unstubAllGlobals(); });

function setup(single = false) {
  const xmlText = single ? onlyBars(contractScore,"1","7a") : contractScore;
  const score = parseScore(xmlText);
  const part = score.parts[0]!;
  const loaded = {fileName:"contract-score.musicxml",xmlText,score};
  const range = {from:0,to:part.measures.length-1};
  const calls: WriteInput[] = [];
  let hold: (input: WriteInput) => boolean = () => false;
  const pending: (() => void)[] = [];
  vi.stubGlobal("fetch",async(url:string,init:RequestInit) => {
    const input = JSON.parse(init.body as string).input;
    if(url.endsWith("study_score")) return new Response(JSON.stringify({status:"fallback",reason:"empty"}));
    if(url.endsWith("read_piece")) return response({summary:"A sketch",sections:[],roles:[],missing:[],thin:[],structures:[]});
    if(url.endsWith("plan_options")) {
      const asked = input as ArrangeInput;
      return response({options:["One","Two"].map(name => ({name,idea:"Flute answers",why:[{from:asked.written[0]!.bar,to:asked.written.at(-1)!.bar,what:"Flute answers",principle:"Use the tune"}]}))});
    }
    if(!url.endsWith("arrange")) throw Error("Unexpected request");
    const asked = input as WriteInput;
    calls.push(asked);
    const pitch=asked.fix?.ask==="Use the later line" ? "E5" : asked.chosen.name === "One" ? "C5" : "D5";
    const answer = {adds:[{part:"Flute",bar:asked.window!.from,events:`${pitch}@0+1`,dyn:"mf"}],doubles:[]};
    if(hold(asked)) return await new Promise<Response>(resolve => pending.push(() => resolve(response(answer))));
    return response(answer);
  });
  let current!: Arranged;
  function Host(){ current=useArrange(loaded,part,range,null); return null; }
  const root=createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(<Host/>));
  unmount=() => root.unmount();
  return {get now(){return current;},calls,hold:(test:(input:WriteInput)=>boolean)=>{hold=test;},release:()=>{pending.splice(0).forEach(done=>done());}};
}
async function plans(screen: ReturnType<typeof setup>) {
  await act(() => screen.now.askPiece());
  await act(() => screen.now.askOptions("",0,"inside"));
}

it("a late one-section preview cannot select itself over the chosen other plan",async()=>{
  const screen=setup(true);
  await plans(screen);
  screen.hold(input=>input.chosen.name==="One");
  let preview!:Promise<unknown>;
  act(()=>{preview=screen.now.askPreview(0);});
  await act(()=>screen.now.askNotes(1));
  expect(screen.now.trying).toEqual({kind:"option",index:1});
  await act(async()=>{screen.release();await preview;});
  expect(screen.now.trying).toEqual({kind:"option",index:1});
  const options=screen.now.options;
  expect(options.status==="ready" && options.notes[0]).toMatchObject({status:"ready"});
});

it("choosing a pending preview waits for its first section and writes each remaining section once",async()=>{
  const screen=setup();
  await plans(screen);
  let held=false;
  screen.hold(input=>{if(input.chosen.name!=="One"||held)return false;held=true;return true;});
  let preview!:Promise<unknown>;
  let choice!:Promise<unknown>;
  act(()=>{preview=screen.now.askPreview(0);});
  act(()=>{choice=screen.now.askNotes(0);});
  await act(async()=>{screen.release();await Promise.all([preview,choice]);});
  const windows=screen.calls.filter(input=>input.chosen.name==="One").map(input=>`${input.window!.from}-${input.window!.to}`);
  expect(windows).toHaveLength(3);
  expect(new Set(windows).size).toBe(3);
  const options=screen.now.options;
  if(options.status!=="ready"||options.notes[0]?.status!=="ready") throw Error("No chosen score");
  expect(options.notes[0].missing).toBeUndefined();
  expect(options.notes[0].preview).toBeFalsy();
});

it("selecting a complete one-section preview uses its existing notes without asking again",async()=>{
  const screen=setup(true);
  await plans(screen);
  await act(()=>screen.now.askPreview(0));
  const before=screen.calls.length;
  await act(()=>screen.now.askNotes(0));
  expect(screen.calls).toHaveLength(before);
  expect(screen.now.trying).toEqual({kind:"option",index:0});
});

it("can compare existing previews at the same selected bars without changing normal new-note focus",async()=>{
  const screen=setup();
  await plans(screen);
  await act(async()=>{await Promise.all([screen.now.askPreview(0),screen.now.askPreview(1)]);});
  act(()=>screen.now.selectRange("15","16"));
  act(()=>screen.now.setTrying({kind:"option",index:1},true));
  expect(screen.now.view).toEqual({from:"15",to:"16"});
  act(()=>screen.now.setTrying({kind:"option",index:0}));
  expect(screen.now.view).toEqual({from:"1",to:"7a"});
});

it("choosing another plan to write pauses future sections and keeps the first plan available to resume",async()=>{
  const screen=setup();
  await plans(screen);
  await act(async()=>{await Promise.all([screen.now.askPreview(0),screen.now.askPreview(1)]);});
  screen.hold(input=>input.chosen.name==="One"&&input.window!.from==="7b");
  let writing!:Promise<unknown>;
  act(()=>{writing=screen.now.askNotes(0);});
  await act(()=>screen.now.askNotes(1));
  await act(async()=>{screen.release();await writing;});
  expect(screen.now.trying).toEqual({kind:"option",index:1});
  expect(screen.calls.filter(input=>input.chosen.name==="One").map(input=>input.window!.from)).toEqual(["1","7b"]);
  let options=screen.now.options;
  if(options.status!=="ready"||options.notes[0]?.status!=="ready") throw Error("Lost the partial first plan");
  expect(options.notes[0].missing).toEqual([{from:"15",to:"21"}]);
  screen.hold(()=>false);
  await act(()=>screen.now.askNotes(0));
  options=screen.now.options;
  if(options.status!=="ready"||options.notes[0]?.status!=="ready") throw Error("No resumed plan");
  expect(options.notes[0].missing).toBeUndefined();
  expect(screen.calls.filter(input=>input.chosen.name==="One").map(input=>input.window!.from)).toEqual(["1","7b","15"]);
});

it("auditioning another preview preserves the view while the chosen plan keeps writing",async()=>{
  const screen=setup();
  await plans(screen);
  await act(async()=>{await Promise.all([screen.now.askPreview(0),screen.now.askPreview(1)]);});
  screen.hold(input=>input.chosen.name==="One"&&input.window!.from==="7b");
  let writing!:Promise<unknown>;
  act(()=>{writing=screen.now.askNotes(0);});
  act(()=>{screen.now.selectRange("15","16");screen.now.setTrying({kind:"option",index:1},true);});
  await act(async()=>{screen.release();await writing;});
  expect(screen.now.trying).toEqual({kind:"option",index:1});
  expect(screen.now.view).toEqual({from:"15",to:"16"});
  const options=screen.now.options;
  if(options.status!=="ready"||options.notes[0]?.status!=="ready") throw Error("No written plan");
  expect(options.notes[0].missing).toBeUndefined();
  expect(screen.calls.filter(input=>input.chosen.name==="One").map(input=>input.window!.from)).toEqual(["1","7b","15"]);
});

it("an older fix cannot replace a newer accepted fix on the same plan",async()=>{
  const screen=setup();
  await plans(screen);
  await act(()=>screen.now.askNotes(0));
  screen.hold(input=>input.fix?.ask==="Use the earlier line");
  let earlier!:Promise<unknown>;
  act(()=>{earlier=screen.now.askFix(0,"1","1","Use the earlier line");});
  await act(()=>screen.now.askFix(0,"1","1","Use the later line"));
  await act(async()=>{screen.release();await earlier;});
  const options=screen.now.options;
  if(options.status!=="ready"||options.notes[0]?.status!=="ready") throw Error("No fixed plan");
  expect(options.notes[0].adds.find(note=>note.bar==="1")!.events).toBe("E5@0+1");
});

it("leaving the score while a chosen preview is pending never starts the rest on its replacement",async()=>{
  const screen=setup();
  await plans(screen);
  screen.hold(input=>input.chosen.name==="One");
  let preview!:Promise<unknown>;
  let choice!:Promise<unknown>;
  act(()=>{preview=screen.now.askPreview(0);});
  act(()=>{choice=screen.now.askNotes(0);});
  act(()=>screen.now.startAgain());
  await act(async()=>{screen.release();await Promise.all([preview,choice]);});
  expect(screen.now.options.status).toBe("none");
  expect(screen.now.trying).toBeNull();
  expect(screen.calls).toHaveLength(1);
});

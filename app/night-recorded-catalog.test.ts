import { afterEach, expect, it, vi } from 'vitest';
import { recordedDemoCatalog, recordedDemoIndex, startDemo, stopDemo, type DemoOutcome, type DemoPiece } from './demo';
import { askSpark } from './spark';

const unavailable: DemoOutcome = { id:'arrange-strings-a',runKey:'arrange-neutral-strings',intent:'arrange',ensemble:'String orchestra',mood:'',option:0,name:'Option A',bars:24,sourceBars:24,status:'unavailable',reason:'This outcome has not been recorded.' };
const complete: DemoOutcome = {...unavailable,status:'complete',name:'A genuine recorded plan',xml:'/demo/sample-sketch/outcomes/arrange-strings-a/score.musicxml',midi:'/demo/sample-sketch/outcomes/arrange-strings-a/all-parts.mid',zip:'/demo/sample-sketch/outcomes/arrange-strings-a/score.zip',xmlSha256:'a'.repeat(64)};
const piece: DemoPiece = {id:'sample-sketch',name:'Sample sketch',words:'An actual local recording.',midi:'/demo/sample-sketch/Sample_sketch.mid',xml:'/demo/sample-sketch/sample-sketch.musicxml',recipe:{intent:'arrange',ensemble:'String orchestra',moreBars:0,where:'inside',useMelodyOnly:false},guide:['Use the recorded choices.'],tutorial:{runKey:'strings',acceptedLabel:'Saved accepted bar analysis.'},runs:[{key:'strings',mode:'arrange',ensemble:'String orchestra',mood:''},{key:'brass',mode:'arrange',ensemble:'Brass quintet',mood:''}]};
const catalog=(outcomes:DemoOutcome[])=>({version:1,pieceId:piece.id,recorded:'2026-11-04',outcomes});
afterEach(()=>{stopDemo();vi.unstubAllGlobals()});

it('accepts a declared matrix with actual complete files and honest unrecorded entries',()=>{
  const rows=Array.from({length:204},(_,i)=>({...unavailable,id:`unavailable-${i}`}));
  rows[0]=complete;
  const result=recordedDemoCatalog(catalog(rows),piece.id)!;
  expect(result.outcomes).toHaveLength(204);
  expect(result.outcomes.filter(x=>x.status==='complete')).toEqual([complete]);
  expect(result.outcomes.filter(x=>x.status==='unavailable').every(x=>x.xml===undefined&&x.midi===undefined&&x.zip===undefined)).toBe(true);
});

it('rejects external/traversing files, duplicate outcomes, missing exports and malformed bindings',()=>{
  for(const path of ['https://outside.invalid/score.xml','//outside.invalid/score.xml','/demo/sample-sketch/../score.xml','/demo//score.xml','/demo/sample-sketch/score.xml?live=1']){
    expect(recordedDemoCatalog(catalog([{...complete,xml:path}]),piece.id)).toBeNull();
  }
  expect(recordedDemoCatalog(catalog([complete,{...complete}]),piece.id)).toBeNull();
  expect(recordedDemoCatalog(catalog([{...complete,midi:undefined}]),piece.id)).toBeNull();
  expect(recordedDemoCatalog(catalog([{...complete,renderXmlSha256:'not-a-hash'}]),piece.id)).toBeNull();
  expect(recordedDemoCatalog(catalog([{...complete,mood:'Sad'}]),piece.id)).toBeNull();
  expect(recordedDemoCatalog(catalog([complete]),'another-piece')).toBeNull();
});

it('binds the tutorial to its declared exact recipe rather than deriving a mood-only filename',()=>{
  const index={recorded:'2026-11-04',pieces:[piece]};
  expect(recordedDemoIndex(index)).toEqual(index);
  expect(recordedDemoIndex({...index,pieces:[{...piece,recipe:{...piece.recipe,mood:'Neutral'}}]})).not.toBeNull();
  expect(recordedDemoIndex({...index,pieces:[{...piece,tutorial:{...piece.tutorial,runKey:'missing'}}]})).toBeNull();
  expect(recordedDemoIndex({...index,pieces:[{...piece,recipe:{...piece.recipe,ensemble:'Full orchestra'}}]})).toBeNull();
  expect(recordedDemoIndex({...index,pieces:[{...piece,recipe:{...piece.recipe,mood:'Sad'}}]})).toBeNull();
  const expanded={...piece,recipe:{...piece.recipe,intent:'expand',moreBars:16,where:'both'},runs:[{key:'strings',mode:'expand',ensemble:'String orchestra',mood:''}]};
  expect(recordedDemoIndex({...index,pieces:[expanded]})).not.toBeNull();
});

it('loads shared plus the selected recipe only and never falls through to an API or a conflicting take',async()=>{
  const receipt={shape:'arrange',input:{chosen:'A'},reply:{status:'ok',answer:{from:'strings'},cached:false},ms:0,thinking:[],model:'local-test',version:'local-test'};
  const fetcher=vi.fn(async(url:string)=>{
    if(url==='/demo/sample-sketch/shared.json')return Response.json([]);
    if(url==='/demo/sample-sketch/strings.json')return Response.json([receipt]);
    throw Error(`Unexpected request ${url}`);
  });vi.stubGlobal('fetch',fetcher);
  startDemo(piece,'2026-11-04');
  expect(await askSpark('arrange',{chosen:'A'})).toEqual(receipt.reply);
  expect(await askSpark('arrange',{chosen:'B'})).toEqual({status:'fallback',reason:'not-prepared'});
  expect(fetcher.mock.calls.map(x=>x[0])).toEqual(['/demo/sample-sketch/shared.json','/demo/sample-sketch/strings.json']);
});

it('keeps a complete promoted pair independent of a different older shared reading',async()=>{
  const current={...piece,tutorial:{...piece.tutorial!,completeOptions:[0,1] as (0|1)[]},runs:piece.runs.map(run=>({...run,selfContained:true}))};
  const reply={status:'ok',answer:{reading:'fresh exact take'},cached:false};
  const fetcher=vi.fn(async(url:string)=>{if(url==='/demo/sample-sketch/strings.json')return Response.json([{shape:'read_piece',input:{},reply,ms:0,thinking:[],model:'local-test',version:'local-test'}]);throw Error(`Older shared reading must not load: ${url}`)});vi.stubGlobal('fetch',fetcher);
  expect(recordedDemoIndex({recorded:'2026-11-04',pieces:[current]})).not.toBeNull();
  startDemo(current,'2026-11-04');expect(await askSpark('read_piece',{})).toEqual(reply);
  expect(fetcher.mock.calls.map(row=>row[0])).toEqual(['/demo/sample-sketch/strings.json']);
  expect(recordedDemoIndex({recorded:'2026-11-04',pieces:[{...current,tutorial:{...current.tutorial,completeOptions:[0,0]}}]})).toBeNull();
});

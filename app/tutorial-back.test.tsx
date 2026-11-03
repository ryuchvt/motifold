// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {act,forwardRef,useImperativeHandle} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {Studio} from './Studio';
import {stopDemo} from './demo';
import {askSpark} from './spark';
vi.mock('./spark',async original=>{const real=await original<typeof import('./spark')>();return{...real,askSpark:vi.fn(real.askSpark)}});
vi.mock('./ScoreView',()=>({ScoreView:forwardRef((_props,ref)=>{useImperativeHandle(ref,()=>({showPlaying:()=>{}}));return <div>Notation canvas</div>})}));
vi.mock('./audio/samples',()=>({loadManifest:async()=>null}));
vi.mock('./Thinking',()=>({MuseChip:()=>null,Thinking:()=>null,resetMuseActivity:()=>{}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|null=null;
afterEach(()=>{act(()=>root?.unmount());root=null;stopDemo();document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals()});

it('returns from the accepted score to only the raw performance, then reuses the accepted score without any analysis call',async()=>{
 const fetched:string[]=[];
 vi.stubGlobal('fetch',async(url:string)=>{
  fetched.push(url);
  if(url==='/api/access')return Response.json({state:'available',resetAt:null});
  if(!url.startsWith('/demo/'))throw Error(`Provider requests are prohibited: ${url}`);
  return new Response(readFileSync(`public${url}`));
 });
 const host=document.body.appendChild(document.createElement('div'));root=createRoot(host);
 await act(async()=>root!.render(<Studio/>));
 const press=async(text:string)=>{const button=[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()===text)!;expect(button,`Missing ${text}`).toBeTruthy();expect(button.disabled).toBe(false);await act(async()=>button.click())};
 const only=(title:string)=>{expect(host.querySelectorAll('main.tutorial-sketch')).toHaveLength(1);expect(host.querySelector('main.tutorial-sketch h1')?.textContent).toBe(title)};
 await press('Start hands-on tutorial');only('My piano sketch, before analysis');
 await press('Open the saved accepted bars');only('The accepted score');
 expect(host.querySelector('main.tutorial-sketch')?.textContent).toContain('114 accepted attacks');
 await press('Back');only('My piano sketch, before analysis');
 expect(host.querySelector('[aria-label="Accepted notation"]')).toBeNull();
 expect(host.querySelector('[data-tutorial="study-start"]')).toBeNull();
 await press('Open the saved accepted bars');only('The accepted score');
 expect(host.querySelector('main.tutorial-sketch')?.textContent).toContain('114 accepted attacks');
 const index=JSON.parse(readFileSync('public/demo/index.json','utf8'));
 expect(fetched.filter(url=>url===index.pieces[0].xml)).toHaveLength(1);
 expect(askSpark).not.toHaveBeenCalled();
 expect(fetched.filter(url=>url.startsWith('/api/')&&url!=='/api/access')).toEqual([]);
});

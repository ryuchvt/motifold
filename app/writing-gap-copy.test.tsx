// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {parseScore} from '../score';
import {ArrangePanel} from './ArrangePanel';
import {setTransport,type SparkReply} from './spark';
import {useArrange,type Arranged} from './useArrange';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const xmlText=`<score-partwise><part-list><score-part id="P1"><part-name>Cello</part-name></score-part></part-list><part id="P1">${Array.from({length:18},(_,i)=>`<measure number="${i+1}">${i===0?'<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>':''}<note><pitch><step>${['D','F','A'][i%3]}</step><octave>3</octave></pitch><duration>4</duration></note></measure>`).join('')}</part></score-partwise>`;
const score=parseScore(xmlText),loaded={fileName:'local-contract.musicxml',xmlText,score},part=score.parts[0]!,range={from:0,to:17};
const plan={name:'Local continuation',idea:'A flute answers the cello.',why:[{from:'1',to:'8',what:'Flute answers',principle:'Counterline'},{from:'9',to:'16',what:'Flute varies the answer',principle:'Variation'},{from:'17',to:'18',what:'Flute closes',principle:'Ending'}]};
let root:Root|null=null;
afterEach(()=>{act(()=>root?.unmount());root=null;setTransport(null);document.body.replaceChildren();vi.unstubAllGlobals()});

it('defers final gap warnings during a pending continuation, then retains real gaps and the failed-window reason',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('No HTTP is allowed')}));
 let finishSecond!:(reply:SparkReply)=>void;
 let blocked=true;const windows:string[]=[];
 const answer=(bar:string):SparkReply=>({status:'ok',cached:false,answer:{adds:[{part:'Flute',bar,events:'C5@0+1',dyn:'mf'}],doubles:[]}});
 setTransport(async(shape,input)=>{
  if(shape==='read_piece')return{status:'ok',cached:false,answer:{summary:'An original synthetic cello line.',sections:[{from:'1',to:'18',name:'Source'}],roles:[{from:'1',to:'18',line:'Cello',role:'melody',of:'',why:'The only line'}],tracks:[{line:'Cello',instrument:'Cello',sure:true,why:'One line'}],questions:[],thin:[],missing:[],structures:[]}};
  if(shape==='plan_options')return{status:'ok',cached:false,answer:{options:[plan]}};
  if(shape==='arrange'){
   const from=(input as {window?:{from:string}}).window?.from??'1';
   windows.push(from);
   if(from==='9')return await new Promise<SparkReply>(resolve=>{finishSecond=resolve});
   if(from==='17'&&blocked)return{status:'fallback',reason:'quota'};
   return answer(from);
  }
  return{status:'fallback',reason:'not-prepared'};
 });
 let now!:Arranged;
 function Host(){now=useArrange(loaded,part,range,null);return <ArrangePanel arranged={now} busy={false}/>}
 const host=document.body.appendChild(document.createElement('div'));root=createRoot(host);act(()=>root!.render(<Host/>));
 const press=async(text:string)=>{const button=[...host.querySelectorAll('button')].find(button=>button.textContent?.trim()===text)!;expect(button,`Missing ${text}`).toBeTruthy();await act(async()=>button.click())};
 await act(()=>now.askPiece());await act(()=>now.askOptions('',0,'inside'));await act(()=>now.askPreview(0));
 expect(now.options.status==='ready'&&now.options.notes[0]?.status==='ready'&&now.options.notes[0].preview).toBe(true);
 await press('Pick');await press('Write the rest of this one');
 expect(finishSecond).toBeTypeOf('function');
 expect(host.textContent).toContain('Writing bars 9 to 16');
 expect(host.textContent).not.toContain('No new notes came back');
 await act(async()=>finishSecond(answer('9')));
 expect(host.textContent).not.toContain('Writing bars 9 to 16');
 expect(host.textContent).toContain("Bars 17 to 18 didn't finish");
 expect(host.textContent).toContain("This connection has reached today's allowance");
 expect(host.textContent).toContain('Writing stopped');
 expect(host.querySelector('.failure-reason ul')?.textContent).toContain('Bars 17 to 18');
 expect(host.textContent).toContain('No new notes came back');
 expect(windows).toEqual(['1','9','17']); // No automatic retry after refusal.
 await press('Export current score');
 expect(host.textContent).toContain('The new writing is not complete');
 expect(host.textContent).toContain('Unfinished writing in bars 17 to 18');
 expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Download partial score')).toBe(true);
 expect(windows).toEqual(['1','9','17']); // Opening Export does not spend.
 blocked=false;await press('Write');await press("Write what's missing");
 expect(windows).toEqual(['1','9','17','17']);
 const result=now.options.status==='ready'?now.options.notes[0]:null;
 expect(result).toMatchObject({status:'ready',adds:[{bar:'1'},{bar:'9'},{bar:'17'}]});
 expect(result&&'missing'in result?result.missing:undefined).toBeUndefined();
 await press('Export');
 expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Download MIDI')).toBe(true);
 expect(host.textContent).not.toContain('The new writing is not complete');
 expect(fetch).not.toHaveBeenCalled();
});

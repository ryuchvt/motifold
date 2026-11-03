import {describe,expect,it} from 'vitest';
import {unzipSync,strFromU8} from 'fflate';
import {parseScore} from '../score';
import {readMidi} from './midi';
import {arrangeInput,checkOption,emptyScore,packageFiles,parseEvents,scoreTracks,withOption,type ArrangeOption} from './arrange';

describe('same-entry held-note continuations',()=>{
 it.each([
  ['F2','A2'],['D3','A2'],['G2','B2'],['C3','G2'],['F2','A2'],['G2','D3'],['C3','G2'],
 ])('reads captured bass %s followed by one held %s attack to beat three',(bass,held)=>{
  expect(parseEvents(`${bass}@0+0.5 ${held}@0.5+2 ${held}~@2.5+0.5`)).toEqual({events:[{start:0,length:0.5,names:[bass]},{start:0.5,length:2.5,names:[held]}],unreadable:0});
 });
 it('continues a grounded chain while keeping explicit repeated attacks separate',()=>{
  expect(parseEvents('C4@0+1 C4~@1+1 C4~@2+1 C4@3+1')).toEqual({events:[{start:0,length:3,names:['C4']},{start:3,length:1,names:['C4']}],unreadable:0});
  expect(parseEvents('C4@0+1 E4@0+3 C4~@1+2')).toEqual({events:[{start:0,length:3,names:['C4']},{start:0,length:3,names:['E4']}],unreadable:0});
 });
 it('accepts a complete held chord without guessing which voices reattack',()=>{
  expect(parseEvents('C4,E4@0+1 E4~,C4~@1+1')).toEqual({events:[{start:0,length:2,names:['C4','E4']}],unreadable:0});
  for(const held of ['C4~,E4@1+1','C4~@1+1','C4~,C4~@1+1'])expect(parseEvents(`C4,E4@0+1 ${held}`)).toEqual({events:[{start:0,length:1,names:['C4','E4']}],unreadable:1});
 });
 it.each([
  ['different pitch','D4~@1+1',1,1],
  ['raw gap even though both boundaries snap together','C4~@1.01+1',1,1],
  ['raw overlap even though both boundaries snap together','C4~@0.99+1',1,1],
  ['duplicate predecessor','C4@0+1 C4~@1+1',1,2],
  ['later-listed duplicate predecessor','C4~@1+1 C4@0+1',1,2],
  ['overlapping same-pitch voice','C4@0.5+1 C4~@1+1',1,2],
  ['overlap inside the predecessor','C4@0.25+0.25 C4~@1+1',1,2],
  ['explicit reattack at the join','C4~@1+1 C4@1+1',1,2],
  ['forked continuation','C4~@1+1 C4~@1+2',2,1],
  ['double marker','C4~~@1+1',1,1],
  ['marker inside a pitch','C~4@1+1',1,1],
  ['marker after duration','C4@1+1~',1,1],
  ['zero duration','C4~@1+0',1,1],
  ['negative duration','C4~@1+-1',1,1],
  ['malformed start','C4~@1..0+1',1,1],
  ['unrepresentable tiny continuation','C4~@1+0.01',1,1],
  ['non-finite duration',`C4~@1+${'9'.repeat(400)}`,1,1],
 ]as const)('rejects %s without extending a known attack',(_name,tail,unreadable,count)=>{
  const result=parseEvents(`C4@0+1 ${tail}`);
  expect(result.unreadable).toBe(unreadable);expect(result.events).toHaveLength(count);
  expect(result.events[0]).toEqual({start:0,length:1,names:['C4']});
 });
 it('rejects orphan chains, earlier-listed orphans and enharmonic ambiguity',()=>{
  expect(parseEvents('C4~@0+1 C4~@1+1')).toEqual({events:[],unreadable:2});
  expect(parseEvents('C4~@1+1 C4@0+1')).toEqual({events:[{start:0,length:1,names:['C4']}],unreadable:1});
  expect(parseEvents('C#4@0+1 Db4~@1+1')).toEqual({events:[{start:0,length:1,names:['C#4']}],unreadable:1});
  expect(parseEvents('C#4@0+1 Db4@0+1 C#4~@1+1')).toEqual({events:[{start:0,length:1,names:['C#4']},{start:0,length:1,names:['Db4']}],unreadable:1});
 });
 it('only tolerates floating-point arithmetic roundoff and refuses a snapped overlap',()=>{
  expect(parseEvents('C4@0.1+0.2 C4~@0.3+0.2')).toEqual({events:[{start:0,length:0.5,names:['C4']}],unreadable:0});
  expect(parseEvents('C4@0+0.01 C4~@0.01+0.99')).toEqual({events:[{start:0,length:0.25,names:['C4']}],unreadable:1});
 });
});

it('does not continue a note across separate entries, parts or bars',()=>{
 const xmlText=emptyScore('Entry boundaries',['Cello','Viola'],{fifths:0,time:'3/4',qpm:90,bars:2});
 const score=parseScore(xmlText),input=arrangeInput(score,score.parts[0]!,0,1,null,0,null,{where:'inside'});
 const check=checkOption({name:'Bounded holds',idea:'Keep entry boundaries.',why:[],adds:[
  {part:'Cello',bar:'1',events:'A2@0.5+2'},
  {part:'Cello',bar:'1',events:'A2~@2.5+0.5'},
  {part:'Viola',bar:'1',events:'A2~@2.5+0.5'},
  {part:'Cello',bar:'2',events:'A2~@0+1'},
 ]},score,input);
 expect(check).toMatchObject({notes:1,unreadable:3});
 expect(check.adds).toHaveLength(1);
 expect(check.adds[0]!.events).toEqual([{start:0.5,length:2,names:['A2']}]);
});

it('exports the held attack as tied notation and one exact MIDI note in every MIDI file, without changing the raw answer',()=>{
 const xmlText=emptyScore('Original local held-note contract',['Cello'],{fifths:0,time:'3/4',qpm:90,bars:1});
 const score=parseScore(xmlText),input=arrangeInput(score,score.parts[0]!,0,0,null,0,null,{where:'inside',intent:'arrange'});
 const option:ArrangeOption={name:'Held contract',idea:'Keep one attack held.',why:[{from:'1',to:'1',what:'Hold the pitch',principle:'Continuation'}],adds:[{part:'Cello',bar:'1',dyn:'mf',events:'F2@0+0.5 A2@0.5+2 A2~@2.5+0.5'}]};
 const original=JSON.stringify(option);Object.freeze(option.adds[0]);Object.freeze(option.adds);Object.freeze(option);
 const check=checkOption(option,score,input);
 expect(check).toMatchObject({notes:2,unreadable:0,overBars:0,pastBarEnd:0,outOfRange:[]});
 const written=withOption(xmlText,score,check),parsed=parseScore(written);
 const tied=parsed.parts[0]!.notes.filter(note=>!note.rest&&note.soundingMidi===45);
 expect(tied.map(note=>[note.onset/parsed.ticksPerQuarter,note.duration/parsed.ticksPerQuarter,note.tieStart,note.tieStop])).toEqual([[0.5,2,true,false],[2.5,0.5,false,true]]);
 expect(scoreTracks(parsed)[0]!.notes).toEqual([{start:0,length:0.5,height:41,velocity:80},{start:0.5,length:2.5,height:45,velocity:80}]);
 const files=unzipSync(packageFiles(written,check,'Held-note parser regression'));
 expect(parseScore(strFromU8(files['score.musicxml']!)).parts).toHaveLength(1);
 const midiNames=Object.keys(files).filter(name=>name.endsWith('.mid'));
 expect(midiNames).toContain('all-parts.mid');expect(midiNames).toContain('new-parts.mid');expect(midiNames.some(name=>name.startsWith('parts/'))).toBe(true);
 for(const name of midiNames){
  const midi=readMidi(files[name]!),notes=midi.tracks.flatMap(track=>track.notes);
  expect(notes,name).toHaveLength(2);
  const held=notes.filter(note=>note.height===45);expect(held,name).toHaveLength(1);
  expect(held[0],name).toMatchObject({tick:midi.ppq*0.5,length:midi.ppq*2.5,velocity:80});
  expect(held[0]!.tick+held[0]!.length,name).toBe(midi.ppq*3);
 }
 expect(JSON.stringify(option)).toBe(original);
});

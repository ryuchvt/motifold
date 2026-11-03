import { useEffect, useMemo, useRef, useState } from "react";
import { parseScore, type Score } from "../score";
import type { InitialSetup } from "./ArrangePanel";
import { Workspace } from "./Workspace";
import { FreeBars } from "./FreeBars";
import { loadDemoIndex, startDemo, stopDemo, type DemoIndex, type DemoPiece } from "./demo";
import { isMidi } from "./midi";
import { openedScore } from "./opened";
import { AUDIO_FILE, isAudioFile, listenTo } from "./listen";
import { OWN_KEY } from "../server/pools";
import { hasOwnKey, onSpark, setOwnKey, setTransport } from "./spark";
import { MuseChip, Thinking, resetMuseActivity } from "./Thinking";
import { playhead, usePlayhead } from "./playhead";
import { looksFreelyPlayed } from "./timing";
import { useArrange } from "./useArrange";
import "./replay-workspace.css";
import { OutcomeExplorer } from "./OutcomeExplorer";
import { RawSketch, AcceptedSketch } from "./TutorialSketch";
import { TutorialCoach, TutorialProvider, useTutorialController } from "./Tutorial";
import { SharedAccess } from "./SharedAccess";

type Access = "demo" | "live" | "own";

/** Play, pause and stop, and where it is. The overview below owns the sound. */
function Transport() {
  const { playing, words } = usePlayhead();
  return (
    <span className="transport" role="group" aria-label="Transport">
      <button className="transport-button" aria-label={playing ? "Pause" : "Play"} onClick={() => (playing ? playhead.pause() : playhead.play())}>
        {playing ? (
          <svg viewBox="0 0 12 12" aria-hidden>
            <path d="M3 2h2v8H3zM7 2h2v8H7z" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" aria-hidden>
            <path d="M3 1.5v9l7-4.5z" />
          </svg>
        )}
      </button>
      <button className="transport-button" aria-label="Stop" onClick={() => playhead.stop()}>
        <svg viewBox="0 0 12 12" aria-hidden>
          <path d="M2.5 2.5h7v7h-7z" />
        </svg>
      </button>
      <span className="transport-where">{words}</span>
    </span>
  );
}

function Clock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-GB"));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return <span>{time}</span>;
}

export interface LoadedSketch { fileName: string; xmlText: string; score: Score }
interface StudioProps { initialScore?: LoadedSketch | null; sample?: boolean; initialSetup?: InitialSetup; sampleMessage?: string }

/** The whole site: choose how to try it, bring a piece, see it read, say where it should go, and take the score away. */
export function Studio({ initialScore = null, sample = false, initialSetup, sampleMessage }: StudioProps) {
  const [access, setAccess] = useState<Access | null>(initialScore ? "live" : null);
  const [demo, setDemo] = useState<DemoIndex | null>(null);
  const [demoPiece, setDemoPiece] = useState<DemoPiece | null>(null);
  const [exploring,setExploring]=useState(false);
  const [guideOpening,setGuideOpening]=useState(false);
  const tutorial=useTutorialController();
  const guide=tutorial.guide;
  const [typedKey, setTypedKey] = useState("");
  const [loaded, setLoaded] = useState<LoadedSketch | null>(initialScore);
  const [unbarred, setUnbarred] = useState<{ fileName: string; bytes: Uint8Array } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [sourceNote, setSourceNote] = useState<string | null>(null);
  /** The workflow stage the panel is on, for the top bar. */
  const [stage, setStage] = useState("Study");
  const [listening, setListening] = useState<{ fileName: string; recording: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // What's listening or recording now, so leaving or opening something else can stop it.
  const hearing = useRef<AbortController | null>(null);
  const microphone = useRef<MediaRecorder | null>(null);
  // Only the last thing opened may change the page, because the composer can leave or open something else while a file is still being read.
  const opening = useRef(0);
  const activeCalls = useRef(new Set<string>());
  const resetRun = () => { activeCalls.current.clear(); setThinking(false); resetMuseActivity(); };

  useEffect(() => void loadDemoIndex().then(setDemo), []);
  useEffect(() => {
    resetRun();
    const running = activeCalls.current;
    return onSpark((event) => {
      if (event.kind === "start") running.add(event.callId);
      if (event.kind === "end") running.delete(event.callId);
      setThinking(running.size > 0);
    });
  }, []);

  const part = loaded?.score.parts[0] ?? null;
  const range = useMemo(() => ({ from: 0, to: part ? part.measures.length - 1 : 0 }), [part]);
  const arranged = useArrange(loaded, part, range, null);
  // Reading what's opened needs no decision, so it starts by itself.
  useEffect(() => {
    if (loaded && arranged.piece.status === "none" && !arranged.kept && !exploring && (!guide || guide.events["study-started"])) void arranged.askPiece();
  }, [loaded, exploring, guide?.events["study-started"]]);

  useEffect(()=>{
    if(!guide||!loaded||!guide.events['study-started'])return;
    if(arranged.piece.status==='ready'&&arranged.study.status==='ready')guide.mark('study-ready');
    if(arranged.tracksConfirmed)guide.mark('tracks-confirmed');
    if(arranged.piece.status==='ready'&&!(arranged.piece.answer.questions??[]).length)guide.mark('questions-done');
    if(arranged.options.status==='ready'){
      if([0,1].every(index=>arranged.options.status==='ready'&&arranged.options.notes[index]?.status==='ready'))guide.mark('previews-ready');
      const chosen=arranged.trying?.kind==='option'?arranged.trying.index:null;
      const notes=chosen!==null?arranged.options.notes[chosen]:null;
      if(chosen!==null&&guide.completeOptions.includes(chosen as 0|1)&&notes?.status==='ready'&&!notes.preview&&!notes.writing&&!notes.missing?.length)guide.mark('write-ready');
    }
  },[guide?.run,guide?.events['study-started'],loaded,arranged.piece,arranged.study,arranged.tracksConfirmed,arranged.options,arranged.trying]);
  useEffect(()=>{if(tutorial.complete&&guide)showExplorer(guide.piece,false)},[tutorial.complete]);

  const stopListening = () => {
    hearing.current?.abort();
    hearing.current = null;
    if (microphone.current?.state === "recording") microphone.current.stop();
    microphone.current = null;
    setListening(null);
  };

  const open = async (file: File, keepBars = false) => {
    const mine = ++opening.current;
    if (!keepBars) resetRun();
    stopListening();
    setError(null);
    try {
      if (isAudioFile(file)) {
        setLoaded(null);
        setUnbarred(null);
        const stop = new AbortController();
        hearing.current = stop;
        setListening({ fileName: file.name, recording: false });
        const heard = await listenTo(file, stop.signal);
        if (opening.current !== mine) return;
        hearing.current = null;
        setListening(null);
        if (heard.notes < 8) throw new Error("It couldn't hear enough notes. It hears one line at a time, so a sung, hummed or played melody works and chords don't.");
        setSourceNote(`Heard ${heard.notes} notes in ${Math.round(heard.seconds)} seconds, here in your browser. It hears one line, so check them on the score.`);
        return await open(new File([heard.midi as BlobPart], file.name.replace(AUDIO_FILE, ".mid")));
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (opening.current !== mine) return;
      if (!keepBars && isMidi(bytes) && looksFreelyPlayed(bytes)) {
        setLoaded(null);
        setUnbarred({ fileName: file.name, bytes });
        return;
      }
      setUnbarred(null);
      const { xmlText, score } = openedScore(bytes, file.name);
      setLoaded({ fileName: file.name, xmlText, score });
    } catch (e) {
      if (opening.current !== mine) return;
      hearing.current = null;
      setListening(null);
      setLoaded(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** A line sung, hummed or played into the microphone, heard just as a file is when it stops. */
  const record = async () => {
    let acquired: MediaStream | null = null;
    const mine = ++opening.current;
    stopListening();
    setError(null);
    try {
      // Speech processing ruins an instrument or a voice singing, so it's all off.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
      acquired = stream;
      if (opening.current !== mine) return stream.getTracks().forEach((t) => t.stop());
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (opening.current !== mine) return;
        const type = recorder.mimeType || "audio/webm";
        void open(new File(chunks, `recording.${/ogg/.test(type) ? "ogg" : /mp4/.test(type) ? "m4a" : "webm"}`, { type }));
      };
      microphone.current = recorder;
      recorder.start();
      setListening({ fileName: "Your microphone", recording: true });
    } catch {
      acquired?.getTracks().forEach((track) => track.stop());
      microphone.current = null;
      if (opening.current !== mine) return;
      setListening(null);
      setError("The microphone isn't available here. Allow it in the browser, or open a recording instead.");
    }
  };

  const openDemo = async (piece: DemoPiece) => {
    const mine = ++opening.current;
    setError(null);
    try {
      const res = await fetch(piece.xml);
      if (!res.ok) throw new Error("The recorded source score could not be opened.");
      const xml = await res.arrayBuffer();
      if (opening.current !== mine) return;
      choosePiece(piece);
      setDemoPiece(piece);
      setSourceNote("The exact score used in this recorded run. The original MIDI is available before you start.");
      await open(new File([xml], piece.xml.split("/").pop()!));
    } catch (failure) {
      if (opening.current !== mine) return;
      setError(failure instanceof Error ? failure.message : "The recorded walkthrough could not be opened.");
    }
  };

  const enter = (way: Access) => {
    if (way !== "own") setOwnKey(null);
    setAccess(way);
    if (way === "demo" && demo) startDemo(demo.pieces[0]!, demo.recorded);
    else if (!sample) stopDemo();
  };
  const choosePiece = (piece: DemoPiece) => demo && startDemo(piece, demo.recorded);
  const leave = () => {
    opening.current++;
    tutorial.exit();setExploring(false);setGuideOpening(false);
    resetRun();
    stopListening();
    if (!sample) stopDemo();
    setAccess(null);
    setLoaded(null);
    setUnbarred(null);
    setDemoPiece(null);
    setSourceNote(null);
  };
  const another = () => {
    if(guide||exploring)return leave();
    opening.current++;
    resetRun();
    stopListening();
    setLoaded(null);
    setUnbarred(null);
    setSourceNote(null);
  };

  const startTutorial=(piece:DemoPiece)=>{
    opening.current++;stopListening();resetRun();setOwnKey(null);setTypedKey('');
    startDemo(piece,demo!.recorded);setAccess('demo');setDemoPiece(piece);setLoaded(null);setUnbarred(null);setExploring(false);setError(null);setSourceNote(null);tutorial.start(piece);
  };
  const acceptTutorial=async()=>{
    if(!guide)return;
    if(loaded&&demoPiece?.id===guide.piece.id){guide.mark('accepted-bars',true,true);return}
    const mine=++opening.current;setGuideOpening(true);setError(null);
    try{const response=await fetch(guide.piece.xml);if(!response.ok)throw Error('The saved accepted score could not be opened.');const xmlText=await response.text();const score=parseScore(xmlText);if(opening.current!==mine)return;setLoaded({fileName:guide.piece.xml.split('/').at(-1)!,xmlText,score});setSourceNote(guide.piece.tutorial?.acceptedLabel??'Saved accepted bar analysis.');guide.mark('accepted-bars',true,true)}
    catch(failure){if(opening.current===mine)setError(failure instanceof Error?failure.message:'The accepted score could not be opened.')}
    finally{if(opening.current===mine)setGuideOpening(false)}
  };
  const showExplorer=(piece=demoPiece??demo?.pieces[0],reset=true)=>{
    if(!piece)return;
    opening.current++;stopListening();playhead.stop();if(reset)resetRun();stopDemo();
    // No pending or unprepared action can become a live call while exploring static exports.
    setTransport(async()=>({status:'fallback',reason:'not-prepared'}));
    setOwnKey(null);tutorial.exit();setAccess('demo');setDemoPiece(piece);setExploring(true);setError(null);
  };
  const rawGuide=!!guide&&guide.step===0;
  const acceptedGuide=!!guide&&!rawGuide&&!!loaded&&(guide.step===1||!guide.events['study-started']);
  const inWork = (!!loaded&&!rawGuide)||exploring;

  // DAW bounces are only available in the explorer, bound to the actual exported score hash.

  return (
    <TutorialProvider value={guide}><div className={`studio${inWork ? " studio-working" : ""}${sample ? " sample-mode" : ""}`}>
      <header className="hud">
        <button className="hud-name" onClick={leave}>
          <span>Motifold</span>
        </button>
        {loaded&&inWork&&!exploring&&<span className="hud-project" title={loaded.fileName}>{loaded.fileName.replace(/\.[^.]+$/, "")}</span>}
        {inWork&&!exploring&&<Transport />}
        {inWork && <span className="hud-stage">{stage.toUpperCase()}</span>}
        <MuseChip />
        <span className="hud-mode">{sample ? "SAVED EXAMPLES" : access === "demo" ? "REPLAY" : access === "own" ? "YOUR KEY" : access === "live" ? "SHARED CREDIT" : "MUSE SPARK 1.3"}</span>
        <span className="author-credit" title="Chawanvit Vuthikornudomkit">by Ryu</span>
        <span className="hud-clock">
          <Clock />
        </span>
        {(inWork || unbarred) && (
          <button className="hud-action" onClick={another}>
            Another piece
          </button>
        )}
      </header>

      {!access && (
        <main className="door">
          <h1>
            Your music.
            <br />
            Your next move.
          </h1>
          <p className="door-sub">Bring a sketch, played or written. Muse Spark reads it, asks what it can't tell, and writes the orchestral score as notes you can read, change and take into your DAW. Keep your melody and build around it, or give it up as a motif and let a new piece grow from it.</p>
          <p className="door-author">Made by Chawanvit Vuthikornudomkit</p>
          <div className="start-sample"><div><strong>Learn Motifold with my piano sketch</strong><p>Start with the raw MIDI, inspect the accepted bars and tempo, then choose, hear and export a recorded arrangement. Free and no key.</p></div><span className="tutorial-start-actions"><button className="button primary" disabled={!demo} onClick={()=>demo&&startTutorial(demo.pieces[0]!)}>Start hands-on tutorial</button><button className="button" disabled={!demo} onClick={()=>showExplorer(demo?.pieces[0])}>Explore recorded outcomes</button></span></div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="doors">
            <div className="door-card">
              <strong>Use your own Meta key</strong>
              <span>On your own piece, live. Kept in this browser tab. The server does not store it.</span>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!OWN_KEY.test(typedKey.trim())) return;
                  setOwnKey(typedKey.trim());
                  setTypedKey("");
                  enter("own");
                }}
              >
                <input type="password" autoComplete="off" aria-label="Your Meta Model API key" placeholder="Meta Model API key" required minLength={8} maxLength={300} value={typedKey} onChange={(e) => setTypedKey(e.target.value)} />
                <button className="button small">Go</button>
              </form>
              {hasOwnKey() && (
                <button className="door-link" onClick={() => enter("own")}>
                  Carry on with the key you gave
                </button>
              )}
            </div>
            <SharedAccess disabled={sample} onEnter={()=>enter("live")} onExplore={()=>showExplorer(demo?.pieces[0])}/>
          </div>
        </main>
      )}

      {access && !inWork && !unbarred && !guide && !exploring && (
        <main className="import">
          {listening ? (
            <div className="hearing">
              <p className="hud-label">{listening.recording ? "RECORDING" : "LISTENING"}</p>
              <h2>{listening.fileName}</h2>
              {listening.recording ? (
                <>
                  <p>Sing, hum or play one line. Press Stop when it's done.</p>
                  <button className="button primary" onClick={() => microphone.current?.stop()}>
                    Stop
                  </button>
                </>
              ) : (
                <>
                  <progress aria-label="Listening" />
                  <p>Finding the notes here in your browser. Nothing is uploaded and no AI model hears it. It hears one line at a time.</p>
                </>
              )}
            </div>
          ) : (
            <>
              <p className="hud-label">Bring your music</p>
              {access === "demo" &&
                demo?.pieces.map((piece) => (
                  <div className="piece-card" key={piece.id}>
                    <div>
                      <h2>{piece.name}</h2>
                      <p>{piece.words}</p>
                    </div>
                    <span className="arrange-chips">
                      <button className="button primary" onClick={() => void openDemo(piece)}>Start recorded walkthrough</button>
                      <a className="button" href={piece.midi} download>Original MIDI</a>
                    </span>
                    <p className="spark-note">Recorded steps. No credit is used. Other choices are not prepared.</p>
                  </div>
                ))}
              {access !== "demo" && (
                <button
                  className="drop"
                  onClick={() => input.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) void open(file);
                  }}
                >
                  <span className="drop-title">Open your sketch</span>
                  <span className="drop-sub">A MIDI or MusicXML file, or a recording of one line, sung, hummed or played. Drop it here, or tap to choose one.</span>
                </button>
              )}
              {access !== "demo" && (
                <button className="door-link" onClick={() => void record()}>
                  Or sing, hum or play it in now
                </button>
              )}
              {error && <p className="error">{error}</p>}
              <input
                ref={input}
                type="file"
                hidden
                accept=".musicxml,.xml,.mxl,.mid,.midi,.wav,.mp3,.m4a,.aac,.flac,.aif,.aiff,.ogg,.opus,.webm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void open(file);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </main>
      )}

      {!inWork && unbarred && !guide && !exploring && (
        <FreeBars
          auto
          fileName={unbarred.fileName}
          bytes={unbarred.bytes}
          title={unbarred.fileName.replace(/\.[^.]+$/, "")}
          savedFile={null}
          onUse={(xmlText) => {
            setUnbarred(null);
            setLoaded({ fileName: unbarred.fileName, xmlText, score: parseScore(xmlText) });
          }}
          onKeep={() => void open(new File([unbarred.bytes as BlobPart], unbarred.fileName), true)}
        />
      )}

      {inWork && !guide && !exploring && access === "demo" && demoPiece && <details className="replay-guide"><summary>Recorded walkthrough. No credit is used.</summary><ol>{demoPiece.guide.map((step, index) => <li key={index}>{step}</li>)}</ol><p>Follow these exact choices. Other settings have no recorded answer.</p><a href={demoPiece.midi} download>Download the original MIDI</a></details>}
      {guide&&<TutorialCoach guide={guide} onBack={tutorial.back} onContinue={tutorial.next} onSkip={()=>showExplorer(guide.piece,false)} onExit={leave}/>}
      {loaded && !rawGuide && !acceptedGuide && !exploring && <Workspace onExplore={demo?.pieces[0]?()=>showExplorer(demo.pieces[0]):undefined} key={loaded!.fileName} arranged={arranged} loaded={loaded!} busy={thinking} demo={access === "demo"} prepared={demoPiece?.runs ?? []} sourceNote={sourceNote} onStage={setStage} initialSetup={access === "demo" ? demoPiece?.recipe : initialSetup}/>}
      {(guide||exploring)&&error&&<p className="error" role="alert">{error}</p>}
      {rawGuide&&guide&&<RawSketch piece={guide.piece} busy={guideOpening} onAccept={()=>void acceptTutorial()}/>}
      {acceptedGuide&&guide&&loaded&&<AcceptedSketch loaded={loaded} piece={guide.piece} onInspect={()=>guide.mark('tempo-inspected',true,true)} canStudy={!!guide.events['tempo-inspected']} onStudy={()=>guide.mark('study-started',true,true)}/>}
      {exploring&&demoPiece&&<OutcomeExplorer piece={demoPiece} onExit={leave}/>}
      {sample && <div className="ui-sample-banner">{sampleMessage ?? "Local UI sample. Fixed answers. No model calls."} <a href="http://127.0.0.1:8788/?record">Open live workspace</a></div>}
      <Thinking sample={sample} />
    </div></TutorialProvider>
  );
}

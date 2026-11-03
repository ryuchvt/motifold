import { useEffect, useMemo, useRef, useState } from "react";
import { parseScore, type Score } from "../score";
import { ArrangePanel } from "./ArrangePanel";
import { FreeBars } from "./FreeBars";
import { loadDemoIndex, startDemo, stopDemo, type DemoIndex, type DemoPiece } from "./demo";
import { isMidi } from "./midi";
import { openedScore } from "./opened";
import { PieceView } from "./PieceView";
import { ScoreView, type ScoreViewHandle } from "./ScoreView";
import { AUDIO_FILE, isAudioFile, listenTo } from "./listen";
import { OWN_KEY } from "../server/pools";
import { hasOwnKey, onSpark, setOwnKey } from "./spark";
import { MuseChip, Thinking } from "./Thinking";
import { playhead, usePlayhead } from "./playhead";
import { looksFreelyPlayed } from "./timing";
import { useArrange } from "./useArrange";
import { attentionOf, writingProgress } from "./attention";
import type { Selection } from "./selection";

type Access = "demo" | "live" | "own";
const NO_MARKS: never[] = [];
const NO_TAP = () => {};

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

/** The whole site: choose how to try it, bring a piece, see it read, say where it should go, and take the score away. */
export function Studio() {
  const [access, setAccess] = useState<Access | null>(null);
  const [demo, setDemo] = useState<DemoIndex | null>(null);
  const [demoPiece, setDemoPiece] = useState<DemoPiece | null>(null);
  const [typedKey, setTypedKey] = useState("");
  const [loaded, setLoaded] = useState<{ fileName: string; xmlText: string; score: Score } | null>(null);
  const [unbarred, setUnbarred] = useState<{ fileName: string; bytes: Uint8Array } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [zoom, setZoom] = useState(0.8);
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
  const view = useRef<ScoreViewHandle>(null);

  useEffect(() => void loadDemoIndex().then(setDemo), []);
  useEffect(() => onSpark((event) => setThinking(event.kind === "start" ? true : event.kind === "end" ? false : (was) => was)), []);

  const part = loaded?.score.parts[0] ?? null;
  const range = useMemo(() => ({ from: 0, to: part ? part.measures.length - 1 : 0 }), [part]);
  const arranged = useArrange(loaded, part, range, null);
  const onPage = arranged.page ?? loaded;
  /** What the composer has picked, shown in the overview, on the score and in the inspector together. */
  const [picked, setPicked] = useState<Selection | null>(null);
  useEffect(() => setPicked(null), [loaded]);
  const attention = useMemo(() => attentionOf(arranged), [arranged.piece, arranged.answered, arranged.options, arranged.trying, arranged.tracks, arranged.tracksConfirmed]);
  const progress = useMemo(() => writingProgress(arranged), [arranged.options, arranged.trying]);
  const forms = arranged.study.status === "ready" ? arranged.study.answer.sections : [];
  // A picked marker that's been dealt with goes back to the overview.
  useEffect(() => {
    if (picked?.kind === "attention" && !attention.some((a) => a.id === picked.id)) setPicked(null);
  }, [attention, picked]);

  // Reading what's opened needs no decision, so it starts by itself.
  useEffect(() => {
    if (loaded && arranged.piece.status === "none" && !arranged.kept) void arranged.askPiece();
  }, [loaded]);

  const stopListening = () => {
    hearing.current?.abort();
    hearing.current = null;
    if (microphone.current?.state === "recording") microphone.current.stop();
    microphone.current = null;
    setListening(null);
  };

  const open = async (file: File, keepBars = false) => {
    const mine = ++opening.current;
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
    const mine = ++opening.current;
    stopListening();
    setError(null);
    try {
      // Speech processing ruins an instrument or a voice singing, so it's all off.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
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
      if (opening.current !== mine) return;
      setListening(null);
      setError("The microphone isn't available here. Allow it in the browser, or open a recording instead.");
    }
  };

  const openDemo = async (piece: DemoPiece, kind: "midi" | "xml") => {
    const mine = ++opening.current;
    setDemoPiece(piece);
    if (kind === "xml") setSourceNote("The MusicXML holds the same notes, and this prepared run was made from the MIDI, so that's what carries on.");
    else setSourceNote(null);
    const res = await fetch(piece.midi);
    const midi = await res.arrayBuffer();
    if (opening.current !== mine) return;
    await open(new File([midi], piece.midi.split("/").pop()!));
  };

  const enter = (way: Access) => {
    setAccess(way);
    if (way === "demo" && demo) startDemo(demo.pieces[0]!, demo.recorded);
    else stopDemo();
  };
  const choosePiece = (piece: DemoPiece) => demo && startDemo(piece, demo.recorded);
  const leave = () => {
    opening.current++;
    stopListening();
    stopDemo();
    setAccess(null);
    setLoaded(null);
    setUnbarred(null);
    setDemoPiece(null);
    setSourceNote(null);
  };
  const another = () => {
    opening.current++;
    stopListening();
    setLoaded(null);
    setUnbarred(null);
    setSourceNote(null);
  };

  const inWork = !!loaded;
  const render = demoPiece?.runs.find((r) => arranged.lastAsk && r.key === arranged.lastAsk)?.render;

  return (
    <div className="studio">
      <header className="hud">
        <button className="hud-name" onClick={leave}>
          MOTIFOLD
        </button>
        {inWork && <span className="hud-project" title={loaded!.fileName}>{loaded!.fileName.replace(/\.[^.]+$/, "")}</span>}
        {inWork && <Transport />}
        {inWork && <span className="hud-stage">{stage.toUpperCase()}</span>}
        <MuseChip />
        <span className="hud-mode">{access === "demo" ? "REPLAY" : access === "own" ? "YOUR KEY" : access === "live" ? "SHARED CREDIT" : "MUSE SPARK 1.3"}</span>
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
            A melody becomes
            <br />
            <em>an orchestra.</em>
          </h1>
          <p className="door-sub">Bring a sketch, played or written. Muse Spark reads it, asks what it can't tell, and writes the orchestral score as notes you can read, change and take into your DAW. Keep your melody and build around it, or give it up as a motif and let a new piece grow from it.</p>
          <div className="doors">
            <button className="door-card" onClick={() => enter("demo")} disabled={!demo}>
              <span className="door-n">01 ——</span>
              <strong>Watch it work</strong>
              <span>{demo ? "Real runs on my own piano theme, recorded and replayed. Free, and no key." : "Real runs on my own piano theme, recorded and replayed. They aren't up yet, so try it live below."}</span>
            </button>
            <div className="door-card">
              <span className="door-n">02 ——</span>
              <strong>Use your own Meta key</strong>
              <span>On your own piece, live. Your key stays in this tab and is never stored.</span>
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
          </div>
          <button className="door-link" onClick={() => enter("live")}>
            Or try one piece live on my credit, while today's share lasts
          </button>
        </main>
      )}

      {access && !inWork && !unbarred && (
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
              <p className="hud-label">01 —— IMPORT</p>
              {access === "demo" &&
                demo?.pieces.map((piece) => (
                  <div className="piece-card" key={piece.id}>
                    <div>
                      <h2>{piece.name}</h2>
                      <p>{piece.words}</p>
                    </div>
                    <span className="arrange-chips">
                      <button
                        className="button primary"
                        onClick={() => {
                          choosePiece(piece);
                          void openDemo(piece, "midi");
                        }}
                      >
                        MIDI
                      </button>
                      <button
                        className="button"
                        onClick={() => {
                          choosePiece(piece);
                          void openDemo(piece, "xml");
                        }}
                      >
                        MusicXML
                      </button>
                    </span>
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

      {!inWork && unbarred && (
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

      {inWork && (
        <div className="work-grid">
          <main className="work-main">
            {sourceNote && <p className="note-line">{sourceNote}</p>}
            {arranged.overview && arranged.view && (
              <PieceView
                data={arranged.overview}
                sections={arranged.sections}
                moments={arranged.moments}
                selected={arranged.view}
                focus={arranged.focus}
                solo={arranged.solo}
                instrumentOf={arranged.instrumentOf}
                hasNew={arranged.trying?.kind === "option"}
                render={render}
                onSelect={arranged.select}
                onSelectRange={(from, to) => {
                  arranged.selectRange(from, to);
                  setPicked({ kind: "bars", from, to });
                }}
                onFocus={arranged.setFocus}
                onSolo={arranged.toggleSolo}
                orders={arranged.options.status === "none" && arranged.trying?.kind !== "option" ? arranged.orders : []}
                ordered={arranged.trying?.kind === "structure" ? arranged.trying.index : null}
                onOrder={(index) => arranged.setTrying(index === null ? null : { kind: "structure", index })}
                onKeepOrder={arranged.keep}
                attention={attention}
                forms={forms}
                progress={progress}
                picked={picked}
                onPick={setPicked}
              />
            )}
            {render && <p className="note-line">You're hearing my own bounce of Muse Spark's notes through my own instruments, with no note corrected. I chose the sounds and the balance.</p>}
            {onPage && (
              <section className="sheet" aria-label="Notation">
                <span className="zoom">
                  <button className="round" aria-label="Smaller" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>
                    −
                  </button>
                  <button className="round" aria-label="Bigger" onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}>
                    +
                  </button>
                </span>
                <ScoreView ref={view} xmlText={onPage.xmlText} noTitle score={onPage.score} zoom={zoom} highlights={[]} noteMarks={NO_MARKS} studyMarks={arranged.studyMarks} onTap={NO_TAP} onDrawn={() => {}} />
              </section>
            )}
          </main>
          <aside className="work-side">
            <ArrangePanel arranged={arranged} busy={thinking} demo={access === "demo"} prepared={demoPiece?.runs ?? []} onStage={setStage} selection={picked} attention={attention} onPick={setPicked} />
          </aside>
        </div>
      )}
      <Thinking />
    </div>
  );
}

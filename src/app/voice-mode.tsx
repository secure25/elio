"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface VoiceStatus {
  tts: {
    available: boolean;
    engine: string | null;
    voice: string | null;
    reason: string;
    note?: string;
  };
  stt: { available: boolean; engine: string };
}

interface Props {
  /** When true, voice mode is on: new assistant replies get spoken automatically. */
  active: boolean;
  /** Chat state mirrored from the page for priority rules. */
  busy: boolean;
  /** Latest assistant message; a new id gets spoken once. */
  lastAssistant: { id: string; content: string } | null;
  /** Called with the transcript when the user finishes talking. */
  onTranscript: (text: string) => void;
  /** Called when the user says "elio stop" (or "muse stop") — stops playback. */
  onStopRequested: () => void;
}

/**
 * Voice mode: push-to-talk mic (Web Speech API, browser-side STT) +
 * server TTS playback with an audio-priority rule (never speak while the
 * user is talking). No extra npm dependencies; graceful degradation.
 */
export function VoiceMode({ active, busy, lastAssistant, onTranscript, onStopRequested }: Props) {
  const [supported, setSupported] = useState(true);
  const [speakOn, setSpeakOn] = useState(true);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [listening, setListening] = useState(false);
  const [finalTr, setFinalTr] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [queueLen, setQueueLen] = useState(0);

  const recRef = useRef<any>(null);
  const spokenRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const userTalkingRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const onStopRequestedRef = useRef(onStopRequested);
  const speakOnRef = useRef(speakOn);
  const busyRef = useRef(busy);
  const finalTrRef = useRef("");
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  onTranscriptRef.current = onTranscript;
  onStopRequestedRef.current = onStopRequested;
  speakOnRef.current = speakOn;
  busyRef.current = busy;
  finalTrRef.current = finalTr;

  // ── Status probe ──
  useEffect(() => {
    fetch("/api/voice/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
    const w = window as any;
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  // ── Server TTS playback queue ──
  const stopPlayback = useCallback(() => {
    queueRef.current = [];
    setQueueLen(0);
    playingRef.current = false;
    setSpeaking(false);
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {}
      audioRef.current = null;
    }
  }, []);

  const playNext = useCallback(async () => {
    if (playingRef.current || queueRef.current.length === 0) return;
    playingRef.current = true;
    setSpeaking(true);
    const text = queueRef.current.shift()!;
    setQueueLen(queueRef.current.length);
    try {
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.hint || "Voice synthesis unavailable");
        return;
      }
      const blob = await res.blob();
      const audio = new Audio();
      audioRef.current = audio;
      audio.src = URL.createObjectURL(blob);
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
      URL.revokeObjectURL(audio.src);
      if (audioRef.current === audio) audioRef.current = null;
    } catch {
      /* transient — drop this frame */
    } finally {
      playingRef.current = false;
      setSpeaking(false);
      if (queueRef.current.length > 0) void playNext();
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      const cleaned = text.trim();
      if (!cleaned || !speakOnRef.current) return;
      stopPlayback();
      queueRef.current = [cleaned];
      setQueueLen(1);
      void playNext();
    },
    [stopPlayback, playNext]
  );

  // ── Auto-speak new assistant messages (final ones only) ──
  // When voice mode activates, mark the current reply as already-heard so we
  // never re-speak history; only fresh replies get spoken.
  const prevActiveRef = useRef(active);
  const lastAssistantRef = useRef(lastAssistant);
  lastAssistantRef.current = lastAssistant;
  useEffect(() => {
    if (active && !prevActiveRef.current && lastAssistantRef.current) {
      spokenRef.current.add(lastAssistantRef.current.id);
    }
    prevActiveRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!active || !speakOn || !lastAssistant) return;
    if (spokenRef.current.has(lastAssistant.id)) return;
    spokenRef.current.add(lastAssistant.id);
    if (busy) return; // more messages are coming; the final one will be spoken
    speak(lastAssistant.content);
  }, [active, speakOn, lastAssistant, busy, speak]);

  useEffect(() => {
    if (!active) stopPlayback();
  }, [active, stopPlayback]);

  // ── Push-to-talk speech recognition ──
  const startListening = useCallback(() => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      setError("Speech recognition needs Chrome or Edge.");
      return;
    }
    stopPlayback(); // audio priority: user takes the floor
    setError(null);
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    recRef.current = rec;
    setFinalTr("");
    setInterim("");

    rec.onstart = () => setListening(true);
    rec.onresult = (e: any) => {
      let fin = "";
      let it = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript;
        else it += r[0].transcript;
      }
      if (fin) setFinalTr((p) => p + fin);
      setInterim(it);
    };
    rec.onerror = (e: any) => {
      if (e.error === "aborted") return;
      if (e.error === "no-speech") setError("Heard nothing — try again.");
      else if (e.error === "not-allowed" || e.error === "service-not-allowed")
        setError("Mic permission denied — allow mic access for this site.");
      else setError("Mic error: " + e.error);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      const text = finalTrRef.current.trim();
      if (text) {
        if (/^\s*(open\s+)?(elio|muse)[\s,!.]*stop\b/i.test(text)) {
          stopPlayback(); // kill audio immediately, then inform the page
          onStopRequestedRef.current();
        } else {
          onTranscriptRef.current(text);
        }
      }
    };
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }, [stopPlayback]);

  // ── Auto-send after a short settle delay when Elio is idle ──
  useEffect(() => {
    if (!listening || busy) return;
    if (!finalTr && !interim) return;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      const text = (finalTrRef.current + " " + interim).trim();
      if (text && !busy) {
        onTranscriptRef.current(text);
        try {
          recRef.current?.stop();
        } catch {}
      }
    }, 1600);
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, [finalTr, interim, listening, busy]);

  // ── Spacebar push-to-talk (not while typing in an input) ──
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const editable = Boolean(t?.isContentEditable) || tag === "INPUT" || tag === "TEXTAREA";
      if (editable || e.repeat) return;
      if (e.code === "Space" && !recRef.current) {
        e.preventDefault();
        startListening();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, startListening]);

  // Clear recRef when a session ends so Space can start a new one.
  useEffect(() => {
    if (!listening) {
      const t = setTimeout(() => {
        recRef.current = null;
      }, 300);
      return () => clearTimeout(t);
    }
  }, [listening]);

  if (!active) return null;

  return (
    <div className="border-t border-[var(--border)] px-3 md:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3 flex items-center gap-2 md:gap-3 flex-wrap">
      <button
        className={`btn ${listening ? "btn-deny" : "btn-primary"} py-2.5 px-4 md:py-2 md:px-3.5`}
        disabled={!supported || busy}
        onClick={startListening}
        title="Click — or press Space — and talk"
      >
        {listening ? "■ Stop" : "🎤 Talk"}
      </button>

      <button
        className={`btn text-xs md:text-sm py-2.5 px-4 md:py-2 md:px-3.5 ${speakOn ? "btn-approve" : ""}`}
        onClick={() => {
          if (speakOn) stopPlayback();
          setSpeakOn((v) => !v);
        }}
        title="Toggle whether Elio speaks replies aloud"
      >
        🔊 {speakOn ? "Voice on" : "Voice off"}
      </button>

      <div className="text-xs muted flex items-center gap-2 flex-wrap">
        {listening && <span style={{ color: "var(--ok)" }}>● listening…</span>}
        {listening && <span>“{interim || finalTr || "…"}”</span>}
        {speaking && <span style={{ color: "var(--accent)" }}>🗣 speaking…</span>}
        {queueLen > 0 && !speaking && <span>{queueLen} queued</span>}
        {!status?.tts.available && (
          <span style={{ color: "var(--warn)" }}>
            TTS unavailable — {status?.tts.reason || "checking…"}
          </span>
        )}
        {status?.tts.available && (
          <span>
            {status.tts.engine === "elevenlabs"
              ? `ElevenLabs · ${status.tts.voice}`
              : status.tts.engine === "sapi"
              ? "Windows built-in voice"
              : `Piper · ${status.tts.voice}`}
          </span>
        )}
        {status?.tts.note && (
          <span style={{ color: "var(--warn)" }} title={status.tts.note}>
            ⚠ {status.tts.note}
          </span>
        )}
      </div>

      {error && (
        <span className="text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

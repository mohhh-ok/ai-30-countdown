import { useEffect, useRef, useState } from "react";
import type {
  Character,
  TickResult,
  WorldState,
} from "../domain/types.ts";
import { CharacterCard } from "./components/CharacterCard.tsx";
import { TickLog } from "./components/TickLog.tsx";
import { PlacesMap } from "./components/PlacesMap.tsx";
import { FrontStage } from "./components/FrontStage.tsx";

interface StatePayload {
  state: WorldState;
  log: TickResult[];
  model?: string;
}

export function App() {
  const [state, setState] = useState<WorldState | null>(null);
  const [log, setLog] = useState<TickResult[]>([]);
  const [model, setModel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [auto, setAuto] = useState(false);
  const [view, setView] = useState<"front" | "back">("front");
  const autoRef = useRef(false);
  autoRef.current = auto;

  async function loadState() {
    const res = await fetch("/api/state");
    const data = (await res.json()) as StatePayload;
    setState(data.state);
    setLog(data.log);
    if (data.model) setModel(data.model);
  }

  useEffect(() => {
    loadState();
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { ollama: boolean }) => setOllamaOk(h.ollama))
      .catch(() => setOllamaOk(false));
  }, []);

  /** 1ティック進める。継続してよいなら true、終了/エラーなら false。 */
  async function tickOnce(): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/tick", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "エラーが発生しました");
        return false;
      }
      setState(data.state as WorldState);
      setLog((prev) => [...prev, data.result as TickResult]);
      return !(data.state as WorldState).finished;
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラー");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // オートモード: auto が立っている間、tick を連続実行する
  useEffect(() => {
    if (!auto) return;
    let cancelled = false;
    (async () => {
      while (autoRef.current && !cancelled) {
        const cont = await tickOnce();
        if (!cont) {
          setAuto(false);
          break;
        }
        // LLM 完了後に少し間を置く（UI 反映と過負荷防止）
        await new Promise((r) => setTimeout(r, 700));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auto]);

  async function reset() {
    setAuto(false);
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      const data = (await res.json()) as StatePayload;
      setState(data.state);
      setLog(data.log);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return <div className="loading">読み込み中…</div>;

  const lastTick = log.length ? log[log.length - 1] : undefined;
  const lastById = new Map(
    (lastTick?.characters ?? []).map((c) => [c.id, c] as const),
  );
  const placeNameOf = (id: string) =>
    state.places.find((p) => p.id === id)?.name ?? id;

  // 同じ場所にいる生存者のまとまり（「一緒にいる」表示用）
  const placeGroups = new Map<string, Character[]>();
  for (const c of state.characters) {
    if (!c.alive) continue;
    const arr = placeGroups.get(c.currentPlaceId) ?? [];
    arr.push(c);
    placeGroups.set(c.currentPlaceId, arr);
  }
  const togetherGroups = [...placeGroups.entries()].filter(
    ([, g]) => g.length >= 2,
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="title">
          <h1>小さなエージェント世界</h1>
          <span className="subtitle">群像・テキスト版 / Ollama</span>
        </div>
        <div className="day-box">
          <span className="day-num">Day {state.day}</span>
          {state.day > 0 && (
            <span className={`weather weather-${state.weather}`}>
              {state.weather === "normal" ? "通常日" : "不作日"}
            </span>
          )}
        </div>
        <div className="view-toggle">
          <button
            className={view === "front" ? "view-on" : "ghost"}
            onClick={() => setView("front")}
          >
            表（観客）
          </button>
          <button
            className={view === "back" ? "view-on" : "ghost"}
            onClick={() => setView("back")}
          >
            裏（楽屋）
          </button>
        </div>
        <div className="controls">
          <button
            onClick={() => tickOnce()}
            disabled={busy || auto || state.finished}
          >
            {busy && !auto ? "思索中…" : "次の1日 ▶"}
          </button>
          <button
            className={auto ? "auto-on" : "ghost"}
            onClick={() => setAuto((v) => !v)}
            disabled={state.finished}
          >
            {auto ? "⏸ 停止" : "▶▶ オート"}
          </button>
          <button className="ghost" onClick={reset} disabled={busy && !auto}>
            リセット
          </button>
        </div>
      </header>

      <div className="status-line">
        <span>モデル: {model || "?"}</span>
        {auto && <span className="auto-badge">● オート進行中{busy ? "（思索中…）" : ""}</span>}
        {ollamaOk === false && (
          <span className="warn">⚠ Ollama に接続できません（ollama serve を起動）</span>
        )}
        {state.finished && <span className="finished">この世界は終わりを迎えた</span>}
        {error && <span className="warn">{error}</span>}
      </div>

      {view === "front" ? (
        <FrontStage state={state} log={log} />
      ) : (
        <>
          <main className="cards cards-multi">
            {state.characters.map((c) => (
              <CharacterCard
                key={c.id}
                character={c}
                last={lastById.get(c.id)}
                placeName={placeNameOf(c.currentPlaceId)}
                spotlight={lastTick?.spotlightId === c.id}
              />
            ))}
          </main>

          <section className="relations">
            <div className="rel-lines">
              {state.characters.map((c) => (
                <div key={c.id} className="rel-line">
                  <span className="rel-name">{c.name}</span>
                  <span className="arrow">→</span>
                  <strong>{c.relationLabel || "—"}</strong>
                </div>
              ))}
            </div>
            {togetherGroups.map(([placeId, g]) => (
              <div key={placeId} className="together">
                {placeNameOf(placeId)}に {g.map((x) => x.name).join("・")} が一緒にいる
              </div>
            ))}
          </section>

          <section className="map-section">
            <h3>京都の地図</h3>
            <PlacesMap places={state.places} characters={state.characters} />
          </section>

          <section className="log-section">
            <h3>ログ</h3>
            <TickLog log={log} />
          </section>
        </>
      )}
    </div>
  );
}

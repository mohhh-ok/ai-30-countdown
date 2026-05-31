import { useEffect, useRef, useState } from "react";
import type {
  Character,
  Chronicle,
  TickResult,
  WorldState,
} from "../domain/types.ts";
import { CharacterCard } from "./components/CharacterCard.tsx";
import { TickLog } from "./components/TickLog.tsx";
import { PlacesMap } from "./components/PlacesMap.tsx";
import { FrontStage } from "./components/FrontStage.tsx";
import { Highlights } from "./components/Highlights.tsx";
import { LoopsPage } from "./pages/LoopsPage.tsx";
import { LoopPage } from "./pages/LoopPage.tsx";
import { CharacterPage } from "./pages/CharacterPage.tsx";
import { SkillsPage } from "./pages/SkillsPage.tsx";
import { CharAvatar } from "./components/CharAvatar.tsx";
import { type Route, useHashRoute } from "./router.ts";
import { allCharIds, loopNumbers, nameOfId, skillName, ticksOfLoop } from "./util.ts";

/** ページ切り替えのナビ。回帰一覧と各キャラへの入口を常設する。 */
function SiteNav({
  route,
  chronicle,
  log,
}: {
  route: Route;
  chronicle: Chronicle | null;
  log: TickResult[];
}) {
  const loops = loopNumbers(log);
  // ナビは全キャラを定義順で並べる。まだ登場（解放）していない子は名前を伏せて「???」に。
  const appeared = new Set<string>(
    chronicle
      ? chronicle.roster
      : log.flatMap((t) => t.characters.map((c) => c.id)),
  );
  const charIds = allCharIds();
  const onLoop = route.name === "loops" || route.name === "loop";
  return (
    <nav className="site-nav">
      <a className={route.name === "home" ? "nav-on" : ""} href="#/">
        ホーム
      </a>
      <a className={onLoop ? "nav-on" : ""} href="#/loops">
        回帰一覧{loops.length > 0 ? `（${loops.length}）` : ""}
      </a>
      <a className={route.name === "skills" ? "nav-on" : ""} href="#/skills">
        スキル一覧
      </a>
      <span className="nav-sep">登場人物</span>
      {charIds.map((id) =>
        appeared.has(id) ? (
          <a
            key={id}
            className={`nav-char${
              route.name === "char" && route.id === id ? " nav-on" : ""
            }`}
            href={`#/char/${id}`}
          >
            <CharAvatar id={id} name={nameOfId(id)} size={26} />
            {nameOfId(id)}
          </a>
        ) : (
          // まだ登場していない（解放前）キャラは名前を伏せ、リンクも張らない
          <span key={id} className="nav-locked" title="まだ登場していません">
            ???
          </span>
        ),
      )}
    </nav>
  );
}

interface StatePayload {
  state: WorldState;
  log: TickResult[];
  chronicle?: Chronicle;
  model?: string;
}

export function App() {
  const [state, setState] = useState<WorldState | null>(null);
  const [log, setLog] = useState<TickResult[]>([]);
  const [chronicle, setChronicle] = useState<Chronicle | null>(null);
  const [model, setModel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [backend, setBackend] = useState<string>("");
  const [auto, setAuto] = useState(false);
  const [view, setView] = useState<"front" | "back">("front");
  const autoRef = useRef(false);
  autoRef.current = auto;
  const route = useHashRoute();

  async function loadState() {
    const res = await fetch("/api/state");
    const data = (await res.json()) as StatePayload;
    setState(data.state);
    setLog(data.log);
    if (data.chronicle) setChronicle(data.chronicle);
    if (data.model) setModel(data.model);
  }

  useEffect(() => {
    loadState();
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { ollama: boolean; backend?: string }) => {
        setOllamaOk(h.ollama);
        if (h.backend) setBackend(h.backend);
      })
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
      if (data.chronicle) setChronicle(data.chronicle as Chronicle);
      // 回帰モードに終わりはない（ハルが死ねば巻き戻る）。エラー以外は進み続ける。
      return true;
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
      if (data.chronicle) setChronicle(data.chronicle);
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

  const currentLoop = chronicle?.loop ?? 1;
  const currentLoopLog = ticksOfLoop(log, currentLoop); // ホームは「現在の回帰のみ」

  // ホーム以外（回帰一覧・各回帰・キャラ別）は専用ページを出す。
  if (route.name !== "home") {
    return (
      <div className="app">
        <SiteNav route={route} chronicle={chronicle} log={log} />
        {route.name === "loops" && <LoopsPage log={log} chronicle={chronicle} />}
        {route.name === "loop" && (
          <LoopPage loop={route.loop} log={log} chronicle={chronicle} />
        )}
        {route.name === "char" && (
          <CharacterPage id={route.id} log={log} chronicle={chronicle} />
        )}
        {route.name === "skills" && <SkillsPage chronicle={chronicle} />}
      </div>
    );
  }

  return (
    <div className="app">
      <SiteNav route={route} chronicle={chronicle} log={log} />
      <header className="topbar">
        <div className="title">
          <h1>小さなエージェント世界</h1>
          <span className="subtitle">群像・テキスト版 / {backend || "ローカルLLM"}</span>
        </div>
        <div className="day-box">
          {chronicle && <span className="loop-num">第 {chronicle.loop} 回帰</span>}
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
            disabled={busy || auto}
          >
            {busy && !auto ? "思索中…" : "次の1日 ▶"}
          </button>
          <button
            className={auto ? "auto-on" : "ghost"}
            onClick={() => setAuto((v) => !v)}
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
          <span className="warn">
            {backend === "ollama"
              ? "⚠ Ollama に接続できません（ollama serve を起動）"
              : "⚠ Claude Code に接続できません（claude CLI のログインを確認）"}
          </span>
        )}
        {error && <span className="warn">{error}</span>}
      </div>

      {chronicle && (
        <div className="chronicle-bar">
          <span className="chron-roster">
            京の住人: {chronicle.roster.map((id) => nameOfId(id)).join("・")}
            {chronicle.roster.length < 3 && (
              <span className="chron-locked">（未解放あり）</span>
            )}
          </span>
          <span className="chron-skills">
            ハルの会得スキル:{" "}
            {chronicle.skills.acquired.length
              ? chronicle.skills.acquired.map((id) => skillName(id)).join("・")
              : "まだない"}
          </span>
        </div>
      )}

      <div className="body-cols">
        <div className="main-col">
          {view === "front" ? (
            <FrontStage state={state} log={currentLoopLog} chronicle={chronicle} />
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
                <TickLog log={currentLoopLog} />
              </section>
            </>
          )}
        </div>
        <aside className="side-col">
          <Highlights log={log} chronicle={chronicle} />
        </aside>
      </div>
    </div>
  );
}

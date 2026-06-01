import { useEffect, useState } from "react";
import type {
  Character,
  Chronicle,
  TickResult,
  WorldState,
} from "../domain/types.ts";
import { DEADLINE_DAY } from "../domain/events.ts";
import { CharacterCard } from "./components/CharacterCard.tsx";
import { TickLog } from "./components/TickLog.tsx";
import { PlacesMap } from "./components/PlacesMap.tsx";
import { FrontStage } from "./components/FrontStage.tsx";
import { Highlights } from "./components/Highlights.tsx";
import { LoopsPage } from "./pages/LoopsPage.tsx";
import { LoopPage } from "./pages/LoopPage.tsx";
import { CharacterPage } from "./pages/CharacterPage.tsx";
import { SkillsPage } from "./pages/SkillsPage.tsx";
import { SoulsPage } from "./pages/SoulsPage.tsx";
import { CharAvatar } from "./components/CharAvatar.tsx";
import { type Route, useHashRoute } from "./router.ts";
import { allCharIds, nameOfId, ticksOfLoop, unlockOf } from "./util.ts";

// サーバ側ワーカーが自走で世界を進める。UI は進行操作を持たず、一定間隔で最新状態を取りに行くだけ。
const POLL_INTERVAL_MS = 3000;

// ホーム配下のビュー切替（表＝main / 裏＝status / デバッグ＝debug）。
type View = "main" | "status" | "debug";

/** ページ切り替えのナビ。回帰一覧と各キャラへの入口を常設する。 */
function SiteNav({
  route,
  chronicle,
  view,
  setView,
}: {
  route: Route;
  chronicle: Chronicle | null;
  view: View;
  setView: (v: View) => void;
}) {
  // 周の総数は現在の回帰番号（chronicle.loop）そのもの。全周ログは持たない。
  const loopCount = chronicle?.loop ?? 1;
  // ナビは全キャラを定義順で並べる。まだ登場（解放）していない子は名前を伏せて「???」に。
  const appeared = new Set<string>(chronicle?.roster ?? []);
  const charIds = allCharIds();
  const onLoop = route.name === "loops" || route.name === "loop";
  return (
    <nav className="site-nav">
      {/* ホーム配下のビュー切替（表/裏/デバッグ）をナビ行に統合。ホーム以外のページから
          押された場合も href="#/" でホームへ戻りつつ、対象ビューに切り替える。 */}
      <a
        className={route.name === "home" && view === "main" ? "nav-on" : ""}
        href="#/"
        onClick={() => setView("main")}
      >
        ホーム
      </a>
      <a
        className={route.name === "home" && view === "status" ? "nav-on" : ""}
        href="#/"
        onClick={() => setView("status")}
      >
        ステータス
      </a>
      <a
        className={route.name === "home" && view === "debug" ? "nav-on" : ""}
        href="#/"
        onClick={() => setView("debug")}
      >
        デバッグ
      </a>
      <a className={onLoop ? "nav-on" : ""} href="#/loops">
        回帰一覧{loopCount > 0 ? `（${loopCount}）` : ""}
      </a>
      <a className={route.name === "skills" ? "nav-on" : ""} href="#/skills">
        スキル一覧
      </a>
      <a className={route.name === "souls" ? "nav-on" : ""} href="#/souls">
        ココロ一覧
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
          // まだ登場していない（解放前）キャラ。名前は伏せるが、開放条件は見られるようにリンクを張る
          <a
            key={id}
            className={`nav-locked${
              route.name === "char" && route.id === id ? " nav-on" : ""
            }`}
            href={`#/char/${id}`}
            title={unlockOf(id)?.requirement ?? "まだ登場していません"}
          >
            🔒 ???
          </a>
        ),
      )}
    </nav>
  );
}

interface StatePayload {
  state: WorldState;
  log: TickResult[];
  chronicle?: Chronicle;
  running?: boolean;
}

export function App() {
  const [state, setState] = useState<WorldState | null>(null);
  const [log, setLog] = useState<TickResult[]>([]);
  const [chronicle, setChronicle] = useState<Chronicle | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>("");
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [backend, setBackend] = useState<string>("");
  const [view, setView] = useState<View>("main");
  const route = useHashRoute();

  async function loadState() {
    try {
      const res = await fetch("/api/state");
      const data = (await res.json()) as StatePayload;
      setState(data.state);
      setLog(data.log);
      if (data.chronicle) setChronicle(data.chronicle);
      if (typeof data.running === "boolean") setRunning(data.running);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラー");
    }
  }

  // サーバ側ワーカーが自走で1日ずつ進める。UI は進行操作を持たず、最新状態を一定間隔で
  // 取りに行くだけ（観るだけ画面）。
  useEffect(() => {
    loadState();
    const id = setInterval(loadState, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { ollama: boolean; backend?: string }) => {
        setOllamaOk(h.ollama);
        if (h.backend) setBackend(h.backend);
      })
      .catch(() => setOllamaOk(false));
  }, []);

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
        <SiteNav
          route={route}
          chronicle={chronicle}
          view={view}
          setView={setView}
        />
        {route.name === "loops" && (
          <LoopsPage chronicle={chronicle} currentDays={log.length} />
        )}
        {route.name === "loop" && (
          <LoopPage loop={route.loop} chronicle={chronicle} />
        )}
        {route.name === "char" && (
          <CharacterPage id={route.id} chronicle={chronicle} />
        )}
        {route.name === "skills" && <SkillsPage chronicle={chronicle} />}
        {route.name === "souls" && (
          <SoulsPage characters={state?.characters ?? []} chronicle={chronicle} />
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <SiteNav
        route={route}
        chronicle={chronicle}
        view={view}
        setView={setView}
      />
      <header className="topbar">
        <div className="title">
          <h1 className="title-logo">
            <img src="/assets/title.webp" alt="30日のカウントダウン" />
          </h1>
          <p className="subtitle">
            30日で終わる世界。
            <br />
            回帰の中で成長するハルは何を成し遂げるのか？
            <br />
            AIが紡ぐ物語。
          </p>
        </div>
        <div className="day-box">
          {chronicle && <span className="loop-num">第 {chronicle.loop} 回帰</span>}
          <span className="day-num">Day {state.day}</span>
          {state.day > 0 && state.day < DEADLINE_DAY && (
            <span className="countdown">大禍まで {DEADLINE_DAY - state.day} 日</span>
          )}
          {state.day >= DEADLINE_DAY && <span className="countdown countdown-now">大禍の日</span>}
          {state.day > 0 && (
            <span className={`weather weather-${state.weather}`}>
              {state.weather === "normal" ? "通常日" : "不作日"}
            </span>
          )}
        </div>
      </header>

      <div className="status-line">
        {running && <span className="auto-badge">● 自動進行中</span>}
        {ollamaOk === false && (
          <span className="warn">
            {backend === "ollama"
              ? "⚠ Ollama に接続できません（ollama serve を起動）"
              : "⚠ Claude Code に接続できません（claude CLI のログインを確認）"}
          </span>
        )}
        {error && <span className="warn">{error}</span>}
      </div>

      <div className={`body-cols${view !== "main" ? " body-cols-single" : ""}`}>
        <div className="main-col">
          {view === "main" && (
            <FrontStage state={state} log={currentLoopLog} chronicle={chronicle} />
          )}
          {view === "status" && (
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
            </>
          )}
          {view === "debug" && (
            <section className="log-section">
              <h3>ログ</h3>
              <TickLog log={currentLoopLog} />
            </section>
          )}
        </div>
        {view === "main" && (
          <aside className="side-col">
            <Highlights log={log} chronicle={chronicle} />
          </aside>
        )}
      </div>
    </div>
  );
}

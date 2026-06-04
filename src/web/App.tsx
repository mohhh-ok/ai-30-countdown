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
import { LoopPage } from "./pages/LoopPage.tsx";
import { LoopSelect } from "./components/LoopSelect.tsx";
import { CharacterPage } from "./pages/CharacterPage.tsx";
import { SkillsPage } from "./pages/SkillsPage.tsx";
import { SoulsPage } from "./pages/SoulsPage.tsx";
import { CharAvatar } from "./components/CharAvatar.tsx";
import { type Route, useHashRoute } from "./router.ts";
import { allCharIds, nameOfId, ticksOfLoop, unlockOf } from "./util.ts";
import { type Lang, useDomainNames, useLang, useLocalized, useT } from "./i18n.tsx";

// サーバ側ワーカーが自走で世界を進める。UI は進行操作を持たず、一定間隔で最新状態を取りに行くだけ。
const POLL_INTERVAL_MS = 3000;

// ホーム配下のビュー切替（表＝main / 裏＝status / デバッグ＝debug）。
type View = "main" | "status" | "debug";

// デバッグ（楽屋ビュー＝ログ TickLog）はローカル開発時のみ表示する。
// 公開（Railway）では誰でも裏側ログを覗ける状態にしたくないので、ブラウザの
// hostname が localhost/ループバックのときだけタブとビューを出す。
const IS_LOCALHOST =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

/** ページ切り替えのナビ。各ページと各キャラへの入口を常設する。
    回帰一覧は廃止（日付欄の「第N回帰」セレクトから各回帰へ直接ジャンプする）。 */
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
  const t = useT();
  const dn = useDomainNames();
  // ナビは全キャラを定義順で並べる。まだ登場（解放）していない子は名前を伏せて「???」に。
  const appeared = new Set<string>(chronicle?.roster ?? []);
  const charIds = allCharIds();
  return (
    <nav className="site-nav">
      {/* ホーム配下のビュー切替（表/裏/デバッグ）をナビ行に統合。ホーム以外のページから
          押された場合も href="#/" でホームへ戻りつつ、対象ビューに切り替える。 */}
      <a
        className={route.name === "home" && view === "main" ? "nav-on" : ""}
        href="#/"
        onClick={() => setView("main")}
      >
        {t("nav_home")}
      </a>
      <a
        className={route.name === "home" && view === "status" ? "nav-on" : ""}
        href="#/"
        onClick={() => setView("status")}
      >
        {t("nav_status")}
      </a>
      {IS_LOCALHOST && (
        <a
          className={route.name === "home" && view === "debug" ? "nav-on" : ""}
          href="#/"
          onClick={() => setView("debug")}
        >
          {t("nav_debug")}
        </a>
      )}
      <a className={route.name === "skills" ? "nav-on" : ""} href="#/skills">
        {t("nav_skills")}
      </a>
      <a className={route.name === "souls" ? "nav-on" : ""} href="#/souls">
        {t("nav_souls")}
      </a>
      <span className="nav-sep">{t("nav_characters")}</span>
      {charIds.map((id) =>
        appeared.has(id) ? (
          <a
            key={id}
            className={`nav-char${
              route.name === "char" && route.id === id ? " nav-on" : ""
            }`}
            href={`#/char/${id}`}
          >
            <CharAvatar id={id} name={dn.char(id, nameOfId(id))} size={26} />
            {dn.char(id, nameOfId(id))}
          </a>
        ) : (
          // まだ登場していない（解放前）キャラ。名前は伏せるが、開放条件は見られるようにリンクを張る
          <a
            key={id}
            className={`nav-locked${
              route.name === "char" && route.id === id ? " nav-on" : ""
            }`}
            href={`#/char/${id}`}
            title={(() => {
              const u = unlockOf(id);
              return u ? dn.unlockReq(u.id, u.requirement) : t("nav_locked_title");
            })()}
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

function TitleBlock() {
  const t = useT();
  const { lang, setLang } = useLang();
  return (
    <div className="title">
      <div className="title-bar">
        <h1 className="title-logo">
          <img src={lang === "en" ? "/assets/title-en.webp" : "/assets/title.webp"} alt={t("title_alt")} />
        </h1>
        <span className="lang-pick">
          <span className="lang-icon" aria-hidden="true">🌐</span>
          <select
            className="lang-select"
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            aria-label="Language / 言語"
          >
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </span>
      </div>
      <p className="subtitle">
        {t("subtitle_1")}
        <br />
        {t("subtitle_2")}
        <br />
        {t("subtitle_3")}
      </p>
    </div>
  );
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
  const t = useT();
  const dn = useDomainNames();
  const loc = useLocalized();
  const { lang } = useLang();
  const nameSep = lang === "en" ? ", " : "・";

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
      setError(e instanceof Error ? e.message : t("comm_error"));
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

  if (!state) return <div className="loading">{t("loading")}</div>;

  const lastTick = log.length ? log[log.length - 1] : undefined;
  const lastById = new Map(
    (lastTick?.characters ?? []).map((c) => [c.id, c] as const),
  );
  const placeNameOf = (id: string) => {
    const p = state.places.find((pl) => pl.id === id);
    return p ? dn.place(p.id, p.name) : id;
  };

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

  // ホーム以外（各回帰・キャラ別など）は専用ページを出す。
  if (route.name !== "home") {
    return (
      <div className="app">
        <TitleBlock />
        <SiteNav
          route={route}
          chronicle={chronicle}
          view={view}
          setView={setView}
        />
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
      <TitleBlock />
      <SiteNav
        route={route}
        chronicle={chronicle}
        view={view}
        setView={setView}
      />
      <header className="topbar">
        <div className="day-box">
          <span className="day-num">{t("day_label", { n: state.day })}</span>
          {state.day > 0 && state.day < DEADLINE_DAY && (
            <span className="countdown">
              {t("countdown", { n: DEADLINE_DAY - state.day })}
            </span>
          )}
          {state.day >= DEADLINE_DAY && (
            <span className="countdown countdown-now">{t("calamity_day")}</span>
          )}
          {state.day > 0 && (
            <span className={`weather weather-${state.weather}`}>
              {state.weather === "normal" ? t("weather_normal") : t("weather_lean")}
            </span>
          )}
          {chronicle && (
            // 「第N回帰」表示そのものがセレクト。ページ右端に置き、選んだ回帰へジャンプする
            <LoopSelect chronicle={chronicle} value={chronicle.loop} />
          )}
        </div>
      </header>

      <div className="status-line">
        {running && <span className="auto-badge">{t("auto_badge")}</span>}
        {ollamaOk === false && (
          <span className="warn">
            {backend === "ollama" ? t("warn_ollama") : t("warn_claude")}
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
                      <span className="rel-name">{dn.char(c.id, c.name)}</span>
                      <span className="arrow">→</span>
                      <strong>{loc(c.relationLabel, "relation") || t("rel_none")}</strong>
                    </div>
                  ))}
                </div>
                {togetherGroups.map(([placeId, g]) => (
                  <div key={placeId} className="together">
                    {t("together", {
                      place: placeNameOf(placeId),
                      names: g.map((x) => dn.char(x.id, x.name)).join(nameSep),
                    })}
                  </div>
                ))}
              </section>

              <section className="map-section">
                <h3>{t("map_title")}</h3>
                <PlacesMap places={state.places} characters={state.characters} />
              </section>
            </>
          )}
          {IS_LOCALHOST && view === "debug" && (
            <section className="log-section">
              <h3>{t("log_title")}</h3>
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

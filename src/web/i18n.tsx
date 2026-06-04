// 表示言語の i18n 基盤（レイヤー1: 静的UI文字列＋ドメイン名の英訳）。
//
// 設計方針（CLAUDE.md の方式3に対応）:
//   - 日本語が source of truth。LLM プロンプト（src/llm/）と DB 保存値は日本語のまま。
//     ここで扱うのは「表示用の派生」だけ。ドメイン定義の .ts（characters.ts 等）は触らない。
//   - 英語はあくまで観客向けの表示派生。ドメインの id をキーに、英語ラベルを別持ちする
//     （ACTION_LABELS が id→日本語 Record で分離しているのと同じ発想を、英語側にも適用）。
//   - 未訳キーは握りつぶさず warn で可視化する（CLAUDE.md: 安易なフォールバック禁止）。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  CharacterTickResult,
  HighlightI18n,
  LocalizedText,
  RewardI18n,
} from "../domain/types.ts";
import { charIdByName, skillIdByName } from "./util.ts";

export type Lang = "ja" | "en";

// ───────────────────────────────────────────────────────────────────────────
// 静的UI文字列。{n} などのプレースホルダは t(key, { n }) で差し込む。
// ───────────────────────────────────────────────────────────────────────────
const UI = {
  ja: {
    nav_home: "ホーム",
    nav_status: "ステータス",
    nav_debug: "デバッグ",
    nav_skills: "スキル一覧",
    nav_souls: "ココロ一覧",
    nav_characters: "登場人物",
    nav_locked_title: "まだ登場していません",
    loading: "読み込み中…",
    title_alt: "30日のカウントダウン",
    subtitle_1: "30日で終わる世界。",
    subtitle_2: "回帰の中で成長するハルは何を成し遂げるのか？",
    subtitle_3: "AIが紡ぐ物語。",
    loop_label: "第 {n} 回帰",
    day_label: "Day {n}",
    countdown: "大禍まで {n} 日",
    calamity_day: "大禍の日",
    weather_normal: "通常日",
    weather_lean: "不作日",
    auto_badge: "● 自動進行中",
    warn_ollama: "⚠ Ollama に接続できません（ollama serve を起動）",
    warn_claude: "⚠ Claude Code に接続できません（claude CLI のログインを確認）",
    comm_error: "通信エラー",
    map_title: "京都の地図",
    log_title: "ログ",
    rel_none: "—",
    together: "{place}に {names} が一緒にいる",
    story_title: "これまでの物語",
    others_label: "その頃——",
    stage_empty: "幕が上がるのを待っています。",
    stage_empty_solo:
      "第一の回帰——京にはまだハルひとり。「次の1日 ▶」で物語を始めましょう。",
    stage_empty_sub: "「次の1日 ▶」で物語を始めましょう。",
    kyo_title: "⛩ 京の気",
    kyo_sei: "和み",
    kyo_daku: "荒び",
    scene_day: "第 {n} 日",
    scene_weather_normal: "穏やかな日",
    scene_weather_lean: "実りの薄い日",
    vigor_critical: "限界が近い",
    vigor_tired: "疲れている",
    vigor_calm: "落ち着いている",
    vigor_well: "元気",
    mark_climax_saved:
      "☄️ 大禍、来たる——ハルの結界が京を護り抜いた。京は救われた",
    mark_climax_lost: "☄️ 大禍、来たる——結界は及ばず、京は呑まれた",
    mark_frenzy:
      "🔥 {name}の眼の色が変わる——餓えと猛りが理性を呑み、荒ぶり（変身）に堕ちた",
    mark_quell: "🕊️ ハルの祓いが{wild}の猛りを鎮めた——静けさが戻る",
    mark_quell_wild: "荒ぶる{name}",
    mark_quell_someone: "荒ぶる者",
    mark_skill: "✨ ハルは「{skills}」を会得した",
    mark_unlock: "🆕 {names} が次の回帰から京に現れる",
    mark_regress: "↻ ハルは力尽き、時は巻き戻る——",
    // fin（大禍を祓い、回帰の輪が断たれた）。観客ビューの幕引き。
    fin_title: "—— 結 ——",
    fin_text:
      "大禍は祓われた。ハルが力尽きる未来は、もうどこにもない。回帰の輪は断たれ、京の長い三十日は、ここに結ばれた。",
    fin_sub: "この物語は完結しました。これまでの回帰は、上の「第N回帰」からいつでも読み返せます。",
    // 変身・鎮静の地の文（決定的ルール文。LLM ナレーションの後に UI が言語別に添える）。
    narr_frenzy_became:
      "——{name}の眼の色が変わる。餓えと猛りが理性を呑み、荒ぶりが鎌首をもたげた。",
    narr_frenzy_steal: "荒ぶる{name}は{target}から霊を奪い、京の気をさらに枯らしていく。",
    narr_frenzy_steal_solo: "荒ぶる{name}は霊を奪い、京の気をさらに枯らしていく。",
    narr_frenzy_taboo: "荒ぶる{name}は和みすら喰らい、京の気をさらに枯らしていく。",
    narr_quell:
      "祓いの手が、{who}の猛りをゆっくりと鎮めていく。張りつめた気配が、ほどけていった。",
    // 日記の理由注記（engine が衝動／分与で行動を上書きした日。本文の前に添える）。
    diary_note_impulse: "（抑えきれない衝動に突き動かされて）",
    diary_note_gift: "（弱った相手を見かね、霊力を分け与えた）",
    // この日の報酬ラベル。ja は engine の label（source of truth）を使うので下記は parity 用。
    rwd_forage_devour_daku: "{place}で荒びを{n}喰らった",
    rwd_forage_devour_sei: "{place}で和みさえ{n}喰らった（禁忌）",
    rwd_taboo_burden: "和みさえ喰らった業がのしかかる",
    rwd_forage_devour_dry: "{place}には喰らう霊も残っていない",
    rwd_forage_gain: "{place}で和みを{n}頂いた",
    rwd_forage_dry: "{place}は枯れ、頂ける霊がなかった",
    rwd_rest: "休んで安らいだ",
    rwd_talk_mutual: "{name}と心が通った",
    rwd_talk_ignored: "{name}に語りかけたが応じてもらえなかった",
    rwd_talk_ignored_solo: "語りかけたが独りだった",
    rwd_share_given: "{name}に分け与えた",
    rwd_steal: "{name}から奪った",
    rwd_steal_solo: "奪った",
    rwd_follow_beside: "{name}の傍に寄り添った",
    rwd_follow_chase: "{name}を追って歩いた",
    rwd_follow_none: "寄り添う相手を求めた",
    rwd_purify_cleansed: "{place}の荒びを{n}鎮めた",
    rwd_purify_quiet: "{place}で静かに祈った",
    rwd_share_received: "{name}から分けてもらった",
    rwd_stolen: "{name}に奪われた",
    rwd_lonely_nearest: "{name}たちと離れていて心細い",
    rwd_lonely_solo: "ひとりで心細い",
    rwd_satiety: "満ち足りている",
    rwd_hunger: "飢えが身にこたえる",
    act_died: "{name}は、ここで消え去った…",
    act_follow_move: "{name}は{target}を慕って{place}へ近づいた",
    act_move: "{name}は{from}から{place}へ移ろった",
    act_forage_taboo: "{name}は{place}で和みさえ喰らった——禁忌",
    act_forage_daku: "{name}は{place}で荒びを喰らった",
    act_forage_dry: "{name}は霊を集めたが、この地は枯れていた",
    act_forage: "{name}は{place}で霊を集めた",
    act_rest: "{name}は静かに気を鎮めた",
    act_talk: "{name}は{target}に語りかけた",
    act_talk_solo: "{name}はひとり言ちた",
    act_share: "{name}は{target}に霊力を分けた",
    act_share_solo: "{name}は霊力を分けようとした",
    act_steal: "{name}は{target}から霊を奪った",
    act_steal_solo: "{name}は霊を奪った",
    act_steal_burden_heavy: "{base}——業が重くなり、日々の消耗がさらに増した",
    act_steal_burden: "{base}——禁忌を犯した代償に、日々の消耗が重くなった",
    act_follow: "{name}は{target}の傍に寄り添った",
    act_follow_solo: "{name}は寄り添う相手を探した",
    act_purify: "{name}は{place}の荒びを鎮めた",
    act_purify_pray: "{name}は{place}で静かに祈った",
    act_default: "{name}はその日を過ごした",
    act_frenzy_suffix: "{story}——荒ぶりは鎮まらぬまま",
    brief_died: "力尽きた…",
    brief_follow_move: "{target}を追って{place}へ",
    brief_move: "{place}へ",
    brief_forage_taboo: "禁忌の業",
    brief_forage: "霊を集めた",
    brief_rest: "気を鎮めた",
    brief_talk: "{target}に語りかけ",
    brief_talk_solo: "ひとり言ちた",
    brief_share: "{target}に分けた",
    brief_share_solo: "分けようとした",
    brief_steal: "{target}から奪った——業が重くなる",
    brief_steal_solo: "奪った——業が重くなる",
    brief_follow: "{target}に寄り添い",
    brief_follow_solo: "寄り添う相手を探し",
    brief_purify: "荒びを鎮めた",
    brief_purify_pray: "静かに祈った",
    brief_default: "日を過ごした",
    brief_frenzy: "🔥荒ぶり",
    montage_low_sep: "…",
    hl_count: "{n} 件",
    hl_loop_showcase: "🎬 第 {n} 回帰の見せ場",
    hl_chronicle: "📜 回帰を超えた年代記",
    hl_empty_loop: "この回帰の見せ場はこれから",
    hl_empty_chronicle: "まだ節目はない",
    // ハイライト文（年代記・見せ場）。{skills}{chars}{place}{stage}… は useHighlightText が差し込む。
    hlx_meta_skill: "ハル、「{skills}」を会得",
    hlx_meta_unlock: "{chars} 解放（次の回帰から登場）",
    hlx_meta_stage: "ハル、初めて「{stage}」に至る",
    hlx_record: "最長生存を更新（{n}日）",
    hlx_regress: "ハル力尽きる",
    hlx_regress_at: "{place}でハル力尽きる",
    hlx_death: "{chars}、力尽きる",
    hlx_skill: "「{skills}」を会得",
    hlx_unlock: "{chars} を解放",
    hlx_stage: "ハル、{stageBefore}→{stageAfter}へ",
    hlx_world_event: "{events} 起こる",
    hlx_taboo_touch: "禁忌に触れる",
    hlx_taboo_touch_at: "{place}で禁忌に触れる",
    hlx_steal: "{chars}、霊を奪う（禁忌）",
    hlx_steal_from: "{chars}、{from}から霊を奪う（禁忌）",
    hlx_frenzy_became: "{chars}、荒ぶりに堕つ（変身）",
    hlx_frenzy_quelled: "{chars}、荒ぶりを鎮める",
    hlx_peril: "ハル、餓えの淵（霊力 {n}）",
    hlx_dialogue: "{chars}の会話",
    hlx_dialogue_solo: "会話劇",
    hlx_scene_meet: "{place}で{chars}が居合わせた",
    hlx_scene_moves: "移動: {moves}",
    map_forage: "実り 通常{normal}/不作{lean}",
    param_axis: "軸",
    card_spotlight: "🎥 主役",
    param_altruism: "利他",
    param_independence: "自立",
    param_trust: "信頼",
    frenzy_became: "⚡ 変身！荒ぶりに堕ちた",
    frenzy_quelled: "🕊️ 荒ぶりが鎮まった",
    frenzy_active: "🔥 荒ぶり（変身中）",
    frenzy_lv: " Lv{n}",
    frenzy_burden: " ／ 溜まる業 {n}",
    moved_from: "{place}から移動",
    energy_label: "エネルギー",
    mood_section: "気分",
    mood_elation: "高揚",
    mood_warmth: "温かさ",
    mood_calm: "安らぎ",
    mood_stress: "ストレス",
    ab_section: "飽き（抗体）",
    ab_achievement: "達成",
    ab_bond: "絆",
    ab_comfort: "安らぎ",
    ab_thrill: "背徳",
    ab_title: "{label}の報酬への慣れ: {v}",
    rewards_section: "この日の報酬",
    diary_mark: "日記",
    diary_empty: "（まだない）",
    dead_banner: "力尽きた",
    back_home: "← ホーム",
    talent_insight: "観の眼（霊脈を読む）",
    talent_bond: "結の力（地を癒す）",
    talent_devour: "奪命（霊を喰らう）",
    talent_none: "—",
    char_loop_meta: "{days} 日・利他ピーク {peak}・{stage}",
    char_meta_frenzy: "・🔥荒ぶり",
    char_meta_died: "・力尽きた",
    char_day_transform: "⚡変身",
    char_day_end: "— ここで消え去った",
    badge_locked: "未解放",
    badge_hero: "主人公",
    locked_empty: "まだ京には現れていない者。",
    unlock_cond: "解放条件",
    unlock_unknown: "この者が現れる条件は、まだ霧の中。",
    unlock_now:
      "現在: 第 {loop} 回帰 ／ ハルの会得スキル {skills} 個 ／ 利他ピーク {peak}",
    char_talent: "異能: {label}",
    char_lesson: "処世術: {lesson}",
    load_failed: "読み込みに失敗しました: {error}",
    char_not_appeared: "このキャラはまだ登場していません。",
    loops_live: "進行中",
    loops_reached: "到達: {stage}（利他 {alt}）",
    loops_skills: "✨ {skills}",
    loops_elapsed: "{n} 日経過",
    loop_select_label: "回帰を選んでジャンプ",
    loop_survived: "生存 {n} 日",
    loop_no_record: "この回帰の記録はありません。",
    loop_end_cleared: "大禍を祓い、回帰の輪を断った",
    loop_end_died: "力尽きた",
    loop_end_died_at: "{place}で力尽きた",
    scope_loop: "周回内",
    scope_career: "通算",
    skill_done: "会得済み",
    skills_title: "✨ 会得式スキル",
    skills_count: "{n} / {total} 会得",
    skills_lead:
      "記憶も成長値も異能も回帰のたびにリセットされる中で、ここに並ぶスキルだけが周回をまたいで永続します。ハルが条件を満たした瞬間に会得し、以後は全周にわたって効き続けます。",
    souls_title: "💞 ココロ",
    souls_lead:
      "霊力を分けてもらう（share を受ける）経験が積もると、妖の内面に「利他の心」が芽生えます。芽生えた心は本人の判断材料に加わり、分け与え・語らい・寄り添いといった行動へ傾けます。会得式スキルとは別の仕組みで全キャラが持ちますが、回帰をまたいで持ち越せるのは主人公ハルだけです（他の妖は周ごとにまっさらへ戻ります）。",
    souls_kinds_head: "ココロの種類",
    souls_now_head: "いまの各々のココロ",
    souls_empty: "まだ誰も登場していません。",
    souls_scope_now: "今周",
    souls_kind_desc: "{source}が積もると芽生える。",
    souls_stage_item: "{label}（{n}回〜）",
    souls_stage_prefix: "{label}・",
    souls_count_times: "{n}回",
    tlog_empty: "まだ何も起きていない。「次の1日」を押して始めましょう。",
    tlog_weather_normal: "通常",
    tlog_weather_lean: "不作",
    tlog_event_new: "（発生）",
    tlog_event_progress: "（{n}/{total}）",
    tlog_event_title: "{n}日目 / 全{total}日",
    tlog_mark_skill: "✨ ハル、「{skills}」を会得",
    tlog_mark_unlock: "🆕 {names} 解放（次の回帰から登場）",
    tlog_mark_regress: "↻ ハル力尽き、時は巻き戻る",
    tlog_spotlight_label: "今日の主役: ",
    tlog_intent: "演出: {intent}",
    tlog_forage_op: "（実り操作 {ops}）",
    tlog_whisper_to: "守護神→{name}",
    tlog_moved: "{from}→{to}へ移動",
    tlog_impulse: "衝動",
    tlog_stage: "段階: {before}→{after}",
    tlog_frenzy: "荒ぶり{n}",
    tlog_frenzy_active: "【変身中】",
    tlog_frenzy_became: "⚡変身!",
    tlog_frenzy_burden: " 業+{n}",
    tlog_quelled: "🕊️荒ぶりを鎮めた!",
    tlog_faced: "荒ぶる者と向き合い祓った",
    tlog_notable_label: "注目の変化: ",
    tlog_timing_head: "⏱ LLM {n}回 / 述べ {total}",
    tlog_timing_slow: "最長 {label} {ms}",
    tlog_timing_fail: "失敗{n}（リトライ）",
    tlog_timing_group_title: "{count}回 / 最長 {max}",
  },
  en: {
    nav_home: "Home",
    nav_status: "Status",
    nav_debug: "Debug",
    nav_skills: "Skills",
    nav_souls: "Hearts",
    nav_characters: "Cast",
    nav_locked_title: "Not yet appeared",
    loading: "Loading…",
    title_alt: "A 30-Day Countdown",
    subtitle_1: "A world that ends in 30 days.",
    subtitle_2: "Growing through each loop, what will Haru achieve?",
    subtitle_3: "A story woven by AI.",
    loop_label: "Loop {n}",
    day_label: "Day {n}",
    countdown: "{n} days to the Calamity",
    calamity_day: "Day of the Calamity",
    weather_normal: "Clear day",
    weather_lean: "Lean day",
    auto_badge: "● Auto-running",
    warn_ollama: "⚠ Cannot reach Ollama (start `ollama serve`)",
    warn_claude: "⚠ Cannot reach Claude Code (check the `claude` CLI login)",
    comm_error: "Connection error",
    map_title: "Map of Kyoto",
    log_title: "Log",
    rel_none: "—",
    together: "{names} are together at {place}",
    story_title: "The story so far",
    others_label: "Meanwhile—",
    stage_empty: "Waiting for the curtain to rise.",
    stage_empty_solo:
      "The first loop—only Haru is in Kyoto. Begin the story with “Next day ▶”.",
    stage_empty_sub: "Begin the story with “Next day ▶”.",
    kyo_title: "⛩ Spirit of Kyoto",
    kyo_sei: "Calm",
    kyo_daku: "Turmoil",
    scene_day: "Day {n}",
    scene_weather_normal: "A calm day",
    scene_weather_lean: "A day of thin harvest",
    vigor_critical: "near the limit",
    vigor_tired: "weary",
    vigor_calm: "at ease",
    vigor_well: "in good spirits",
    mark_climax_saved:
      "☄️ The Calamity comes—Haru’s ward held, and Kyoto was protected. Kyoto is saved",
    mark_climax_lost:
      "☄️ The Calamity comes—the ward could not hold, and Kyoto was swallowed",
    mark_frenzy:
      "🔥 {name}’s eyes change color—hunger and fury devour reason, falling into frenzy (transformation)",
    mark_quell:
      "🕊️ Haru’s purification quelled the fury of {wild}—stillness returns",
    mark_quell_wild: "the frenzied {name}",
    mark_quell_someone: "the frenzied one",
    mark_skill: "✨ Haru mastered {skills}",
    mark_unlock: "🆕 {names} will appear in Kyoto from the next loop",
    mark_regress: "↻ Haru’s strength fails, and time rewinds—",
    // fin (the Calamity was purified and the cycle of regression is severed). Final curtain of the stage view.
    fin_title: "—— Fin ——",
    fin_text:
      "The Calamity has been purified. There is no future left in which Haru’s strength fails. The cycle of regression is severed, and Kyoto’s long thirty days come, at last, to a close.",
    fin_sub:
      "This story is complete. You can revisit every loop anytime from the “Loop N” selector above.",
    narr_frenzy_became:
      "—{name}’s eyes change color. Hunger and fury swallow reason, and the frenzy rears its head.",
    narr_frenzy_steal:
      "The frenzied {name} devours spirit from {target}, withering Kyoto’s spirit further.",
    narr_frenzy_steal_solo:
      "The frenzied {name} devours spirit, withering Kyoto’s spirit further.",
    narr_frenzy_taboo:
      "The frenzied {name} devours even the calm, withering Kyoto’s spirit further.",
    narr_quell:
      "The purifying hand slowly quells {who}’s fury. The taut, strained air loosens at last.",
    diary_note_impulse: "(driven by an uncontrollable impulse) ",
    diary_note_gift: "(seeing a weakened companion, shared spirit power) ",
    rwd_forage_devour_daku: "Devoured {n} turmoil at {place}",
    rwd_forage_devour_sei: "Devoured even {n} calm at {place} (taboo)",
    rwd_taboo_burden: "The karma of devouring calm weighs down",
    rwd_forage_devour_dry: "No spirit left to devour at {place}",
    rwd_forage_gain: "Received {n} calm at {place}",
    rwd_forage_dry: "{place} was barren—no spirit to receive",
    rwd_rest: "Rested and found ease",
    rwd_talk_mutual: "Hearts connected with {name}",
    rwd_talk_ignored: "Spoke to {name} but got no answer",
    rwd_talk_ignored_solo: "Spoke up, but was alone",
    rwd_share_given: "Shared with {name}",
    rwd_steal: "Stole from {name}",
    rwd_steal_solo: "Stole spirit",
    rwd_follow_beside: "Nestled close to {name}",
    rwd_follow_chase: "Walked after {name}",
    rwd_follow_none: "Sought someone to stay close to",
    rwd_purify_cleansed: "Quelled {n} turmoil at {place}",
    rwd_purify_quiet: "Prayed quietly at {place}",
    rwd_share_received: "Received a share from {name}",
    rwd_stolen: "Robbed by {name}",
    rwd_lonely_nearest: "Far from {name} and the others—lonely",
    rwd_lonely_solo: "Alone and lonely",
    rwd_satiety: "Content and full",
    rwd_hunger: "Hunger bites deep",
    act_died: "{name} vanished here…",
    act_follow_move: "{name} drew near to {place}, longing for {target}",
    act_move: "{name} drifted from {from} to {place}",
    act_forage_taboo: "{name} devoured even the calm at {place}—a taboo",
    act_forage_daku: "{name} took in the turmoil at {place}",
    act_forage_dry: "{name} gathered spirit, but this land was barren",
    act_forage: "{name} gathered spirit at {place}",
    act_rest: "{name} quietly calmed the spirit",
    act_talk: "{name} spoke to {target}",
    act_talk_solo: "{name} murmured alone",
    act_share: "{name} shared spirit power with {target}",
    act_share_solo: "{name} tried to share spirit power",
    act_steal: "{name} devoured spirit from {target}",
    act_steal_solo: "{name} devoured spirit",
    act_steal_burden_heavy:
      "{base}—the karma grew heavier, and the daily toll rose further",
    act_steal_burden:
      "{base}—as the price of the taboo, the daily toll grew heavier",
    act_follow: "{name} nestled close to {target}",
    act_follow_solo: "{name} searched for someone to stay close to",
    act_purify: "{name} quelled the turmoil at {place}",
    act_purify_pray: "{name} prayed quietly at {place}",
    act_default: "{name} passed the day",
    act_frenzy_suffix: "{story}—the frenzy unquelled still",
    brief_died: "spent the last of their strength…",
    brief_follow_move: "to {place}, after {target}",
    brief_move: "to {place}",
    brief_forage_taboo: "a taboo deed",
    brief_forage: "gathered spirit",
    brief_rest: "calmed the spirit",
    brief_talk: "spoke to {target}",
    brief_talk_solo: "murmured alone",
    brief_share: "shared with {target}",
    brief_share_solo: "tried to share",
    brief_steal: "devoured from {target}—karma grows heavier",
    brief_steal_solo: "devoured—karma grows heavier",
    brief_follow: "stayed close to {target}",
    brief_follow_solo: "searched for someone to stay close to",
    brief_purify: "quelled the turmoil",
    brief_purify_pray: "prayed quietly",
    brief_default: "passed the day",
    brief_frenzy: "🔥frenzy",
    montage_low_sep: "… ",
    hl_count: "{n}",
    hl_loop_showcase: "🎬 Loop {n} highlights",
    hl_chronicle: "📜 Chronicle across loops",
    hl_empty_loop: "Highlights for this loop are yet to come",
    hl_empty_chronicle: "No milestones yet",
    hlx_meta_skill: "Haru mastered {skills}",
    hlx_meta_unlock: "{chars} unlocked (appear next loop)",
    hlx_meta_stage: "Haru first reaches “{stage}”",
    hlx_record: "New survival record ({n} days)",
    hlx_regress: "Haru falls",
    hlx_regress_at: "Haru falls at {place}",
    hlx_death: "{chars} fall",
    hlx_skill: "Mastered {skills}",
    hlx_unlock: "Unlocked {chars}",
    hlx_stage: "Haru: {stageBefore}→{stageAfter}",
    hlx_world_event: "{events} strikes",
    hlx_taboo_touch: "Touches a taboo",
    hlx_taboo_touch_at: "Touches a taboo at {place}",
    hlx_steal: "{chars} devours spirit (taboo)",
    hlx_steal_from: "{chars} devours spirit from {from} (taboo)",
    hlx_frenzy_became: "{chars} falls into frenzy (transformation)",
    hlx_frenzy_quelled: "{chars} quells the frenzy",
    hlx_peril: "Haru at the brink (spirit power {n})",
    hlx_dialogue: "Conversation: {chars}",
    hlx_dialogue_solo: "A dialogue",
    hlx_scene_meet: "{chars} meet at {place}",
    hlx_scene_moves: "Moves: {moves}",
    map_forage: "Harvest: clear {normal} / lean {lean}",
    param_axis: "Axis",
    card_spotlight: "🎥 Lead",
    param_altruism: "Altruism",
    param_independence: "Independence",
    param_trust: "Trust",
    frenzy_became: "⚡ Transformed! Fell into frenzy",
    frenzy_quelled: "🕊️ The frenzy was quelled",
    frenzy_active: "🔥 Frenzy (transformed)",
    frenzy_lv: " Lv{n}",
    frenzy_burden: " / pending karma {n}",
    moved_from: "moved from {place}",
    energy_label: "Energy",
    mood_section: "Mood",
    mood_elation: "Elation",
    mood_warmth: "Warmth",
    mood_calm: "Calm",
    mood_stress: "Stress",
    ab_section: "Fatigue (antibodies)",
    ab_achievement: "Achievement",
    ab_bond: "Bond",
    ab_comfort: "Comfort",
    ab_thrill: "Transgression",
    ab_title: "Habituation to the {label} reward: {v}",
    rewards_section: "Rewards today",
    diary_mark: "Diary",
    diary_empty: "(none yet)",
    dead_banner: "Spent their strength",
    back_home: "← Home",
    talent_insight: "Insight (reads spirit veins)",
    talent_bond: "Bond (heals the land)",
    talent_devour: "Devour (eats spirit)",
    talent_none: "—",
    char_loop_meta: "{days} days · peak altruism {peak} · {stage}",
    char_meta_frenzy: " · 🔥frenzy",
    char_meta_died: " · spent their strength",
    char_day_transform: "⚡transform",
    char_day_end: "— vanished here",
    badge_locked: "Locked",
    badge_hero: "Protagonist",
    locked_empty: "One who has not yet appeared in Kyoto.",
    unlock_cond: "Unlock conditions",
    unlock_unknown: "The conditions for this one to appear are still in the mist.",
    unlock_now:
      "Now: Loop {loop} / Haru's skills {skills} / peak altruism {peak}",
    char_talent: "Talent: {label}",
    char_lesson: "Life lesson: {lesson}",
    load_failed: "Failed to load: {error}",
    char_not_appeared: "This character has not appeared yet.",
    loops_live: "In progress",
    loops_reached: "Reached: {stage} (altruism {alt})",
    loops_skills: "✨ {skills}",
    loops_elapsed: "{n} days elapsed",
    loop_select_label: "Jump to a loop",
    loop_survived: "Survived {n} days",
    loop_no_record: "No records for this loop.",
    loop_end_cleared: "Warded off the Calamity and severed the cycle of regression",
    loop_end_died: "Fell, strength spent",
    loop_end_died_at: "Fell at {place}, strength spent",
    scope_loop: "Per loop",
    scope_career: "Lifetime",
    skill_done: "Mastered",
    skills_title: "✨ Acquired skills",
    skills_count: "{n} / {total} mastered",
    skills_lead:
      "Memories, growth, and talents all reset with each loop—only the skills listed here persist across loops. Haru acquires one the moment its conditions are met, and it keeps working across every loop thereafter.",
    souls_title: "💞 Hearts",
    souls_lead:
      "As the experience of receiving shared spirit power accumulates, a “heart of altruism” sprouts within a spirit. Once sprouted, it joins their judgment and inclines them toward sharing, talking, and staying close. Unlike acquired skills, every character has this, but only the protagonist Haru carries it across loops (other spirits reset to blank each loop).",
    souls_kinds_head: "Kinds of heart",
    souls_now_head: "Each one's heart now",
    souls_empty: "No one has appeared yet.",
    souls_scope_now: "This loop",
    souls_kind_desc: "Grows as {source} accumulates.",
    souls_stage_item: "{label} ({n}+)",
    souls_stage_prefix: "{label} · ",
    souls_count_times: "{n}×",
    tlog_empty: "Nothing has happened yet. Press “Next day” to begin.",
    tlog_weather_normal: "Clear",
    tlog_weather_lean: "Lean",
    tlog_event_new: "(new)",
    tlog_event_progress: "({n}/{total})",
    tlog_event_title: "Day {n} / {total} total",
    tlog_mark_skill: "✨ Haru mastered {skills}",
    tlog_mark_unlock: "🆕 {names} unlocked (appears next loop)",
    tlog_mark_regress: "↻ Haru's strength fails; time rewinds",
    tlog_spotlight_label: "Today's lead: ",
    tlog_intent: "Direction: {intent}",
    tlog_forage_op: " (harvest tweak {ops})",
    tlog_whisper_to: "Guardian→{name}",
    tlog_moved: "moved {from}→{to}",
    tlog_impulse: "Impulse",
    tlog_stage: "Stage: {before}→{after}",
    tlog_frenzy: "Frenzy {n}",
    tlog_frenzy_active: " [transformed]",
    tlog_frenzy_became: " ⚡transform!",
    tlog_frenzy_burden: " karma+{n}",
    tlog_quelled: "🕊️ Quelled the frenzy!",
    tlog_faced: "Faced and purified the frenzied one",
    tlog_notable_label: "Notable: ",
    tlog_timing_head: "⏱ LLM {n} calls / total {total}",
    tlog_timing_slow: "slowest {label} {ms}",
    tlog_timing_fail: "{n} failed (retried)",
    tlog_timing_group_title: "{count} calls / max {max}",
  },
} satisfies Record<Lang, Record<string, string>>;

export type UiKey = keyof (typeof UI)["ja"];

// ───────────────────────────────────────────────────────────────────────────
// ドメイン名の英訳（日本語は domain 定義が source of truth。ここは英語の表示派生のみ）。
// 日本語表示は従来どおり util.ts のヘルパ（domain 定義）から引く。
// ───────────────────────────────────────────────────────────────────────────

const CHAR_EN: Record<string, string> = {
  haru: "Haru",
  nagi: "Nagi",
  kai: "Kai",
  sora: "Sora",
  shiori: "Shiori",
};

const PLACE_EN: Record<string, string> = {
  kamogawa: "Kamo Riverbank",
  ohara: "Ohara Hidden Village",
  kibune: "Kibune Ravine",
  arashiyama: "Arashiyama Bamboo Grove",
  fushimi: "Fushimi Inari",
};

const ACTION_EN: Record<string, string> = {
  forage: "Gather spirit",
  rest: "Calm the spirit",
  share: "Share power",
  talk: "Speak",
  steal: "Devour spirit (taboo)",
  move: "Move",
  follow: "Stay close",
  purify: "Purify",
};

const SKILL_EN: Record<string, string> = {
  share_taste: "Taste of Sharing",
  insight_edge: "Keen Sight",
  beyond_hunger: "Beyond Hunger",
  binding_hands: "Binding Hands",
  sever_solitude: "Sever Solitude",
  warded_heart: "Unyielding Core",
  ward_basics: "Ward Basics",
  ward_vigil: "Clarity of Stillness",
  ward_bonds: "Warmth of Bonds",
  ward_resolve: "Selfless Guard",
  quell_art: "Art of Quelling",
  never_dry: "Unfailing Hands",
};

const EVENT_EN: Record<string, string> = {
  famine: "Great Famine",
  plague: "Plague",
  coldRain: "Cold Rains",
  bounty: "Bounty",
  calamity: "The Calamity",
};

const STAGE_EN: Record<string, string> = {
  芽生え: "Sprouting",
  揺らぎ: "Wavering",
  成熟: "Maturity",
};

// ココロ（soul.ts）。表示名・芽生える経験・段階名の英訳（prompt は LLM 注入用で非表示＝対象外）。
const SOUL_KIND_EN: Record<string, string> = {
  altruism: "Heart of Altruism",
};
const SOUL_SOURCE_EN: Record<string, string> = {
  altruism: "receiving shared spirit power",
};
const SOUL_STAGE_EN: Record<string, string> = {
  芽生え: "Sprouting",
  温む: "Warming",
  満ちる: "Full",
};

// ───────────────────────────────────────────────────────────────────────────
// ドメイン定義の長文（場所の説明・スキル説明・キャラの core/処世術・解放条件）の英訳。
// 日本語は domain 定義（places.ts / skills.ts / characters.ts）が source of truth。
// ここは id をキーにした英語の表示派生のみ（フェーズ1.5）。
// ───────────────────────────────────────────────────────────────────────────

const PLACE_DESC_EN: Record<string, string> = {
  kamogawa:
    "The shore where humans and spirits mingle. The busiest crossing of common folk, where calm and turmoil blend alike—a pivotal thoroughfare on the way to anywhere.",
  ohara:
    "A village opening among the northern hills of Kyoto. Filled with the clear air of prayer and daily life, rich in calm. Peaceful, though few people pass through.",
  kibune:
    "Deep beyond Kurama, a valley of clear streams where the water god dwells. Its calm is pure and steady, but remote and thin. A place of stillness.",
  arashiyama:
    "The western outskirts, land of the Hozu River and bamboo spirits. Travelers come and go, with calm and turmoil mingling in moderation.",
  fushimi:
    "The fox land to the south. Human desire and prayer swirl here, and turmoil gathers thick. Its spirit power is great and fierce but its calm is thin—a land where raging divine force whirls.",
};

const SKILL_DESC_EN: Record<string, string> = {
  share_taste:
    "Acquired by sharing spirit power 3 times within a single loop. Thereafter, the self-cost of sharing is lighter.",
  insight_edge:
    "Acquired by gathering spirit 30 times in total (accumulates across loops). The eye that reads spirit veins sharpens, raising the harvest from gathering by +15%.",
  beyond_hunger:
    "Acquired by surviving the brink of starvation (spirit power 12 or below) 3 times within a single loop. The daily toll is lighter by 1.",
  binding_hands:
    "Acquired when speaking touches another's heart 5 times in total (accumulates across loops). From the next loop on, you awaken with +10 trust.",
  sever_solitude:
    "Acquired by reaching, even once, a loop where altruism attains “Maturity” (70 or above). From the next loop on, you awaken with +10 spirit power.",
  warded_heart:
    "Acquired when your spirit power is stolen 3 times in total (accumulates across loops). A core inured to being robbed repels defilement, so thereafter the loss of spirit power and stress from being stolen from are halved.",
  ward_basics:
    "Acquired by purifying 8 times in total (accumulates across loops). The hand that quells troubled land becomes the basis of a ward: +14 ward power against the Calamity.",
  ward_vigil:
    "Acquired by stilling yourself and resting 10 times in total (accumulates across loops). Clear stillness settles into the body: recovery from resting is +4 thereafter.",
  ward_bonds:
    "Acquired by sharing spirit power 12 times in total (accumulates across loops). The warmth of what was shared lodges in the soul: from the next loop on, you awaken with +5 altruism.",
  ward_resolve:
    "Only the closeness of one who has met every companion and whose Heart of Altruism is Full can become nourishment. In that state, stay close to someone 6 times in total to acquire (accumulates across loops). The resolve to sever the cycle weaves the ward: +18 ward power against the Calamity.",
  quell_art:
    "Acquired by facing the frenzied half-spirit in the same sacred land and purifying it 5 times in total (accumulates across loops; days you fail to quell still count). Grants +14 quelling power to undo a frenzy.",
  never_dry:
    "Acquired by receiving another's sharing 5 times in total (accumulates across loops). Thereafter, when Haru is given spirit power, he returns spirit power to the one who gave at their own expense (+10 spirit return), so they never run dry.",
};

const CHAR_CORE_EN: Record<string, string> = {
  haru:
    "A spirit of purification who hates the monopoly of spirit veins. Calm and of few words.",
  nagi:
    "A binding-spirit of miko (shrine-maiden) lineage who fears abandonment above all. Bright and caring.",
  kai: "A starving half-spirit who devours spirits to survive. Trusts no one.",
  sora:
    "A wandering spirit who puts down roots nowhere. He comes and goes, laughing at attachment.",
  shiori:
    "A shrine-guardian envoy bound by an old promise. Deeply dutiful, and unforgiving of herself.",
};

const CHAR_LESSON_EN: Record<string, string> = {
  haru: "So he ties himself to no one, and lives taking only his own share.",
  nagi: "So she devotes herself to others, heals spirits, and strives to stay needed.",
  kai: "Trust, and you are devoured. So devour first.",
  sora: "Stay, and you lose. So he puts down no roots and lives like the wind.",
  shiori: "Only the promise governs her. So she will not bend the code.",
};

const UNLOCK_REQ_EN: Record<string, string> = {
  nagi: "Haru masters 1 skill",
  kai: "Haru's altruism reaches Maturity (70+) / masters “Sever Solitude” / masters 3 skills (any one)",
  sora: "Reach loop 7 and master 4 skills, including “Keen Sight”",
  shiori: "Master “Binding Hands” and master 5 skills",
};

const UNLOCK_DESC_EN: Record<string, string> = {
  nagi: "When Haru gains even one power (skill) to survive alone, the binding-spirit appears in Kyoto.",
  kai: "Once Haru breaks his shell and his altruism reaches maturity, he comes to face the half-spirit who trusts no one.",
  sora: "Rumors of Haru, who never halts even across many loops, blow the wandering spirit toward Kyoto.",
  shiori: "When Haru learns the hand that binds hearts, the envoy who cannot abandon her ruined shrine appears, relying on his lead.",
};

// 警告済みキーの記録。ポーリングで毎レンダリング走るので、同じ未登録キーを
// 何度も warn して devtools を溢れさせない（可視化は1回で十分）。
const warnedKeys = new Set<string>();

// id→英語ラベルの引き当て。未登録なら warn して日本語フォールバック（黙って既定化しない）。
function pickEn(
  table: Record<string, string>,
  id: string,
  jaFallback: string,
  kind: string,
): string {
  const en = table[id];
  if (en !== undefined) return en;
  const wk = `${kind}.${id}`;
  if (!warnedKeys.has(wk)) {
    warnedKeys.add(wk);
    console.warn(`[i18n] 英訳が未登録です: ${wk}（日本語表示にフォールバック）`);
  }
  return jaFallback;
}

// ───────────────────────────────────────────────────────────────────────────
// Context / hooks
// ───────────────────────────────────────────────────────────────────────────

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const LangContext = createContext<LangCtx>({ lang: "ja", setLang: () => {} });

function isLang(v: string | null): v is Lang {
  return v === "en" || v === "ja";
}

function readInitialLang(): Lang {
  if (typeof window === "undefined") return "ja";
  // 優先順位: URL(?lang) > ブラウザ言語（ja 系なら ja、それ以外は en）。localStorage は使わない。
  // 副作用なしの純粋な判定のみ。URL への書き込みは LangProvider の useEffect が行う。
  const q = new URL(window.location.href).searchParams.get("lang");
  if (isLang(q)) return q;
  return (navigator.language ?? "").toLowerCase().startsWith("ja") ? "ja" : "en";
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);
  // URL の ?lang を現在言語に同期する。?lang 未指定で開かれた初回も、ここでブラウザ言語の
  // 判定結果が書き込まれて「リダイレクト」相当になる。現在ページ（ハッシュ）は保ったまま
  // クエリだけ書き換え、履歴は汚さない（replaceState）。リロードや共有時にこの言語で開ける。
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", lang);
    window.history.replaceState(null, "", url.toString());
    // <html lang> も現在言語に同期する（静的既定は OGP の英語優先に合わせ "en"。
    // 日本語で表示しているのに lang="en" のままだと支援技術や翻訳機能が誤動作するため）。
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => setLangState(l), []);
  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangCtx {
  return useContext(LangContext);
}

/** 静的UI文字列を引く。t("countdown", { n: 5 }) で {n} を差し込む。 */
export function useT() {
  const { lang } = useLang();
  return useCallback(
    (key: UiKey, vars?: Record<string, string | number>): string => {
      let s: string = UI[lang][key];
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replaceAll(`{${k}}`, String(v));
        }
      }
      return s;
    },
    [lang],
  );
}

/** ドメイン名の言語別ヘルパ。ja は domain 定義（jaName）を、en は英訳テーブルを使う。 */
export function useDomainNames() {
  const { lang } = useLang();
  return {
    char: (id: string, jaName: string) =>
      lang === "en" ? pickEn(CHAR_EN, id, jaName, "char") : jaName,
    place: (id: string, jaName: string) =>
      lang === "en" ? pickEn(PLACE_EN, id, jaName, "place") : jaName,
    action: (action: string, jaLabel: string) =>
      lang === "en" ? pickEn(ACTION_EN, action, jaLabel, "action") : jaLabel,
    skill: (id: string, jaName: string) =>
      lang === "en" ? pickEn(SKILL_EN, id, jaName, "skill") : jaName,
    event: (kind: string, jaName: string) =>
      lang === "en" ? pickEn(EVENT_EN, kind, jaName, "event") : jaName,
    stage: (jaStage: string) =>
      lang === "en" ? pickEn(STAGE_EN, jaStage, jaStage, "stage") : jaStage,
    soulKind: (id: string, jaLabel: string) =>
      lang === "en" ? pickEn(SOUL_KIND_EN, id, jaLabel, "soulKind") : jaLabel,
    soulSource: (id: string, jaSource: string) =>
      lang === "en" ? pickEn(SOUL_SOURCE_EN, id, jaSource, "soulSource") : jaSource,
    soulStage: (jaStage: string) =>
      lang === "en" ? pickEn(SOUL_STAGE_EN, jaStage, jaStage, "soulStage") : jaStage,
    // ドメイン定義の長文（id 起点）。ja は元の日本語固定文をそのまま返す。
    placeDesc: (id: string, jaDesc: string) =>
      lang === "en" ? pickEn(PLACE_DESC_EN, id, jaDesc, "placeDesc") : jaDesc,
    skillDesc: (id: string, jaDesc: string) =>
      lang === "en" ? pickEn(SKILL_DESC_EN, id, jaDesc, "skillDesc") : jaDesc,
    charCore: (id: string, jaCore: string) =>
      lang === "en" ? pickEn(CHAR_CORE_EN, id, jaCore, "charCore") : jaCore,
    charLesson: (id: string, jaLesson: string) =>
      lang === "en" ? pickEn(CHAR_LESSON_EN, id, jaLesson, "charLesson") : jaLesson,
    unlockReq: (id: string, jaReq: string) =>
      lang === "en" ? pickEn(UNLOCK_REQ_EN, id, jaReq, "unlockReq") : jaReq,
    unlockDesc: (id: string, jaDesc: string) =>
      lang === "en" ? pickEn(UNLOCK_DESC_EN, id, jaDesc, "unlockDesc") : jaDesc,
    // 表示名（日本語）しか手元に無いとき用（TickResult の acquiredSkills/unlockedCharacters は
    // 表示名で載る）。名前→id 逆引きしてから英訳テーブルへ橋渡しする。
    skillByName: (jaName: string) => {
      if (lang !== "en") return jaName;
      const id = skillIdByName(jaName);
      return id ? pickEn(SKILL_EN, id, jaName, "skill") : jaName;
    },
    charByName: (jaName: string) => {
      if (lang !== "en") return jaName;
      const id = charIdByName(jaName);
      return id ? pickEn(CHAR_EN, id, jaName, "char") : jaName;
    },
  };
}

/** リスト連結の区切り。汎用リストとスキル名（日本語は「」で括る）で分ける。 */
export function useSep() {
  const { lang } = useLang();
  return {
    list: lang === "en" ? ", " : "・",
    skills: lang === "en" ? ", " : "」「",
  };
}

/**
 * 回帰の結末文を言語別に組み立てる。
 * JP は causeOfEnd（domain が source of truth）をそのまま使い、EN は構造化（endKind/endPlaceId）から組む。
 * 構造化を持たない旧 run は JP（causeOfEnd）へフォールバックし、warn で1度だけ可視化する。
 */
export function useLoopEnd() {
  const { lang } = useLang();
  const t = useT();
  const dn = useDomainNames();
  return (sum: {
    causeOfEnd: string;
    endKind?: "cleared" | "died";
    endPlaceId?: string;
  }): string => {
    if (lang !== "en") return sum.causeOfEnd;
    if (!sum.endKind) {
      if (!warnedKeys.has("loopEnd.legacy")) {
        warnedKeys.add("loopEnd.legacy");
        console.warn(
          "[i18n] 旧 run の結末（causeOfEnd）は構造化が無いため日本語表示にフォールバック",
        );
      }
      return sum.causeOfEnd;
    }
    if (sum.endKind === "cleared") return t("loop_end_cleared");
    return sum.endPlaceId
      ? t("loop_end_died_at", { place: dn.place(sum.endPlaceId, sum.endPlaceId) })
      : t("loop_end_died");
  };
}

/**
 * LLM 生成の多言語文（{ja,en}）を現在の言語で取り出す（フェーズ2）。
 * en が空のときは日本語へフォールバックし、warn で1度だけ可視化する（黙って既定化しない）。
 * 移行期の保険として素の string も受ける（その場合はそのまま）。
 */
export function useLocalized() {
  const { lang } = useLang();
  return (v: LocalizedText | string | undefined | null, what = "llm"): string => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (lang !== "en") return v.ja;
    if (v.en) return v.en;
    const wk = `localized.${what}`;
    if (!warnedKeys.has(wk)) {
      warnedKeys.add(wk);
      console.warn(`[i18n] 英訳が空のため日本語表示にフォールバック: ${what}`);
    }
    return v.ja;
  };
}

/**
 * 「この日の報酬」ラベルを現在の言語で組む。
 * ja は engine が組み立てた label（source of truth）をそのまま使い、
 * en は構造化 i18n（key＋placeId/charId/n）からテンプレ展開する（名前・地名は useDomainNames で英訳）。
 * 構造化を持たない旧データは label（日本語）へフォールバックし、en では warn で1度だけ可視化する。
 */
export function useReward() {
  const { lang } = useLang();
  const t = useT();
  const dn = useDomainNames();
  return (e: { label: string; i18n?: RewardI18n }): string => {
    if (lang !== "en") return e.label;
    const x = e.i18n;
    if (!x) {
      if (!warnedKeys.has("reward.legacy")) {
        warnedKeys.add("reward.legacy");
        console.warn("[i18n] 旧データの報酬ラベルは構造化が無いため日本語表示にフォールバック");
      }
      return e.label;
    }
    return t(x.key as UiKey, {
      place: x.placeId ? dn.place(x.placeId, x.placeId) : "",
      name: x.charId ? dn.char(x.charId, x.charName ?? "") : (x.charName ?? ""),
      n: x.n ?? 0,
    });
  };
}

/**
 * 一行日記を現在の言語で組む（フェーズ2）。本文は LLM の {ja,en}、
 * engine が行動を上書きした日の理由注記（衝動／分与）を言語別に前置する。
 */
export function useDiary() {
  const loc = useLocalized();
  const t = useT();
  return (
    entry: LocalizedText | string | undefined | null,
    note?: "impulse" | "gift" | null,
  ): string => {
    const body = loc(entry, "diary");
    if (!note) return body;
    const prefix = note === "impulse" ? t("diary_note_impulse") : t("diary_note_gift");
    return body ? `${prefix}${body}` : prefix.trimEnd();
  };
}

/**
 * 当日の変身・鎮静を観客向けの地の文に組む（決定的ルール文）。
 * 旧来 engine が narration に焼き込んでいたものを、名前の英訳のため UI 層へ移設。
 * LLM ナレーションの後ろに添える想定。該当が無ければ空文字。
 */
export function useFrenzyNarration() {
  const t = useT();
  const dn = useDomainNames();
  return (chars: CharacterTickResult[]): string => {
    const lines: string[] = [];
    const becamer = chars.find((r) => r.becameFrenzied);
    if (becamer) {
      lines.push(t("narr_frenzy_became", { name: dn.char(becamer.id, becamer.name) }));
    }
    // 荒ぶり継続中の所業（奪い・和みすら喰らう。変身当日は上で告げ済みなので除く）。
    const rampager = chars.find(
      (r) =>
        r.frenzyActive &&
        !r.becameFrenzied &&
        !r.died &&
        (r.action === "steal" || r.forageDraw?.taboo),
    );
    if (rampager) {
      const name = dn.char(rampager.id, rampager.name);
      if (rampager.action === "steal") {
        lines.push(
          rampager.targetName
            ? t("narr_frenzy_steal", {
                name,
                target: rampager.targetId
                  ? dn.char(rampager.targetId, rampager.targetName)
                  : rampager.targetName,
              })
            : t("narr_frenzy_steal_solo", { name }),
        );
      } else {
        lines.push(t("narr_frenzy_taboo", { name }));
      }
    }
    if (chars.some((r) => r.quelledFrenzy)) {
      const wild = chars.find((r) => r.frenzyLevel !== undefined);
      const who = wild
        ? t("mark_quell_wild", { name: dn.char(wild.id, wild.name) })
        : t("mark_quell_someone");
      lines.push(t("narr_quell", { who }));
    }
    return lines.join("\n");
  };
}

/**
 * ハイライト文（年代記・見せ場）を言語別に組み立てる。
 * 日本語は text（source of truth）をそのまま使い、EN は i18n 構造化（key＋素の値）から
 * テンプレ展開する。名前・場所・段階・イベントは useDomainNames が英訳する。
 * 構造化を持たない旧データ（永続 metaHighlights 等）は text（日本語）へフォールバックする。
 */
export function useHighlightText() {
  const { lang } = useLang();
  const t = useT();
  const dn = useDomainNames();
  const sep = useSep();
  return (h: { text: string; i18n?: HighlightI18n }): string => {
    if (lang !== "en") return h.text; // 日本語は組み立て済みの text をそのまま
    const x = h.i18n;
    if (!x) {
      if (!warnedKeys.has("highlight.legacy")) {
        warnedKeys.add("highlight.legacy");
        console.warn(
          "[i18n] 旧データのハイライトは構造化が無いため日本語表示にフォールバック",
        );
      }
      return h.text;
    }
    // scene は meets/moves から組む（単一テンプレに収まらないため別扱い）。
    if (x.key === "hlx_scene") {
      if (x.meets?.length) {
        return x.meets
          .map((m) =>
            t("hlx_scene_meet", {
              place: dn.place(m.placeId, m.placeId),
              chars: m.names.map((nm) => dn.charByName(nm)).join(sep.list),
            }),
          )
          .join(" / ");
      }
      if (x.moves?.length) {
        const moves = x.moves
          .map((mv) => `${dn.charByName(mv.name)}→${dn.place(mv.placeId, mv.placeId)}`)
          .join(", ");
        return t("hlx_scene_moves", { moves });
      }
      return h.text;
    }
    return t(x.key as UiKey, {
      skills: (x.skills ?? []).map((n) => dn.skillByName(n)).join(sep.skills),
      chars: (x.chars ?? []).map((n) => dn.charByName(n)).join(sep.list),
      place: x.placeId ? dn.place(x.placeId, x.placeId) : "",
      stage: x.stage ? dn.stage(x.stage) : "",
      stageBefore: x.stageBefore ? dn.stage(x.stageBefore) : "",
      stageAfter: x.stageAfter ? dn.stage(x.stageAfter) : "",
      events: (x.events ?? [])
        .map((e) => `${e.icon}${dn.event(e.kind, e.name)}`)
        .join(sep.list),
      from: x.fromName ? dn.charByName(x.fromName) : "",
      n: x.n ?? 0,
    });
  };
}

/**
 * 観客ビューの「物語文」を言語別に組み立てるヘルパ。
 * 分岐ロジックはここに集約し、文字列は UI（useT）テンプレートから引く。
 * 名前・地名は id 起点で useDomainNames が解決する（en は英訳、ja は元の日本語）。
 * 注意: 移動元は fromPlaceId があれば英訳。id を持たない旧データのみ日本語名へフォールバックする。
 */
export function useStory() {
  const t = useT();
  const dn = useDomainNames();

  const weatherWord = (weather: string): string => {
    if (weather === "normal") return t("scene_weather_normal");
    if (weather === "lean") return t("scene_weather_lean");
    return "";
  };

  // 数値は観客に見せず、ざっくりした体調語に落とす（しきい値は元実装のまま）。
  const vigor = (e: number): string => {
    if (e <= 10) return t("vigor_critical");
    if (e <= 25) return t("vigor_tired");
    if (e <= 55) return t("vigor_calm");
    return t("vigor_well");
  };

  const resolve = (c: CharacterTickResult) => ({
    name: dn.char(c.id, c.name),
    place: dn.place(c.placeId, c.placeName),
    target: c.targetId
      ? dn.char(c.targetId, c.targetName ?? "")
      : (c.targetName ?? ""),
    // fromPlaceId があれば英訳。無い旧データは日本語の fromPlaceName へフォールバック。
    from: c.fromPlaceId
      ? dn.place(c.fromPlaceId, c.fromPlaceName ?? "")
      : (c.fromPlaceName ?? ""),
  });

  const actStoryBase = (c: CharacterTickResult): string => {
    const { name, place, target, from } = resolve(c);
    if (c.died) return t("act_died", { name });
    if (c.moved)
      return c.action === "follow" && c.targetName
        ? t("act_follow_move", { name, target, place })
        : t("act_move", { name, from, place });
    switch (c.action) {
      case "forage": {
        const dr = c.forageDraw;
        if (dr?.taboo) return t("act_forage_taboo", { name, place });
        if (dr && dr.daku > 0 && dr.sei === 0)
          return t("act_forage_daku", { name, place });
        if (dr && dr.gain === 0) return t("act_forage_dry", { name });
        return t("act_forage", { name, place });
      }
      case "rest":
        return t("act_rest", { name });
      case "talk":
        return c.targetName
          ? t("act_talk", { name, target })
          : t("act_talk_solo", { name });
      case "share":
        return c.targetName
          ? t("act_share", { name, target })
          : t("act_share_solo", { name });
      case "steal": {
        const base = c.targetName
          ? t("act_steal", { name, target })
          : t("act_steal_solo", { name });
        return c.stealBurden > 1
          ? t("act_steal_burden_heavy", { base })
          : t("act_steal_burden", { base });
      }
      case "follow":
        return c.targetName
          ? t("act_follow", { name, target })
          : t("act_follow_solo", { name });
      case "purify":
        return (c.purifyCleansed ?? 1) > 0
          ? t("act_purify", { name, place })
          : t("act_purify_pray", { name, place });
      default:
        return t("act_default", { name });
    }
  };

  // 荒ぶり継続中の日だけ末尾に印を添える（変身当日は SceneMarks が大きく告げる）。
  const actStory = (c: CharacterTickResult): string => {
    const story = actStoryBase(c);
    if (!c.died && c.frenzyActive && !c.becameFrenzied) {
      return t("act_frenzy_suffix", { story });
    }
    return story;
  };

  // 早回し用の短い行為ラベル（名前は別に出すので動詞句だけ）。
  const briefAct = (c: CharacterTickResult): string => {
    const { place, target } = resolve(c);
    if (c.died) return t("brief_died");
    if (c.moved)
      return c.action === "follow" && c.targetName
        ? t("brief_follow_move", { target, place })
        : t("brief_move", { place });
    switch (c.action) {
      case "forage":
        return c.forageDraw?.taboo ? t("brief_forage_taboo") : t("brief_forage");
      case "rest":
        return t("brief_rest");
      case "talk":
        return c.targetName ? t("brief_talk", { target }) : t("brief_talk_solo");
      case "share":
        return c.targetName ? t("brief_share", { target }) : t("brief_share_solo");
      case "steal":
        return c.targetName ? t("brief_steal", { target }) : t("brief_steal_solo");
      case "follow":
        return c.targetName
          ? t("brief_follow", { target })
          : t("brief_follow_solo");
      case "purify":
        return (c.purifyCleansed ?? 1) > 0
          ? t("brief_purify")
          : t("brief_purify_pray");
      default:
        return t("brief_default");
    }
  };

  return { weatherWord, vigor, actStory, briefAct };
}

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
  useState,
  type ReactNode,
} from "react";
import type { CharacterTickResult } from "../domain/types.ts";

export type Lang = "ja" | "en";

// ───────────────────────────────────────────────────────────────────────────
// 静的UI文字列。{n} などのプレースホルダは t(key, { n }) で差し込む。
// ───────────────────────────────────────────────────────────────────────────
const UI = {
  ja: {
    nav_home: "ホーム",
    nav_status: "ステータス",
    nav_debug: "デバッグ",
    nav_loops: "回帰一覧",
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
    loops_title: "📜 回帰の年代記",
    loops_empty: "まだ記録がありません。ホームで物語を進めましょう。",
    loops_live: "進行中",
    loops_days: "{n} 日",
    loops_reached: "到達: {stage}（利他 {alt}）",
    loops_skills: "✨ {skills}",
    loops_elapsed: "{n} 日経過",
    back_loops: "← 回帰一覧",
    loop_survived: "生存 {n} 日",
    loop_no_record: "この回帰の記録はありません。",
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
    nav_loops: "Loops",
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
    loops_title: "📜 Chronicle of loops",
    loops_empty: "No records yet. Advance the story from Home.",
    loops_live: "In progress",
    loops_days: "{n} days",
    loops_reached: "Reached: {stage} (altruism {alt})",
    loops_skills: "✨ {skills}",
    loops_elapsed: "{n} days elapsed",
    back_loops: "← Loops",
    loop_survived: "Survived {n} days",
    loop_no_record: "No records for this loop.",
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
  ward_vigil: "Vigil of Stillness",
  ward_bonds: "Bonds of Warding",
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

// id→英語ラベルの引き当て。未登録なら warn して日本語フォールバック（黙って既定化しない）。
function pickEn(
  table: Record<string, string>,
  id: string,
  jaFallback: string,
  kind: string,
): string {
  const en = table[id];
  if (en) return en;
  console.warn(`[i18n] 英訳が未登録です: ${kind}.${id}（日本語表示にフォールバック）`);
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

const STORAGE_KEY = "ai-sim-lang";

function isLang(v: string | null): v is Lang {
  return v === "en" || v === "ja";
}

function readInitialLang(): Lang {
  if (typeof window === "undefined") return "ja";
  // 優先順位: URL(?lang) > localStorage > 既定(ja)。共有リンクで言語を固定できるよう URL を最優先。
  const q = new URLSearchParams(window.location.search).get("lang");
  if (isLang(q)) return q;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return isLang(saved) ? saved : "ja";
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);
  const setLang = useCallback((l: Lang) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, l);
      // URL の ?lang も同期する。現在ページ（ハッシュ）は保ったままクエリだけ書き換え、
      // 履歴は汚さない（replaceState）。リロードや共有時にこの言語で開ける。
      const url = new URL(window.location.href);
      url.searchParams.set("lang", l);
      window.history.replaceState(null, "", url.toString());
    }
    setLangState(l);
  }, []);
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

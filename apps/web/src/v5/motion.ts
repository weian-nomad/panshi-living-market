// V5 動效常數唯一 TS 正本。
//
// 數值全部來自 `docs/v5/visual-system.md`「Production token source」表
// （該表明文：「本檔是角色比例、場景密度與鏡頭時間的唯一 production source。
// 其他規格只能引用，不另設數值。」）。表中給區間的 token，本檔取區間內的固定
// production 值並在註解標出原區間；要調整先升 visual-system.md 版本再同步這裡。
//
// 其他前端檔案不得另設鏡頭／過場時間數字，一律 import 這裡的 const。
// 本檔刻意零 import：不依賴任何資料、契約或同層元件。

/** `gesture.follow_hold` = 180 ms —— 長按成立跟拍；人生誌不綁長按功能。 */
export const FOLLOW_HOLD_MS = 180;

/** `camera.follow_in` = 280–420 ms —— 取 340 ms；reduced motion 不使用縮放。 */
export const CAMERA_FOLLOW_IN_MS = 340;

/** `camera.follow_subject_height` = 38% —— 跟拍人物約占場景高度；窄螢幕仍保留環境。 */
export const FOLLOW_SUBJECT_HEIGHT = 0.38;

/** `camera.follow_handoff` = 240 ms —— 拖向注意對象後交接鏡頭。 */
export const FOLLOW_HANDOFF_MS = 240;

/** `camera.follow_release_hold` = 800 ms —— 放開後保留當前人物，再回全景。 */
export const FOLLOW_RELEASE_HOLD_MS = 800;

/** `camera.closeup_cta_persist` = 2 s —— 回全景後保留「再靠近一點」入口。 */
export const CLOSEUP_CTA_PERSIST_MS = 2000;

/** `motion.closeup_action_lead` = 600–900 ms —— 取 700 ms；近景先讓動作成立，再出人物文字。 */
export const CLOSEUP_ACTION_LEAD_MS = 700;

/** `transition.sprite_to_closeup` = 360–480 ms —— 取 420 ms；從世界 sprite 走近同一張臉。 */
export const SPRITE_TO_CLOSEUP_MS = 420;

/** `transition.enter_journal` = 600–900 ms —— 取 750 ms；可中途取消，不能遮住資料狀態。 */
export const ENTER_JOURNAL_MS = 750;

/** `transition.outcome_reveal` = 160–240 ms —— 取 200 ms；先人物事件，後顯示數字節點。 */
export const OUTCOME_REVEAL_MS = 200;

/** `motion.world_breath` = 8–12 s —— 取 10 s；角色沒有事件時不做誇張 idle。 */
export const WORLD_BREATH_MS = 10000;

/** `motion.market_signal_in_max` = 400 ms —— 冷色訊號只表示新事實抵達，不暗示好壞。 */
export const MARKET_SIGNAL_IN_MAX_MS = 400;

/** `motion.reduced_fade_max` = 120 ms —— reduced motion 只用淡入、描邊與狀態文字。 */
export const REDUCED_FADE_MAX_MS = 120;

/**
 * 跟拍時鏡頭外環境明度（`docs/v5/experience-spec.md`：「近景時，鏡頭外居民降到
 * 22% 明度，遠處字幕與姓名退場」）。跟拍有視野代價，不能同時監看所有人。
 */
export const OFFSCREEN_DIM_OPACITY = 0.22;

/**
 * `world.residents.edge_silhouette` = 0–4 —— 上限 4；剪影只在遠景邊緣出現，
 * 不承擔台詞、精細表情或跟拍入口。
 */
export const WORLD_RESIDENTS_EDGE_SILHOUETTE_MAX = 4;

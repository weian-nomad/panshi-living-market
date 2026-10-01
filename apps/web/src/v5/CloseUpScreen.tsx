// 人物近景（experience-spec.md §7）。
//
// 近景不是資料卡，是一個短場景，固定六段構圖：
//   1. 上方 55–60%：4:5 幾何近景 ＋ 一個持續微動作
//   2. 姓名／年齡／職業 ＋ 當下動詞
//   3. 一句尚未解決的矛盾
//   4. 只與當下故事直接相關的一項後果碎片
//   5. 主動作 `翻開今天的人生誌`
//   6. 次動作 `回到世界`、`記住這個人`，以及直接到他模擬紀錄的「持股與理由」
//      （世界 →（1）近景 →（2）模擬紀錄：成本、損益、原始理由與退出條件在同一頁）
//
// 揭露節奏（§7.2）：先看動作（`CLOSEUP_ACTION_LEAD_MS`），再出文字；名字先出、
// 數值後出（`OUTCOME_REVEAL_MS`）。**每個紙上數字旁都必須有 as_of**，一律用
// `formatAsOfIntraday()`，不自行推算日期。
//
// 資料身分**逐項**掛（AGENTS.md「Product invariants」：每一項對外可見的宣稱剛好一個
// `truth_class`）：姓名、年齡、職業、姿態、當下動詞、那句矛盾、後果碎片與承諾，
// 各自讀投影在那一項上給的身分（public-v2.yaml 2.1.0 的 `<欄位>TruthClass` 或物件的
// `truthClass`）。本檔沒有「哪一塊該是哪一種身分」的對照表。某一項缺身分、或身分
// 不在投影 `truthClasses` 裡時 fail closed：那一項不顯示並寫出原因，不改掛別的身分。
//
// 沒有模擬部位時改顯示工作／關係／記憶後果，不硬塞空績效（§7.2 最後一條）。
// reduced motion 時取消微動作，改用描邊與狀態文字（visual-system.md）。
// 「記住這個人」只寫 localStorage，不打後端（封測不接帳號流程）。

import { useEffect, useState, useSyncExternalStore } from "react";

import type {
  CharacterCloseUp,
  CharacterPoseState,
  RecentConsequenceHighlight,
  TruthClass,
  UnresolvedCommitment,
} from "../api/generated-v2/types.gen";
import { ClaimWithTruth, ItemTruthTag, WithheldClaim } from "./ItemTruthTag";
import { claimTruthClassOf, distinctTruthClasses } from "./claimTruth";
import { DATA_UNAVAILABLE_LABEL, formatAsOfIntraday, percentFixed2ToString, projectionVersionLabel } from "./format";
import { CLOSEUP_ACTION_LEAD_MS, OUTCOME_REVEAL_MS, WORLD_BREATH_MS } from "./motion";
import { figureGeometry } from "./scene";
import { SystemLabel } from "./SystemLabel";

/** 中性的可觀察姿態用語（public-v2.yaml：這組枚舉刻意不帶市場訊號）。 */
const POSE_LABEL: Readonly<Record<CharacterPoseState, string>> = {
  idle: "站著沒動",
  walking: "在走動",
  talking: "在說話",
  examining: "在端詳一份資料",
  interrupted: "動作被打斷",
  avoiding: "避開了某個方向",
  silent: "安靜著",
};

const PORTRAIT_WIDTH = 80;
const PORTRAIT_HEIGHT = 100;

const STYLES = `
.v5-closeup { margin: 0 0 16px; }
.v5-closeup__portrait {
  position: relative;
  width: 100%;
  max-width: 26rem;
  aspect-ratio: 4 / 5;
  border: 1px solid var(--rule-paper);
  background: var(--surface-panel);
  overflow: hidden;
}
.v5-closeup__portrait svg { display: block; width: 100%; height: 100%; }
.v5-closeup__pose {
  margin: .35rem 0 .9rem;
  font-size: .78rem;
  color: var(--copper-500);
}
.v5-closeup__identity { margin: .9rem 0 .1rem; font-size: 1.15rem; font-weight: 500; }
.v5-closeup__verb { margin: 0 0 .9rem; color: var(--copper-500); }
.v5-closeup__tension {
  margin: 0 0 1rem;
  font-size: 1.02rem;
  padding-inline-start: .75rem;
  border-inline-start: 2px solid var(--copper-500);
}
.v5-closeup__consequence {
  margin: 0 0 1rem;
  padding: .6rem .75rem;
  border: 1px solid var(--rule-paper);
}
.v5-closeup__figure { margin: 0; display: flex; flex-wrap: wrap; gap: .2rem .8rem; align-items: baseline; }
.v5-closeup__asof { font-size: .76rem; color: var(--copper-500); }
.v5-closeup__actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 1rem 0 0; }
.v5-closeup__actions button {
  min-height: 44px;
  padding: .4em 1.1em;
  border: 1px solid var(--copper-500);
  border-radius: 2px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.v5-closeup__actions button[data-role="primary"] { border-width: 2px; font-weight: 500; }
.v5-closeup__actions button:focus-visible { outline: 2px solid var(--signal-420); outline-offset: 2px; }
.v5-closeup__actions a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  padding: .4em 1.1em;
  border: 1px solid var(--copper-500);
  border-radius: 2px;
  color: inherit;
}
.v5-closeup__actions a:focus-visible { outline: 2px solid var(--signal-420); outline-offset: 2px; }
.v5-closeup__note { margin: .8rem 0 0; font-size: .8rem; color: var(--copper-500); }
@keyframes v5-closeup-glance {
  0%, 78%, 100% { transform: translate(0, 0); }
  86% { transform: translate(-.6%, -.9%); }
}
`;

const REMEMBERED_STORAGE_KEY = "panshi.v5.remembered-characters";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function readReducedMotion(): boolean {
  // 判不出來就當成使用者要求減少動態（fail closed 到最安靜的一邊）。
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function readRemembered(): string[] {
  try {
    const raw = window.localStorage.getItem(REMEMBERED_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeRemembered(ids: readonly string[]): boolean {
  try {
    window.localStorage.setItem(REMEMBERED_STORAGE_KEY, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

function safeAsOf(iso: string): string {
  try {
    return formatAsOfIntraday(iso);
  } catch {
    return DATA_UNAVAILABLE_LABEL;
  }
}

function safePercent(value: number): string {
  try {
    return percentFixed2ToString(value);
  } catch {
    return DATA_UNAVAILABLE_LABEL;
  }
}

/** 4:5 幾何近景。無圖片資產：同一個 `figureGeometry` 放大，維持同一個人的比例。 */
function Portrait({ reducedMotion }: { reducedMotion: boolean }) {
  const geometry = figureGeometry(PORTRAIT_WIDTH / 2, PORTRAIT_HEIGHT - 6, PORTRAIT_HEIGHT * 0.86);

  return (
    <svg
      viewBox={`0 0 ${PORTRAIT_WIDTH} ${PORTRAIT_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="presentation"
    >
      {/* 環境：一面暖紙牆光與一條氧化銅桌緣，維持與世界同一個空間語彙。 */}
      <rect x="0" y="0" width={PORTRAIT_WIDTH} height={PORTRAIT_HEIGHT} fill="var(--ink-900)" />
      <polygon
        points={`14,0 46,0 58,${PORTRAIT_HEIGHT} 4,${PORTRAIT_HEIGHT}`}
        fill="var(--paper-100)"
        opacity="0.07"
      />
      <line
        x1="0"
        y1={PORTRAIT_HEIGHT - 18}
        x2={PORTRAIT_WIDTH}
        y2={PORTRAIT_HEIGHT - 22}
        stroke="var(--copper-500)"
        strokeWidth="0.4"
        opacity="0.8"
      />
      <ellipse
        cx={geometry.contact.cx}
        cy={geometry.contact.cy}
        rx={geometry.contact.rx}
        ry={geometry.contact.ry}
        fill="var(--ink-1000)"
        opacity="0.6"
      />
      <polygon points={geometry.torso} fill="var(--paper-260)" opacity="0.92" />
      {geometry.legs.map((leg, index) => (
        <rect
          key={`closeup-leg-${index}`}
          x={leg.x}
          y={leg.y}
          width={leg.width}
          height={leg.height}
          fill="var(--ink-760)"
        />
      ))}
      <circle
        cx={geometry.head.cx}
        cy={geometry.head.cy}
        r={geometry.head.r}
        fill="var(--paper-260)"
        stroke={reducedMotion ? "var(--copper-500)" : "none"}
        strokeWidth={reducedMotion ? 0.6 : 0}
      />
      {/* 持續微動作：手與紙張的偷瞄節奏。reduced motion 時不動，改用描邊與狀態文字。 */}
      <g
        className="panshi-motion"
        style={
          reducedMotion
            ? undefined
            : {
                transformBox: "fill-box",
                transformOrigin: "center",
                animation: `v5-closeup-glance ${WORLD_BREATH_MS}ms ease-in-out infinite`,
              }
        }
      >
        <polyline
          points={geometry.arm}
          fill="none"
          stroke="var(--paper-260)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <rect
          x={geometry.prop.x}
          y={geometry.prop.y}
          width={geometry.prop.width}
          height={geometry.prop.height}
          fill="var(--copper-500)"
          stroke={reducedMotion ? "var(--paper-260)" : "none"}
          strokeWidth={reducedMotion ? 0.4 : 0}
        />
      </g>
    </svg>
  );
}

/** 一項後果碎片。紙上數字一律附 as_of；沒有紙上後果就換成工作／關係／記憶。 */
function ConsequenceFragment({
  highlight,
  fallbackCommitment,
  showValues,
  declared,
  versionLabel,
  serverNow,
}: {
  highlight: RecentConsequenceHighlight | undefined;
  fallbackCommitment: UnresolvedCommitment | null;
  showValues: boolean;
  declared: readonly TruthClass[];
  versionLabel: string;
  serverNow: string;
}) {
  if (!highlight) {
    // 沒有碎片時，只有投影自己給的承諾（帶它自己的身分）可以頂上；什麼都沒有就是
    // 固定的空狀態說明，它不是一項關於他的宣稱，所以不掛身分。
    return (
      <div className="v5-closeup__consequence">
        {fallbackCommitment === null ? (
          <p className="panshi-paper">他目前沒有模擬持倉。沒下手，也是今天的一部分。</p>
        ) : (
          <ClaimWithTruth
            truthClass={fallbackCommitment.truthClass}
            declared={declared}
            asOfLabel={safeAsOf(fallbackCommitment.sealedAt)}
            versionLabel={versionLabel}
          >
            <p className="panshi-paper">{fallbackCommitment.rationaleSummary}</p>
          </ClaimWithTruth>
        )}
      </div>
    );
  }

  // 紙上碎片的資料時間是它自己的 as_of；其餘碎片沒有市場數字，用投影時間。
  const asOfLabel = highlight.kind === "paper_position" ? safeAsOf(highlight.asOf) : safeAsOf(serverNow);

  return (
    <div className="v5-closeup__consequence">
      <ClaimWithTruth
        truthClass={highlight.truthClass}
        declared={declared}
        asOfLabel={asOfLabel}
        versionLabel={versionLabel}
      >
        {highlight.kind === "paper_position" ? (
          <p className="v5-closeup__figure">
            <span className="panshi-paper">模擬損益</span>
            <span className="panshi-data">
              {showValues ? safePercent(highlight.unrealizedPnlPercentFixed2) : ""}
            </span>
            <span className="v5-closeup__asof panshi-data">{safeAsOf(highlight.asOf)}</span>
          </p>
        ) : (
          <p className="panshi-paper">{highlight.summary}</p>
        )}
      </ClaimWithTruth>
    </div>
  );
}

/**
 * 姓名、年齡、職業同一行。三個欄位各自過身分閘門：缺身分的欄位不顯示，並在下方寫出原因；
 * 其餘欄位照常顯示。三者身分相同時共用一顆標籤，不同時每種各一顆。
 */
function IdentityLine({
  closeUp,
  asOfLabel,
  versionLabel,
}: {
  closeUp: CharacterCloseUp;
  asOfLabel: string;
  versionLabel: string;
}) {
  const declared = closeUp.truthClasses;
  const name = claimTruthClassOf(closeUp.displayNameTruthClass, declared);
  const age = claimTruthClassOf(closeUp.ageYearsTruthClass, declared);
  const occupation = claimTruthClassOf(closeUp.occupationLabelTruthClass, declared);
  const head = [
    name === null ? null : closeUp.displayName,
    age === null ? null : `${closeUp.ageYears} 歲`,
  ]
    .filter((part): part is string => part !== null)
    .join("，");
  const text = [head, occupation === null ? "" : closeUp.occupationLabel]
    .filter((part) => part.length > 0)
    .join("　");
  const classes = [name, age, occupation];

  return (
    <>
      {text.length === 0 ? null : <h2 className="v5-closeup__identity">{text}</h2>}
      {distinctTruthClasses(classes).map((truthClass) => (
        <ItemTruthTag key={truthClass} truthClass={truthClass} asOfLabel={asOfLabel} versionLabel={versionLabel} />
      ))}
      {classes.includes(null) ? <WithheldClaim className="v5-closeup__note" /> : null}
    </>
  );
}

export type CloseUpScreenProps = {
  closeUp: CharacterCloseUp;
  onOpenJournal: () => void;
  onBackToWorld: () => void;
  /** 這個人的模擬紀錄路徑（`/people/{id}/archive/paper`）；不給就不顯示入口。 */
  paperHref?: string;
  onOpenPaper?: () => void;
};

export function CloseUpScreen({
  closeUp,
  onOpenJournal,
  onBackToWorld,
  paperHref,
  onOpenPaper,
}: CloseUpScreenProps) {
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => true);
  const [revealText, setRevealText] = useState(false);
  const [revealValues, setRevealValues] = useState(false);
  const [remembered, setRemembered] = useState(false);
  const [rememberFailed, setRememberFailed] = useState(false);

  useEffect(() => {
    setRemembered(readRemembered().includes(closeUp.characterId));
  }, [closeUp.characterId]);

  useEffect(() => {
    if (reducedMotion) {
      // 不做鏡頭節奏時，文字與數值一起到位，避免內容看起來像卡住。
      setRevealText(true);
      setRevealValues(true);
      return;
    }
    setRevealText(false);
    setRevealValues(false);
    const textTimer = window.setTimeout(() => setRevealText(true), CLOSEUP_ACTION_LEAD_MS);
    const valueTimer = window.setTimeout(
      () => setRevealValues(true),
      CLOSEUP_ACTION_LEAD_MS + OUTCOME_REVEAL_MS,
    );
    return () => {
      window.clearTimeout(textTimer);
      window.clearTimeout(valueTimer);
    };
  }, [reducedMotion, closeUp.characterId]);

  const fallbackCommitment = closeUp.unresolvedCommitments[0] ?? null;
  // public-v2 3.0.0：kill switch 暫停這一頁的「今天」層時，動作句、矛盾、後果碎片與
  // 承諾都不在投影裡。這裡只畫投影給的固定系統說明，不畫「他目前沒有模擬持倉」之類
  // 的中性句，也不把缺席的宣稱畫成「缺少資料身分」。
  const closure =
    typeof closeUp.marketClosureReasonLabel === "string" ? closeUp.marketClosureReasonLabel : null;
  const versionLabel = projectionVersionLabel(closeUp);
  const declared = closeUp.truthClasses;
  const nowLabel = safeAsOf(closeUp.serverNow);

  return (
    <section className="v5-closeup" aria-label="角色近景">
      <style>{STYLES}</style>

      <div className="v5-closeup__portrait">
        <Portrait reducedMotion={reducedMotion} />
      </div>
      <ClaimWithTruth
        truthClass={closeUp.poseStateTruthClass}
        declared={declared}
        asOfLabel={nowLabel}
        versionLabel={versionLabel}
        withheldClassName="v5-closeup__note"
      >
        <p className="v5-closeup__pose panshi-data">
          {reducedMotion
            ? `靜態畫面：他${POSE_LABEL[closeUp.poseState]}。`
            : `他${POSE_LABEL[closeUp.poseState]}。`}
        </p>
      </ClaimWithTruth>

      <IdentityLine closeUp={closeUp} asOfLabel={nowLabel} versionLabel={versionLabel} />
      {closure === null ? null : <SystemLabel field="marketClosureReasonLabel" text={closure} />}
      {closure !== null ? null : (
      <ClaimWithTruth
        truthClass={closeUp.currentVerbPhraseTruthClass}
        declared={declared}
        asOfLabel={nowLabel}
        versionLabel={versionLabel}
        withheldClassName="v5-closeup__note"
      >
        <p className="v5-closeup__verb panshi-paper">{closeUp.currentVerbPhrase}</p>
      </ClaimWithTruth>
      )}

      {closure !== null ? null : revealText ? (
        <>
          {/* 每一項宣稱掛它自己在投影裡的身分，不共用一顆整塊標籤。 */}
          <ClaimWithTruth
            truthClass={closeUp.unresolvedTensionSummaryTruthClass}
            declared={declared}
            asOfLabel={nowLabel}
            versionLabel={versionLabel}
            withheldClassName="v5-closeup__note"
          >
            <p className="v5-closeup__tension panshi-paper">{closeUp.unresolvedTensionSummary}</p>
          </ClaimWithTruth>

          <ConsequenceFragment
            highlight={closeUp.recentConsequenceHighlight}
            fallbackCommitment={fallbackCommitment}
            showValues={revealValues}
            declared={declared}
            versionLabel={versionLabel}
            serverNow={closeUp.serverNow}
          />
        </>
      ) : (
        <p className="v5-closeup__pose panshi-paper">先看他在做什麼。</p>
      )}

      <div className="v5-closeup__actions">
        <button type="button" data-role="primary" onClick={onOpenJournal}>
          翻開今天的人生誌
        </button>
        {paperHref === undefined ? null : (
          // 「持股與理由」：他自己的模擬紀錄，成本、損益、原始理由與退出條件同頁（未經 copy-taste 審稿）。
          <a
            href={paperHref}
            data-nav="ledger"
            onClick={(event) => {
              if (onOpenPaper === undefined) return;
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                return;
              }
              event.preventDefault();
              onOpenPaper();
            }}
          >
            持股與理由
          </a>
        )}
        <button type="button" onClick={onBackToWorld}>
          回到世界
        </button>
        <button
          type="button"
          aria-pressed={remembered}
          onClick={() => {
            const next = remembered
              ? readRemembered().filter((id) => id !== closeUp.characterId)
              : [...new Set([...readRemembered(), closeUp.characterId])];
            const ok = writeRemembered(next);
            setRememberFailed(!ok);
            if (ok) setRemembered(!remembered);
          }}
        >
          記住這個人
        </button>
      </div>

      {rememberFailed ? (
        <p className="v5-closeup__note panshi-paper">
          這台裝置不讓網頁保存紀錄，所以沒有記住。這只影響這台裝置，不影響他的人生。
        </p>
      ) : null}

      <p className="v5-closeup__note panshi-paper">
        「記住這個人」只存在這台裝置的瀏覽器裡，不會送到伺服器。
      </p>
    </section>
  );
}

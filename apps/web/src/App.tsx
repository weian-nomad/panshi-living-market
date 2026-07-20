import { useEffect, useMemo, useRef, useState } from "react";

import { type ItemKind, type Placement, type SeatId, swapPlacement } from "./placement";

type Character = {
  id: string;
  name: string;
  initials: string;
  instinct: string;
  state: string;
  continuity: number;
  tone: string;
};

type Dossier = {
  id: string;
  name: string;
  signal: string;
  companies: string[];
};

type Seat = {
  id: SeatId;
  label: string;
  perspective: string;
  peer: string;
  qmax: string;
  risk: string;
  position: string;
};

const characters: Character[] = [
  {
    id: "zhih-wei",
    name: "宋知微",
    initials: "微",
    instinct: "先找缺口，才肯表態",
    state: "戒心上升",
    continuity: 4,
    tone: "clay",
  },
  {
    id: "chang-chuan",
    name: "顧長川",
    initials: "川",
    instinct: "證據要能反覆驗證",
    state: "專注穩定",
    continuity: 3,
    tone: "sage",
  },
  {
    id: "yi-ning",
    name: "方以寧",
    initials: "寧",
    instinct: "會聽人，但不跟風",
    state: "願意協作",
    continuity: 2,
    tone: "indigo",
  },
  {
    id: "shen-yao",
    name: "沈曜",
    initials: "曜",
    instinct: "追新，也記得退路",
    state: "好奇升溫",
    continuity: 1,
    tone: "copper",
  },
  {
    id: "lin-cheng",
    name: "林澄",
    initials: "澄",
    instinct: "保留餘地也是決定",
    state: "需要休息",
    continuity: 5,
    tone: "slate",
  },
];

const dossiers: Dossier[] = [
  {
    id: "dossier-tide",
    name: "潮汐卷",
    signal: "供應鏈的回聲",
    companies: ["浮橋運輸", "岸線材料", "白帆倉儲", "深港系統"],
  },
  {
    id: "dossier-lantern",
    name: "燈塔卷",
    signal: "需求開始分岔",
    companies: ["遠燈光學", "星礁元件", "折光製造", "晨霧感測"],
  },
  {
    id: "dossier-orchard",
    name: "果園卷",
    signal: "價格與庫存拉扯",
    companies: ["青枝食品", "野泉冷鏈", "穗日包材", "丘陵通路"],
  },
  {
    id: "dossier-loom",
    name: "織機卷",
    signal: "舊產能正在換手",
    companies: ["迴梭工業", "細雨纖維", "複線設備", "沉木機械"],
  },
  {
    id: "dossier-monsoon",
    name: "季風卷",
    signal: "政策風向仍未定",
    companies: ["南徑能源", "穹頂工程", "逆風儲能", "候鳥電網"],
  },
];

const seats: Seat[] = [
  {
    id: "gatekeeper",
    label: "守門席",
    perspective: "先排除最脆弱的假設",
    peer: "只聽探索席",
    qmax: "1.00",
    risk: "風險正常",
    position: "seat-north",
  },
  {
    id: "core-a",
    label: "核心席 A",
    perspective: "優先讀基本證據",
    peer: "只聽守門席",
    qmax: "0.75",
    risk: "信心上限 75%",
    position: "seat-east",
  },
  {
    id: "core-b",
    label: "核心席 B",
    perspective: "追蹤相互矛盾的線索",
    peer: "只聽核心席 A",
    qmax: "0.00",
    risk: "本席暫不建立立場",
    position: "seat-south-east",
  },
  {
    id: "flank",
    label: "側翼席",
    perspective: "尋找被忽略的第二效果",
    peer: "只聽核心席 B",
    qmax: "0.50",
    risk: "信心上限 50%",
    position: "seat-south-west",
  },
  {
    id: "explore",
    label: "探索席",
    perspective: "先看最新、最陌生的事實",
    peer: "只聽側翼席",
    qmax: "1.00",
    risk: "風險正常",
    position: "seat-west",
  },
];

const initialPlacement: Placement = {
  gatekeeper: { characterId: "zhih-wei", dossierId: "dossier-tide" },
  "core-a": { characterId: "chang-chuan", dossierId: "dossier-lantern" },
  "core-b": { characterId: "yi-ning", dossierId: "dossier-orchard" },
  flank: { characterId: "shen-yao", dossierId: "dossier-loom" },
  explore: { characterId: "lin-cheng", dossierId: "dossier-monsoon" },
};

function byId<T extends { id: string }>(items: T[], id: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown fixture item: ${id}`);
  return item;
}

export function App() {
  const [placement, setPlacement] = useState<Placement>(initialPlacement);
  const [tray, setTray] = useState<ItemKind>("character");
  const [selected, setSelected] = useState<{ kind: ItemKind; id: string } | null>(null);
  const [activeSeat, setActiveSeat] = useState<SeatId>("gatekeeper");
  const [causeOpen, setCauseOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [commitState, setCommitState] = useState<"draft" | "saving" | "sealed">("draft");
  const [announcement, setAnnouncement] = useState("示範排席已載入");
  const tableRef = useRef<HTMLDivElement>(null);

  const active = byId(seats, activeSeat);
  const activePlacement = placement[activeSeat];
  const activeCharacter = byId(characters, activePlacement.characterId);
  const activeDossier = byId(dossiers, activePlacement.dossierId);

  const placementDigest = useMemo(
    () =>
      seats
        .map((seat) => `${seat.id}:${placement[seat.id].characterId}:${placement[seat.id].dossierId}`)
        .join("|"),
    [placement],
  );

  useEffect(() => {
    if (commitState !== "saving") return;
    const timer = window.setTimeout(() => {
      setCommitState("sealed");
      setAnnouncement("封席完成。五位角色將依自己的狀態做決定。");
    }, 680);
    return () => window.clearTimeout(timer);
  }, [commitState]);

  function assign(kind: ItemKind, itemId: string, seatId: SeatId) {
    if (commitState !== "draft") return;
    const next = swapPlacement(placement, kind, itemId, seatId);
    if (next === placement) {
      setSelected(null);
      return;
    }
    setPlacement(next);
    const itemName = kind === "character" ? byId(characters, itemId).name : byId(dossiers, itemId).name;
    setActiveSeat(seatId);
    setSelected(null);
    setAnnouncement(`${itemName} 已排到${byId(seats, seatId).label}`);
  }

  function activateSeat(seatId: SeatId) {
    setActiveSeat(seatId);
    if (selected) assign(selected.kind, selected.id, seatId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!tableRef.current) return;
    const bounds = tableRef.current.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    tableRef.current.style.setProperty("--pointer-x", x.toFixed(3));
    tableRef.current.style.setProperty("--pointer-y", y.toFixed(3));
  }

  function onDrop(event: React.DragEvent, seatId: SeatId) {
    event.preventDefault();
    const payload = event.dataTransfer.getData("application/x-panshi-placement");
    if (!payload) return;
    const parsed = JSON.parse(payload) as { kind: ItemKind; id: string };
    assign(parsed.kind, parsed.id, seatId);
  }

  return (
    <div className={`app-shell is-${commitState}`}>
      <a className="skip-link" href="#round-desk">跳到五席圓桌</a>
      <header className="topbar">
        <div className="wordmark" aria-label="盤勢眾生">
          <span className="wordmark-mark" aria-hidden="true">盤</span>
          <span>盤勢・眾生</span>
        </div>
        <nav className="primary-nav" aria-label="主要導覽">
          <button className="is-current" type="button">今日排席</button>
          <button type="button">人物一生</button>
          <button type="button">因果典藏</button>
        </nav>
        <div className="truth-status">
          <span className="status-beacon" aria-hidden="true" />
          <span>歷史劇本</span>
          <b>虛構公司</b>
        </div>
      </header>

      <main>
        <section className="round-heading" aria-labelledby="round-title">
          <div>
            <p className="eyebrow">第 01 幕 · 封存交易日</p>
            <h1 id="round-title">今天，你只決定誰坐哪裡。</h1>
            <p className="round-dek">角色會讀同一批事實，帶著不同記憶與關係，自己做最後決定。</p>
          </div>
          <div className="cutoff-block">
            <span>示範封席</span>
            <strong>{commitState === "sealed" ? "已完成" : "尚可排席"}</strong>
            <small>伺服器版本 08 · 投影版本 08</small>
          </div>
        </section>

        <section className="cause-ribbon" aria-label="昨日關鍵因果">
          <button type="button" onClick={() => setCauseOpen((value) => !value)} aria-expanded={causeOpen}>
            <span className="cause-index">昨日 01</span>
            <span className="cause-line"><b>一段失敗記憶</b>，讓宋知微沒有跟進同伴的樂觀主張。</span>
            <span className="cause-toggle">{causeOpen ? "收起" : "看因果"}</span>
          </button>
          {causeOpen && (
            <div className="cause-detail">
              <div><span>原本</span><strong>浮橋運輸・上行 50%</strong></div>
              <div className="cause-arrow" aria-hidden="true">→</div>
              <div><span>記憶介入後</span><strong>不做</strong></div>
              <p>其餘證據、同伴與桌位都保持不變。這是單變量反事實，不是行情預測。</p>
            </div>
          )}
        </section>

        <div className="workspace-grid">
          <aside className="placement-tray" aria-label="待排物件">
            <div className="tray-tabs" role="tablist" aria-label="排席物件">
              <button type="button" role="tab" aria-selected={tray === "character"} onClick={() => setTray("character")}>五位角色</button>
              <button type="button" role="tab" aria-selected={tray === "dossier"} onClick={() => setTray("dossier")}>五份卷宗</button>
            </div>
            <p className="tray-hint">點一下再選桌位，或直接拖上桌。</p>
            <div className="tray-list">
              {tray === "character"
                ? characters.map((character) => (
                    <button
                      key={character.id}
                      type="button"
                      className={`character-token tone-${character.tone} ${selected?.id === character.id ? "is-selected" : ""}`}
                      draggable={commitState === "draft"}
                      aria-pressed={selected?.id === character.id}
                      onClick={() => setSelected({ kind: "character", id: character.id })}
                      onDragStart={(event) => event.dataTransfer.setData("application/x-panshi-placement", JSON.stringify({ kind: "character", id: character.id }))}
                    >
                      <span className="avatar" aria-hidden="true">{character.initials}</span>
                      <span><strong>{character.name}</strong><small>{character.state}</small></span>
                      <i>{character.continuity} 日</i>
                    </button>
                  ))
                : dossiers.map((dossier) => (
                    <button
                      key={dossier.id}
                      type="button"
                      className={`dossier-token ${selected?.id === dossier.id ? "is-selected" : ""}`}
                      draggable={commitState === "draft"}
                      aria-pressed={selected?.id === dossier.id}
                      onClick={() => setSelected({ kind: "dossier", id: dossier.id })}
                      onDragStart={(event) => event.dataTransfer.setData("application/x-panshi-placement", JSON.stringify({ kind: "dossier", id: dossier.id }))}
                    >
                      <span className="dossier-glyph" aria-hidden="true" />
                      <span><strong>{dossier.name}</strong><small>{dossier.signal}</small></span>
                    </button>
                  ))}
            </div>
            <div className="continuity-note">
              <span className="continuity-line" aria-hidden="true" />
              <p><b>脈絡最深：</b>林澄留在探索席已 5 日。換席不會清除他的記憶。</p>
            </div>
          </aside>

          <section
            id="round-desk"
            className="round-desk"
            aria-label="五席圓桌"
            ref={tableRef}
            onPointerMove={onPointerMove}
          >
            <div className="generated-table-art" aria-hidden="true" />
            <div className="table-vignette" aria-hidden="true" />
            <div className="astrolabe" aria-hidden="true">
              <span className="orbit orbit-one" />
              <span className="orbit orbit-two" />
              <span className="axis" />
              <span className="center-seal">勢</span>
            </div>
            <div className="desk-instruction" aria-hidden="true">
              <span>五席同時封存</span>
              <b>{selected ? `請選擇${selected.kind === "character" ? "角色" : "卷宗"}的新桌位` : "點選一席查看規則"}</b>
            </div>

            {seats.map((seat) => {
              const current = placement[seat.id];
              const character = byId(characters, current.characterId);
              const dossier = byId(dossiers, current.dossierId);
              return (
                <button
                  key={seat.id}
                  type="button"
                  className={`seat ${seat.position} ${activeSeat === seat.id ? "is-active" : ""} ${seat.qmax === "0.00" ? "is-locked" : ""}`}
                  aria-label={`${seat.label}，${character.name}，${dossier.name}，${seat.risk}`}
                  aria-current={activeSeat === seat.id ? "true" : undefined}
                  onClick={() => activateSeat(seat.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => onDrop(event, seat.id)}
                >
                  <span className="seat-label">{seat.label}</span>
                  <span className={`seat-avatar tone-${character.tone}`} aria-hidden="true">{character.initials}</span>
                  <span className="seat-person"><b>{character.name}</b><small>{character.state}</small></span>
                  <span className="seat-dossier"><i aria-hidden="true" />{dossier.name}</span>
                  <span className="seat-risk"><em>qmax</em>{seat.qmax}</span>
                </button>
              );
            })}
          </section>

          <aside className="seat-inspector" aria-labelledby="inspector-title">
            <p className="eyebrow">席位規則</p>
            <h2 id="inspector-title">{active.label}</h2>
            <p className="inspector-perspective">{active.perspective}</p>
            <dl>
              <div><dt>角色</dt><dd>{activeCharacter.name}</dd></div>
              <div><dt>卷宗</dt><dd>{activeDossier.name}</dd></div>
              <div><dt>同伴來源</dt><dd>{active.peer}</dd></div>
              <div><dt>信心上限</dt><dd>{active.qmax}</dd></div>
            </dl>
            <div className={`risk-note ${active.qmax === "0.00" ? "is-alert" : ""}`}>
              <span aria-hidden="true">{active.qmax === "0.00" ? "×" : "·"}</span>
              <p><b>{active.risk}</b>{active.qmax === "0.00" && "。換人或換卷宗也不會解除。"}</p>
            </div>
            <button className="text-action" type="button" onClick={() => setPreviewOpen(true)}>預覽這個安排允許什麼</button>
            <div className="company-list" aria-label="卷宗內虛構公司">
              {activeDossier.companies.map((company, index) => <span key={company}><i>{String(index + 1).padStart(2, "0")}</i>{company}</span>)}
            </div>
          </aside>
        </div>

        <section className="commit-rail" aria-label="排席提交">
          <div>
            <span className="commit-status" aria-hidden="true" />
            <p><b>{commitState === "sealed" ? "五席已封存" : "五席配置完整"}</b><small>資料截至：劇本日 08:20 · 只顯示合法行為，不預告角色選擇</small></p>
          </div>
          <div className="commit-actions">
            {commitState === "draft" && <button type="button" className="secondary-action" onClick={() => setPlacement(initialPlacement)}>回到昨日配置</button>}
            <button
              type="button"
              className="primary-action"
              disabled={commitState !== "draft"}
              onClick={() => {
                setCommitState("saving");
                setAnnouncement("正在提交完整五席配置");
              }}
            >
              {commitState === "draft" && "確認排席"}
              {commitState === "saving" && "正在封席…"}
              {commitState === "sealed" && "封席完成"}
            </button>
          </div>
        </section>

        <section className="product-principle">
          <p>你安排資訊環境，<br /><b>不替角色下指令。</b></p>
          <div>
            <span>01</span><p><b>先看一條因果</b>不把十五項內在狀態一次倒給你。</p>
          </div>
          <div>
            <span>02</span><p><b>封席後不能重抽</b>角色的決定才真正屬於角色。</p>
          </div>
          <div>
            <span>03</span><p><b>結果可以重播</b>同一狀態與證據，永遠得到同一行動。</p>
          </div>
        </section>
      </main>

      <footer>
        <p>這是使用完全虛構公司與封存資料的互動劇本，不提供投資建議、即時行情或個別證券分析。</p>
        <span>Historical fixture · revision 08</span>
      </footer>

      <div className="sr-only" aria-live="polite">{announcement}</div>
      <span className="digest-sentinel" data-layout-digest={placementDigest} hidden />

      {previewOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setPreviewOpen(false)}>
          <section className="legal-dialog" role="dialog" aria-modal="true" aria-labelledby="legal-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="dialog-close" type="button" aria-label="關閉合法行為預覽" onClick={() => setPreviewOpen(false)}>關閉</button>
            <p className="eyebrow">合法行為預覽</p>
            <h2 id="legal-title">{activeCharacter.name} 坐在{active.label}，能做什麼？</h2>
            <p>封席前只公開選項邊界。公司、方向、信心與最後是否行動，都要等角色完成研判。</p>
            <div className="legal-grid">
              <div><span>可讀公司</span><strong>{activeDossier.companies.length} 家</strong></div>
              <div><span>方向選項</span><strong>{active.qmax === "0.00" ? "無" : "上行／下行"}</strong></div>
              <div><span>不做</span><strong>永遠可選</strong></div>
              <div><span>信心上限</span><strong>{active.qmax}</strong></div>
            </div>
            {active.qmax === "0.00" && <div className="locked-explanation"><b>風險煞車已鎖住這一席。</b><p>角色仍會閱讀、留下記憶並更新關係，但今天不能建立方向性立場。</p></div>}
            <button className="primary-action" type="button" onClick={() => setPreviewOpen(false)}>我知道邊界了</button>
          </section>
        </div>
      )}
    </div>
  );
}

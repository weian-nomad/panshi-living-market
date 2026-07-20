import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  formatSceneTime,
  getResidentLine,
  getSceneMoment,
  marketPulses,
  residents,
  type Resident,
} from "./scene";
import { hitTestWorldPoint, type WorldHitTarget } from "./interaction";

type FocusMode = "wide" | "hold" | "tap";

type PressSession = {
  pointerId: number;
  focusId: string;
  activated: boolean;
  timer: number;
};

const ANNOUNCEMENT_ID = "announcement";
const MARKET_TAPE_ID = "market-tape";
const HOLD_DELAY_MS = 180;
const RELEASE_DELAY_MS = 800;

function shouldShowFollowGuide(): boolean {
  try {
    return window.localStorage.getItem("panshi.follow-guide") !== "done";
  } catch {
    return true;
  }
}

function residentStyle(resident: Resident, atlasIndex: number): CSSProperties {
  const atlasStops = ["0%", "33.333%", "66.667%", "100%"] as const;
  return {
    "--resident-x": `${resident.x}%`,
    "--resident-y": `${resident.y}%`,
    "--hair": resident.hair,
    "--skin": resident.skin,
    "--coat": resident.coat,
    "--accent": resident.accent,
    "--atlas-x": atlasStops[atlasIndex % 4] ?? "0%",
    "--atlas-y": atlasStops[Math.floor(atlasIndex / 4)] ?? "0%",
  } as CSSProperties;
}

function ResidentFigure({ resident }: { resident: Resident }) {
  return (
    <span className={`figure figure--${resident.look}`} aria-hidden="true">
      <span className="figure__shadow" />
      <span className="figure__sprite" />
      <span className="figure__attention" />
    </span>
  );
}

export function App() {
  const [seconds, setSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState<FocusMode>("wide");
  const [pressingId, setPressingId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(shouldShowFollowGuide);
  const pressRef = useRef<PressSession | null>(null);
  const releaseTimerRef = useRef<number | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);

  const moment = getSceneMoment(seconds);
  const focusedResident = useMemo(
    () => residents.find((resident) => resident.id === focusId) ?? null,
    [focusId],
  );
  const isAnnouncementFocused = focusId === ANNOUNCEMENT_ID;
  const isMarketTapeFocused = focusId === MARKET_TAPE_ID;
  const focusPoint = focusedResident
    ? { x: focusedResident.x, y: focusedResident.y }
    : isAnnouncementFocused
      ? { x: 58, y: 20 }
      : isMarketTapeFocused
        ? { x: 61, y: 11 }
      : { x: 50, y: 50 };

  useEffect(() => {
    if (!isPlaying) return;

    const interval = window.setInterval(() => {
      setSeconds((current) => (current >= 599 ? 0 : current + 1));
    }, 1_000);

    return () => window.clearInterval(interval);
  }, [isPlaying]);

  useEffect(() => {
    if (!showGuide) return;
    const timer = window.setTimeout(() => setShowGuide(false), 8_000);
    return () => window.clearTimeout(timer);
  }, [showGuide]);

  useEffect(() => {
    return () => {
      if (pressRef.current) window.clearTimeout(pressRef.current.timer);
      if (releaseTimerRef.current !== null) window.clearTimeout(releaseTimerRef.current);
    };
  }, []);

  function clearReleaseTimer() {
    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
  }

  function enterFocus(nextFocusId: string, mode: FocusMode) {
    clearReleaseTimer();
    setFocusId(nextFocusId);
    setFocusMode(mode);
  }

  function completeFollowGuide() {
    setShowGuide(false);
    try {
      window.localStorage.setItem("panshi.follow-guide", "done");
    } catch {
      // The gesture still works when storage is unavailable.
    }
  }

  function returnToWide() {
    clearReleaseTimer();
    setFocusId(null);
    setFocusMode("wide");
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>, nextFocusId: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    clearReleaseTimer();
    event.currentTarget.setPointerCapture(event.pointerId);

    const session: PressSession = {
      pointerId: event.pointerId,
      focusId: nextFocusId,
      activated: false,
      timer: 0,
    };

    setPressingId(nextFocusId);

    session.timer = window.setTimeout(() => {
      session.activated = true;
      setPressingId(null);
      completeFollowGuide();
      enterFocus(session.focusId, "hold");
    }, HOLD_DELAY_MS);
    pressRef.current = session;
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const session = pressRef.current;
    if (!session || session.pointerId !== event.pointerId || !session.activated) return;

    const world = worldRef.current;
    if (!world) return;
    const bounds = world.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const point = {
      x: ((event.clientX - bounds.left) / bounds.width) * 100,
      y: ((event.clientY - bounds.top) / bounds.height) * 100,
    };
    const hitTargets: WorldHitTarget[] = residents.map((resident) => ({
      id: resident.id,
      x: resident.x,
      y: resident.y,
      radiusX: 6,
      radiusY: 5,
      priority: 2,
    }));

    hitTargets.push({ id: MARKET_TAPE_ID, x: 61, y: 11, radiusX: 19, radiusY: 9 });
    if (moment.announcementVisible) {
      hitTargets.push({ id: ANNOUNCEMENT_ID, x: 58, y: 20, radiusX: 18, radiusY: 6, priority: 1 });
    }

    const nextId = hitTestWorldPoint(point, hitTargets);

    if (nextId && nextId !== session.focusId) {
      session.focusId = nextId;
      enterFocus(nextId, "hold");
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>) {
    const session = pressRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    window.clearTimeout(session.timer);
    pressRef.current = null;
    setPressingId(null);

    if (!session.activated) {
      enterFocus(session.focusId, "tap");
      return;
    }

    releaseTimerRef.current = window.setTimeout(returnToWide, RELEASE_DELAY_MS);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLElement>) {
    const session = pressRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    window.clearTimeout(session.timer);
    pressRef.current = null;
    setPressingId(null);
    returnToWide();
  }

  function stepResident(direction: -1 | 1) {
    const currentIndex = residents.findIndex((resident) => resident.id === focusId);
    const base = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = (base + direction + residents.length) % residents.length;
    const next = residents[nextIndex];
    if (next) enterFocus(next.id, "tap");
  }

  const worldStyle = {
    "--focus-x": `${focusPoint.x}%`,
    "--focus-y": `${focusPoint.y}%`,
    "--scene-progress": `${(seconds / 599) * 100}%`,
  } as CSSProperties;

  return (
    <main className="app-shell">
      <section className="watch" aria-label="盤勢眾生歷史場景">
        <header className="topbar">
          <div className="brand-block">
            <p className="eyebrow">盤勢 · 眾生</p>
            <h1>開盤廳</h1>
          </div>
          <div className="history-stamp" aria-label="歷史資料演示，2026 年 7 月 17 日">
            <span>歷史資料演示</span>
            <time dateTime="2026-07-17T09:00:00+08:00">2026.07.17</time>
          </div>
          <button className="scene-toggle" type="button" onClick={() => setIsPlaying((current) => !current)} aria-label={isPlaying ? "暫停現場" : "繼續現場"}>
            <span className={isPlaying ? "pause-icon" : "play-icon"} aria-hidden="true" />
          </button>
        </header>

        <div className={`scene-viewport ${focusId ? "has-focus" : ""}`}>
          <div
            className={`world ${focusId ? "is-focused" : "is-wide"} moment--${moment.id}`}
            style={worldStyle}
            ref={worldRef}
          >
            <button
              className={`market-wall ${isMarketTapeFocused ? "is-current" : ""}`}
              data-follow-id={MARKET_TAPE_ID}
              type="button"
              aria-label="查看 2026 年 7 月 17 日三檔封存行情"
              onPointerDown={(event) => handlePointerDown(event, MARKET_TAPE_ID)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            >
              <span className="market-wall__header">市場脈衝 · 09:00</span>
              {marketPulses.map((pulse) => (
                <span className={`market-line market-line--${pulse.tone}`} key={pulse.ticker}>
                  <i />
                </span>
              ))}
            </button>

            <div className="market-pulse pulse--one" aria-hidden="true" />
            <div className="market-pulse pulse--two" aria-hidden="true" />
            <div className="market-pulse pulse--three" aria-hidden="true" />

            {moment.announcementVisible ? (
              <button
                className={`announcement-object ${isAnnouncementFocused ? "is-current" : ""}`}
                data-follow-id={ANNOUNCEMENT_ID}
                type="button"
                aria-label="查看台積公司 2026 年第二季營運結果來源"
                onPointerDown={(event) => handlePointerDown(event, ANNOUNCEMENT_ID)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
              >
                <span className="announcement-object__signal" />
                <span className="announcement-object__copy">
                  <small>真實資料</small>
                  台積公司第二季營運結果
                </span>
              </button>
            ) : null}

            <div className="conversation-thread thread--one" aria-hidden="true" />
            <div className="conversation-thread thread--two" aria-hidden="true" />

            {residents.map((resident, atlasIndex) => {
              const isCurrent = resident.id === focusId;
              return (
                <button
                  className={`resident resident--${resident.depth} ${isCurrent ? "is-current" : ""} ${pressingId === resident.id ? "is-pressing" : ""}`}
                  style={residentStyle(resident, atlasIndex)}
                  key={resident.id}
                  type="button"
                  data-follow-id={resident.id}
                  aria-label={`跟拍 ${resident.name}，${resident.activity}`}
                  onPointerDown={(event) => handlePointerDown(event, resident.id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                >
                  <ResidentFigure resident={resident} />
                  <span className="resident__name">{resident.name}</span>
                  {isCurrent ? <span className="resident__reticle" aria-hidden="true" /> : null}
                </button>
              );
            })}

          </div>

          {focusedResident ? (
            <aside className={`field-note field-note--${focusedResident.look}`} aria-live="polite">
              <div className="field-note__identity">
                <strong>{focusedResident.name}</strong>
                <span>{focusedResident.role}</span>
              </div>
              <p><em>近距收音</em>{getResidentLine(focusedResident, seconds)}</p>
              <small>鏡頭所見 · {focusedResident.activity}</small>
            </aside>
          ) : null}

          {isAnnouncementFocused ? (
            <aside className="source-note" aria-live="polite">
              <div className="source-note__topline">
                <span>真實資料</span>
                <time dateTime="2026-07-16">2026.07.16 發布</time>
              </div>
              <strong>台積公司 2026 年第二季營運結果</strong>
              <p>營收 US$40.20B，毛利率 67.7%，營業利益率 60.3%。</p>
              <a href="https://investor.tsmc.com/english/quarterly-results/2026/q2" target="_blank" rel="noreferrer">
                查看公司原始公告
              </a>
            </aside>
          ) : null}

          {isMarketTapeFocused ? (
            <aside className="source-note source-note--market" aria-live="polite">
              <div className="source-note__topline">
                <span>真實資料</span>
                <time dateTime="2026-07-17">2026.07.17 收盤</time>
              </div>
              <strong>三檔封存行情</strong>
              <div className="market-facts">
                {marketPulses.map((pulse) => (
                  <div key={pulse.ticker}>
                    <span>{pulse.ticker} {pulse.company}</span>
                    <b>{pulse.close}</b>
                    <i>{pulse.change}</i>
                  </div>
                ))}
              </div>
              <a href="https://www.twse.com.tw/zh/trading/historical/stock-day.html" target="_blank" rel="noreferrer">
                查看臺灣證券交易所原始資料
              </a>
            </aside>
          ) : null}

          {showGuide ? (
            <div className="first-use-guide">
              <span className="first-use-guide__finger" aria-hidden="true" />
              <strong>按住 0.18 秒跟拍</strong>
              <span>拖到另一人交接</span>
            </div>
          ) : null}

          <div className="scene-caption" aria-live="polite">
            <span className="scene-caption__time">{formatSceneTime(seconds)}</span>
            <span className="scene-caption__divider" />
            <div>
              <strong>{moment.label}</strong>
              <p>{moment.ambient}</p>
            </div>
          </div>
        </div>

        <footer className="control-deck">
          <div className="timeline" aria-label={`場景進度 ${Math.round((seconds / 599) * 100)}%`}>
            <span style={{ width: `${(seconds / 599) * 100}%` }} />
          </div>
          <div className="controls">
            <button type="button" onClick={() => stepResident(-1)} aria-label="跟拍上一位居民">
              <i aria-hidden="true">←</i>
              上一位
            </button>
            <button
              className="control-primary"
              type="button"
              onClick={focusId ? returnToWide : () => enterFocus(residents[0]?.id ?? "", "tap")}
            >
              <span className="viewfinder-icon" aria-hidden="true" />
              {focusId ? "回到全景" : "開始跟拍"}
            </button>
            <button type="button" onClick={() => stepResident(1)} aria-label="跟拍下一位居民">
              下一位
              <i aria-hidden="true">→</i>
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}

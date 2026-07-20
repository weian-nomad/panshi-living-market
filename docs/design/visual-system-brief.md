# 視覺與動態系統 brief

_版本 1.0｜2026-07-20｜高保真 Figma 與生成資產的共同約束_

## 視覺判決

《盤勢・眾生》像一張被長期使用的研究桌：墨黑桌面、溫紙卷宗、少量氧化銅，資料更新時才出現冷藍訊號。角色有生活痕跡，但畫面不髒；市場資訊精確，但不像券商終端。

玄學只在封席、人物內在與反事實切換時出現。資料延遲、作廢、分數修正、權利撤回與刪帳畫面全部使用直接文字和穩定版面，不用煙霧、閃光或儀式遮住狀態。

## 核心畫面

首屏固定是一張五席圓桌，不做城市鳥瞰。桌上同時看得到五人、五份卷宗、桌位風險、唯一同伴來源、資料截至時間和封席倒數。昨日關鍵因果只佔一條可展開的橫帶。

桌面以 drag-and-drop 為主要手勢，但鍵盤、switch control 和 screen reader 使用同一個完整 placement payload。窄螢幕改成可橫向巡席的五段圓弧，不把五席縮成看不清楚的小圖示。

## 字型

| 用途 | 字型策略 | 原因 |
| --- | --- | --- |
| 繁中介面與長文 | IBM Plex Sans TC | 筆畫清楚，數字與拉丁文協調，可用於密度高的狀態畫面 |
| 數字、時間、revision、分數 | IBM Plex Mono | 固定寬度讓版本與數值易比較，不借用交易終端的螢光語法 |
| 大標與章節 | Noto Serif TC，限 32 px 以上 | 讓卷宗與人物敘事有紙本感；不進小字、按鈕或風險資訊 |
| 品牌字標 | 由「盤勢・眾生」六字另畫字形 | 只做 wordmark，不改造整套開源字型，也不把字標當內文 font |

IBM Plex 採 SIL Open Font License；正式打包前保存實際 font file、版本、license 與 subset 清單。參考：[IBM Plex 官方 repository](https://github.com/IBM/plex)、[IBM Plex license](https://github.com/IBM/plex/blob/master/LICENSE.txt)。Noto Serif TC 也須在 asset manifest 固定版本與授權檔。

## 色彩與材質

第一輪 token 不是最終色票，但角色必須固定：

| Token | 起始值 | 用途 |
| --- | --- | --- |
| `ink-950` | `#0B0D0E` | 主背景 |
| `paper-100` | `#F0E6D2` | 卷宗、閱讀面 |
| `paper-300` | `#D8C8AA` | 分隔與停用面 |
| `copper-500` | `#A46F44` | 已選桌位、封席儀式、長期人物痕跡 |
| `signal-400` | `#74A9C6` | 新資料、同步、可展開證據 |
| `danger-500` | `#C75B4F` | 作廢、撤回與不可逆風險；不用於日常跌幅裝飾 |

紙張紋理最大不透明度 6%，不得降低文字對比。正式 token 要通過 WCAG 2.2 AA；分數、方向、truth class 和錯誤不能只靠顏色辨識。

## 角色圖像由 Codex 生成，但不即興

角色主視覺使用編輯插畫式半身肖像：35–55 mm 等效鏡頭、柔和側光、克制的版畫與礦物顏料質感、真實年齡紋理、無霓虹、無交易螢幕、無占星符號貼臉。五人要有不同輪廓、姿勢、年代感與社經線索，但不得模仿真人。

每張 master asset 保存：

- 角色與服裝 brief、完整 prompt、negative prompt、工具版本、seed／生成識別、日期與核准人。
- 4:5 原始主圖、1:1 頭像、9:16 分享裁切與透明安全區。
- 臉、眼、呼吸、衣料、前景紙紋和命盤光紋分層；動態由前端控制，不逐 frame 重新生成。
- 靜態 fallback、reduced-motion 版本、alt text 與使用權紀錄。

生成圖只提供外觀。人物年齡、背景、情緒、關係與命盤狀態仍由正式資料決定，圖像模型不能發明 canonical 角色事件。

## 四段動態

1. `排席`：物件抬起 80 ms，桌位合法範圍在 140 ms 內顯示；落位後只更新風險、資訊視角、同伴來源與四家公司。
2. `封席`：680 ms 內完成紙纖維收束與銅線閉合；完成條件來自 command receipt，不由動畫時間判定。
3. `揭曉`：先出 action，再依序展開事實、人物狀態、同伴與效用差；不把結果藏在長過場後。
4. `反事實`：只移動被替換的一個因素，其餘畫面固定，讓使用者能看見單變量差異。

Reduced motion 取消位移、縮放、視差和粒子，保留 120 ms 以下的 opacity／stroke 狀態切換。所有動畫中斷後，畫面仍須反映 server truth。

## 禁用語法

- 漲跌跑馬燈、K 線滿版背景、金幣噴發、轉盤、寶箱、倒數焦慮與賭場音效。
- 通用紫藍 AI 漸層、漂浮玻璃卡、無意義粒子、假 3D 城市和大量自由聊天泡泡。
- 用紅綠判斷好壞、用命盤線直接連到漲跌、用人物表情暗示明日方向。
- 為了電影感延遲 error、hold、void、correction 或 deletion 的文字。

## Figma handoff gate

每個 frame 要附 command／read resource、authoritative state、projection version、禁顯欄位、loading／empty／stale／held／void／offline 狀態，以及鍵盤、screen-reader、reduced-motion 等價操作。未附齊不能交給工程，也不能只靠 prototype transition 補語意。

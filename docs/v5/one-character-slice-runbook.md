# 一名角色垂直切片：跑起來與走查

這份文件給「沒讀過任何規格、只想把切片跑起來看一眼」的人。照著做即可；不需要先讀
`product-constitution.md` 或 `experience-spec.md`。

切片的內容是一名虛構成年居民（陸硯之，28 歲，企業研究助理）在六個合成歷史交易時段裡
留下的完整紙上承擔：持股、損益、當初的理由、後來的改口。走查路徑就是產品結構本身：

```text
公共世界 → 跟拍 → 角色近景 → 角色人生誌 → 深層檔案索引 → 模擬紀錄
```

授權依據是 `docs/v5/decision-record.md` 的 ADR-PRODUCT-005「後續約束」：可以先做一名角色的
完整垂直切片，資料形狀仍要是最終的事件、帳本與人生誌。

---

## 1. 前置

| 需要 | 版本 | 怎麼確認 |
| --- | --- | --- |
| Node | 24.x | `node --version` |
| pnpm | 由 corepack 帶起，版本鎖在 `package.json` 的 `packageManager` | `corepack pnpm --version` |
| Rust | `rust-toolchain.toml` 指定的版本 | `cargo --version` |

macOS 上 Node 24 若是用 Homebrew 的 keg-only 版本安裝，每個指令前面加上 PATH 前綴：

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
```

以下所有指令都在 repo 根目錄執行，路徑一律用 repo 內的相對路徑。

## 2. 安裝相依

```sh
corepack pnpm install --frozen-lockfile
```

lockfile 不要動。這一步不需要網路以外的任何憑證。

## 3. 產生 fixture（事件 ＋ 公開 API 投影）

切片的資料不是手寫的 JSON，而是由 Rust 端把 canonical 事件序列 fold 出來的。兩條指令：

```sh
cargo run -p panshi-character-episode -- --write-slice-events fixtures/v5/one-character-slice/events
cargo run -p panshi-character-episode -- --write-public-api  fixtures/v5/one-character-slice/api
```

或用一行捷徑：

```sh
corepack pnpm slice:emit
```

第一條寫出 canonical 事件（`.pb`）；第二條把同一串事件重播成
`contracts/openapi/public-v2.yaml` 定義的五個回應物件。**先跑第一條再跑第二條**：第二條讀的是
同一份事件序列，兩者不一致時投影會失敗，而不是靜靜地補值。

市場事實全部是這個 repo 自有的合成歷史 fixture（`contracts/world-fact-manifest/historical-v1/`），
不連任何外部行情來源，也不讀另一個 repo。

## 4. 啟動並開啟切片

```sh
corepack pnpm --filter @panshi/web dev
```

然後開：

```text
http://127.0.0.1:4173/world
```

dev server 會把 `/api/v2/*` 對映到步驟 3 產生的 fixture，所以瀏覽器打的是**真的公開路徑**、
拿的是**最終 API 形狀**。fixture 重新產生後不需要重啟 dev server。

`corepack pnpm slice:dev` 是同一件事的捷徑，它會先提醒你跑 `slice:emit`。

## 5. 自動走查

```sh
corepack pnpm slice:verify
# 等同於： node tools/v5-slice-walkthrough.mjs
```

它自己開一個 dev server 子行程（127.0.0.1:4173）、等就緒、依序打六條路徑並印出六行 `PASS`，
結束時關掉子行程。任何一條失敗會印出失敗原因並以非 0 結束。

六條檢查：

1. `GET /world` 回傳切片外殼（HTML）。
2. `GET /api/v2/world` 只有一名居民。
3. `GET /api/v2/characters/{id}/close-up` 有未解矛盾與後果碎片，資料截至 2026-03-17。
4. `GET /api/v2/characters/{id}/life-journal` 五章，第二章有當時原話、第四章有重複模式。
5. `GET /api/v2/characters/{id}/archive` 六節，只有模擬紀錄有真頁。
6. `GET /api/v2/characters/{id}/archive/paper` 有完整紙上承擔，且今天那筆沒有揭露 key。

六份回應同時會被掃一次：本切片的市場事實是合成 fixture，任何一份回應出現
`real_fact` 都算失敗——標成真實資料就是說謊。

## 6. 人工走查清單

自動走查只證明資料到位，畫面與節奏要靠眼睛。依序看：

### 6.1 公共世界 `/world`

- [ ] 一間 CSS／SVG 幾何畫的開盤廳，裡面站著一名可辨識的居民。
- [ ] 沒有今日主角、沒有光圈、沒有任何跨角色的績效比較或名次。
- [ ] 全站導覽只有「公共世界」一項；持股與模擬紀錄沒有全站入口。

### 6.2 跟拍

- [ ] 在居民身上按住約 0.2 秒進入跟拍：鏡頭外環境明顯變暗，遠處字幕退場。
- [ ] 跟拍層只剩姓名、一句可觀察動作，以及一句可核對的已封存原話。
- [ ] 放開手後畫面仍停留一段時間才回全景，全景短暫保留「再靠近一點」。
- [ ] 單擊（不是長按）會出現「開始跟拍／看他的近況／取消」三選項。
- [ ] 只用鍵盤（Tab 聚焦、Enter 開啟）也能走到同一組選項。

### 6.3 角色近景 `/people/{id}`

- [ ] 固定構圖，不是資料儀表板。
- [ ] 一句未解矛盾：他昨天終於減碼，但還沒說為什麼撐了十五天。
- [ ] 一項後果碎片：模擬損益 −11.80%，旁邊固定寫「截至前一交易日收盤（2026-03-17）」。
- [ ] 主動作是「翻開今天的人生誌」。

### 6.4 人生誌 `/people/{id}/journal`

- [ ] 五個交易日章節，每章九段順序一致。
- [ ] 第二章（2026-03-03）看得到他當時的逐字原話（有 artifact id 與 digest 前 8 碼可核對），
      以及**不加引號**的結構化建倉理由。
- [ ] 第四章（2026-03-10）看得到改口：引用的理由換過，但新增支持事實是 0。
- [ ] 第四、第五章出現「老毛病又回來了」，第一、二、三章沒有。
- [ ] 「打開完整人生檔案」只出現在頁面**最底部**，全頁只有這一個入口。

### 6.5 深層檔案索引 `/people/{id}/archive`

- [ ] 肖像與一句長期自我矛盾在最上面，接著是「最近留下的三件事」。
- [ ] 六節依序是：模擬紀錄、關係、本命盤、性格與習慣、記憶、生平。
- [ ] 只有「模擬紀錄」可以點進去；其餘五節顯示可讀的「本切片只做到入口」說明，
      不是按下去沒反應的灰色按鈕。
- [ ] 每一節都掛著資料身分標籤，本命盤是「象徵解讀」。

### 6.6 模擬紀錄 `/people/{id}/archive/paper`

持股主卡由上到下固定七段，順序不變：

- [ ] 1 人物動詞。今天（2026-03-18）盤中還沒收盤定案，所以這一句只能講前一個交易日
      已公開的狀態，**不會**出現「他終於減碼」這種同日動詞，也不會帶標的名稱。
- [ ] 2 資料截至時間：截至前一交易日收盤（2026-03-17）。
- [ ] 3 持有 600 股、成本 60,000.00、現值 52,920.00、曝險、持有天數 15。
- [ ] 4 已實現 −4,720.00（虧損）與未實現 −7,080.00（−11.80%，虧損）**同時**出現。
      虧損不會被折疊、不會被淡化，獲利與虧損的字級與版位相同。
- [ ] 5 原始理由（無引號、含 thesis-hist-001）、失效條件標成「已發生（已觸發）」，
      以及當時的逐字原話。
- [ ] 6 現在說法（逐字引用）加上一行「新增支持事實：0 筆」。
- [ ] 7 關係、記憶與資料節點（部位識別碼、紙上版本集、來源修訂）。
- [ ] 交易紀錄最後一列是 2026-03-18：只有日期與一句說明，**沒有任何數字**，也沒有標的、
      方向、數量、信心或理由。這是 finality fence 的另一側，跟上面五列同屏對照。

### 6.7 全站紅線（每一頁都要成立）

- [ ] 沒有任何跨角色的績效比較、名次或勝負標籤。
- [ ] 沒有交易指令、沒有買賣按鈕、沒有自由輸入的 prompt。
- [ ] 每個對外可見的宣稱都掛著一個資料身分標籤，而且從不出現「真實資料」。
- [ ] 缺資料的地方寫「資料未到」，不是 0、不是空白、不是猜測值。

## 7. 驗證指令總表

```sh
corepack pnpm --filter @panshi/web test    # 前端單元測試（含持股主卡七段）
corepack pnpm --filter @panshi/web check   # 前端型別檢查
corepack pnpm slice:verify                 # 端到端走查
corepack pnpm check                        # 全部契約與 fixture audit
cargo test -p panshi-character-episode     # 事件與投影的 Rust 測試
```

## 8. 本切片的已知邊界

這些不是 bug，是這一刀切下去時明確留在外面的東西：

- **只有一名角色**。世界裡沒有第二個人，也沒有關係雙向聚合；同組同事只以人生誌節點與
  **單向可觀察動作**存在（他把提醒滑掉、他避開座位、他走回去），介面不替她寫台詞。
- **時間軸是靜態的**。`/events/v2/world` 的 SSE 沒有接；畫面不會自己往前走，重新整理也一樣。
- **市場事實全部是合成 historical fixture**，六個交易時段都由 repo 內自有的 manifest 封存，
  資料身分一律是「虛構設定」，永遠不是真實資料。上游的即時事實管線不在這一刀裡。
- **深層檔案只有模擬紀錄有真頁**。關係、本命盤、性格與習慣、記憶、生平五節只有索引摘要；
  摘要本身已經是最終形狀，之後補的是頁面，不是資料結構。
- **事件沒有寫進資料庫**。事件以 `.pb` 落在 `fixtures/v5/one-character-slice/events/`，
  形狀與既有 `stream_type` 命名一致，之後可以直接 append 進 event store。
- **`/api/v2/*` 由 dev/preview 中介層提供**，只在本機開發時存在。正式服務要換成真的服務端，
  路徑與回應形狀不變。
- **「新增支持事實：0」目前是從投影自己封存的後果摘要文字裡嚴格擷取**的，
  `public-v2.yaml` 還沒有結構化欄位；投影沒寫時介面顯示「資料未到」，不代算。
- **金額格式**：全站唯一一份換算在 `apps/web/src/v5/format.ts` 的 `minorUnitsToTwd()`，
  `TWD_MINOR_UNIT_DECIMALS = 2`（1 minor unit ＝ 0.01 元），與 Rust 發射端一致。模擬紀錄頁
  原本自帶一份私有實作，已移除並改用同一個函式；`paperCard.test.ts` 用函式同一性斷言鎖住，
  再複製一份就會紅。**不要再另寫換算**。
- **角色美術是 CSS／SVG 幾何佔位**。正式角色美術（含可重現的產生紀錄與使用授權）待另案處理，
  本切片不產生任何圖檔。
- **封測姿態**：不接金流、不顯示廣告、不做試用倒數。

## 9. 卡住時

| 症狀 | 通常原因 |
| --- | --- |
| `/world` 出現「找不到這個頁面」 | 網址打成別的 path；切片只有五個公開位址 |
| 任何一頁顯示「這頁現在不可見」加 `UNKNOWN_RESOURCE` | fixture 還沒產生，回步驟 3 |
| 顯示「回應缺少契約必填欄位」 | fixture 是舊版；重跑步驟 3 的兩條指令 |
| 走查腳本說 dev server 沒就緒 | 4173 埠被佔用；先關掉既有的 dev server |
| 數字看起來差 100 倍 | 有人另寫了一份金額換算而沒走 `format.ts` 的 `minorUnitsToTwd()`，見第 8 節 |

# 一名角色垂直切片：跑起來與走查

這份文件給「沒讀過任何規格、只想把切片跑起來看一眼」的人。照著做即可；不需要先讀
`product-constitution.md` 或 `experience-spec.md`。

切片的內容是一名虛構成年居民（陸硯之，28 歲，企業研究助理）在三十個合成歷史交易日裡
留下的完整紙上承擔：持股、損益、當初的理由、後來的改口，以及一次在組會上把虧損推給
同事、後來又自己承認的關係後果。三十天內可以從 canonical 事件重播追高、凹單、錯過、
認錯、推給別人各至少一次。走查路徑就是產品結構本身：

```text
公共世界 → 跟拍 → 角色近景 → 角色人生誌 → 深層檔案索引 → 模擬紀錄／關係／本命盤／性格與習慣／記憶／生平
```

近景另有一個直接到他模擬紀錄的「持股與理由」入口：世界 →（1）點居民 →（2）看他的近況 →
（3）持股與理由，三次操作內看到成本、損益、原始理由與退出條件。

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

第一條寫出 canonical 事件（`.pb`，目前 393 筆，檔名是三位數序號 `000-…pb` 起，維持字典序
＝發射順序）；第二條把同一串事件重播成
`contracts/openapi/public-v2.yaml` 定義的十個回應物件（外加一份路由索引 `index.json`）。
**先跑第一條再跑第二條**：第二條讀的是同一份事件序列，兩者不一致時投影會失敗，而不是靜靜地補值。

### 3.1 公開 API 路由一覽

`index.json` 列出十條路由，每條對應 `fixtures/v5/one-character-slice/api/v2/` 底下一個檔案：

| 路由 | 內容 |
| --- | --- |
| `/api/v2/world` | 公共世界快照：一名居民、今日五幕索引、市場時鐘 |
| `/api/v2/characters/{id}/close-up` | 人物近景：未解矛盾、最近一句公開原話與自我承認、一項後果碎片 |
| `/api/v2/characters/{id}/life-journal` | 人生誌：已公開章節 `entries`，以及只帶 id／日期／原因的 `heldEntries` |
| `/api/v2/characters/{id}/archive` | 深層檔案索引：六節各自的摘要與 `sectionPath`（六節都非 null） |
| `/api/v2/characters/{id}/archive/paper` | 模擬紀錄：帳戶、部位、交易紀錄、紙上版本集 |
| `/api/v2/characters/{id}/archive/relations` | 關係：熟人節點（顯示名＋關係標籤，不給原始 key）、他單向的可觀察互動、他公開原話留下的關係訊號（逐字引用 artifact）、對方一側一律標「未知」 |
| `/api/v2/characters/{id}/archive/chart` | 本命盤：虛構出生身分、象徵主題（`symbolic_interpretation`，明寫只影響注意與解讀、不影響價格或績效）、作用時段與喚起它的章節；未由封存出生資料算出的盤面是帶原因的空清單 |
| `/api/v2/characters/{id}/archive/traits` | 性格與習慣：四軸偏好、核心需要／恐懼、血型（只影響社交語氣）、習慣、偏誤逐次列出並附證據時段，以及反例；沒有分數、總量或排行 |
| `/api/v2/characters/{id}/archive/memories` | 記憶：只列 `subscriber_archive`／`public_edition` 的 `MemoryFormed`，附來源事件；`canonical_restricted` 連數量都不出現 |
| `/api/v2/characters/{id}/archive/life` | 生平：虛構成年人的身分與合成出生地、生平里程碑、到來時就有的記憶、底盤沒封存的面向（列為未記錄，不補寫）、三十個交易時段的章節指標 |

五節的每一個 item 都帶 `truthClass` 與非空的 `sourceRefs`：來源不是 canonical 事件（事件型別＋
全域位置＋stream）就是人物底盤 `crate::slice::seed` 裡的具名錨點。人生誌每章另有 typed
`evidenceCard`（動作、紙上後果、逐字原話、記憶與關係 ref）、`narrativeState`、`entryVisibility`
與可讀的 `relationshipConsequence`；敘事失敗時章節改為 `evidence_card_only`，後果仍完整。

**逐項身分與系統說明（public-v2 2.1.x → 2.2.0）。** 每一項會上畫面的宣稱都在**自己的物件上**
帶身分：單一欄位 `x` 用同層的 `xTruthClass`，整個物件就是一項宣稱時用它自己的 `truthClass`，
字串清單用平行的 `<單數>TruthClasses[i]`。2.2.0 起沒有任何欄位向外層借身分：記憶裡提到的人
（`involvedPeople[].truthClass`，人名與關係是人物設定 `fictional_setting`）、關係訊號上對方的
`displayNameTruthClass`／`relationLabelTruthClass`（`fictional_setting`；訊號本身的
`truthClass` 是他的行為 `simulated_narrative`）、訊號裡引用的原話（`utterance.truthClass`，
他說的話 `simulated_narrative`）、每一筆 lot 與每一筆成交（`truthClass`，紙上數字
`simulated_narrative`，與同頁其他紙上數字相同）。前端只讀這些逐項身分；缺了、不合法、或巢狀
數字和上層不同，那一項就不顯示並寫原因（fail closed），不改掛別的身分。
`*EmptyReason`、`*NullReason`、`heldReasonLabel`、`tombstoneReasonLabel` 是**系統說明**：它講
系統（清單為什麼空、值為什麼是 null、這章為什麼暫不公開），不是對角色或市場的宣稱，所以不帶
身分。契約以 `x-panshi-system-label: true` 標記這些欄位，每個欄位允許的固定句全集在
`contracts/openapi/public-v2-system-labels.json`（同檔的 `nonClaimNumberKeys` 列出出處、版本與
場景座標這類不是宣稱的數字鍵）；畫面以系統說明樣式呈現（句首標「系統說明」、不掛身分標籤）。
`tools/character-episode/tests/slice_claim_truth_classes.rs` 掃描十一份 JSON，要求每一個中文字串
與每一個數字不是在自己的物件上有身分、就是在上述清單內，0 例外。
`tools/v5-slice-api-audit.mjs` 的交易動詞句子規則（舊的禁語清單與語型已併入，受同一條主詞規則約束）是最後防線、
不是主要控制（主要控制在生成管線：版本化的 deterministic 模板與模型不能決定的 policy gate）。規則以句為單位
（。！？；或換行切句，「」『』內的話另成一句獨立判定，誰說的都一樣）：句中有交易動詞時，整句只要對讀者說話
（你／您／我們／大家／各位／想賺的…）就擋，沒有例外；否則動詞前必須找得到敘事主詞（他／她／他們／她們，或投影裡
讀得到的角色名；「我」只在引語內算），主詞可以在同句前面的子句（逗號不切斷），或在同欄位同段落的前一句、且這句
以覺得／打算／看到／沒有這類述語開頭；角色封存原話 `canonicalTextUtf8` 與部位 `consequenceSummary` 的說話者由
契約決定，只能豁免不在語型或禁語內、也沒有催促語氣的單一動詞。句子帶催促語氣（吧、！、何不、是時候、快＋動詞、
再不…就晚了、…會後悔等）時，主詞必須就在動詞自己的子句裡，借來的主詞不算。殘餘風險是不帶清單內交易動詞的催促
（口語代稱、隱喻）、自帶第三人稱主詞卻讀起來像在勸讀者的子句（例如「他覺得這種價位不買以後一定後悔」）都可能
通過掃描，反過來沒有主詞的字面用法（例如搭車的「下車」）會被誤擋；audit 綠燈不等於沒有文案讀起來像投資建議。
以上段落是工程文件，未經 copy-taste 審稿。

市場事實全部是這個 repo 自有的合成歷史 fixture（`contracts/world-fact-manifest/historical-v1/`），
不連任何外部行情來源，也不讀另一個 repo。日期是**合成日曆**：2026-03-02 起連續的平日，
扣掉兩個宣告的合成休市日（2026-04-03、2026-04-06），第 30 個交易日是 2026-04-14。
它不是、也不宣稱是真實交易所的日曆。

如果先前留著舊版（兩位數檔名）的事件檔，重新產生前先把
`fixtures/v5/one-character-slice/events/` 與 `api/` 整個刪掉再跑，舊檔不會被覆蓋。

## 4. 啟動並開啟切片

```sh
corepack pnpm --filter @panshi/web dev
```

然後開：

```text
http://127.0.0.1:4173/
```

裸網址就是公共世界；`/world` 是同一畫面的正式位址（外殼往 history 推的也是它）。

dev server 會把 `/api/v2/*` 對映到步驟 3 產生的 fixture，所以瀏覽器打的是**真的公開路徑**、
拿的是**最終 API 形狀**。fixture 重新產生後不需要重啟 dev server。

同一個 dev server 上還掛著封存的 research-v4 研究版，位址是 `/study`（受測連結
`/study/P01?visit=1`）與 `/research`。它不再佔用根位址，內容、同意流程與匯出都沒有改。
兩個 app 都不吃 SPA fallback：`/journal` 這種不存在的路徑回 404，不會掉進另一個 app。

`corepack pnpm slice:dev` 是同一件事的捷徑，它會先提醒你跑 `slice:emit`。

## 5. 自動走查

```sh
corepack pnpm slice:verify
# 等同於： node tools/v5-slice-walkthrough.mjs
```

它自己開一個 dev server 子行程（127.0.0.1:4173）、等就緒、依序打十一條檢查並印出十一行 `PASS`
（`PASS [n/11]`），結束時關掉子行程。任何一條失敗會印出失敗原因並以非 0 結束。
4173 埠被佔用時它會直接失敗，先關掉既有的 dev server 再跑。

十一條檢查：

1. `GET /world` 回傳切片外殼（HTML）。
2. `GET /api/v2/world` 只有一名居民。
3. `GET /api/v2/characters/{id}/close-up` 有未解矛盾與後果碎片，資料截至 2026-04-13。
4. `GET /api/v2/characters/{id}/life-journal` 二十九章、日期嚴格遞增，第二章有當時原話、
   第四章（2026-03-05）有重複模式，恰好一章（推給別人那天）帶關係訊號。
5. `GET /api/v2/characters/{id}/archive` 六節依固定順序（模擬紀錄、關係、本命盤、性格與習慣、
   記憶、生平），每一節的 `sectionPath` 都是 `/api/v2/characters/{id}/archive/{key}`。
6. `GET /api/v2/characters/{id}/archive/paper` 有完整紙上承擔，且今天那筆沒有揭露 key。
7. `/people/{id}/archive/relations`：頁面路徑回切片外殼（HTML）；API 每個 item 都有
   `truthClass` 與非空 `sourceRefs`；每位熟人有顯示名與關係標籤，對方那一側一律 `unknown`。
8. `/people/{id}/archive/chart`：同上，且每個象徵主題的 `effectScopeLabel` 明寫「只影響注意與解讀」。
9. `/people/{id}/archive/traits`：同上，偏誤逐次列出、沒有任何分數／排名／次數欄位，並附反例。
10. `/people/{id}/archive/memories`：同上，且不列任何 `canonical_restricted` 記憶。
11. `/people/{id}/archive/life`：同上，且 `identity.adultFictionalResident` 是 `true`、年齡至少 18。

每一份回應（十六份：六條 API ＋ 五節 API ＋ 五個頁面外殼）同時會被掃一次：本切片的市場事實是合成 fixture，任何一份回應出現
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
- [ ] 一句未解矛盾：他在 2026-03-27 的組會上把虧損說成別人的關係，2026-04-08 又說是自己
      判斷錯了；第一次那句話還沒有收回。
- [ ] 一項後果碎片：模擬損益 −12.80%，旁邊固定寫「截至前一交易日收盤（2026-04-13）」。
- [ ] 主動作是「翻開今天的人生誌」。
- [ ] 動作列有「持股與理由」連結，指向 `/people/{id}/archive/paper`；點下去就是他的模擬紀錄。

### 6.4 人生誌 `/people/{id}/journal`

- [ ] 二十九個交易日章節（每個已接受收盤的交易日一章），每章九段順序一致。
- [ ] 第二章（2026-03-03）看得到他當時的逐字原話（有 artifact id 與 digest 前 8 碼可核對），
      以及**不加引號**的結構化建倉理由。
- [ ] 2026-03-10 那章看得到改口：引用的理由換過，但新增支持事實是 0。
- [ ] 2026-03-05 到 2026-03-16 的八章出現「老毛病又回來了」；前三章沒有，2026-03-17 他終於
      打開那份反面資料之後也不再出現。
- [ ] 2026-03-17 那章的「現在怎麼說」是他第一次的自我承認原話。
- [ ] 2026-03-27 那章：組會上他的原話把虧損推給「旁邊的人」，章末問題是他會不會收回；
      這是全誌唯一帶關係訊號的一章。
- [ ] 2026-04-08 那章：又一次組會、又一次虧損，這次原話說是自己判斷錯了。
- [ ] 每章都有錨點：網址加上 `#chapter-2026-03-03` 會直接落在那一章。
- [ ] 改口的章節（2026-03-10、2026-03-17、2026-03-27、2026-04-08）在那句話旁邊有「回到原話（2026-03-03）」
      連結；點一下就跳到 2026-03-03 那章，同一處看得到當時的逐字原話、「他其實知道什麼」與
      「他漏掉了什麼」。
- [ ] 同一章下面有「原本理由｜現在說法｜紙上代價｜關係後果」四欄並排；把視窗縮到手機寬度，
      四欄依同樣順序往下堆疊，每欄的欄標題還在。
- [ ] 原話顯示成「」引號包住的一句話；引號是 CSS 產生的，選取文字複製出來就是 artifact 原文。
- [ ] 某一章若是 `evidence_card_only`（敘事沒有到），那一章只剩證據卡：動作、紙上後果數字與原話，
      沒有九段也沒有敘事句；某一章若被 HELD，那一章只有日期與原因一句話。真 fixture 目前沒有這
      兩種章節，由 `apps/web/src/v5/archiveNavigation.test.tsx` 的 `[evidence-card]`／`[entry-held]`
      覆蓋。
- [ ] 「打開完整人生檔案」只出現在頁面**最底部**，全頁只有這一個入口。

### 6.5 深層檔案索引 `/people/{id}/archive`

- [ ] 肖像與一句長期自我矛盾在最上面，接著是「最近留下的三件事」。
- [ ] 六節依序是：模擬紀錄、關係、本命盤、性格與習慣、記憶、生平。
- [ ] 六節都有「打開…」按鈕，點下去換到各自的頁面（`/people/{id}/archive/{key}`）。
- [ ] 每一節都掛著資料身分標籤，本命盤是「象徵解讀」。

### 6.6 模擬紀錄 `/people/{id}/archive/paper`

持股主卡由上到下固定七段，順序不變：

- [ ] 1 人物動詞。今天（2026-04-14）盤中還沒收盤定案，所以這一句只能講前一個交易日
      已公開的狀態，**不會**出現同日動詞，也不會帶標的名稱。
- [ ] 2 資料截至時間：截至前一交易日收盤（2026-04-13）。
- [ ] 3 持有 600 股、成本 60,000.00、現值 52,320.00、曝險、**至今持有天數 42**（`heldDays`：
      建倉 2026-03-03 算第 1 天，數到資料截至日 2026-04-13）。標籤刻意寫「至今」，因為第 7 段
      下面逐字印出的 `consequenceSummary`（見下一項）另外提到一個 15，兩個數字都對、講的不是
      同一段區間，畫面用詞先分開，不要看到兩個「持有…天」就以為哪一個錯了。
- [ ] 3a 七段主卡結束、四欄並排之前，逐字印出這個部位的 `consequenceSummary`：
      「持有 15 天後減碼 400 股，實現虧損 4,720 元；剩下 600 股仍在，未實現虧損 7,680 元。
      引用的理由換過一次，新增支持事實 0 筆。」這裡的 15 天是**減碼前持有天數**：從建倉
      2026-03-03 數到那次減碼 2026-03-17（同一個 `heldDays` 公式、起點相同，終點是減碼日
      不是今天），跟第 3 段「至今持有天數 42」是兩個合法不同的量，不是同一件事重覆寫錯。
- [ ] 4 已實現 −4,720.00（虧損）與未實現 −7,680.00（−12.80%，虧損）**同時**出現。
      虧損不會被折疊、不會被淡化，獲利與虧損的字級與版位相同。
- [ ] 5 原始理由（無引號、含 thesis-hist-001）、失效條件標成「已發生（已觸發）」，
      以及當時的逐字原話。
- [ ] 6 現在說法（逐字引用）加上一行「新增支持事實：0 筆」。
- [ ] 7 關係、記憶與資料節點（部位識別碼、紙上版本集、來源修訂）。
- [ ] 主卡下面有「原本理由｜現在說法｜紙上代價｜關係後果」四欄並排：理由與當時原話、現在說法、
      成本與已實現／未實現損益（方向有文字）、影響來源（目前是帶原因的空清單）。第 5 段的標籤是
      「退出條件（失效條件）」。
- [ ] 交易紀錄共三十列，最後一列是 2026-04-14：只有日期與一句說明，**沒有任何數字**，也沒有
      標的、方向、數量、信心或理由。這是 finality fence 的另一側，跟上面二十九列同屏對照。

### 6.6a 深層檔案其餘五節 `/people/{id}/archive/{relations|chart|traits|memories|life}`

五節共同：每一項都掛自己的資料身分標籤；畫面上沒有任何原始 id 或 digest；章節一律以日期出現，
「回到 YYYY-MM-DD 的章節」會換到人生誌並落在那一章；頁底是「回到完整人生檔案」。

- [ ] 關係：陳小雨（同組同事）的關係說明、他在她身邊的五次單向可觀察動作、2026-03-27 那筆關係
      訊號（附他當時的逐字原話），以及「她那一側」只寫未知的原因。
- [ ] 本命盤：頁首明寫「本命盤只影響注意與解讀」；出生資料、帶原因的空盤面、象徵主題「控制與認可」
      的作用期間、作用中的時段與四次章節解讀。
- [ ] 性格與習慣：四軸只寫傾向文字（沒有分數或長條）、核心需求與恐懼、血型與它的作用範圍、自述、
      習慣；「老毛病，逐次記下」每一次發生一列、依日期排列、各自連回那一章，**沒有次數、分數或排名**；
      「那一次沒有發生」的反例在同一頁。
- [ ] 記憶：分成「來到這裡之前」與「在這座城市形成的記憶」，每則有情緒、把握程度（文字百分比）與
      可見範圍；沒有重新解讀的寫出原因。
- [ ] 生平：虛構成年居民的身分、人生節點、帶進來的記憶、沒有記下的部分（只列原因，不補寫），以及
      三十個交易時段；今天盤中那一格寫「盤中，這一章還沒出版」，不做假連結。

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
  **單向可觀察動作**存在（他把提醒滑掉、他避開座位、他走回去、茶水間、組會），介面不替
  她寫台詞。他在組會上點名她那一次，會在他這一側的 dyad stream 留下一筆
  `RelationshipSignalObserved`：只引用那則 `PublicClaimMade` 與原話的 artifact id／hash，
  不存第二份文字，也不替她寫任何狀態或反應；同時形成一筆 relationship 記憶。
- **推給別人是算出來的，不是劇本寫的**。組會上點名誰，由壓力、核心恐懼（公開顯得無知）、
  是否公開場合、近期與誰互動的記憶決定（`crates/character-domain/src/attribution.rs`）；
  是不是「甩鍋」再由 `BlameShift` 對照當時那筆決策實際引用的資料判定：對方若確實提供了
  後來被更正的錯誤資訊、而他當時也依賴了，就不算。
- **時間軸是靜態的**。`/events/v2/world` 的 SSE 沒有接；畫面不會自己往前走，重新整理也一樣。
- **市場事實全部是合成 historical fixture**，三十個交易日都由 repo 內自有的 manifest 封存，
  日期是合成日曆，資料身分一律是「虛構設定」，永遠不是真實資料。上游的即時事實管線不在
  這一刀裡。
- **新增的繁中句子都是工程 placeholder，未經 copy-taste 審稿**（每日章節的動作、理由、
  章末問題由投影從 canonical 資料組句；推託與承認的原話來自版本化的 deterministic
  fallback 模板）。
- **深層檔案六節都有 API 端點與前端頁面**。五節的畫面文案（段名、說明句、空狀態）是工程
  placeholder，未經 copy-taste 審稿。前端對五節回應做 fail-closed 驗證：缺必填欄位、item 沒有
  `truthClass` 或 `sourceRefs`、清單與 `*EmptyReason` 不一致，整份就顯示「回應缺少契約必填欄位」。
- **「改口」是由欄位推出來的，不讀語意**：同一個部位第一次出現可核對當時原話的章節是「原話」，
  之後同一部位出現另一份 artifact 的說法就是改口（`apps/web/src/v5/journalRevisions.ts`）。原話之前
  有 HELD 章節、或原話那章只剩證據卡時，不產生「回到原話」連結。
- **本命盤不列星座位置**。人物底盤只封存了一個象徵主題；完整盤面要由封存的出生資料計算，
  這一版沒有，所以 `placements` 是帶原因的空清單，不手填星座。
- **`influencedBy` 目前是空的**。沒有任何封存事件記錄別人影響過這個部位的決定；他在組會上把
  虧損歸到同事身上是他自己的說法，放在關係頁，不當成影響事實。
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
| `/` 或 `/world` 出現「找不到這個頁面」 | 網址打成別的 path；切片的公開位址是 `/world`、`/people/{id}`、`/journal`、`/archive` 與六節 `/archive/{key}`（根位址等同 `/world`） |
| 打某個路徑回 404 空白頁 | 那個路徑不屬於切片也不屬於 `/study`；dev server 故意不做 SPA fallback |
| 任何一頁顯示「這頁現在不可見」加 `UNKNOWN_RESOURCE` | fixture 還沒產生，回步驟 3 |
| 顯示「回應缺少契約必填欄位」 | fixture 是舊版；重跑步驟 3 的兩條指令 |
| 走查腳本說 dev server 沒就緒 | 4173 埠被佔用；先關掉既有的 dev server |
| 數字看起來差 100 倍 | 有人另寫了一份金額換算而沒走 `format.ts` 的 `minorUnitsToTwd()`，見第 8 節 |

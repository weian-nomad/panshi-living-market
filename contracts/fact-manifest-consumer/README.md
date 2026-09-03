# `fact-manifest/v1` — pinned 唯讀消費者副本

本目錄是 ADR-0001（`docs/repository-boundary.md`）生產者／消費者分工的**消費者半條**。生產者是研究產品 `company-chart-stock`，它擁有 schema、封存 sealed bytes；本 repo 只做三件事：

1. **pin 一個 exact 發布版本**，建立唯讀 mirror（`pinned/`）。
2. 用**自己寫的**驗證器（`verify.mjs`）對同一份 bytes 重算、逐欄比對。
3. 任一條不符就 **exit ≠ 0 ＝ 隔離告警**，不寬鬆解析、不繞過、不「先記 warning 繼續」。

第 2 點的「自己寫的」是重點：conformance 的意義是**兩個獨立實作對同一份 bytes 得到相同判定**。`verify.mjs` 沒有 import 生產者的任何程式碼，只依據生產者 README 記載的慣例重寫一遍。

```
pnpm audit:fact-manifest-consumer      # self-test + verify
node contracts/fact-manifest-consumer/verify.mjs
node contracts/fact-manifest-consumer/self-test.mjs
```

> **待辦（本工作包刻意沒做）：** `audit:fact-manifest-consumer` **尚未**串進 `package.json` 的 `check` 聚合腳本，因為那條 script 行同時是其他工作包的熱點，本工作包的邊界只允許新增一個 script。串進去是下一個小改動，串之前這支只有人工／CI 顯式呼叫才會跑，fixture 漂移不會自動被擋。

## 目錄內容

| 路徑 | 是什麼 |
| --- | --- |
| `pinned/schema.json` | 生產者 `contracts/fact-manifest/schema.json` 的逐位元組副本（draft 2020-12） |
| `pinned/fixtures/v0.1.0/` | 生產者發布的 conformance fixtures（5 份 manifest ＋ sealed bundle）的逐位元組副本 |
| `pinned/fixtures/v0.1.0/README.md` | 生產者對這批 fixture 的 provenance 說明（**隨副本一起帶過來，不要刪**） |
| `pinned/INDEX.json` | 本 repo 自己的 pin：每份檔案的 SHA-256、`manifestId`、`manifestHash`、`objectHash`、兩個 set digest 與筆數 |
| `verify.mjs` | 零依賴唯讀驗證器 |
| `self-test.mjs` | 對驗證器本身的負向測試：把副本改壞，驗證器**必須**拒絕 |

`pinned/` 底下的東西**不得就地修改**。上游發新版本時的作法是**新增** `pinned/fixtures/vX.Y.Z/` 與對應的 INDEX 條目，不是覆蓋既有的；舊版本要留到讀取窗口關閉為止。

## 硬性邊界（這支腳本刻意不做的事）

- **不 import `crates/protocol`、`crates/domain`、角色引擎，或本 repo 任何 package。** 只用 Node builtins（`node:fs` / `node:path` / `node:crypto` / `node:url` / `node:child_process`，最後一個只有 self-test 用來把 verifier 當子行程跑）。可以直接 `node` 執行，不需要 build、不需要 workspace。
- **不讀任何上游資料庫，不掛載生產者的 SQLite/Postgres。** ADR-0001 明文禁止；契約只能經 semver 化的 sealed manifest 消費。
- **不抓網路。** 連 `objectUri` 都不抓 —— 要驗的 bundle 就是 pinned 的同層檔案。抓取會讓 CI 依賴外部主機，也會把 MUST 15 (a)-(c)（DNS rebinding / SSRF、跨 origin redirect、punycode 同形字）這些**真實 ingest 路徑**的義務混進一個契約檢查裡。因此 verifier 只斷言它離線判得了的 MUST 15(d)（origin 命中 pin），其餘明說不管，而不是假裝有驗。
- **不寬鬆解析。** 未實作的 schema 關鍵字、驗證器處理不了的關鍵字值形狀（draft-07 tuple 形式 `items`、布林 subschema、`additionalProperties: true`、遠端 `$ref`）一律**大聲失敗**，不是靜默略過 —— 靜默略過的驗證器會對它從沒檢查過的約束報綠燈。

## `verify.mjs` 實際檢查什麼

對 `pinned/INDEX.json` 列出的每一份 manifest：

1. **bytes 對得上 pin**：manifest 與 bundle 的 SHA-256 等於 INDEX 記的值；schema 檔案本身也比對。
2. **結構驗證**：用 pinned schema 跑零依賴 2020-12 子集驗證器；`format` 當 annotation 不當 assertion（規範預設行為），所以每條字串約束都必須靠 `pattern` / `minLength` 站得住。未知欄位由 `additionalProperties: false` 直接拒。
3. **版本 pin**：`contractVersion` / `modeDomain` / `jurisdiction` 必須是本消費者已 pin 的值。宣稱 `current` 模式或非 `TW` 的封包＝未支援版本＝隔離。
4. **逐欄比對 pin**：`manifestId`、`manifestHash`、`objectHash`、兩個 set digest、兩組 allowlist 筆數，逐欄與 INDEX 比對。
5. **重算所有雜湊**：`manifestHash`（**只排除自身**、`objectHash` 留在被雜湊的 bytes 內）、兩個 set digest（去重、UTF-8 位元組排序、單一 `\n` 接合）、`objectHash`（對 bundle bytes）。另外斷言**檔案 bytes 本身就是 JCS 正規形式** —— 若不是，`sha256(檔案) === objectHash` 只是這幾個檔案的巧合，不是契約性質。
6. **跨欄位 MUST 清單**（生產者 README「消費者 MUST 檢查的跨欄位不變式」）：rights 視窗（1、2、3）、`interactionCutoffAt <= evidenceCutoffAt <= sealedAt`（4、5）、兩個 cutoff 的 Asia/Taipei 日期不早於 `marketDateTaipei`（6）、歷史可知性逐筆（8）、allowlist 雙向解析（9）、digest 重算（10、11）、purposes / licence / 簽章金鑰參照命中本消費者 allowlist（12、13、14）、`objectUri` origin 命中 pin（15d）、每個時間欄位都解析得成真實瞬時（16，會回推比對年月日時分秒，不只看 `Date.parse` 非 NaN）。
7. **bundle 側**：id 不重複、筆數對得上 pin、兩組 allowlist 不重疊、bundle 內沒有任何 allowlist 之外的 revision、更正（`manifestRevision >= 2`）必須指名 `supersedesManifestId`，以及 attestation 區塊四個值逐一比對字面值（`securityDirectionWeight` 必須恰為 `0`）。

第 7 條沒有涵蓋的 MUST 7（`marketDateTaipei` 依交易日曆是真實交易日）**本消費者現在做不到**：本 repo 沒有 pin 任何交易日曆，生產者的 `marketCalendarRevision` 目前也還沒有真正簽發的來源。這條列在下面的風險紀錄裡，而不是被假裝驗過。

## 風險紀錄（不得對外淡化）

- **這套驗證證明的是 pinned bytes 的自洽性（integrity），不是來源鑑別（authenticity）。** `fact-manifest/v1` 只有 `signatureKeyId`（金鑰參照），**沒有簽章值欄位**。掌握發布通道的人可以重新產生一整份自我一致的 envelope，本驗證器抓不到 —— `self-test.mjs` 的案例二只擋得住「envelope 與 bundle 被一起改、但 bundle bytes 沒跟著改」那一層。來源信任目前完全依賴 mirror 是怎麼取得的（pin 的發布來源、TLS）。補上 detached signature 屬生產者的 additive（minor）工作。
- **pinned 發布 v0.1.0 的 fixture 是合成輸入封出來的**，不是真實交易日。形狀與雜湊算術可 conformance，市場內容不可。詳見 `pinned/fixtures/v0.1.0/README.md`。任何下游敘述都不得把它講成「已消費到真實市場事實」。
- **bundle 裡的 `provenanceClass: "real_fact"` 不可以直接映成本 repo 的 `truth_class: real_fact`。** 那個欄位是生產者契約的常數，描述該欄位在真實發布時承載的資料類別；本批 fixture 的底層 datum 是合成的。拿 v0.1.0 的內容驅動任何可見畫面時，`truth_class` 必須降級處理（AGENTS.md「每個可見宣稱帶一個 `truth_class`」是硬不變式），或乾脆不要拿 fixture 驅動可見畫面 —— 它的用途是驗證器對驗，不是內容來源。
- **rights 視窗會過期。** v0.1.0 的 `rightsValidUntil` 是 `2027-07-01T00:00:00Z`。MUST 3 是**每次 bind 都要重跑**的閘門，因此 verifier 在該日之後會直接 exit 1 —— 那是契約在正常運作，不是 bug，正確反應是 pin 一個新的契約發布，不是放寬檢查。到期前 90 天內驗證器會先印出提醒行。
- **MUST 7（真實交易日）未驗**，見上。
- **MUST 15 的 (a)(b)(c)** 是真實 ingest 取檔路徑的義務，本驗證器不抓網路所以不涉及；哪天真的要抓 `objectUri`，那些必須先實作，而且**不得**先抓再判。

## 上游對應

- 生產者契約正本：`company-chart-stock` 的 `contracts/fact-manifest/`（`schema.json` / `README.md` / `CHANGELOG.md` / `fixtures/`）。
- 版本規則（patch / minor / major 與讀取窗口）：該 repo 的 `contracts/fact-manifest/CHANGELOG.md`。
- 裁決理由：該 repo 的 `docs/adr/0001-fact-manifest-contract-ownership.md`，以及本 repo 的 `docs/repository-boundary.md`。

同 repo 舊的 `contracts/sealed-facts/v1/`（superseded / legacy）與 `contracts/world-fact-manifest/v1/`（未經生產者批准的消費者草稿）**都不是**契約來源，也與本目錄無關；本目錄不得為了與它們相容而放寬任何驗證。

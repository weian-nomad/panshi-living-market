# `fact-manifest/v1` conformance fixtures — 契約發布 v0.1.0

本目錄是**生產者發布的 conformance fixtures**：pinned 消費者可以複製整份唯讀副本，重算雜湊逐欄比對，藉此證明「消費者的驗證器」與「生產者的 emit 管線」對同一份 bytes 得到相同判定。

版本規則與變更紀錄見 `../../CHANGELOG.md`。

## 🔴 先講清楚：這些是**合成**輸入封出來的，不是真實交易日

| 問題 | 答案 |
| --- | --- |
| 這些檔案是真的交易日資料嗎？ | **不是。** 每一組輸入（`DailyFiveSelection`、ingest ledger、發布身分）都由 `scripts/emit-fact-manifest-fixtures.ts` 手寫，ledger 以 `ingestDayLookup` **注入**，本機市場庫從頭到尾沒有被讀取。 |
| 那 bytes 是真的嗎？ | **是。** 這些 bytes 是**真的由 order 4 的 `emitFactManifest()` 產生**的，未經手改；`manifestHash` / `objectHash` / 兩個 set digest 都是對這些 bytes 實算出來的。可 conformance 的是**形狀與雜湊算術**，不是市場內容。 |
| 可以拿來當「真實交易日通過 schema 驗證」的證據嗎？ | **不可以。** 研究筆記 `PANSHI-RESEARCH-x-GAME-CONNECTION-2026-07-23.md:230` 的第三條驗收條件**仍未達成**（本機 `data/panshi-market.db` 為空庫、上游行情主機在本環境不通），理由與前置條件見 `../../README.md`。 |
| bundle 裡的 `provenanceClass: "real_fact"` 呢？ | 那是**契約常數**，描述該欄位在真實發布時所承載的資料類別，不是對本目錄檔案的來源聲明。本目錄的底層 datum 是合成的，**不得**把這個欄位讀成 provenance 主張。 |
| 發布身分（簽章金鑰 / rights manifest / finality policy / clock authority / licence class）是真的嗎？ | **不是。** 每個值都帶 `synthetic-conformance` 字樣，方便在消費者 mirror 裡一 grep 就看出來。真正簽發的發布身分仍然缺（見 `../../README.md`）。 |
| `objectUri` 抓得到東西嗎？ | **抓不到。** 那是形狀合法的公開 HTTPS 位址，目前**沒有**檔案發布在該位址上。驗證時 bundle 一律取本目錄的同層檔案，不得對外抓取。 |

換句話說：**這批 fixture 可以拿來釘驗證器，不可以拿來宣稱市場事實。**

## 五份 manifest 各自釘住什麼

| 目錄 | 檔案 | `manifestId` | 釘住的分支 |
| --- | --- | --- | --- |
| `2026-07-24/` | `manifest.v1.json` + `bundle.v1.json` | `fm_20260724_r1_6293a325dd8d` | 完整發布：interaction（12 筆）＋ outcome（5 筆）雙 allowlist、兩筆公司靜態黃經、有效期間有終點的授權 |
| `2026-07-23/` | `manifest.v1.json` + `bundle.v1.json` | `fm_20260723_r1_9ee75024babd` | **interaction-only 發布**：`outcomeEvidenceRevisionIds` 為 `[]`、`outcomeEvidenceSetDigest` 為空集 digest（`sha256:e3b0c442…b855`），消費者不跑 outcome pipeline |
| `2026-07-22/` | `manifest.v1.json` + `bundle.v1.json` | `fm_20260722_r1_48ab2b52b518` | 跨市場日（TWSE ＋ TPEx）的 revision 1 |
| `2026-07-22/` | `manifest.v1.r2.json` + `bundle.v1.r2.json` | `fm_20260722_r2_627572451f8d` | **更正走 revision + supersedes**：`manifestRevision: 2`、`supersedesManifestId` 指向上一列、每筆 fact revision 帶 `supersedesFactId`，且 r1 的檔案**沒有被覆寫** |
| `2026-07-21/` | `manifest.v1.json` + `bundle.v1.json` | `fm_20260721_r1_2ef96f6669dd` | 完全沒有象徵事實（命盤零貢獻）＋ **開放式授權**（`rightsValidUntil: null`） |

## 檔案格式與不變式

- 檔案 bytes **就是** RFC 8785 JCS 正規形式（無縮排、key 已排序）。因此 `sha256(bundle.v1*.json)` 直接等於同層 manifest 的 `objectHash`，中間沒有任何重排版步驟。已由測試逐檔驗證。
- 權限 `0444`，emit 以 `flag: "wx"` 寫入：**已發布的 fixture 永不覆寫**。要改動就是發新版本目錄（`../v0.1.1/`、`../v0.2.0/`…）＋ 一條 CHANGELOG，不是就地編輯。
- 五份 manifest 都通過 `tests/fact-manifest-contract.test.ts` 的零依賴 2020-12 子集驗證器（`format` 當 annotation，不當 assertion），以及該檔重算的 `manifestHash`（只排除自身、含 `objectHash`）、兩個 set digest 與 `objectHash`。
- `../../README.md`「消費者 MUST 檢查的跨欄位不變式」中生產者算得出來的那幾條（rights 視窗、`interactionCutoffAt <= evidenceCutoffAt <= sealedAt`、兩個 cutoff 的 Asia/Taipei 日期不早於 `marketDateTaipei`、時間欄位須解析成真實瞬時），在封存前就已被 emit 管線檢查過，並由測試對這些檔案再驗一次。
- **排序量不得跨界**已在檔案層可證：產生器刻意在輸入放了 `dailyChangePercent = 4.9317`、`volumeRatio20SessionMedian = 6.1289`、`salience.value = 7.321` 三個特徵值，測試對每份 bundle 全文掃描斷言它們一個都沒出現。

## 重新產生

```
npm run fixtures:fact-manifest
```

對**已存在**的發布再跑一次會以 `manifest-would-be-overwritten` 退出（exit 1）——這是設計要的行為。產生器本身在 `scripts/emit-fact-manifest-fixtures.ts`，其開頭的註解是這批 fixture 的權威 provenance 說明。

## 消費者側

遊戲（消費者）repo `panshi-living-market` 的 `contracts/fact-manifest-consumer/` 持有本目錄的 **pinned 唯讀副本**與一支零依賴驗證腳本。那份副本不得被就地修改；上游發新版本時是新增一份 pinned 副本，不是覆蓋舊的。

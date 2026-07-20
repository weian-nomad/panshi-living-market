# 跨產品契約

_2026-07-20｜ADR-0001｜Accepted_

## 決策

《盤勢・眾生》與盤勢公司市場研究是兩個獨立 repository、兩套部署與兩個 bounded context。前者消費已封存的市場事實，後者生產市場事實。任何共享都要經過可發布、可驗證、可演進的契約。

這個分界讓遊戲可以獨立調整角色引擎與互動，也讓市場資料的授權、修訂和排程留在單一責任方。遊戲故障不能拖垮每日資料管線；市場研究換儲存方式，也不能迫使遊戲重寫。

## 責任表

| 能力 | 系統紀錄來源 | 對方可做的事 |
| --- | --- | --- |
| 市場來源、授權與延遲 | 盤勢研究產品 | 遊戲只讀授權結果與三種分離時間，不自行推導可知性 |
| 公司盤、歷史事件與證據修訂 | 盤勢研究產品 | 遊戲引用固定 revision，不覆寫 |
| sealed fact manifest | 盤勢研究產品 | 遊戲驗證後建立 immutable mirror |
| 合成人口分布與虛構人物 | 本 repo | 盤勢研究產品不讀人物私有狀態 |
| 記憶、關係、情緒、卷宗、封席、決策分、反事實與 replay | 本 repo | 只能讀已核准的延遲公開投影 |
| 私人筆記、匯出與刪除 | 本 repo | 不跨產品傳遞 |
| 五交易日回合、排席、公開自主與遊戲權益 | 本 repo | 共用訂閱只能回傳最小 entitlement claim |
| 每日研究影片 | 盤勢研究產品 | 可引用經核准的公開人物片段，不讀遊戲資料庫 |
| 遊戲分岔報告與角色分享影片 | 本 repo | 只使用 sealed fact 與 approved narrative artifact |

## 跨界資料包

上游每次發布一個 `FactManifestEnvelope`。最低欄位如下：

```ts
type FactManifestEnvelope = {
  contractVersion: string;
  modeDomain: "historical" | "current";
  jurisdiction: string;
  manifestId: string;
  manifestHash: string;
  sealedAt: string;
  marketCalendarVersion: string;
  contentSessionId: string;
  interactionCutoffAt: string;
  evidenceCutoffAt: string;
  finalityPolicyRevision: string;
  clockAuthorityRevision: string;
  licenseClass: string;
  rightsManifestId: string;
  rightsValidFrom: string;
  rightsValidUntil: string | null;
  evidenceRevisionIds: string[];
  evidenceTimesDigest: string;
  objectUri: string;
  objectHash: string;
};
```

每個 evidence revision 另帶不可變的 `worldPublishedAt` 與 `platformReceivedAt`。Historical 可知性只看 `worldPublishedAt <= evidenceCutoffAt`；Current 才看 `max(worldPublishedAt, platformReceivedAt) <= evidenceCutoffAt`。Rights validity 只作 build／bind gate，不參與角色世界時間。

本 repo 只接受支援的 major contract、正確 hash、已核准授權類別、非空封存時間、合格的 evidence time 與仍有效的 rights manifest。`interactionCutoffAt` 只裁決玩家 command；finality policy 只裁決結算與揭曉，三者不能互相代替。驗證失敗時保留上一個有效世界狀態，介面顯示延遲或暫停，不能自行補值。

## 契約如何發布

- 上游擁有 schema 原始碼與 conformance fixtures。
- 發布程序產生帶 semantic version 的唯讀契約 artifact、JSON Schema、範例與 changelog。
- 本 repo pin exact contract version，CI 跑 consumer contract tests。
- additive 欄位走 minor；修正不改語意的版本走 patch；刪欄、改 enum、改金額或時間語意必須升 major。
- 上游至少保留目前與前一個 major 的讀取窗口。遊戲只在新舊 fixtures、replay 與 staging smoke 全數通過後升級。
- 不使用 Git submodule、相對路徑 import、共享資料庫 schema 或同步複製 application source。

## 身份與權益

若兩個產品共用登入，身份提供方只核發標準化 subject 與短效 audience-bound token。本 repo 保存自己的 user projection，不取得上游 session table。共用訂閱只傳 `plan_key`、`status`、`valid_until`、`issued_at` 與簽章；角色引擎只讀本 repo 正規化後的 entitlement，不直接呼叫付款服務。

封測固定使用 `beta_full_access`。這條契約先實作，但不連接付款、不顯示試用倒數，也不建立自動續訂。

## 故障與修正

- 新事實包延遲：保留上一版，標示資料時間，不讓角色假裝看到新資料。
- 上游撤回或修正：新增 revision 與 supersedes link；已發生的角色事件保留當時 manifest，介面另顯示後續修正。
- 契約不相容：隔離新包、告警、停止相關世界 tick，不以寬鬆 parser 繼續。
- 授權變更：封鎖新使用，依政策撤下公開 artifact；稽核紀錄只保留不可還原的識別與 hash。
- 遊戲模型失敗：不回寫上游、不修改 fact mirror、不發布半成品。

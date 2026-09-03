# 《盤勢・眾生》V5 規格索引

_2026-07-23｜故事產品重置_

V5 是目前唯一有效的產品方向。它取代 V4 把「十分鐘跟拍原型」提升為最終產品的決策，也撤銷「角色詳情、紙上持股與績效永遠不出現」的禁令。

V4 留作兩種歷史材料：

- 跟拍手勢與共享場景的互動研究。
- 公共研究模式、固定手機紀錄與既有部署的操作證據。

V4 不能再決定正式產品的資訊架構、角色深度、商業模式或視覺氣質。

## 一句話

真實台股每天替一群 AI 小人製造未知；觀眾追著他們看，記住他們說過的話，也看著他們追高、嘴硬、凹單、認錯或再次犯同一個錯。

## 產品形狀

公共世界是第一層。使用者先看見很多人同時生活，再跟拍其中一人。

跟拍是鏡頭語法，不是整個產品。每位居民都有可進入的「角色人生誌」，沿正史時間保存已發布的說法、行動、改口與直接後果，並連到相應的生活背景、命盤、性格、記憶、關係與紙上紀錄。完整資料只由「深層人生檔案」保存與展開。數字用來證明他承擔過什麼，不用來選出全世界最會賺錢的人。

## 文件優先序

遇到衝突時，依下列順序裁決：

1. [`product-constitution.md`](./product-constitution.md)
2. [`market-safety.md`](./market-safety.md)
3. [`experience-spec.md`](./experience-spec.md)
4. [`character-story-engine.md`](./character-story-engine.md)
5. [`system-design.md`](./system-design.md)
6. [`contracts/canonical-owner-map.yaml`](./contracts/canonical-owner-map.yaml)，只裁決 aggregate／event owner 與 projection 回寫
7. [`visual-system.md`](./visual-system.md)
8. [`delivery-plan.md`](./delivery-plan.md)
9. [`competitive-synthesis.md`](./competitive-synthesis.md)
10. Repository 層級的跨產品契約與安全規則

`AGENTS.md`、README、產品行銷脈絡與實作文件都必須指向這組規格。

方向重置的原因與不可回退項目記錄在 [`decision-record.md`](./decision-record.md)。它用來解釋決策，不覆蓋上方規格。

`competitive-synthesis.md` 記錄競品樣本、公開價格錨點與求同存異。產品規則或價格與它衝突時，仍以 `product-constitution.md` 的已採納決策為準。

五輪動工前審查、各輪 P0 關閉方式、機器驗證與終局 verdict 記錄在 [`pre-code-review.md`](./pre-code-review.md)。R5 結論為 `PRE-CODE MAXIMUM REACHED`，不代表外部法律、資料權利、資安、Figma 或封測 gate 已自動通過。

## 不可拆開的五件事

1. 真實市場提供所有角色共同面對、而且不能預寫的外部事件。
2. 成年虛構角色有一條不可重抽的人生，離線時也繼續前進。
3. 性格、命盤、記憶、情緒、生活責任與關係真的改變注意、解讀與行為。
4. 紙上交易留下可核對的持股、損益與後果，也留下角色如何自我合理化的故事。
5. 公共群像、單角人生誌與深層檔案是同一段體驗的不同距離，不是三個互不相干的產品。

## 目前實作狀態

現有 Web 版是 V4 跟拍研究切片，不代表 V5 已完成。正式實作前應先依 V5 文件重做 domain map、projection contract、畫面路由和視覺母版，再決定哪些 V4 手勢與素材可以保留。

封測使用 `beta_full_access`。金流、廣告、試用倒數和商店 SDK 暫不啟用；正式版商業規則先寫入權益契約，不能散落在畫面條件裡。

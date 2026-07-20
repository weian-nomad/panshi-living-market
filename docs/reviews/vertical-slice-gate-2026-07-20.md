# Canonical vertical-slice gate

_2026-07-20｜判決：`GO / COMMIT NOW`_

第一條 production-shaped vertical slice 已關閉會迫使未來重切 canonical
bytes、事件原子性或決策語義的 P0／P1。此判決經兩輪對抗式審查：第一輪
要求等待 SQLx vertical slice；完成修正與實證後，第二輪回覆 `NO BLOCKERS`。

## 已關閉

- `CommitActions` 精確綁定 sealed event、session input version、input、snapshot、
  kernel ABI、algorithm bundle 與 action digests。
- Protobuf decode／re-encode equality、domain-owned seat／company order、fixed-width
  IDs、fixed-point range 與 typed invalid paths 已固定。
- exact `i128` numerator 決定排序；顯示用除法不反過來影響贏家。
- UUID16 與產品定義的 `NO_ACTION` utility 已確認為正式 V1 語義，不是暫時格式。
- canonical `input.pb`／`output.pb`、native／WASI raw-byte parity 與邊界測試已進 CI。
- SQLx adapter 已在 PostgreSQL 16 實跑 dedup、CAS、ownership epoch、hash chain、
  event↔outbox 1:1、frozen receipt 與 writer-role bypass denial。

## 不在此 gate 假裝完成

HTTP command handlers、projection worker、server-connected UI、fault/load qualification、
資料權利與法遵仍是後續交付。它們必須沿用本次固定的契約與 write boundary，
但不是這個 commit 的 canonical-architecture blocker。

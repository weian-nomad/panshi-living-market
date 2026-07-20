# Client truth and recovery contract

_版本 1.0｜2026-07-20｜Figma 開畫前必須遵守_

Client 只呈現 server projection，不能由倒數、本機草稿、動畫、推播或先前 response 推論 canonical truth。

## Truth projection

每個可操作畫面至少取得：

```text
authoritative_state
canonical_version
projection_version
server_now
interaction_cutoff_at
evidence_cutoff_at
control_state
pending_boundary_transition
data_state: READY | STALE | HELD | VOID | CORRECTED
reveal_state
can_submit
blocking_reason_codes[]
truth_classes[]
logical_cell_id
ownership_epoch
```

倒數由 `server_now` 與 `interaction_cutoff_at` 顯示，但倒數歸零本身不代表 command 已提交或 session 已封存。`projection_version < canonical_version` 時顯示同步中，不能用舊 projection 覆蓋新排席。

## Command acknowledgement

所有 mutation 回傳同一 receipt：

```text
command_id
disposition: COMMITTED | PENDING | DUPLICATE | REJECTED
canonical_version
retryable
reason_code
status_resource
```

Push 與 polling 讀同一 command journal。`PENDING` 只能引導到 `status_resource`；client 不可建立第二個語意相同但 idempotency key 不同的 command。動畫完成、toast 或網路 200 都不等於 `COMMITTED`。

## Atomic placement

排席不是五到十條 drag command。Client 可以逐步拖曳，但 domain 只接受一次完整 payload：

```text
SaveSeatPlan {
  round_id
  base_version
  layout_digest
  placements[5] {
    seat_id
    character_id
    dossier_id
  }
}
```

五個 `seat_id` 固定，角色與卷宗各自雙射。Server 在同一 aggregate 驗證完整合法性。鍵盤、switch control、screen reader 與觸控操作產生相同 payload，不另造簡化規則。

`SealSeatPlan` 只引用已 committed 的 `layout_digest + canonical_version`；若玩家最後拖曳仍 pending，封席必須等待該 receipt 或明確使用上一個 committed placement，不能靠 client 畫面猜測。

## Offline draft

離線草稿只保存在裝置，最少包含：

```text
round_id
base_version
layout_digest
placements
drafted_at_device
```

回線後先抓 truth projection，再顯示 server／draft diff。版本衝突、control inactive、cell migrating 或 cutoff 已過時，不能自動 merge 或背景補送。`drafted_at_device` 只供使用者理解，不參與 cutoff 裁決。

## Typed errors and only recovery

| reason code | UI 真相 | 唯一可做動作 |
| --- | --- | --- |
| `VERSION_CONFLICT` | server 已有較新排席 | 取得最新版本並顯示 diff |
| `CUTOFF_PASSED` | 今日不可再寫 | 顯示 committed／carry-forward 結果 |
| `CONTROL_INACTIVE` | 沒有本回合控制權 | 進入延遲觀看或權益說明 |
| `SESSION_HELD` | 缺 finality、rights、pack 或裁決 | 顯示 hold 原因與狀態資源，不提供重抽 |
| `CELL_MIGRATING` | logical bundle 暫停寫入 | 等 router 提供新 ownership epoch 後重抓 |
| `RIGHTS_REVOKED` | 內容不可再使用 | 撤下內容並回到可用 episode |
| `MODE_UNAVAILABLE` | mode 資料面不存在或未核准 | 返回 Historical；不能顯示開啟按鈕 |
| `PROJECTION_LAGGING` | read model 落後 canonical | 以 receipt／status resource 等待，不重送 |

每個錯誤都要有 loading、keyboard focus、screen-reader live region 與 reduced-motion 等價狀態。Error copy 不得暗示「再試一次可能得到更好的角色決定」。

## Revision-aware reveal

Corrected／void reveal 不覆蓋舊結果，必須回傳：

```text
current_revision
previous_revisions[]
adjudication_reason_class
score_changed
crew_history_changed
risk_brake_carry
```

因果關閉後 `crew_history_changed` 永遠為 false。UI 要明說「正式分數已修正；角色仍保留當時經歷」或「因果關閉前已重新結算」，不可只換數字。

## Notification and mobile background

通知 payload 只含 opaque resource ID、notification type 與 visibility epoch，不含真實公司、方向、q、private memory 或 canonical action。開啟 App 後必須重新抓 truth projection。

Mobile background task 不得替玩家保存或封存排席，不得使用 client time 補 grace period。背景只可預抓無敏感 projection，且 visibility epoch／rights revoke 後立即拒絕顯示舊內容。

## Structured causality

因果畫面使用 typed API，不以自由生成文字作真相：

```text
factor_id
factor_type
source_snapshot_ref
baseline_action
intervention
counterfactual_action
utility_gap_before
utility_gap_after
classification: DECISIVE | STRENGTHENED | WEAKENED | NOT_PRIMARY
narrative_projection
```

只有 typed fields 通過 policy，`narrative_projection` 才能使用「決定性因素之一」「強化」或「削弱」。替代思考核心情境必須使用不同 endpoint／resource type，不能與單變量反事實共用 classification。

## Figma handoff annotation

每個高保真 frame 必須標：

1. 對應 command 或 read resource。
2. authoritative state 與可見 projection。
3. canonical／projection version 行為。
4. blocking reason 與 recovery。
5. 禁止顯示的資訊。
6. keyboard／screen-reader／reduced-motion 等價操作。

缺任一項的 frame 不能進工程 handoff。

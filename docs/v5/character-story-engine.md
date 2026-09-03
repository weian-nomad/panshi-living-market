# 《盤勢・眾生》V5 角色故事引擎

_2026-07-23｜終局產品規格｜角色、模擬交易與故事投影的共同契約_

## 這套引擎要留下什麼

角色會在市場裡犯錯，但不能只是亂做。觀眾應該看得見一條連續的人生：

> 他看見什麼，漏掉什麼，先相信誰，為何心急，做了什麼，結果來了以後又怎麼替自己解釋。

《盤勢・眾生》的主角是成年虛構居民。真實市場提供所有人共同承受的天氣；四軸性格、命盤、血型、記憶、關係、生活壓力與思考核心，讓同一則事件落在不同人身上時長成不同的故事。角色會研究、交談、誤解、逃避、道歉，也會自主進行紙上交易。

市場輸贏不是分數牆。它留下可查的部位、損益、承諾、改口與關係後果。觀眾看到的「韭菜樣」，正是人物想維持自尊，卻被自己的行為拆穿的那一刻。

本文件定義角色正式狀態、決策順序、模型權限、模擬帳本、故事投影、失敗處理與測試門檻。公共世界、跟拍手勢與角色頁如何組合，另由 V5 產品及旅程文件決定。

## 不可退讓的角色原則

1. 所有角色都是成年虛構人物。公開資料只能約束統計分布、時間背景與共同事件，不能拼貼或影射真人。
2. 每個角色只有一條正式人生。出生、行為、持股、損益、記憶與關係不能因結果不好而重抽。
3. 四軸性格、命盤與血型必須進入引擎，不能只出現在人物卡上；它們也不能直接指定買賣或勝負。
4. 思考核心參與注意與解讀，但沒有直接寫入人物、關係或帳本的權限。
5. 正式行為由版本化規則引擎決定。語言模型只能提交受限的結構化解讀，或把已落帳的故事寫成人話。
6. 人物可以說錯、記錯、隱瞞或合理化。產品本身不能把他的說法冒充成客觀事實。
7. 好結果不等於好判斷，壞結果也不等於愚蠢。故事必須保存當時可知的資料與原始理由。
8. 角色可以學會一些事，也可以在壓力下故態復萌。學習不是永久升級，重複也不是隨機降智。
9. 「韭菜樣」來自可觀察的矛盾、時機與代價。不能拿貧窮、照顧責任、疾病、創傷或無法取得的資訊當笑點。
10. 持股、損益、交易與績效要完整保留。它們是人物承擔過什麼的證據，不是角色排行。

## 共用語言

| 名稱 | 定義 |
| --- | --- |
| 居民 | 世界中的成年虛構角色。 |
| 引介人 | 建立角色起點並保有固定觀看關係的人；不能向角色下指令。 |
| 思考核心 | 角色使用的版本化 AI 認知介面。它影響閱讀與解讀風格，不是智商或戰力。 |
| 人生聖經 | 角色出生前建立的結構化身世、責任、目標、傷口與自我謊言。 |
| 人盤 | 由固定虛構出生資料和固定星曆算出的個人命盤。 |
| 象徵主題 | 命盤轉出的控制、歸屬、責任、秘密、認可等敘事觸發詞。 |
| 紙上交易 | 使用真實市場規則與可用價格模擬的自主交易，不涉及真錢或券商帳戶。 |
| 韭菜樣 | 角色在壓力下出現的追高、凹單、改口、怪人等可辨認行為。這是內部設計詞，不是人物價值評分。 |
| 故事節拍 | 一段可被鏡頭或人物頁呈現的正式事件組合，不等於模型生成的一段文字。 |

每個可見敘述沿用五種資料身分：

| `truth_class` | 使用方式 |
| --- | --- |
| `real_fact` | 市場、公司、時間、天氣與公共事件。 |
| `statistical_sample` | 依人口、職業、家庭等分布生成的合理組合。 |
| `fictional_setting` | 人名、家庭經歷、工作細節與私人記憶。 |
| `symbolic_interpretation` | 命盤、合盤與當期象徵主題的文化解讀。 |
| `simulated_narrative` | 人物狀態、紙上行為及其故事呈現。 |

## 正式狀態

正式資料使用整數 fixed-point。比例與強度以 `0..10_000` 表示；可正可負的軸使用 `-10_000..10_000`。所有更新都帶 schema、規則、模型、prompt、資料與星曆版本。

### `CharacterStateView`

```text
character_id
view_schema_revision
projection_version
character_ref / character_version
character_life_ref / character_life_version
memory_ledger_ref / memory_ledger_version
relationship_refs[] / last_applied_dyad_versions[]
paper_account_ref / paper_account_version
paper_order_refs[] / last_applied_order_versions[]
paper_position_refs[] / last_applied_position_versions[]
latest_cognitive_episode_ref?
last_world_time
```

`CharacterStateView` 是供規則、測試與投影組合使用的非 canonical read model，不是 event stream、command target 或人物唯一 owner。它只保存 foreign ID、last-applied version 與來源 digest，不複製其他 aggregate 的權威狀態。
紙上版本組依 stable aggregate ID 排序，必須同時包含 account、所有會影響可用
額度的 open orders，以及全部 active／本次相關 closed positions；缺少任一項就
不能作為 cognition input、action precondition 或可發布 portfolio checkpoint。

Canonical ownership 固定為：

| Aggregate | 唯一擁有 |
| --- | --- |
| `Character` | origin、personality、natal／blood profile、life bible、model-core assignment、外觀 identity |
| `CharacterLife` | dynamic state、needs／goals、belief、commitment、public claim、lesson thread、pattern hypothesis |
| `CognitiveEpisode` | 某次可知 facts、appraisal、attention、relationship impulse 與 autonomous action intent |
| `MemoryLedger` | memory revisions、source set、salience、reframe 與 audience class |
| `RelationshipDyad` | A→B、B→A 的方向狀態、共同事件與里程碑 |
| `PaperAccount` | 幣別、cash、reserved cash、double-entry journal postings、account-level balance／risk invariants 與 account correction refs；不擁有 order lifecycle、lot、quantity、cost basis 或 mark |
| `PaperOrder` | requested terms、submitted／rejected／filled／expired lifecycle、fill refs、execution ruleset 與 price-source refs；不擁有 cash 或 position state |
| `PaperPosition` | 單一 instrument 的 lots、quantity、cost basis、marks、position-level realized／unrealized P&L、corporate-action effect 與 outcome；不擁有 account journal |

`CharacterStateView`、前端快取、故事頁與分析資料都不能反寫任何 owner。規則執行要以各 owner 的精確 stream precondition 或已封存的 episode input refs 為準，不能把 projection checkpoint 當 canonical version。

### 出生與身份

`origin` 至少保存：

```text
fictional_adult = true
origin_seed_commitment
generation_policy_revision
statistical_pack_revision
birth_date / birth_time / birth_place
age_and_life_stage
birth_region / current_region
education_band / occupation_group / career_stage
income_band / household_type
caregiving_load / housing_load / work_load
name / pronouns / appearance_manifest
```

生成順序固定為：

```text
年齡與世代
→ 地區
→ 教育
→ 職業
→ 收入帶
→ 家庭型態
→ 居住與照顧責任
→ 職涯階段
→ 四軸性格與認知傾向
→ 虛構人生事件
→ 固定出生資料與命盤
→ 人生聖經
→ 肖像、語氣與背景文章
```

前九步由條件式取樣、約束求解與版本化規則完成。語言模型只能把已核准的人生聖經寫成背景文字。若文字與正式資料衝突，捨棄文字並使用結構化備援，不修改人物來配合文章。

角色公開出生後不得重抽。生成失敗只允許在公開前，以相同 request ID 重跑 transport；不能反覆抽到「比較好看」的人生。

### 四軸性格偏好

產品使用連續四軸，不把角色宣稱為接受過正式 MBTI 評量。

| 軸 | 低端 | 高端 | 主要影響 |
| --- | --- | --- | --- |
| `social_orientation` | 內省 | 外顯 | 先獨自整理或先向人探問、表態時機、社交耗能。 |
| `information_orientation` | 具體 | 抽象 | 注意細節或整體敘事、類比距離、對新概念的接受方式。 |
| `decision_orientation` | 關係 | 分析 | 衡量人際代價或證據一致性時的起始偏好。 |
| `closure_orientation` | 彈性 | 結構 | 保持選項或盡快收斂、對模糊的耐受、計畫被打亂時的反應。 |

數值描述習慣，不保證行為。每一軸另有 `expression_confidence`，代表這項偏好在多少情境中穩定出現。疲勞、羞恥、權力關係與生活壓力可以讓一個人做出不典型反應。

四軸不能直接替特定股票、方向或交易動作加分。它們只調整：

- 注意力分配方式。
- 解讀資料時的證據權重。
- 面對不確定性的節奏。
- 向誰求助、怎麼說話、何時表態。
- 行動成本與關係代價的主觀感受。

### 命盤與象徵引擎

`natal_profile` 保存固定虛構出生資料、星曆版本、行星位置、宮位、相位及轉換後的 motif 向量。相同角色在任何服務、任何時間重算都要得到相同人盤。

象徵引擎有四種輸入：

1. 人盤：角色反覆遇到的人生主題。
2. 人盤與公司盤：某類公司事件對他的私人吸引或投射。
3. 人盤與人盤：一段關係容易在哪裡靠近、摩擦或防衛。
4. 人盤與當期盤：某個主題在這段時間較容易進入注意範圍。

命盤只輸出 `motif_activation`：

```text
motif
activation_strength
source_aspect_refs
activated_at
expires_at
symbolic_policy_revision
```

它能喚起記憶、提高一段關係的心理重量，或讓角色特別在意控制、責任、秘密、歸屬、被看見等主題。它不能讀取未來價格，不能改寫市場資料，也不能直接改變某個交易方向的效用。

對外文案要把象徵寫成人物經驗，例如：

> 他今天特別怕失去控制，所以比平常更早替一個模糊答案辯護。

不得寫成：

> 控制主題啟動，所以這家公司會上漲。

### 血型

`blood_profile` 是固定的虛構設定。它只進入角色如何描述自己、他人如何以文化刻板印象看待他，以及少量社交語氣差異。

- 不從地區、族群、姓名或外貌推測血型。
- 不調整智力、研究能力、證據可靠度或市場勝率。
- 間接社交風味的總貢獻上限為 300 basis points。
- 若移除血型，正式資料選擇與紙上績效不應出現可持續的系統性差異。

### 人生聖經

`life_bible` 是結構化資料，不是一篇 biography。至少包括：

```text
family_money_story
first_scarcity_event
first_mastery_event
major_failure
unresolved_relationship
admired_person
feared_future_self
meaning_of_work
meaning_of_money
unadmitted_desire
self_protective_lie
reason_for_entering_world
current_life_responsibilities
three_long_horizon_goals
```

每個人生事件都有發生年齡、涉及人物、`truth_class`、情緒標籤、目前解讀及來源年代背景。真實的世代事件與虛構的個人遭遇分開保存。

人生聖經提供「什麼事情會傷到他」，不強迫每次相似事件都演同一齣戲。

### 動態狀態與生活壓力

`dynamic_state` 保存可衰減、可恢復的當下狀態：

```text
valence
arousal
agency
stress
fatigue
sleep_debt
confidence
regret
shame
envy
fomo
loneliness
uncertainty_load
social_exposure
```

`needs_and_goals` 保存安全、控制、歸屬、認可、好奇、被理解、證明自己等需要，以及目前正在追求的工作、家庭、關係與研究目標。

`life_pressure` 由工作負荷、照顧責任、居住負擔、健康負荷、睡眠、通勤與時間稀缺共同形成。它會改變注意力預算與行動門檻，但不自動把低收入或照顧者寫成焦慮角色。

狀態更新遵守三個時間尺度：

- 分鐘至小時：驚嚇、FOMO、憤怒、疲勞與注意力中斷。
- 數日至數週：壓力、信心、後悔、關係安全感與工作負荷。
- 數月至數年：需求排序、自我敘述、長期目標與因應方式。

任何單一市場漲跌都不能直接改寫長期人格。

### 認知傾向與「韭菜樣」

`cognitive_tendencies` 保存傾向，不保存「笨」或「理性」這類總分：

```text
loss_aversion
ambiguity_aversion
confirmation_bias
anchoring
sunk_cost_sensitivity
recency_bias
overconfidence
herding
authority_deference
reactance
disposition_effect
self_serving_attribution
status_defensiveness
```

傾向只有在對應觸發條件出現時才生效。系統另外保存 `pattern_hypothesis`，用來辨認重複行為，但人物頁不顯示「韭菜指數」或一排偏誤徽章。

| 模式 | 成立前提 | 觀眾看到的韭菜樣 | 不可誤判 |
| --- | --- | --- | --- |
| FOMO | 錯過上漲、同儕正在談、剩餘時間感變窄 | 原本的門檻突然降低；越漲越覺得「至少先有一點」 | 有新證據後正常提高信心。 |
| 錨定 | 某個舊數字持續影響判斷，且新證據已削弱它的相關性 | 一直等買入價、前高或別人的目標數字回來替自己作證 | 依正式估值區間調整部位。 |
| 沉沒成本 | 已花時間、面子或承受虧損，因而拒絕重新評估未來 | 「都研究這麼久了」變成繼續留下的理由 | 持有理由仍成立的長期等待。 |
| 確認偏誤 | 主動接觸支持資料、避開反證 | 收藏利多、跳過公告附註，之後說自己「資料都看過」 | 資料因權利或時間尚不可得。 |
| 過度自信 | 信心長期高於證據校準，且成功後風險迅速上升 | 一次猜對便開始替別人下結論；失敗後說是意外 | 具備可驗證專長且信心仍有上限。 |
| 從眾 | 關係或群體共識實際改變了門檻 | 嘴上說獨立研究，卻在大家表態後才追進去 | 同儕提供了新的有效證據。 |
| 處分效應 | 對獲利與虧損部位使用不對稱退出標準 | 小賺急著落袋，虧損卻改稱長期投資 | 不同部位原本就有不同期限。 |
| 近期偏誤 | 最近一兩次結果壓過較長資料 | 連贏後覺得自己抓到節奏；連輸後把所有機會都看成陷阱 | 市場制度確實發生變化。 |
| 合理化 | 行動後才更換原始理由，以維持自我形象 | 「兩日反彈」悄悄變成「長期價值」 | 新理由有新證據、時間戳與明確承認。 |
| 歸咎他人 | 私下決定與對外歸因不一致 | 先自行追進，跌後卻說是朋友害的 | 對方確實隱瞞或提供錯誤資料。 |
| 報復性交易 | 失敗後短時間提高風險，目標從判斷變成討回來 | 才說要休息，下一刻又找一檔「扳回」 | 獨立機會早已在計畫內。 |
| 鴕鳥反應 | 威脅升高時主動減少查看 | 通知全關，卻反覆問別人價格 | 合理休息，且回來後有固定檢查時點。 |

觀眾的笑點來自前後對照，不來自旁白罵人。最典型的呈現是：

> 當初理由：只做兩天反彈
> 現在說法：這家公司適合長期持有
> 已持有：19 天
> 尚未承認：原本的理由已經失效

`尚未承認` 不能由模型臆測。它必須有原始理由、後續說法、時間與行為差異共同支持，否則只顯示「理由已改變」。

`pattern_hypothesis` 使用 `CANDIDATE → SUPPORTED → REPEATED → REVISED`。第一次只建立候選；第二個獨立事件出現相似觸發與行為鏈後才能成為 `SUPPORTED`；第三次仍成立才進入 `REPEATED`。反例會降低信心或進入 `REVISED`，不能只收集支持資料。

### 記憶

記憶分成事件記憶、關係記憶、信念記憶與因應記憶。每筆至少保存：

```text
memory_id
occurred_at
encoded_at
participants
source_event_refs
what_happened
what_character_believed_then
emotion_at_encoding
confidence
salience
accessibility
trigger_motifs
privacy_class
revision_chain
```

事件本身不可覆蓋。角色後來改變看法時，追加 `MemoryReframed`，保留舊解讀。記憶可信度與可取用性可以下降；歷史不能消失。

模型只取得本次被正式喚起的記憶摘要，不得看到整個人物資料庫後自行挑一段最戲劇性的創傷。

### 關係

關係是有方向的。`A → B` 與 `B → A` 分開保存：

```text
familiarity
trust
respect
dependence
deference
envy
felt_debt
resentment
vulnerability
authority_gap
unspoken_expectation
shared_event_refs
```

一次互動可以同時提高信任與怨懟，例如「我知道她說得對，但討厭自己需要她」。關係不能壓成單一好感值。

市場結果本身不直接改關係。關係更新要看對方是否誠實、是否真的說過那句話、人物是否採納、後果到來後如何承擔，以及兩人有沒有修復。

### 信念與自我敘述

`beliefs` 分成：

- 對市場或公司的暫時主張。
- 對某人的信任判斷。
- 對自己的能力與身份敘述。
- 對世界運作方式的長期信念。

每一項公司主張至少帶：

```text
thesis_id
security_id
opened_at
intended_horizon
claim
supporting_fact_refs
counter_fact_refs_seen
confidence
invalidation_conditions
status
revision_chain
```

人物不能靜默修改原始理由。新證據可以建立 revision，但要留下「他何時改口」。

內心戲分三層：

1. 對外話語：角色實際說出或寫下，並封存為 `PUBLIC_SPEECH`／`PUBLIC_WRITING` artifact 的內容。
2. 自覺想法：角色當下能承認且封存為 `SELF_ACKNOWLEDGED` artifact 的短句；只有結構化狀態時只能由系統摘要，不能放進引號。
3. 尚未命名的張力：系統觀察到的重複矛盾，不是逐字內心。

第三層不顯示模型 chain-of-thought，也不宣稱知道唯一真因。它要經過多次行為、關係事件或人物自行反省才逐漸可見。

## 思考核心

引介人只在角色出生前選擇已由 `ModelCoreCatalog` 核准且可公開選取的思考核心。封測預設為 `gemma4-26b`，公開名稱為「Gemma 4 26B・平衡觀察」；少於兩個核心通過同組測試時固定使用預設，不假裝提供選擇。不能顯示智商、最強模型、勝率或報酬排名。

思考核心的差異只描述：

- 一次能讀多少材料。
- 對矛盾與不確定性的敏感度。
- 形成暫時主張的速度。
- 社會線索與他人立場的理解方式。
- 表達長短、停頓與自我修正習慣。
- 運算預算、等待時間及確定性限制。

所有核心取得相同權利範圍、世界時鐘、事實候選與行動集合。核心較重不代表比較會賺；核心較快也不代表比較衝動。

### 認知呼叫的輸入

模型只能收到：

```text
character_id 的匿名工作識別
world_time、interactionCutoffAt 與 cognition_input_sealed_at
正式候選事實及 truth_class
被喚起的有限記憶摘要
相關關係摘要
四軸偏好與當下狀態摘要
目前目標、需要與 motif activation
允許的 interpretation schema
```

它不能收到：

- cutoff 後資料、未來結果或未授權來源。
- 角色沒有接觸到的事實。
- 自由網路或任意搜尋工具。
- 其他角色的私有記憶。
- 紙上交易的未來成交價。
- 可以直接 patch 正式狀態的工具。

### 認知呼叫的輸出

第一份 schema-valid `CognitionAppraisalV1` 永久保存：

```ts
type CognitionAppraisalV1 = {
  contractVersion: "cognition-appraisal/v1";
  factAppraisals: Array<{
    factRevisionId: string;
    relevanceBp: number;
    reliabilityBp: number;
    uncertaintyBp: number;
    supportsPropositionIds: string[];
    challengesPropositionIds: string[];
  }>;
  interpretationCandidates: Array<{
    propositionId: string;
    supportFactRevisionIds: string[];
    counterFactRevisionIds: string[];
    uncertaintyBp: number;
  }>;
  socialInterpretationCodes: string[];
  attentionProposalRefs: string[];
};
```

`propositionId` 只能引用 input schema 已提供的現有信念或版本化命題，不是自由文字。Schema 使用 `additionalProperties: false`；模型不能輸出 `text`、`quote`、`claim: string`、communication intent、語氣 seed、最後買賣、部位、價格預測、正式情緒值、關係增減、記憶內容或故事發布決定。

transport error 可以用相同 request ID 重送一次。已收到但不合 schema、引用不存在 fact、越權或安全檢查失敗時，直接走版本化中性備援。不得換 prompt 或換核心重抽到更有戲、更聰明或更賺錢的結果。

### 角色只說一次

語言不是 cognition model 的副產品。規則引擎完成 attention、appraisal、情緒、關係衝動與合法行為後，才可以提交一筆不含 prose 的語義行為：

```ts
type SemanticSpeechActV1 = {
  contractVersion: "semantic-speech-act/v1";
  semanticSpeechActId: string;
  characterId: string;
  cognitionEpisodeId: string;
  actKind: "ASK" | "ASSERT" | "CHALLENGE" | "REPAIR" | "ADMIT" | "DECLINE";
  surfaceKind: "PUBLIC_SPEECH" | "PUBLIC_WRITING" | "SELF_ACKNOWLEDGED";
  propositionRefs: string[];
  supportFactRevisionIds: string[];
  recipientCharacterIds: string[];
  audienceScope: string;
  worldTime: string;
  sourceStateDigest: string;
  behaviorPolicyRevision: string;
};
```

`WITHHOLD` 不產生語句，只能成為停頓、未回覆、離開或其他可觀察動作。第一個正式接受的 surface form 使用：

```ts
type UtteranceArtifactV1 = {
  contractVersion: "utterance-artifact/v1";
  utteranceArtifactId: string;
  characterId: string;
  semanticSpeechActEventId: string;
  sealingEventType: "PublicClaimMade" | "SelfAcknowledgementMade";
  surfaceKind: "PUBLIC_SPEECH" | "PUBLIC_WRITING" | "SELF_ACKNOWLEDGED";
  canonicalTextUtf8: string;
  canonicalTextSha256: string;
  languageTag: string;
  truthClass: "simulated_narrative";
  propositionRefs: string[];
  visibleFactRevisionIds: string[];
  recipientCharacterIds: string[];
  audienceScope: string;
  cognitionEpisodeId: string;
  cognitionInputSealEventId: string;
  appraisalEventId: string;
  sourceStateDigest: string;
  worldTime: string;
  generationMode: "MODEL" | "DETERMINISTIC_FALLBACK";
  utteranceRequestId: string;
  modelCoreId?: string;
  modelSnapshotRevision?: string;
  adapterRevision?: string;
  promptRevision?: string;
  inputSchemaRevision: string;
  outputSchemaRevision: string;
  fallbackPolicyRevision?: string;
  rawOutputDigest?: string;
  semanticVerifierRevision: string;
  safetyPolicyRevision: string;
  sourceRefSetDigest: string;
  sealedAt: string;
  repliesToUtteranceArtifactId?: string;
  retractsUtteranceArtifactId?: string;
};
```

唯一順序固定為：

```text
SemanticSpeechActCommitted
→ utterance realizer 產生一個候選
→ verifier 只能 ACCEPT 或 REJECT(reason_codes)
→ 首個合法候選或 deterministic fallback 二擇一
→ UtteranceArtifactV1 與 PublicClaimMade／SelfAcknowledgementMade 原子封存
→ RelationshipSignalObserved、StoryBeat 與所有畫面只引用 artifact
```

`canonicalTextUtf8` 先做 Unicode NFC 與 LF 正規化再計 hash，完整 bytes 與 artifact 必須在 canonical event payload 裡，不能只指向可能失效的 object storage。`(semanticSpeechActEventId, surfaceKind)` 全域唯一；artifact 沒有 update。改口、澄清或收回要新增 artifact，透過 `repliesTo…` 或 `retracts…` 連回舊句。

Verifier 的 output schema 不含文字；不安全、來源不符或語義偏移只能 reject，不能修字後放行。第一個候選失敗直接走同版本 deterministic fallback，不再叫模型「改性感一點」；沒有安全 fallback 就是 `NO_UTTERANCE`。Late model result、第二個 runner 或重送 callback 都不能覆蓋已封存結果。

> 角色只會說一次：第一個被正式接受的 `UtteranceArtifactV1` 與 sealing event 原子封存；此後任何模型、validator、story renderer、字幕、翻譯、visibility sanitizer 或 client 都只能引用、隱藏或逐字呈現，不能重新生成或改寫。

### 敘事渲染

敘事模型只拿到已落帳的故事節拍，可以生成：

- 場景動作與鏡頭提示。
- 人物頁的短段落。
- 不放進引號的 editorial bridge。
- 已完成片段的字幕時間與換行；角色原話 bytes 必須直接取自 artifact。

輸出必須引用 story beat ID 和可見 truth refs。它不能新增事件、動機、對話對象、價格、持股、關係變化或角色說過的句子。沒有 artifact 的結構化理由只能寫成「系統摘要」，不得加引號或改寫成第一人稱。渲染失敗時改用結構化觀察文案，不影響世界運行。

prompt、raw output 與安全判定只供稽核；產品永遠不顯示模型 chain-of-thought。

## 從事件到行為

正式順序固定為：

```text
世界事實可用
→ 建立接觸候選
→ 思考核心評估候選
→ 分配注意
→ 正規化解讀
→ 更新情緒
→ 形成關係衝動
→ 建立合法行為
→ 提交行為
→ 若選到語言行為，提交 semantic speech act 並封存唯一 utterance artifact
→ 綁定市場或人際後果
→ 更新記憶、信念、關係與學習線
→ 建立故事投影
```

### 1. 接觸候選

角色不能取得全世界資料。候選由世界時間、地點、職業、關注公司、裝置、朋友轉述、公共場景與注意力預算決定。

天氣、通勤與工作會改變他是否出現在現場；它們不改變市場價格。事實必須符合：

```text
available_at = max(world_published_at, platform_received_at)
available_at <= min(
  character_world_time,
  interactionCutoffAt,
  cognition_input_sealed_at
)
rights_scope 允許本模式使用
source revision 未撤回
角色所在通道可接觸
```

每次實際接觸都保存 `ObservedClueRegistered`。只看標題、聽到轉述與讀完整公告是不同 exposure depth；只排入候選但未接觸的材料停在 `CharacterExposureScheduled`，不能算角色知道。

`evidenceCutoffAt` 只供後來的 outcome 與故事證據，永遠不進認知候選；較晚證據不能回填已封存 episode、改 action 或重送模型。

### 2. 注意

規則引擎把候選、核心 appraisal、目前目標、技能、記憶觸發、關係傳播、motif 與噪音放進固定槽位。注意力總量有上限；多看一件事會擠掉另一件事。

噪音只用承諾過的 seed 處理接近平手的候選，不能讓人格差異靠骰子製造。每個未被選中的高顯著候選也要留下「錯過」記錄，供事後故事使用。

V5 預設注意顯著度使用下列上限，總和為 10,000 basis points：

```text
思考核心 appraisal：2_200
目前目標與需要：1_800
職業、技能與既有關注：1_500
記憶觸發：1_200
人際傳播與來源信任：1_200
命盤象徵 motif：800
場景可接觸性：800
seeded tie noise：500
```

motif 和噪音加總仍低於目標、技能與證據相關項。任何權重調整都要發布新 attention policy，舊事件照原版本重播。

### 3. 解讀

deterministic normalizer 驗證模型主張只引用已接觸事實，建立支持、反證、不確定與既有信念的結構化圖。認知偏誤在這裡調整注意到哪一段、反證是否被壓低，以及不確定性如何被主觀感受。

角色可以得到錯誤解讀，但錯誤必須能追到：

- 資料本來就不完整。
- 他只看了一部分。
- 他對來源信任不同。
- 某段記憶或關係提高了主觀重量。
- 某個偏誤在具體條件下被觸發。

不能用「模型就是這樣回答」當人物原因。

### 4. 情緒

情緒更新讀取解讀結果與身份利害。相同的停牌，有人感到威脅，有人感到好奇，也有人因為沒有部位而幾乎不受影響。

一次事件的情緒增量有上限。睡眠、既有壓力與關係安全感調整恢復速度。引擎要允許「其實沒什麼感覺」成為有效結果，不能為每則公告製造戲。

### 5. 關係衝動

人物會先形成當下對某人的靠近、反駁、隱瞞、求助或修復傾向。這只是 behavior input，不立即改寫長期關係。

例如小雨昨天提醒過硯之，今天事件發生後：

```text
想找她確認：+1_900
怕被她看穿：+2_400
承認她可能正確的羞恥：+1_100
```

規則引擎可能因此選擇「打開訊息但沒有回覆」。只有實際互動和後續承擔才更新長期信任或怨懟。

### 6. 合法行為

行為不只有紙上買賣：

```text
閱讀 / 查證 / 等待 / 放棄研究
詢問 / 提醒 / 挑戰 / 隱瞞 / 道歉 / 退出談話
寫筆記 / 修改主張 / 承認不知道 / 維持原說法
建立 / 增加 / 降低 / 結束紙上部位
關閉裝置 / 休息 / 逃避 / 回到工作或家庭責任
```

候選由當前場景、時間、權限、現金、持股、市場狀態與人物能力建立。`不行動` 永遠是合法候選。

詢問、提醒、挑戰、道歉、承認與拒絕等語言行為，先由 deterministic `BehaviorPolicy` 選成 `SemanticSpeechActV1`；模型不能決定 communication intent。只有唯一 utterance realizer 能把已提交的 semantic act 變成候選句。隱瞞、忍住不說與未回覆是動作，不會為了讓畫面有字而補一句內心旁白。

每個行為的效用由下列項目組成：

```text
證據與信念一致度
+ 目前目標與需要
+ 情緒及身份威脅
+ 被喚起的記憶
+ 關係衝動
+ 已觸發的認知模式
+ 思考核心的正規化 appraisal
- 時間、金錢、身體與關係成本
- 不確定與違反自我敘述的代價
```

權重、上限與順序全部帶 policy revision。命盤沒有直接 action term；血型沒有市場 action term；關係總貢獻有上限。最高合法效用成為正式行為，完全平手才使用承諾過的 seed。

V5 初始 `BehaviorPolicy` 使用：

```text
U(action) =
  evidence_and_belief_fit       × 30%
+ current_goal_and_need_fit     × 18%
+ dynamic_emotion_and_agency    × 15%
+ activated_memory              × 10%
+ relationship_impulse          × 10%
+ cognitive_pattern_activation  × 10%
+ habit_and_skill_fluency       ×  7%
- time_money_body_social_cost
```

每個項目先正規化到 `-10_000..10_000`。模型 appraisal 只進第一項；motif 只能透過需要、情緒、記憶或關係進入；偏誤沒有對應 trigger 時，第六項固定為零。成本另有硬性 action mask，不能靠高情緒效用越過現金、持股、市場或身體限制。

### 7. 後果

後果分成四類：

- 市場：成交、未成交、價格變化、公司事件、交易限制。
- 人際：對方有沒有回應、誠實、誤解、疏遠或靠近。
- 生活：錯過工作、熬夜、家庭責任、身體疲勞。
- 自我：信心、羞恥、後悔、掌控感及自我敘述的裂縫。

市場損益只更新帳本和主觀狀態，不自動宣判判斷對錯。若原始理由已失效但價格仍上漲，故事要保留這種不舒服的幸運。

## 自主紙上交易

### 帳戶與市場規則

每位居民出生時開立一個獨立紙上帳戶。V5 公開世界預設虛擬本金為 NT$1,000,000，避免人生收入直接變成「誰比較能賺」；生活壓力只改變人物對虧損的感受與可投入研究時間。

初始公開規則只支援現金股票與既有持股賣出：

- 不使用真錢。
- 不借款、不槓桿、不融資融券、不做衍生品。
- 最多同時持有八檔；單一檔在 intent commit 時不得超過模擬資產 25%；成交後至少保留 5% 現金。
- 交易單位、漲跌幅、交易時間、暫停交易、手續費、稅、公司行動與成交規則來自 `ExecutionRuleset`。
- 未來增加其他市場或工具時，要新增 ruleset 與 instrument type，不能改寫舊帳本。

### 從想法到成交

```text
ThesisOpened / ThesisRevised
→ AutonomousActionIntentCommitted
→ 風險與市場規則驗證
→ PaperOrderSubmitted | PaperOrderRejected
→ 使用 commit 後第一個合格可用價格
→ PaperOrderFilled | PaperOrderExpired
→ 原子寫入 double-entry ledger postings
```

角色不能用決定之前的價格成交，也不能在資料缺漏時猜一個價格。盤中資料不可用的模式，應使用事先公開的下一合格開盤、收盤或延遲規則；每筆交易保存 ruleset 與 price source revision。

`AutonomousActionIntentCommitted` 的 paper-action payload 至少包含：

```text
character_id
paper_account_ref / paper_account_version
open_paper_order_refs[] / open_paper_order_versions[]
relevant_paper_position_refs[] / relevant_paper_position_versions[]
security_id
side
quantity_or_target_weight
order_type
limit_price_if_any
committed_at
expires_at
thesis_revision
perceived_fact_refs
confidence
invalidation_conditions
behavior_policy_revision
```

### Append-only 帳本

紙上帳本使用 double-entry postings。至少包含：

```text
paper_cash
paper_position:{security_id}
paper_fee_expense
paper_tax_expense
paper_realized_pnl
paper_corporate_action
```

正式事件包括：

```text
PaperAccountOpened
PaperCashInitialized
PaperAccountJournalPosted
AutonomousActionIntentCommitted
PaperOrderSubmitted
PaperOrderRejected
PaperOrderFilled
PaperOrderExpired
PaperPositionOpened / PaperPositionAdjusted / PaperPositionClosed
PaperCorporateActionApplied
PaperMarkApplied
PaperOutcomeRecognized
PaperAccountingCorrectionApplied
```

一筆 fill 使用同一個 multi-stream transaction：`PaperOrderFilled` 只推進
`PaperOrder` lifecycle，`PaperPositionOpened／Adjusted／Closed` 只推進 lot、
quantity 與 position outcome，`PaperAccountJournalPosted` 只提交 cash、fee、
tax 與 P&L account postings。三個事件引用同一 `fill_id`、source price 與
transaction digest，並封存提交後的三 aggregate version set；任何一個 stream
CAS 失敗就全部不提交。Corporate action 與 correction 也遵守相同 owner 分工，
不能以 projection 或旁路訊息補其中一半。

帳本事件不可修改或刪除。市場資料更正以新 revision 重算 projection；若更正影響正式成交，使用明確 reversal 與 corrected posting，不覆蓋原紀錄。

### 績效是投影，不是人格

人物頁可以完整顯示：

- 模擬資產與可用現金。
- 每一部位的數量、成本、現值、已持有天數。
- 已實現與未實現損益。
- 累積報酬、期間報酬與最大回落。
- 每筆原始理由、修訂、失效條件與實際行動。
- 手續費、稅、未成交與暫停交易。

projection 必須能從 append-only 帳本重新計算。角色之間不做全服績效排行榜，思考核心也不以報酬排名。

預設人物卡先說故事，再讓使用者展開數字：

> 他仍握著這個部位
> 已承受 −8.4%，持有 12 天
> 當時理由（系統摘要）：預期兩天內出現反彈
> 現在原話：「我本來就想看長一點」

「現在原話」必須逐字引用可見 `UtteranceArtifactV1`；沒有 artifact 就改成無引號的最新理由摘要，不補一句第一人稱台詞。折線圖、成交紀錄與完整計算留在「他的模擬帳本」，不能取代人物當下的姿勢、話語與關係。

## 學會，還是再來一次

人物更新分成四條學習線：

1. 證據校準：知道哪些來源可靠，信心是否常高過證據。
2. 自我理解：逐漸認出自己在害怕什麼、如何改口。
3. 關係修復：能否承認影響、向人道歉或建立新的信任方式。
4. 因應方式：遇到相同壓力時，是否多出一個可用反應。

每個 `lesson_thread` 使用以下狀態：

```text
UNSEEN
→ FELT
→ NAMED
→ TESTED
→ INTEGRATED
```

壓力過高時可以追加 `RELAPSED`，再回到 `FELT` 或 `NAMED`。已發生的理解不會被刪除，但「懂了」不保證下一次做得到。

### 學習成立

學習不能只靠虧錢觸發。至少需要：

- 一段可識別的舊模式。
- 新事件造成足夠 surprise 或關係代價。
- 角色取得反證，或有人讓他安全地看見矛盾。
- 他以話語或行為命名一部分問題。
- 下一次相似情境中出現不同選擇，哪怕只多等十分鐘或先問一句。

`INTEGRATED` 需要跨至少兩個不同事件測試。一次漂亮反省只能到 `NAMED`。

### 重複成立

重複也需要證據。相似 motif、相似身份威脅與相似行為鏈至少出現兩次，才能把它升為 `pattern_hypothesis`。第三次再發生時，故事可以讓觀眾有「他又要來了」的預感。

角色不會因重複而永久變笨。壓力降低、關係變安全或學會新的因應方式後，同一傾向可以不再主導行為。

### 結果與學習分開

四種情況都必須成立：

| 過程 | 結果 | 人物可能學到什麼 |
| --- | --- | --- |
| 理由完整 | 虧損 | 接受不確定，而不是否定所有能力。 |
| 理由破裂 | 獲利 | 承認幸運沒有修補原本的漏洞。 |
| 理由破裂 | 虧損 | 面對錯誤，也可能先合理化或怪人。 |
| 理由完整 | 獲利 | 信心小幅校準，不能升級成無敵。 |

世界不能把獲利當品德，把虧損當報應。

## 正式事件

每個 canonical event 都帶：

```text
event_id
aggregate_id
aggregate_version
world_time
recorded_at
idempotency_key
causation_id
correlation_id
truth_refs
schema_revision
policy_revision
model_revision_if_used
prompt_revision_if_used
seed_ref_if_used
prior_state_digest
next_state_digest
```

### Canonical event owner

本表的機器可驗證版本是 [`contracts/canonical-owner-map.yaml`](./contracts/canonical-owner-map.yaml)。同名 event 只能出現在一個 owner；`CharacterStateView`、`StoryBeat`、人生誌與搜尋都是 projection，不能接受 command 或回寫人物。

| Owner | Event | 必要內容 |
| --- | --- | --- |
| Character Origin | `CharacterIntroduced` | 引介 request、允許的建立選擇、成功 consume 的 quota ref 與 character ID。 |
| Character Origin | `CharacterOriginSealed` | origin seed、統計包、人生聖經、四軸、血型、出生資料、星曆與 origin digest。 |
| Character Origin | `ModelCoreAssigned` | core ID、adapter、snapshot、能力描述、出生時選擇紀錄。 |
| Character Life | `CharacterStateAdvanced` | 睡眠、生活壓力、恢復與固定日常造成的 state patch。 |
| Cognition／Decision | `ObservedClueRegistered` | fact revision、接觸時間、通道、深度、轉述者。 |
| Cognition／Decision | `AttentionCommitted` | 候選、選中與錯過 fact refs、attention policy、seed ref。 |
| Cognition／Decision | `CoreAppraisalAccepted`／`CoreAppraisalFallbackUsed` | 原始 core output ref 或 fallback、normalized claims、反證、不確定度。 |
| Character Life | `EmotionStateAdvanced` | trigger refs、前後狀態、衰減與上限。 |
| Cognition／Decision | `RelationshipImpulseCommitted` | 對象、靠近／反駁／隱瞞／修復傾向及來源。 |
| Cognition／Decision | `AutonomousActionIntentCommitted` | 合法候選、第一與第二效用、實際行為、action mask。 |
| Cognition／Decision | `SemanticSpeechActCommitted` | 不含 prose 的 act kind、surface kind、proposition refs、對象、來源 state digest 與 policy。 |
| Character Life | `PublicClaimMade` | 與事件原子封存的 `UtteranceArtifactV1` ID、hash、完整 canonical bytes、對象與可見範圍；不得另存第二份文字。 |
| Character Life | `SelfAcknowledgementMade` | 與事件原子封存的 `SELF_ACKNOWLEDGED` artifact；是角色當下能承認的原話，不得倒灌到較早時間。 |
| Character Life | `CommitmentRationaleSealed` | 永遠只有結構化 proposition、來源與退出條件，不含 quote 或 artifact；畫面只能以無引號摘要呈現。 |
| Paper Portfolio／`PaperAccount` | `PaperAccountJournalPosted` | fill／corporate-action transaction digest、平衡 postings、cash／reservation 前後值、fee／tax／P&L account entries，以及對應 Order／Position event refs。 |
| Paper Portfolio／`PaperOrder` | `PaperOrderSubmitted`／`Rejected`／`Filled`／`Expired` | requested terms、order lifecycle、ruleset、fill／expiry、price-source refs 與同 transaction 的 Account／Position refs；不保存 cash 或 lots。 |
| Paper Portfolio／`PaperPosition` | `PaperPositionOpened`／`Adjusted`／`Closed`、`PaperMarkApplied`、`PaperCorporateActionApplied` | instrument、lot／quantity／cost／mark／outcome patch，及同 transaction 的 Account／Order refs；不保存 account balance。 |
| Paper Portfolio／`PaperAccount` | `PaperAccountingCorrectionApplied` | prior revision、inverse／forward journal postings、correction source 與同 transaction 的 `PaperPositionAdjusted` ref；不改寫原 fill。 |
| Paper Portfolio | `PaperOutcomeRecognized` | 市場結果、PaperAccount／PaperOrder／PaperPosition exact version set 與 sealed mark refs。 |
| Character Life | `OutcomeAttributed` | 角色如何歸因；人際與記憶後果由各自 owner 保存。 |
| Memory | `MemoryFormed` | 事件、當時信念、情緒、可信度、觸發 motif。 |
| Memory | `MemoryReframed` | 原 memory revision、新解讀、觸發事件；不得改原事件。 |
| Character Life | `BeliefRevised` | 舊主張、新主張、新證據、是否承認改口。 |
| Relationship | `RelationshipEncounterCommitted` 與 directed relationship events | 雙方可觀察互動、前後 directional state。 |
| Character Life | `BehaviorHypothesisAdvanced` | pattern、支持與反例、信心、不得公開的內部狀態。 |
| Character Life | `LessonThreadAdvanced` | lesson、前後階段、測試事件、relapse 原因。 |

Paper portfolio 固定使用 `PaperAccount`、`PaperOrder`、`PaperPosition` 三個不
重疊 aggregate。跨 aggregate 的行為與帳本提交，要由同一 logical-cell
multi-stream write boundary 與共同 transaction digest 保證不會只成功一半；
任何 cognition input、action seal、故事或績效 projection 都封存三者 exact
version set，不能只引用 `PaperAccount`。

### 事件順序與重播

同一角色同一世界時間的更新順序固定：

```text
Daily state
→ Exposure
→ Attention
→ Interpretation
→ Emotion
→ Relationship impulse
→ Behavior
→ Paper intent / Semantic speech act
→ Utterance artifact seal or NO_UTTERANCE
→ Consequence
→ Memory / Belief / Relationship
→ Pattern / Lesson
```

法證重播使用原始 state、事實、core output、policy 與 seed，不能重新呼叫模型。相同輸入的 state digest 必須完全相同。

## 故事引擎

行為引擎決定人物做了什麼；故事引擎只決定觀眾此刻看見哪一段。兩者不可合併。

### 故事節拍

`StoryBeat` 是 projection，至少引用：

```text
beat_id
character_ids
canonical_event_refs
utterance_artifact_refs
world_time_range
observable_setup
visible_action
consequence
unresolved_question
truth_classes
visibility_policy
continuity_thread_id
```

故事選擇讀取：

- 尚未解決的自我矛盾。
- 關係張力與修復機會。
- 紙上部位的實際代價。
- 重複模式或第一次不同選擇。
- 觀眾已跟拍的人物連續性。
- 市場事件的新鮮度與可見性。
- 場景中能用姿勢、距離、停頓和動作演出的程度。

獲利幅度不能單獨決定主戲。模型也不能自行挑「最戲劇性的創傷」。

V5 預設故事顯著度為：

```text
觀眾已建立的連續人物線：25%
可觀察的自我矛盾：20%
關係張力或修復：20%
已落帳的市場、生活或自我代價：15%
第一次發生或第一次做出不同選擇：10%
可用姿勢、距離、聲音演出的程度：10%
```

模擬損益只能進「已落帳的代價」，最高占 15%。同分時優先保留觀眾正在跟拍的人物，再使用承諾過的 story seed。故事 policy 只能改未發布 projection，不能回頭換掉已播出的正式片段。任何 `utterance_artifact_refs` 都帶 canonical hash；chapter supersede、換版型或換 renderer 仍引用同一 artifact。

### 四層閱讀契約

這四層沿用 `product-constitution.md` 與 `experience-spec.md` 的同一份
資訊架構；角色引擎不另建第二份人生資料。公共世界與近景回答「現在發生
什麼」，人生誌只按 canonical 時序編章，完整結構化人生與紙上帳本只由
`/archive/*` 深層檔案投影提供。

#### 公共世界

先看到很多人同時生活。人物用停頓、走位、反覆看裝置、靠近或躲開某人表演。市場資料是場景壓力，不是卡片牆。

可見資訊：

- 當下動作，以及可見性政策允許的完整 `UtteranceArtifactV1` 原話。
- 公開市場物件。
- 一句已封存為 `SELF_ACKNOWLEDGED` 的短自我敘述；沒有 artifact 就只顯示觀察摘要。
- 模擬部位造成的姿勢、工作與關係壓力。

#### 角色近景與跟拍

從跟拍自然進入同一人的連續故事，不回到冷冰冰 dashboard。首層固定只
回答一個當下問題，不把人物拆成多張卡：

1. 他此刻在哪裡，正在做什麼。
2. 他現在卡在哪一個矛盾。
3. 一項與當下故事直接相關的後果碎片：模擬後果、關係變化、生活代價或記憶牽引四選一。
4. `翻開今天的人生誌`；其餘只有回到世界與記住人物。

近景只顯示這一刻與當章直接相關的摘要，不提供完整人生曲線、完整關係圖或
可篩選帳本。它可使用以下句型，但引號內文字必須逐 byte 來自頁面引用的
`UtteranceArtifactV1`：

> 前一個完成交易日，他在 10:42 追了進去。兩小時前，他還說：「沒有新公告就不動。」

上例只有在對應交易日已出現 `MarketSessionFinalityAccepted` 後才能顯示，
並附「紙上資料截至該交易日收盤」的 `as_of`。盤中近景不得公開同日 ticker、
BUY／SELL 語義、方向、數量、理由或尚未 final 的成交；它只能顯示截至前一
交易日的後果，或改用關係、生活與記憶碎片。

不要使用：

> FOMO +18，確認偏誤 +12。

#### 角色人生誌

人生誌只將已發布事件依 canonical 時序編成連續章節。每章可保留：

- 人物肖像、當章場景與世界時間。
- 當章可見的四軸性格、命盤 motif、記憶或關係牽引摘要。
- 對外話語、已封存的自覺原話與逐漸可見的重複張力；系統推論不能冒充內心獨白。
- 當章模擬行動及它留下的持股、損益、生活或關係後果摘要。
- 回到原始事件、完整 `UtteranceArtifactV1` 與相應 `/archive/*` 資源的引用。
- 尚未解決的人生問題，但不預告或生成未發生結果。

人生誌不擁有完整人生曲線、完整命盤、記憶索引、關係年表、紙上帳本或交易
歷史；這些資料即使在畫面上由人生誌進入，也只能讀取獨立 `/archive/*`
投影。命盤摘要不能只是太陽、月亮、上升三個標籤；每個出現在章節裡的主題
都要連回它曾經改變注意、記憶或關係重量的具體事件。

#### `/archive/*` 深層人生檔案

深層檔案是唯一保存完整可發布結構化人生的閱讀層，包括：

- 人物一生時間線、人生聖經與世代背景。
- 四軸性格、認知偏誤、完整命盤及象徵主題。
- 記憶索引、重新解讀版本、關係年表與共同事件。
- 思考核心的閱讀習慣、能力邊界與盲點。
- 紙上持股、成本、數量、損益、交易、錯過、原始理由與改口歷史。
- 已命名、正在測試與再次復發的人生課題，以及每一項的證據來源。

這一層依 entitlement 與 market-time fence 過濾；它仍不揭露 prompt、
chain-of-thought、未發布候選記憶、moderation artifact 或引介人專屬真相。

### 可見因果的語氣

只有可重播的因素改變正式候選或效用時，才能寫「這件事推了他一把」。若只是同時存在，寫「當時也在場」或「可能增加了這件事的重量」。

介面不畫唯一真因箭頭。建議展開層使用：

> 為什麼這一刻變重？
> 昨夜只睡 5.3 小時 · 小雨昨天提醒過他 · 買入理由已逾期 · 控制主題被喚起 · 尚未讀到更正公告

每一項都要能點回正式事件。未知就保留未知。

## 完整例子：陸硯之又追了進去

本例所有引號內角色文字都逐字引用各自已封存的 `UtteranceArtifactV1`；若 fixture 沒有對應 artifact，就改成無引號的系統摘要或可觀察動作，不能由 renderer 補寫例句。

### 人物底盤

```text
28 歲，企業研究助理
四軸：內省 68／抽象 61／分析 74／結構 57
太陽天蠍、月亮雙子、上升摩羯
O 型
核心需要：控制
核心恐懼：公開顯得無知
主要傾向：確認偏誤、模糊厭惡、地位防衛
舊記憶：14 歲時父親的印刷廠突然關閉
關係：信任陳小雨的判斷，也怕被她看穿
```

### 第一天，錯過

一家公司在早盤快速上漲。硯之正在補昨天的公告附註，沒有跟上第一段。他先說：

> 「沒有新資料，我不會為了價格動。」

世界記錄：

```text
錯過上漲
同儕談論增加
被看見需求升高
FOMO 由 1_100 升至 4_600
```

命盤的「控制與認可」主題只提高這件事的私人重量，沒有替上漲加分。

### 第二天，追進去

開盤後又上漲。小雨說：「你現在想買，是因為昨天沒買嗎？」這句逐字引用小雨當時封存的 `PUBLIC_SPEECH` artifact。

他沒有回答，卻把原本要求的兩項反證降成一項。10:42，他建立紙上部位。封存的結構化理由摘要是預期兩日內動能延續，失效條件是兩個交易日內沒有新證據。

鏡頭看到：

- 他先把小雨的訊息滑掉。
- 下單後才回頭補看昨天的材料。
- 對外說「只是小部位」，實際已碰到單一部位上限的 82%。

這一幕可以好笑，旁白不需要叫他韭菜。

### 第四天，理由過期

價格回落，兩日動能理由到期。系統沒有自動賣出，也沒有自動判他錯。它建立新的行為候選：

```text
承認理由失效並降低部位
等待一個交易日
用新證據正式修訂 thesis
靜默維持
```

硯之選擇靜默維持。他在筆記裡把標題從「動能觀察」改成「長期治理價值」，但沒有新增支持事實。

人物頁顯示：

> 原定期限已過 2 天
> 理由摘要由兩日動能改為長期治理
> 新增支持資料：0
> 他還沒有和小雨談這件事

這才構成合理化與沉沒成本的支持證據。

### 第十二天，第一次不同

另一家公司出現相似快速上漲。硯之又感到焦躁，但這次先把小雨的問題寫進筆記。只有這筆公開書寫已封存為 `PUBLIC_WRITING` artifact 時，才使用引號：

> 「如果昨天沒有漲，我今天還會想買嗎？」

他仍然看了很久，也沒有突然變成完人。最後只做「繼續研究」，沒有建立部位。`lesson_thread` 從 `NAMED` 進入 `TESTED`。

故事的落點不是「他學會正確交易」，而是：

> 他第一次讓一個難堪的問題，活得比衝動久十分鐘。

## 失敗處理

| 狀況 | 正式處理 | 對觀眾呈現 |
| --- | --- | --- |
| 市場事實缺漏或過期 | 不進 attention；受影響行為 hold 或移除交易候選。 | 「資料還沒齊，他沒有形成新判斷。」 |
| 公告更正 | 新增 fact revision；保留角色當時看到的舊版。 | 回看同時顯示「他當時看到」與「後來更正」。 |
| 角色未接觸事實 | 不得放進 prompt 或事後理由。 | 可在觀察層顯示「他當時沒看到」，不能讓角色自己說出內容。 |
| Cognition 模型 timeout | 同 request ID 重送一次；仍失敗走不含 prose 的 appraisal fallback。 | 不把技術故障寫成角色變笨或情緒失控。 |
| Cognition 模型引用不存在資料或輸出文字 | 拒絕輸出，寫 policy violation，走結構化 appraisal fallback。 | 顯示可觀察動作，不補角色原話。 |
| Utterance realizer timeout／invalid／unsafe | 同 request ID 的第一個 terminal 結果勝出；候選被拒後走 deterministic fallback，沒有安全句就 `NO_UTTERANCE`。 | 角色可以沉默；不能再叫另一個模型改寫。 |
| 敘事模型失敗 | canonical 世界照常運行；已存在的 utterance artifact 不受影響。 | 顯示正式動作、時間、資料標籤及允許公開的逐字 artifact。 |
| 重複事件送達 | idempotency key 讀回原結果。 | 不重複演出、不重複交易。 |
| state version 衝突 | 拒絕 stale command，重新讀取正式 head。 | 維持上一個可信畫面，標示更新中。 |
| 市場暫停或沒有合格價格 | 訂單依 ruleset 保留、拒絕或到期；不得猜 fill。 | 「市場暫停，這筆模擬委託沒有成交。」 |
| 帳本不平 | 封鎖新委託與績效 projection，進 audit hold。 | 保留既有故事，數字區顯示「帳本核對中」。 |
| 關係或記憶引用缺失 | 不生成該因果，建立 integrity incident。 | 寧可少一句，也不臨時補一段往事。 |
| 不安全或羞辱性候選文案 | 封存前 reject；已封存內容若因新政策不可見，只改 visibility epoch，不改 artifact。 | 隱藏整筆原話，另用非第一人稱的中性可觀察描述。 |
| 角色狀態超出範圍 | transaction 拒絕，記錄失敗注入資訊。 | 不顯示半套情緒或關係更新。 |

所有 failure 都不能觸發「換核心再試一次」，也不能用較好看的結果覆蓋第一次正式輸出。

## 測試與發布門檻

### 狀態與重播

- 相同 state、facts、core output、policy 與 seed，重播 state digest 一致率必須是 100%。
- renderer、字幕或文案版本改變造成的 canonical state 差異必須是 0。
- 任何 cutoff 後 fact 進入注意、解讀或行為的數量必須是 0。
- 記憶重新解讀後，原始事件與舊解讀仍可重播。
- 同一事件重送一百次，只能有一組正式行為及一組帳本 postings。

### 原話不可變

- Cognition 與 fallback schema 都設 `additionalProperties: false`；注入 `text`、`quote`、`claim: string`、`communication_intent` 或 `self_narrative_seed` 必須拒絕。
- `UtteranceArtifactV1` insert、`PublicClaimMade`／`SelfAcknowledgementMade` append 與 projection outbox 使用同一 transaction；crash injection 的結果只能全部存在或全部不存在。
- 兩個 runner、duplicate callback、transport retry、late model result 同時完成時，同一 semantic act 只能封存一個 artifact；已封存 fallback 不能被較晚模型結果覆蓋。
- Verifier output schema 只有 `ACCEPT`／`REJECT(reason_codes)`；不含任何文字欄，也不能用 sanitizer 修字後放行。
- World、close-up、journal、archive、search、share、notification、video、字幕與 screen reader 對同一原話回報相同 artifact ID 與 `canonicalTextSha256`。
- Story model 即使收到「把台詞寫得更性感」的提示，output schema 也沒有角色台詞欄。Chapter supersede 只能沿用 artifact 或移除整個 quote segment。
- Market finality fence 前，受限制的 artifact 必須從 public schema 物理移除；中性替代只能是 `observable`／`editorial_bridge`，finality 後公開的仍是原 artifact。
- Replay 不呼叫任何模型；artifact ID、canonical bytes、hash 與 sealing event 完全一致。Correction、clarification 與 retraction 只能追加新 artifact。
- `RelationshipSignalObserved` 只引用 `PublicClaimMade` 與 artifact，不保存第二份 text。

### 人物一致性

- 365 個世界日後，年齡、家庭結構、出生資料、命盤與重要人生事件不得自相矛盾。
- 背景文章每一項可查陳述都能回到人生聖經；找不到 ref 的句子不能公開。
- 兩位四軸值相近的角色，仍能因記憶、關係、生活壓力與目標形成不同路徑。
- 四軸、命盤或血型只改文風，卻沒有進入允許的中介狀態時，測試判失敗。

### 因果邊界

- 命盤與特定 security direction 之間的直接權重固定為 0。
- 血型與證據品質、智力、交易 action 的直接權重固定為 0；社交風味貢獻不得超過 300 basis points。
- 模型不能提交 `PaperOrderSubmitted`、`EmotionStateAdvanced`、directed relationship events 或 `MemoryFormed`。
- 每一個可見「因為」都要有 counterfactual 或已定義的效用差門檻支持；否則改寫成並列線索。
- raw chain-of-thought 不得進任何 public 或 controller projection。

### 韭菜樣場景

每個偏誤至少有一組正例、一組容易誤判的反例與一組壓力解除後不再發生的案例。

- FOMO fixture 中，移除「錯過＋同儕＋窄化時間」後，不得仍以 FOMO 解釋行為。
- 合理長期持有不能被標成沉沒成本。
- 有新支持事實的 thesis revision 不能被標成改口。
- 對方確實提供錯誤資訊時，追究責任不能被標成甩鍋。
- 一次成功後的正常信心調整不能被標成過度自信。
- 相同 character fixture 在相同輸入下不能時而追高、時而不追，只為了增加戲。

30 天群像模擬還要通過：

- 同一則高顯著事件進入 16 位居民時，至少出現四條可描述的注意或行為路徑。
- 任何人物都不能只剩單一偏誤；每名角色同時要有能力、關係牽掛、生活責任與至少一個能做對的領域。
- 任何單一偏誤不得解釋全體大多數正式行為。
- 有人學會、有人復發、有人尚未感到問題；全體不能沿同一條成長曲線。

研究測試以不顯示偏誤名稱的片段進行。至少 80% 的受測者能指出人物前後矛盾；把人物描述為「只是隨機笨」的比例必須低於 20%；至少 70% 除了記得錯誤，也記得同一人的一項願望或關係。

### 紙上帳本

- 每筆交易 postings 借貸平衡，帳本 balance check 通過率 100%。
- 任何 fill 的可用時間都不得早於 intent commit。
- 暫停、缺價、漲跌幅、交易單位、稅費與公司行動都有 fixtures。
- 從 genesis 重算的現金、數量、成本、已實現損益與 projection 完全一致。
- 原始理由、修訂與失效條件能逐筆對上交易。
- 把一段獲利改成虧損，只能改 consequence 以後的狀態；不能回寫之前的注意、解讀與行為。

### 故事投影

- 每個 `StoryBeat` 的人物、時間、動作與數字都有 canonical ref；角色原話另有唯一 artifact ref 與 hash，沒有 artifact 就不得顯示引號。
- 公共世界、角色近景、人生誌與 `/archive/*` 深層檔案對同一事件、摘要 ref 與可見性狀態不能互相衝突。
- 績效數字異常時只封鎖數字 projection，不刪掉人物故事。
- reduced-motion、螢幕閱讀器與文字模式能取得等價的動作、話語、時間與真實性標示。
- 角色頁首屏能在不看人格標籤的情況下，說清楚他此刻在做什麼、卡在哪裡、正在承受哪個後果。

## 禁止的捷徑

- 用星座、四軸字母或血型直接寫出台詞和行為。
- 把命盤當成股票方向、勝率或角色能力加成。
- 把所有虧錢行為都叫韭菜，把所有獲利都寫成聰明。
- 顯示「韭菜值」「理性值」「AI 智商」或把角色排成績效榜。
- 讓語言模型自行上網、挑事實、補價格或決定角色知道什麼。
- 讓模型直接修改人物、記憶、關係、持股或帳本。
- 顯示模型 chain-of-thought，或把它冒充成角色的真實內心。
- 為了更有戲而重抽模型、seed、人物背景、交易或市場結果。
- 用隨機失控替代可追溯的認知、情緒與關係過程。
- 先寫一篇背景故事，再回頭硬湊結構化資料。
- 用真人社群、履歷、生日、照片或家庭資訊拼成虛構角色。
- 把收入帶、地區、職業、性別或照顧責任當人格捷徑。
- 覆蓋舊記憶、舊理由、舊公告或舊交易，讓人物事後顯得比較聰明。
- 把產品沒有資料或模型故障寫成角色犯錯。
- 只在人物賠錢時給戲，忽略關係、工作、羞恥、幸運與自我欺騙。
- 把關係壓成好感度，或只因對方猜對就增加信任。
- 讓每位角色每天都遇到重大創傷、激烈衝突或交易。
- 把「沒有行動」「先休息」「承認不知道」當無效內容。
- 用付費解鎖創傷、秘密或角色羞辱。
- 用冷冰冰的金融 dashboard 取代單角故事；也不能為了故事藏掉完整帳本。

## 完成定義

角色引擎達到可動工程度時，團隊應能從任一人物的某次行為，回答以下問題：

```text
他當時能知道什麼？
他實際看見了什麼？
哪段記憶、關係與生活壓力進入了這一刻？
思考核心提交了什麼受限解讀？
規則引擎有哪些合法行為，為什麼選了這一個？
紙上交易如何落帳，後果何時才可知？
他後來怎麼說，原始理由有沒有被改寫？
這次是學會了一點，還是同一個模式又回來？
觀眾看到的每一句話，能不能回到正式事件？
```

少一個答案，故事就只是一段漂亮文字。全部答得出來，角色才真的在世界裡活過。

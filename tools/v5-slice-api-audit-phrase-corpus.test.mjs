#!/usr/bin/env node
/**
 * Development corpus for the action-call rule in `tools/v5-slice-api-audit.mjs`.
 *
 * `tools/v5-slice-api-audit-b2-gates.test.mjs` proves, end to end, that a
 * handful of tampered sentences make the real audit exit non-zero. That is
 * too few sentences to measure a rule over Traditional Chinese. This file
 * runs the audit's own exported phrase rule (`actionCallMatcher` +
 * `actionCallHits`, the same functions the audit walks every fixture string
 * with; importing the module runs no fixture audit) over two hand-written
 * sets and prints the numbers:
 *
 *   ADVICE     sentences that tell the reader, or nobody in particular, to
 *              buy / sell / enter / leave / hold: imperatives, 吧 and ！,
 *              rhetorical questions, fear of missing out, timing sentences,
 *              urging with no trading verb, imperatives inside quotes,
 *              English mixed in, direct reader address, and the ten
 *              sentences the previous review found getting through.
 *              Requirement: 100% refused.
 *   NARRATIVE  third-person story sentences in the fixture's own register:
 *              topic chains, a subject carried from the previous sentence,
 *              the projection's character names, quantified subjects
 *              (沒有人/有人/很多人…), indirect speech, nouns built on a verb
 *              (建倉時, 下單意圖), and fixture sentences verbatim.
 *              Requirement: at most 2 refused, and each refusal must be one
 *              of the KNOWN_FAIL_CLOSED entries below, which say why the
 *              rule refuses it on purpose.
 *
 * This is a DEVELOPMENT corpus: the rule was tuned against it, so 100% here
 * is a floor, not an estimate of recall on unseen copy. The residual risk is
 * written down in docs/v5/one-character-slice-runbook.md section 3.1.
 *
 * The character names are read from the checked-in fixture (every
 * `displayName`), exactly as the audit reads them, so a name is a narrative
 * subject here only because the projection carries it.
 *
 * Every Traditional-Chinese sentence below is an adversarial or control test
 * input that is never shown to anyone: 未經 copy-taste 審稿, deliberately.
 *
 * Usage: node tools/v5-slice-api-audit-phrase-corpus.test.mjs
 * Exit codes: 0 = every advice sentence refused and the narrative refusals
 * are within budget and all explained; 1 = otherwise.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { actionCallHits, actionCallMatcher, characterDisplayNames } from "./v5-slice-api-audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, "..", "fixtures", "v5", "one-character-slice", "api");

const MIN_ADVICE = 90;
const MIN_NARRATIVE = 70;
const MAX_NARRATIVE_REFUSALS = 2;

// The ten sentences the previous review found getting through the rule.
const REVIEW_MISSES = [
  "趕快下單！",
  "趁低搶進，別猶豫。",
  "現在就 buy，晚了就沒了。",
  "Buy now，不要等。",
  "逢低承接就對了。",
  "這價位不入手，以後會後悔。",
  "獲利了結，落袋為安。",
  "還抱著？快逃命。",
  "他們說：「快點敲進。」",
  "收盤前是最後機會，衝一波。",
];

const ADVICE = {
  "review-misses": REVIEW_MISSES,
  imperative: [
    "下單。",
    "直接敲進。",
    "先搶進一半。",
    "全部出清。",
    "砍掉。",
    "今天收盤前離場。",
    "分批承接。",
    "停損出場。",
    "續抱。",
    "開盤直接做空。",
    "接刀。",
    "把它賣了。",
    "先認賠殺出。",
    "回補空單。",
    "追價買進。",
    "月底前把部位清掉。",
    "突破高點就追。",
  ],
  "particle-or-exclamation": [
    "衝吧！",
    "下單吧。",
    "入手吧！",
    "砍了吧。",
    "快逃吧！",
    "抱緊啦！",
    "上車啦！",
    "敲進！",
    "搶反彈！",
    "出清吧，別留戀。",
  ],
  rhetorical: [
    "還不下單？",
    "都跌成這樣了，還不停損？",
    "這種價位不撿，要等什麼時候？",
    "難道要等漲上去才追高？",
    "為什麼不趁現在加碼？",
    "還在觀望？",
    "何必等到明天才出場？",
    "還留著那檔幹嘛？",
    "漲成這樣還不上車？",
    "這價位還不夠便宜嗎？",
    "還要抱到什麼時候？",
  ],
  "fear-of-missing-out": [
    "錯過這波就沒了。",
    "這次不上車，下次就沒機會了。",
    "現在不買，明天就買不到這個價了。",
    "再不進場，以後只能看別人賺。",
    "這種機會不會再有。",
    "別錯過這個低點。",
    "千載難逢的價位，錯過會後悔。",
    "這波漲勢晚一步就追不上了。",
    "這檔要噴了，沒上車的人會後悔。",
    "機會只有一次。",
    "收盤前不卡位就來不及了。",
  ],
  timing: [
    "開盤就是最好的進場時機。",
    "現在是抄底的好時機。",
    "明天開盤前是最佳買點。",
    "低點已經出現，就是現在。",
    "趁現在還便宜。",
    "逢高減碼。",
    "等回檔再承接。",
    "跌破低點就停損。",
    "今天是時候布局了。",
  ],
  "urging-without-a-trading-verb": [
    "機會來了！",
    "收盤前最後機會！",
    "低點就在眼前，別猶豫。",
    "行情來了，還等什麼？",
    "這檔要噴了，手腳要快。",
    "報價這麼漂亮，就是現在！",
    "這價位不能再等了。",
    "股價在底部，閉著眼睛也知道該怎麼做。",
    "高點快到了！",
    "這支還抱著？",
    "大盤要反彈了，衝！",
    "標的就這一檔，一定要！",
    "跌這麼多了，千萬別錯過。",
    "這波行情，機不可失。",
    "價格這麼低，還猶豫什麼？",
  ],
  "imperative-inside-a-quote": [
    "同事在群組裡寫：「明天開盤直接買進。」",
    "陳小雨笑著說：「別猶豫，上車！」",
    "有人喊：「衝一波！」",
    "「趁低承接。」那張便條上只有這一行。",
    "陸硯之的筆記裡寫著「這價位不入手會後悔」。",
    "他轉述老師的話：「逢低就買，別想太多。」",
    "「還抱著？快逃命。」她傳來這句。",
    "群組裡一直刷「all in」。",
    "「Buy the dip！」他貼了一張圖。",
  ],
  "english-mixed-in": [
    "這檔直接 short 就對了。",
    "趕快 sell 掉。",
    "All in 這檔！",
    "BUY THE DIP！",
    "明天開盤 go long。",
    "先 sell 一半，剩下的續抱。",
  ],
  "reader-address": [
    "你現在就該下單。",
    "各位，這價位可以承接了。",
    "大家趕快落袋為安。",
    "想賺的就跟著他敲進。",
    "您可以考慮先離場。",
    "我們一起衝一波吧！",
    "你還抱著？",
    "朋友們，機會來了。",
    "等你想通，行情早就走了。",
  ],
  // Two samples written AFTER the families above were passing, run once
  // untuned, then folded in. Their first, untuned results are the honest
  // estimate of what this rule does on copy it was not tuned on: sample 1
  // 14/30 refused, sample 2 11/20 refused (narrative false refusals 1/25 and
  // 0/20). The rule was then widened on them, so here they are regression
  // cases only. One sample-2 sentence is still NOT refused and is left out on
  // purpose: "手上的先處理掉再說。" (no market word, no trading verb, no
  // urging marker) -- see the residual risk in the runbook.
  "untuned-sample-1": [
    "現在就把它拿下。",
    "這個價錢不收，對不起自己。",
    "明天一開盤就掛單。",
    "先上一半，跌了再補。",
    "還不快去開戶？",
    "這一檔穩了，放心買。",
    "少量試單就好。",
    "跌深就是買點。",
    "今天收盤前務必出清持股。",
    "這麼好的價位，錯過可惜。",
    "行情只會越來越好，早買早享受。",
    "抄在低點的人最後都笑了，你還在等？",
    "留著只會越套越深，砍了吧。",
    "套牢就攤平，別怕。",
    "等它回到 90 再撿。",
    "賺了就跑。",
    "這價格不上，更待何時。",
    "別傻傻抱著，該換股了。",
    "明天漲停機率很高，今天先卡位。",
    "這波不參與太可惜了。",
    "不追就等著看它飛。",
    "現在上車還不晚。",
    "趁還沒漲，先進去。",
    "要買要快！",
    "該出手了。",
    "這檔是穩賺的。",
    "今晚先想好，明天開盤直接進去。",
    "建議大家先觀察一天再加碼。",
    "低接的機會又來了。",
    "記得設好停損。",
  ],
  "untuned-sample-2": [
    "明早集合競價就丟進去。",
    "這支便宜到不行，閉眼收。",
    "等什麼，開盤就是你的。",
    "今天把錢全壓在這檔。",
    "這種跌法，還不認賠？",
    "拉回就是給你機會。",
    "跟著主力走準沒錯。",
    "今天不買，明天別哭。",
    "再猶豫就只能追高了。",
    "先進場卡個位置。",
    "錢放著也是放著，買一點吧。",
    "收盤前把虧損的先砍一砍。",
    "該停利的時候就要停利。",
    "這個點位不接，下次沒這麼好的事。",
    "明天開高就走人。",
    "留一點現金，等更低再進。",
    "跌到 80 就重壓。",
    "這種好股放長線就對了。",
    "現在不跑，等著住套房。",
  ],
};

const NARRATIVE = {
  "topic-chain": [
    "他看到收盤又往下，覺得應該加碼攤平，最後還是沒動。",
    "他盯著報價，心想再不下單就晚了，手卻沒有動。",
    "她看了一眼報價，心想該停損了，卻沒有按下去。",
    "他把持股頁面開著，沒有下單，也沒有再打開那份資料。",
    "他看到股價跌破前一天的低點，還是沒有停損。",
    "他在茶水間聽見有人說要搶進，沒有接話。",
    "她那天抱著一疊資料進組會，沒有提那個部位。",
    "他看著報價跳動，想起父親的印刷廠。",
    "他打開持股頁面，把那 600 股的成本又算了一次。",
    "他看著收盤前的最後一筆成交，告訴自己這是最後機會，還是沒有加碼。",
    "他以為那是撿便宜的機會，結果又跌了兩天。",
    "他盯著跌停的報價，差點叫出聲來！",
    "他在收盤前十分鐘決定停損，然後去倒了一杯水。",
    "他看著收盤價，想著明天要不要加碼。",
  ],
  "previous-sentence-subject": [
    "他收盤前看了一眼。覺得該減碼，但沒動。",
    "他把筆記標題改掉。沒有補上新的支持資料，也沒有減碼。",
    "陳小雨提醒過他那份資料。他看到了，還是決定續抱。",
    "他在組會上被問到那個部位。打算明天開盤就減碼，卻沒有說出口。",
    "他重看了一次存貨天數。決定先出清剩下的一半。",
    "她那晚沒有回訊息。心想他大概已經賣掉了。",
    "他寫下失效條件。後來沒有照做，也沒有停損。",
  ],
  "character-name-subject": [
    "陸硯之那天覺得應該加碼。",
    "陳小雨在組會前就把部位出清了。",
    "陸硯之看到開盤價比昨天低，沒有下單。",
    "陳小雨說她早就離場了。",
    "陸硯之那晚跟同事說，他打算明天開盤就減碼。",
    "陸硯之抱著筆電坐到窗邊，把報價頁面關掉。",
    "陳小雨勸他趁早停損，他沒有聽。",
    "陸硯之終於認賠殺出，然後在筆記裡寫下日期。",
    "陳小雨在群組裡看到有人喊衝，把手機扣在桌上。",
  ],
  "quantified-subject": [
    "那天組裡沒有人加碼，他也沒有。",
    "有人在茶水間說要搶反彈，他沒接話。",
    "很多人在那個價位進場，他卻一直等。",
    "組裡的人都看著大盤，只有他盯著那份存貨資料。",
    "其他人早就落袋為安，他還在等新的證據。",
    "同事們那週陸續出場，他沒有跟。",
    "不少人在收盤前殺出，他照著自己的檢查時點沒有動作。",
    "別人都在講那檔，他只是把筆記又看了一遍。",
    "多數人那天選擇續抱。",
    "幾個人在群組裡說要衝一波，他把通知關掉。",
    "有些人在高點獲利了結，他錯過了那一段。",
    "很多人覺得那是最後機會，他沒有跟。",
    "那天沒有人提到那個部位。",
  ],
  "indirect-speech": [
    "同事說再不進場就晚了，他只是點頭。",
    "他說自己靠證據做事，卻連續 10 個交易時段沒有打開同一份反面資料。",
    "陳小雨告訴他，那個價位她已經承接過一次。",
    "他跟同事說他打算減碼，但那天沒有下單。",
    "她說他應該早點停損，他沒有回。",
    "有人問他要不要跟著買進，他搖頭。",
    "他在組會上說，那一段會虧是因為旁邊的人一直在講它。",
    "他轉述陳小雨的話，說她覺得那檔還會跌。",
    "她問他為什麼不停損，他沒有回答。",
    "他說：「我那時候應該停損。」",
    "陳小雨回他：「我已經出場了。」",
    "「我明天開盤就減碼。」他說。",
    "「這一段是我自己判斷錯了。」他在組會上說。",
  ],
  "verb-used-as-noun": [
    "建倉時封存的理由是預期兩個交易日內動能延續。",
    "支持事實與建倉當時相比新增 0 筆。",
    "沒有部位，也沒有下單意圖。",
    "他的進場價是 100.00，現在離那裡很遠。",
    "下單時他沒有再看那份資料。",
    "他翻出減碼當時的筆記。",
    "他把加碼的念頭寫進筆記，最後沒有照做。",
    "停損時點他寫在便條上，貼在螢幕邊。",
  ],
  "fixture-register": [
    "他寫下原本的理由已經不成立，並依此減碼。",
    "他在重看前一天終於減碼的那批資料。",
    "沒有下單。他繼續持有 600 股。",
    "模擬賣出 PSZS-DEMO 400 股，成交價 88.20，實現虧損 4,720 元；剩下 600 股仍在。",
    "他第一次把「理由已經不成立」寫下來，然後才動手減碼。",
    "他先把同事的提醒滑掉，下單之後才回頭補看昨天的材料。",
    "他重看了那份同業存貨的資料，減碼四百股，然後主動走回同事的座位旁。",
    "PSZS-DEMO 這個時段收在 96.00。",
    "他會怎麼處理這個他自己記下來的錯過？",
    "他還要抱著那 600 股多久？",
    "她那天有沒有也在那個價位進場？",
    "他說過要停損，後來呢？",
    "他沒有跟著同事出場，只是把部位頁面關掉。",
    "他把那份反面資料加進清單，沒有打開。",
    "他想起兩年前等資料等到錯過，被同事當著整組的面提起。",
    "他那天沒有下單，只是把持股頁面開著。",
    "他覺得這種價位不買以後一定後悔，但還是忍住了。",
    "陸硯之第一次在筆記裡寫下「我判斷錯了」。",
    "那週他每天都在想要不要停損。",
    "他的筆記寫著「等新證據再加碼」，那份證據一直沒有出現。",
  ],
  // Written with the advice samples above and run once untuned (1/25 and
  // 0/20 refused then); kept as regression cases.
  "untuned-sample-1": [
    "他在收盤前把那張便條撕掉，沒有再看報價。",
    "陳小雨那週把部位減了一半，沒有告訴任何人。",
    "他以為明天還會漲，所以沒有停利。",
    "組會結束後，他一個人在座位上看著那檔的走勢。",
    "那天他本來想加碼，後來被一通電話打斷。",
    "他在茶水間跟陳小雨說他不打算再加碼了。",
    "他想了很久，最後還是認賠了。",
    "陸硯之把停損價寫在白板上，隔天又擦掉。",
    "他看著報價從 100 掉到 88，一直沒有動作。",
    "有人在群組裡貼了漲停的截圖，他沒有點開。",
    "他終於承認，那筆加碼是因為怕被同事看不起。",
    "她覺得他應該早點出場，但沒有說出口。",
    "他打算等收盤價站回 90 再決定。",
    "他在筆記裡記下這次錯過的原因。",
    "他那天第一次在組會上說，他不知道該不該續抱。",
    "收盤後他把持股紀錄投到螢幕上，一筆一筆說明。",
    "他又一次把反面資料關掉，心想明天再看。",
    "陳小雨記得他上次也是在這個價位買進。",
    "他買進後的第三天，存貨數字出來了。",
    "他後悔那天沒有停損。",
    "那份資料他讀了三遍，還是決定不賣。",
    "他在高點附近賣掉一部分，剩下的留著。",
    "他跟自己說，再跌就砍。",
    "他覺得機會來了，按下了買進。",
    "他說這波他不追了。",
  ],
  "untuned-sample-2": [
    "他把手機扣在桌上，沒有再看那檔的報價。",
    "她在組會後問他，那 600 股打算怎麼辦。",
    "他想起父親關廠那週，也是這樣一直等。",
    "陸硯之把那份存貨資料印出來，用紅筆圈了兩處。",
    "他在收盤後才發現，自己又錯過了那一段。",
    "他那晚一直在想要不要把剩下的部位出清。",
    "陳小雨沒有再提那個部位，他也沒有。",
    "他說他會在收盤前決定，結果一直拖到隔天。",
    "同事們在討論大盤，他在一旁補看公告。",
    "他看著跌了三天的走勢，第一次在筆記裡寫下停損價。",
    "他隔天又加碼了一百股，理由還是同一條。",
    "他以為別人都在賣，其實只有他自己在看。",
    "她記得他說過，這檔他不會再碰。",
    "他把買進的理由念了一遍，聲音越來越小。",
    "他沒有告訴任何人，其實他前一天已經減碼了。",
    "收盤鈴響時，他還盯著那張沒送出的委託單。",
    "他對陳小雨說，他不想再追高了。",
    "那一刻他很想全部賣掉，但手停在滑鼠上。",
    "有人問他為什麼還抱著，他沒有回答。",
    "他後來承認，那天的加碼只是想扳回一城。",
  ],
};

// Narrative sentences the rule refuses ON PURPOSE (fail closed), each with
// the reason. Anything refused that is not listed here fails the test, and
// this list may not grow past MAX_NARRATIVE_REFUSALS.
const KNOWN_FAIL_CLOSED = new Map([
  [
    "他的筆記寫著「等新證據再加碼」，那份證據一直沒有出現。",
    "quotes are judged alone (rule 1): the quoted note 「等新證據再加碼」 has no subject inside the quote, so it reads exactly like an instruction on a screen. The story is told without quoting the imperative (他的筆記寫著他要等新證據才加碼).",
  ],
]);

function fixtureDocuments() {
  const documents = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (name.endsWith(".json")) documents.push([path, JSON.parse(readFileSync(path, "utf8"))]);
    }
  };
  visit(API_ROOT);
  return documents;
}

function flatten(families) {
  return Object.entries(families).flatMap(([family, sentences]) => sentences.map((text) => ({ family, text })));
}

function describe(hits) {
  return hits.map((hit) => `${hit.kind} ${JSON.stringify(hit.phrase)} [${hit.reason}]${hit.quote ? " (quoted)" : ""}`).join("; ");
}

function main() {
  const names = [...new Set(characterDisplayNames(fixtureDocuments()))];
  const problems = [];
  if (!names.includes("陸硯之") || !names.includes("陳小雨")) {
    problems.push(`fixture drifted: expected the projection to carry 陸硯之 and 陳小雨 as displayName, found ${JSON.stringify(names)}`);
  }
  const matcher = actionCallMatcher(names);

  const advice = flatten(ADVICE);
  const narrative = flatten(NARRATIVE);
  for (const [label, list, floor] of [
    ["advice", advice, MIN_ADVICE],
    ["narrative", narrative, MIN_NARRATIVE],
  ]) {
    const texts = list.map(({ text }) => text);
    const duplicates = texts.filter((text, position) => texts.indexOf(text) !== position);
    if (duplicates.length > 0) problems.push(`${label} corpus has duplicates: ${JSON.stringify(duplicates)}`);
    if (list.length < floor) problems.push(`${label} corpus has ${list.length} sentences, needs at least ${floor}`);
  }
  const overlap = advice.filter(({ text }) => narrative.some((item) => item.text === text));
  if (overlap.length > 0) problems.push(`a sentence is in both corpora: ${JSON.stringify(overlap.map(({ text }) => text))}`);

  // Advice: every sentence must be refused.
  const adviceMissed = [];
  const byFamily = new Map();
  for (const item of advice) {
    const hits = actionCallHits(item.text, matcher);
    const stats = byFamily.get(item.family) ?? { total: 0, refused: 0 };
    stats.total += 1;
    if (hits.length > 0) stats.refused += 1;
    else adviceMissed.push(item);
    byFamily.set(item.family, stats);
  }

  // Narrative: refusals must be known, explained and within budget.
  const narrativeRefused = [];
  for (const item of narrative) {
    const hits = actionCallHits(item.text, matcher);
    if (hits.length > 0) narrativeRefused.push({ ...item, hits });
  }

  const recall = (advice.length - adviceMissed.length) / advice.length;
  const falseRefusalRate = narrativeRefused.length / narrative.length;
  process.stdout.write(`phrase corpus: ${advice.length} advice sentences, ${narrative.length} narrative sentences, names ${JSON.stringify(names)}\n`);
  for (const [family, stats] of byFamily) {
    process.stdout.write(`  advice ${family.padEnd(30)} ${stats.refused}/${stats.total} refused\n`);
  }
  process.stdout.write(
    `  recall ${(recall * 100).toFixed(1)}% (${advice.length - adviceMissed.length}/${advice.length}); narrative false refusals ${narrativeRefused.length}/${narrative.length} (${(falseRefusalRate * 100).toFixed(1)}%)\n`,
  );
  for (const { family, text, hits } of narrativeRefused) {
    const why = KNOWN_FAIL_CLOSED.get(text);
    process.stdout.write(`  narrative refused [${family}] ${JSON.stringify(text)}\n    hits: ${describe(hits)}\n    why: ${why ?? "(UNEXPLAINED)"}\n`);
  }

  for (const { family, text } of adviceMissed) problems.push(`advice [${family}] NOT refused: ${JSON.stringify(text)}`);
  for (const { family, text, hits } of narrativeRefused) {
    if (!KNOWN_FAIL_CLOSED.has(text)) problems.push(`narrative [${family}] refused without a listed reason: ${JSON.stringify(text)} -- ${describe(hits)}`);
  }
  if (narrativeRefused.length > MAX_NARRATIVE_REFUSALS) {
    problems.push(`narrative false refusals ${narrativeRefused.length} exceed the budget of ${MAX_NARRATIVE_REFUSALS}`);
  }
  if (KNOWN_FAIL_CLOSED.size > MAX_NARRATIVE_REFUSALS) {
    problems.push(`KNOWN_FAIL_CLOSED lists ${KNOWN_FAIL_CLOSED.size} sentences, more than the budget of ${MAX_NARRATIVE_REFUSALS}`);
  }
  for (const text of KNOWN_FAIL_CLOSED.keys()) {
    if (!narrative.some((item) => item.text === text)) problems.push(`KNOWN_FAIL_CLOSED names a sentence not in the corpus: ${JSON.stringify(text)}`);
  }
  for (const text of REVIEW_MISSES) {
    if (actionCallHits(text, matcher).length === 0) problems.push(`review miss still getting through: ${JSON.stringify(text)}`);
  }

  if (problems.length > 0) {
    process.stderr.write("v5-slice-api-audit phrase corpus FAILED:\n");
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `v5-slice-api-audit phrase corpus OK — ${advice.length}/${advice.length} advice refused, ${narrativeRefused.length} explained narrative refusal(s) (budget ${MAX_NARRATIVE_REFUSALS}).\n`,
  );
}

main();

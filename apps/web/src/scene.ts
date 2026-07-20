export type MarketPulse = {
  ticker: string;
  company: string;
  close: string;
  change: string;
  tone: "slate" | "blue" | "violet";
};

export type Resident = {
  id: string;
  name: string;
  age: number;
  role: string;
  x: number;
  y: number;
  depth: "back" | "middle" | "front";
  look: "left" | "right" | "front";
  hair: string;
  skin: string;
  coat: string;
  accent: string;
  activity: string;
  lines: readonly string[];
};

export const marketPulses: readonly MarketPulse[] = [
  {
    ticker: "2330",
    company: "台積公司",
    close: "2,290",
    change: "−180",
    tone: "blue",
  },
  {
    ticker: "2454",
    company: "聯發科技",
    close: "3,370",
    change: "−330",
    tone: "violet",
  },
  {
    ticker: "2317",
    company: "鴻海精密",
    close: "234",
    change: "−8.5",
    tone: "slate",
  },
] as const;

export const residents: readonly Resident[] = [
  {
    id: "yu-zhi",
    name: "陸硯之",
    age: 38,
    role: "半導體設備業務",
    x: 20,
    y: 27,
    depth: "back",
    look: "right",
    hair: "#222326",
    skin: "#d3a680",
    coat: "#596879",
    accent: "#a56d52",
    activity: "盯著牆上的公告，手卻沒有離開口袋",
    lines: [
      "數字比傳聞好。市場卻像沒聽見。",
      "我不是怕跌。我怕自己其實一直在等別人先動。",
      "先不說。小雨一聽就知道我改主意了。",
    ],
  },
  {
    id: "xiao-yu",
    name: "陳小雨",
    age: 31,
    role: "產品設計師",
    x: 35,
    y: 29,
    depth: "back",
    look: "left",
    hair: "#342d2b",
    skin: "#e0b38d",
    coat: "#8b5360",
    accent: "#d0a073",
    activity: "把手機扣在桌面，繼續聽硯之沒有說完的話",
    lines: [
      "他又開始把情緒說成資料。",
      "昨天還說要等。今天為什麼一直看時間？",
      "我不問。看他能忍多久。",
    ],
  },
  {
    id: "old-mao",
    name: "老貓",
    age: 57,
    role: "退休營造監工",
    x: 55,
    y: 25,
    depth: "back",
    look: "front",
    hair: "#6e6c68",
    skin: "#bd8d69",
    coat: "#5f6958",
    accent: "#b78b52",
    activity: "把報紙折成很窄的一條",
    lines: [
      "年輕人看的是跌幅，我看誰還坐得住。",
      "以前我也以為經驗會讓人不怕。",
      "阿哲今天太安靜。安靜不一定是好事。",
    ],
  },
  {
    id: "a-zhe",
    name: "周哲民",
    age: 27,
    role: "韌體工程師",
    x: 70,
    y: 31,
    depth: "back",
    look: "left",
    hair: "#171a1f",
    skin: "#c99670",
    coat: "#435768",
    accent: "#6d97a2",
    activity: "反覆解鎖同一個畫面，沒有下單",
    lines: [
      "只是模擬單。錯了也不會怎樣。",
      "老貓在看我。他一定以為我沒發現。",
      "如果等到不怕才按，我永遠不會按。",
    ],
  },
  {
    id: "zhi-wei",
    name: "宋知微",
    age: 44,
    role: "財經節目製作人",
    x: 84,
    y: 25,
    depth: "back",
    look: "left",
    hair: "#2b2527",
    skin: "#d2a17b",
    coat: "#765464",
    accent: "#c58d80",
    activity: "記下每個人第一次轉頭的時間",
    lines: [
      "公告沒有戲。人們假裝公告沒影響他們，才有戲。",
      "長川在找一句能讓所有人安心的話。找不到的。",
      "我今天不剪掉沉默。",
    ],
  },
  {
    id: "chang-chuan",
    name: "顧長川",
    age: 49,
    role: "家族企業財務主管",
    x: 78,
    y: 44,
    depth: "middle",
    look: "right",
    hair: "#272a2e",
    skin: "#b98763",
    coat: "#48505c",
    accent: "#9a765a",
    activity: "站在門口，每隔十秒看一次走廊",
    lines: [
      "公司裡每個人都在問我同一件事。",
      "我能解釋數字，不能替他們承諾明天。",
      "知微正在記。我得少說一點。",
    ],
  },
  {
    id: "yi-ning",
    name: "方以寧",
    age: 35,
    role: "急診護理師",
    x: 16,
    y: 47,
    depth: "middle",
    look: "right",
    hair: "#26211f",
    skin: "#d8a681",
    coat: "#4e7575",
    accent: "#b7d0c9",
    activity: "用紙杯暖手，沒有看任何螢幕",
    lines: [
      "夜班結束後，所有紅字都像警報。",
      "硯之以為我不懂。我只是現在不想懂。",
      "先喝完。再決定今天要不要留在這裡。",
    ],
  },
  {
    id: "shen-yao",
    name: "沈曜",
    age: 33,
    role: "獨立交易者",
    x: 32,
    y: 49,
    depth: "middle",
    look: "front",
    hair: "#1f2025",
    skin: "#c6926a",
    coat: "#61586d",
    accent: "#8b83a3",
    activity: "張口後停下，沒有出聲",
    lines: [
      "我有一個理由。問題是我剛剛才想出來。",
      "別把運氣說成紀律。也別把恐懼說成耐心。",
      "那句話現在說出口，只會像在替自己辯護。",
    ],
  },
  {
    id: "lin-cheng",
    name: "林澄",
    age: 29,
    role: "占星內容編輯",
    x: 49,
    y: 48,
    depth: "middle",
    look: "left",
    hair: "#3a2f35",
    skin: "#dcb08a",
    coat: "#665b79",
    accent: "#b8a5d1",
    activity: "在筆記邊緣畫了一個沒有完成的圓",
    lines: [
      "相位只會放大他本來就在看的東西。",
      "沈曜不是改變看法。他只是換了一種說法。",
      "今天的盤很擠。人也一樣。",
    ],
  },
  {
    id: "jin-sheng",
    name: "羅謹生",
    age: 62,
    role: "前銀行授信主管",
    x: 64,
    y: 52,
    depth: "middle",
    look: "right",
    hair: "#79746e",
    skin: "#c19572",
    coat: "#59574f",
    accent: "#a99c78",
    activity: "看著年輕人，沒有加入任何一桌",
    lines: [
      "人欠的不是錢，是對昨天那個自己的交代。",
      "跌一天不構成故事。誰開始說謊才構成。",
      "我以前也愛給答案。現在只想看問題會去哪。",
    ],
  },
  {
    id: "mei-ling",
    name: "許美玲",
    age: 52,
    role: "早餐店老闆",
    x: 85,
    y: 57,
    depth: "middle",
    look: "left",
    hair: "#332b28",
    skin: "#c88f69",
    coat: "#7b5e4c",
    accent: "#d0a56f",
    activity: "把帶來的飯糰分給沒吃早餐的人",
    lines: [
      "你們空著肚子看盤，什麼都會看成世界末日。",
      "長川不吃，代表他真的有事。",
      "先拿著。要不要吃是你的事。",
    ],
  },
  {
    id: "bo-wen",
    name: "葉博文",
    age: 41,
    role: "高中歷史教師",
    x: 12,
    y: 68,
    depth: "front",
    look: "right",
    hair: "#252527",
    skin: "#ba8765",
    coat: "#525d6d",
    accent: "#879bb0",
    activity: "並排翻閱兩份不同年份的報紙",
    lines: [
      "歷史不會重演。人會重複尋找熟悉的解釋。",
      "這不是崩盤。至少現在還不是。",
      "我說得太快了。",
    ],
  },
  {
    id: "jia-en",
    name: "魏嘉恩",
    age: 24,
    role: "研究所學生",
    x: 29,
    y: 72,
    depth: "front",
    look: "left",
    hair: "#1d1c20",
    skin: "#d5a27d",
    coat: "#6e5263",
    accent: "#ce879d",
    activity: "把論文視窗縮小，又立刻打開",
    lines: [
      "我只是來看，不是來逃避論文。",
      "美玲姐怎麼每次都知道誰沒吃東西？",
      "再五分鐘。我真的五分鐘後就走。",
    ],
  },
  {
    id: "zi-an",
    name: "杜子安",
    age: 36,
    role: "工業攝影師",
    x: 46,
    y: 69,
    depth: "front",
    look: "front",
    hair: "#202326",
    skin: "#9f6d50",
    coat: "#3f5b5a",
    accent: "#769a94",
    activity: "拍下沒有人注意的空椅子",
    lines: [
      "大家都在拍牆。我想知道誰離開過。",
      "空的位置比坐著的人誠實。",
      "相機一靠近，人就開始演自己。包括我。",
    ],
  },
  {
    id: "ruo-lan",
    name: "高若蘭",
    age: 46,
    role: "法律顧問",
    x: 66,
    y: 74,
    depth: "front",
    look: "left",
    hair: "#312b2c",
    skin: "#d1a07a",
    coat: "#58536b",
    accent: "#a99ac0",
    activity: "逐字讀完來源，才看旁人的反應",
    lines: [
      "公告寫了什麼是一件事，人希望它寫了什麼是另一件事。",
      "這裡沒有人需要為別人的判斷負責。",
      "但每個人都會影響別人的判斷。這才麻煩。",
    ],
  },
  {
    id: "kai-yuan",
    name: "江開元",
    age: 30,
    role: "餐飲採購",
    x: 84,
    y: 78,
    depth: "front",
    look: "left",
    hair: "#252223",
    skin: "#bd815c",
    coat: "#6a5848",
    accent: "#c99a69",
    activity: "計算原料成本，隔壁桌說話時停筆",
    lines: [
      "我不碰科技股。至少我一直這樣跟別人說。",
      "若蘭姐每句話都留出口。真羨慕。",
      "今天先記下來。記下來不算動心。",
    ],
  },
] as const;

export type SceneMoment = {
  id: string;
  startsAt: number;
  label: string;
  ambient: string;
  announcementVisible: boolean;
};

export const sceneMoments: readonly SceneMoment[] = [
  {
    id: "open",
    startsAt: 0,
    label: "開盤後",
    ambient: "三道市場脈衝同時進入房間。",
    announcementVisible: false,
  },
  {
    id: "notice",
    startsAt: 20,
    label: "公告抵達",
    ambient: "牆面亮起。四個人轉頭，一個人繼續說話。",
    announcementVisible: true,
  },
  {
    id: "hesitation",
    startsAt: 35,
    label: "有人停了一拍",
    ambient: "硯之沒有把手拿出來，小雨看見了。",
    announcementVisible: true,
  },
  {
    id: "cross-talk",
    startsAt: 240,
    label: "熟人靠近",
    ambient: "兩段對話同時開始。鏡頭只能留在一邊。",
    announcementVisible: true,
  },
  {
    id: "position",
    startsAt: 420,
    label: "一筆模擬部位",
    ambient: "阿哲建立模擬部位，老貓沒有問他理由。",
    announcementVisible: true,
  },
  {
    id: "after",
    startsAt: 480,
    label: "再次回到原位",
    ambient: "沈曜收起手機，換到窗邊。",
    announcementVisible: true,
  },
] as const;

export function getSceneMoment(seconds: number): SceneMoment {
  const normalized = Math.max(0, Math.min(599, Math.floor(seconds)));
  const firstMoment = sceneMoments[0];
  if (!firstMoment) {
    throw new Error("Scene timeline must contain at least one moment");
  }

  let active = firstMoment;

  for (const moment of sceneMoments) {
    if (moment.startsAt > normalized) break;
    active = moment;
  }

  return active;
}

export function getResidentLine(resident: Resident, seconds: number): string {
  if (seconds >= 480) return resident.lines[2] ?? resident.lines[0] ?? "";
  if (seconds >= 240) return resident.lines[1] ?? resident.lines[0] ?? "";
  return resident.lines[0] ?? "";
}

export function formatSceneTime(seconds: number): string {
  const total = Math.max(0, Math.min(599, Math.floor(seconds)));
  const hours = 9 + Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

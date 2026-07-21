# 研究 origin 與通過後網域分工

_2026-07-21｜只固定會造成 origin 搬家與證據失效的邊界，不提前凍結正式世界架構_

## 現在

24 人測試只使用 `https://world.panshi.app`。這個 origin 同時擁有研究 PWA、service worker、IndexedDB 與匯出檔的 `studyOrigin`；不得改用 apex、beta、study、供應商預覽網址或 path 前綴。

現在只部署靜態容器。主機不接收研究事件，不設應用後端、事件資料庫或 analytics；原始紀錄與研究控制台只存在固定手機。`panshi.app` 不承載研究 build，公開根路徑不導流，研究站維持 `noindex`。

## 三項門檻通過後

| Host | 永久責任 |
| --- | --- |
| `panshi.app` | 品牌與節目入口 |
| `world.panshi.app` | 《盤勢・眾生》唯一世界與 PWA，沿用研究 origin |
| `research.panshi.app` | 企業命盤 × 股價歷史研究產品 |
| `api.panshi.app` | 世界 API 邊界；市場證據固定走 `/sealed-facts/v1` |

舊 `panshi.nomadsustaintech.com` 屆時逐 path 301 到 `research.panshi.app`，目的頁使用 self-canonical，不保留兩個可索引副本。這項轉址只在三項門檻通過後執行。

## 不可跨越的邊界

- 兩個產品不共用資料庫、runtime 或 application code。
- 研究產品只經已發布的 `sealed-fact/v1` 提供可核對的市場證據。
- PWA、IndexedDB、快取與隔日證據不搬離 `world.panshi.app`。
- DNS、TLS 與舊站轉址都是獨立 operator action，不由 build 或 app code 自動修改。

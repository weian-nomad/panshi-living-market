# V4 分層場景資產

這裡的兩組正式資產由 OpenAI ImageGen 依 V4 開盤廳方向稿生成，並保留可互動分層：

- `opening-hall-empty-v1`：不含人物、介面、文字與行情數字的 3/4 俯視空場景。
- `resident-atlas-alpha-v1`：4 × 4、共 16 位成年臺灣居民的獨立人物 atlas。Web 端以 `background-position` 取出每一格，命中區、姓名、焦點、鏡頭與事件狀態仍由 DOM 控制。

瀏覽器使用 WebP；PNG 保留作為可再處理的來源。`tools/remove-atlas-background.mjs` 只清除與畫布邊界連通的淺色生成底，避免破壞人物衣物內部細節。

生成約束：深墨與灰藍自然光、臺北當代服裝、成年人比例、每人不同輪廓／髮型／服裝明度／姿勢／道具，不含姓名、品牌、介面或金融儀表板。

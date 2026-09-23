# B.B.MAN 彈珠超人 · 台灣夜市新型彈珠台

B.B.MAN／彈珠超人類型的 3D 台灣夜市彈簧拉桿式彈珠台。核心玩法依實機
規則重建：每局以 10 顆彈珠開始，紅燈跳動後鎖定 2／4／6／8／10 目標，拉桿發射，
命中指定紅燈球道才贏回對應顆數彈珠。

瀏覽器另提供「基礎分數 × 洞口倍率」的**遊戲設計抽象**，讓玩家可以比較本局表現；
分數、倍率洞、5／10／20 顆批量模式都不是實機規則，實機沒有積分，贏得的是彈珠顆數。

## v7 實機重建版

- 依實機桌上型 64 × 35.5 × 48 cm 的窄長比例重建黃色機殼
- 後方直立控制箱包含投幣器、LED 顆數／倍率顯示、倍率燈與黃色退珠盒
- 球盤底部是 9 個黃色倍率洞：1／2／3／5／10／5／3／2／1
- 前控制板具白色跳燈鈕、中央鎖孔、紅色接珠盤與右前鍍鉻彈簧拉桿
- 彩虹外框、透明罩、卡通印刷盤面與夜市共用鐵架依實機照片整理
- 完整新手引導、中文即時狀態；實機基準 10 顆，另提供 5／10／20 顆瀏覽器練習模式
- 總分、最高單次得分、各倍率次數與最近進洞歷史紀錄（全部明確標為瀏覽器設計抽象）
- 桌面支援實體拉桿、滑鼠環繞、滾輪縮放與 SPACE 長按蓄力
- 手機版提供獨立力道滑桿與大型發射按鈕，直向畫面也能完整遊玩
- 真實剛體物理、隨機撞釘擾動、卡球救援與防穿模機制，沒有預錄落點

## 實機研究依據

- 經濟部 B.B.MAN 機具說明：紅燈隨機跳動、按鍵停止、命中指定燈號後按倍率退珠
  <https://gcis.nat.gov.tw/graphics/game_pic/311/game311d_032.pdf>
- 機台商資料：實機尺寸、十顆彈珠流程及 2／4／6／8／10 倍率玩法
  <https://gamingtoys.com.tw/2210/彈珠檯-彈珠超人彈珠台-遊戲機台-超市、夜市懷舊/>
- 新友電玩產品照：直立控制箱、黃色機身、彩虹外框、前控制板與右前拉桿
  <https://www.agisgame.com.tw/product_item_info.asp?id=295>

完整的來源分級、兩種夜市彈珠台類型區分、不確定事項與設計決策，見
[`docs/night-market-pinball-research.md`](docs/night-market-pinball-research.md)。本專案的
「新型」一詞在此明確採 B.B.MAN／彈簧拉桿式現代機台解讀，不指傳統木製手撥台。

## 遊戲設計抽象（瀏覽器限定）

本專案的「總分」只為瀏覽器遊戲提供可比較的回饋：鋼珠進入 9 個設計用倍率洞後，依
「基礎分數 × 洞口倍率」加分。官方實機文件明確記載無積分、押分、退幣功能；實機的
真實獎勵只有命中亮紅指定球道後獲得 2／4／6／8／10 顆彈珠。畫面會以「抽象」標籤
區分兩者，避免把瀏覽器計分誤當成考證規則。

## 遊玩

### 方式一：單檔離線版（推薦，零依賴）

```bash
npm install && npm run build   # 產生 game.html（引擎+遊戲全內嵌，約 1.5MB）
```

之後**直接雙擊 `game.html`** 即可遊玩 — 不需要伺服器、不需要網路、
拷貝到隨身碟或任何電腦都能玩。

### 方式二：本地伺服器（開發用）

```bash
node serve.mjs 8181     # 或 npm run serve（no-store 防快取）
# 開啟 http://localhost:8181/index.html
```

> 畫面右上角有版本標記（如 `v7 · B.B.MAN`），看不到代表瀏覽器載到舊快取。

- 每局 10 顆、一次投入 1 顆；`SPACE` / 點白色跳燈鈕開始跳燈，跳燈中再按一次才鎖定紅燈目標道與 2/4/6/8/10 顆獎勵
- 瞄準狀態長按 `SPACE` 蓄力、放開發射；`Enter` 可快速發射
- 將右下拉桿往玩家方向拉出蓄力、放開後向機台內回彈發射；短拉若沒越過發射道，原球會滾回待發位置，不會扣球
- 手機／平板可直接調整底部力道條，再按「發射鋼珠」
- 拖曳空白處 = 旋轉視角、滾輪 = 縮放（自由 3D 環繞）
- `R` = 重來，`M` = 靜音

規則：起始 10 顆，一次投入一顆；只有鋼珠進入本球亮紅燈的指定球道，
才按上方獎勵顆數贏回 2／4／6／8／10 顆。進入其餘 11 道不退珠。
`BALLS = 0` 時結算發射數、命中數、贏回球數與最高倍率。

## 技術

- `three@0.160` 渲染（含 RoomEnvironment IBL 金屬反射），`cannon-es@0.20` 物理（CDN import map，無需安裝、無後端）
- v7：機台視覺真的傾斜 TILT 角，放在夜市共用鐵架上；物理座標不變
- 單位 1 = 1cm；傾斜盤重力 `tiltedGravity(TILT)`，`SAPBroadphase` + 每子步鉗速 + 外殼安全碰撞層
- `src/loop.js` 固定步進排程器：240Hz 固定 timestep + 累積器 + 最大補算步數，
  每幀物理計算另有 wall-clock 時間預算；算不完的切片延後到下一幀、落後過多則丟棄
  （不會無限追幀）。撞釘/多球或低幀率時自動降到低精度 solver，並在恢復後升回，
  `requestAnimationFrame` 渲染與輸入永遠優先回應
- 撞釘 `InstancedMesh`（目前 77 根小型金屬釘）+ 12 條實體黃隔板球道；接觸材質：撞釘 restitution 0.62 / friction 0，邊框 0.36，底部槽 0.05
- 發射滿力約 390 cm/s（明確拉動會保證足夠起步力，帶 ±3.5% 速度抖動）+ ±2% 方向抖動，撞釘附加碰撞擾動，每局結果不可完全預測
- 卡球保護：位移錨點偵測 + 傳送到開放點脫困；分隔牆頂加球直接重放回開放軌道
- 音效全用 Web Audio 合成，無外部素材

## 結構

```
index.html  style.css     開發版（CDN import map，需 http）
game.html                離線單檔版（npm run build 產生，雙擊即玩）
serve.mjs                零依賴靜態伺服器（no-store 防快取）
build-singlefile.mjs     esbuild 打包腳本
src/main.js      場景/燈光/相機/主迴圈
src/loop.js      固定步進排程器（累積器／時間預算／最大補算／精度降級）
src/camera.js    自由環繞相機（拖曳/滾輪/WASD/閒置展示）
src/pinball.js   機台組裝（呼叫 geometry.js）
src/geometry.js  機殼/撞釘/擋板/槽/拉桿網格
src/layout.js    撞釘座標/槽位置
src/physics.js   cannon-es world + 材質
src/game.js      READY→SPINNING→AIMING→IN_PLAY→RESOLVING→GAME_OVER
src/controls.js  拉桿拖曳/按鈕/鍵盤/相機操作
src/audio.js     Web Audio 音效
src/ui.js        HUD/蓄力條/結算
test/            puppeteer 真瀏覽器測試
```

## 測試

Headless 瀏覽器端到端測試（功能 + 物理 + 混沌測試，目前 30 項檢查）：

```bash
npm install        # 安裝 puppeteer
npm run serve      # 先啟動 8181 伺服器（另開終端）
npm test
```

另有桌面／手機響應式介面與觸控流程測試：

```bash
npm run test:ux
```

固定步進／時間預算排程器（純 Node，不需瀏覽器）與瀏覽器整合測試：

```bash
npm run test:timestep    # 累積器、最大補算、時間預算、精度降級
npm run test:loop        # 讀取離線 game.html，驗證落後夾制、插值、渲染/輸入持續回應
npm run test:game-logic  # 開始/重來、瞄準蓄力、進洞計分、卡球/出界復原、重複事件防護
```

預設找 `/tmp/chs/chrome-headless-shell-linux64/chrome-headless-shell`，
可用任何 Chrome / Chromium 指定：

```bash
CHROME_PATH=/path/to/chrome npm test
```

涵蓋：開機無錯誤、機台結構（12 球道燈 / 5 倍率燈 / 小型撞釘 / InstancedMesh）、
雙輪盤目標、完整遊戲循環（每發射必結算、命中指定紅燈道 +N、失誤 -1）、
球數歸零結束、重開、同力度 10 發落點各異（無預錄路徑）、無越界無卡球。

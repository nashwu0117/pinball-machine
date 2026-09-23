# 實作基線（給後續 workers）

寫於 2026-09-20，涵蓋目前 working tree 的未提交變更。詳細規則/操作說明見 `README.md`；
本文件只記錄「接手前必須知道」的分工、風險與驗收方式。

## 現況總覽

- 分支 `main`，僅有 1 個 commit（`abd947a`），其餘皆為未提交變更 + 尚未加入版控的新檔案。
- 未提交變更（`git diff --stat`）：`README.md`、`game.html`、`package.json`、
  `src/config.js`、`src/game.js`、`src/main.js`、`src/physics.js`、`src/pinball.js`、
  `test/offline-check.js`、`test/run.js`、`test/ux-check.js`。
- 未加入版控的新檔案：`src/loop.js`（新模組）、`test/timestep.js`、`test/timestep-check.js`。
- 這一批變更是同一個功能：把物理更新從「每幀用可變 dt 呼叫 `world.step`」
  換成「固定 240Hz 步進 + 每幀時間預算 + 精度降級」的排程器（`FixedTimestepRunner`），
  詳見下方「進行中的功能」。**功能已完成、測試齊全、可通過全部既有與新增測試**，不是半成品。
- `.qoder/` 是未加入 `.gitignore` 的本機工具設定（另一個 AI 編輯器的權限清單），與遊戲無關，未動它。
- `.mimocode/`、`.omo/` 已在 `.gitignore` 中排除，不需理會。

## 架構與檔案分工

沿用 README「結構」一節的檔案配置，這裡標注目前這批改動誰動了什麼、後續 worker 可以怎麼分工：

| 檔案 | 角色 | 這批變更動了什麼 | 後續分工建議 |
|---|---|---|---|
| `src/loop.js` | **新增**。固定步進排程器：累積器、追趕上限、wall-clock 預算、精度降級 (`FULL`/`REDUCED`)、插值 `alpha` | 全新檔案 | 排程/效能相關工作認領這支 + `test/timestep.js` |
| `src/physics.js` | cannon-es world/材質 | 移除舊的 `stepWorld()`（可變 dt 直接 `world.step`），改成 `sanitizeBodies()`（NaN/Inf 防呆），真正的 `world.step` 呼叫移到 `loop.js` 內 | 物理材質/碰撞調整認領這支 |
| `src/game.js` | READY→SPINNING→AIMING→IN_PLAY→RESOLVING→GAME_OVER 狀態機 | `Game` 持有 `this.stepper = new FixedTimestepRunner()`；`update()` 改用 `stepper.advance()` 拿到 `renderDt`/`simulatedDt`/`alpha`；`_trackBall` 新增多組防呆（見下方風險） | 遊戲規則/計分邏輯認領這支，**改動 `_trackBall` 前務必先讀完現有 4 組防呆邏輯，避免疊床架屋** |
| `src/pinball.js` | 機台組裝、球體 mesh 同步 | `syncBall(alpha)` 用 cannon-es 內建的 `previousPosition`/`previousQuaternion` 做插值；`_guardBallInsideWalls` 補強 NaN/Inf 防呆與速度鉗制 | 視覺呈現/插值相關工作認領這支 |
| `src/main.js` | 場景/相機/主迴圈 | `frame()` 把 `rawDt` 餵給 `game.update()`（讓 stepper 自己管理 dt），`presentDt`（clamp 過的）餵給 controls/ui/orbit；新增 `window.__pinballTestDrive` 開關讓測試接管模擬時脈；`window.__pinball` 曝露 `stepper`/`CANNON` 供測試存取 | 相機/輸入相關工作認領這支 |
| `src/config.js` | 常數 | 新增 `PHYSICS.budgetMs/maxFrameDelta/reducedSolverIterations/reducedSolverTolerance/crowdThreshold/slowCostMs/degradedHoldMs`；新增 `BALL.outOfBoundsExtra/maxSurvivalTime/stuckTimeout/continuousOverlapTime` | 數值調校認領這支；改數值前看 `src/loop.js` 頂部註解，理解每個值的用途 |
| `src/camera.js`/`controls.js`/`ui.js`/`audio.js`/`geometry.js`/`layout.js` | 未變動 | — | 可安全並行認領，不會跟這批改動衝突 |
| `test/timestep.js` | **新增**。純 Node 單元測試（無瀏覽器），測 `FixedTimestepRunner` 本身 | — | 排程器邏輯的回歸測試以此為主 |
| `test/timestep-check.js` | **新增**。瀏覽器整合測試，載入 `game.html`（file://，不需 server），驗證真實 cannon-es world 下的積壓/插值/精度降級/輸入回應 | — | 改完 `src/loop.js` 或 `src/game.js` 的迴圈邏輯後，這是主要回歸測試 |
| `test/run.js`、`test/ux-check.js`、`test/offline-check.js` | 既有測試 | 三者都加了 `window.__pinballTestDrive = true`，讓測試自己驅動 `game.update()`，不被真實 rAF 迴圈搶時脈；`test/run.js` 額外把 Chrome 執行檔搜尋路徑擴充成多個候選路徑並在都找不到時直接報錯退出 | — |

## 啟動方式（已驗證於本機）

```bash
npm install                 # 一次性；node_modules 已存在，通常不需重跑
npm run build                # 從 src/ 重新產生 game.html（esbuild 打包）
npm run serve                # 啟動 http://localhost:8181（無快取，開發用）
```

Chrome 執行檔本機路徑（`CHROME_PATH` 若未設會用 `test/run.js` 內建的候選清單自動找到）：
```
/home/nash/.cache/puppeteer/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell
```

## ⚠️ 重要：改 `src/*.js` 後必須先 `npm run build`

`game.html` 是建置產物（由 `build-singlefile.mjs` 用 esbuild 打包 `src/`），但**直接被
`test/offline-check.js` 和 `test/timestep-check.js` 用 `file://` 載入**——這兩支測試不會
自動重新打包。**本次接手時 `game.html` 落後於 `src/` 的最新修改**（重新 `npm run build`
後 diff 從 285 行新增變成 354 行新增），已重新建置並全數驗證通過。之後任何 worker 改了
`src/*.js`，在跑 `offline-check` / `timestep-check` 之前一定要先 `npm run build`，否則會
測到舊行為卻誤判為過。`test/run.js` 與 `test/ux-check.js` 是打 `http://localhost:8181`（即
`index.html` + CDN import map 直接讀 `src/`），不需要 rebuild 就能反映原始碼變更。

## 已修正的低風險問題

- `src/game.js` 的 `DRAIN_TIMEOUT`（球在場上多久沒進洞就強制結算）原本是寫死的 `const DRAIN_TIMEOUT = 12`，
  但 `src/config.js` 這批改動同時新增了語意相同的 `BALL.maxSurvivalTime = 12.0` 卻沒有人接上，
  形成兩份會各自漂移的重複魔術數字。已改成 `const DRAIN_TIMEOUT = BALL.maxSurvivalTime;`，
  數值不變（12 秒），純粹消除重複來源，**不影響任何既有行為**。已重新 `npm run build` 並
  跑滿五組測試（見下方驗收清單）全數通過後才確認此修正安全。

## 已知風險 / 尚待留意的地方（未動，留給後續 worker 判斷）

1. **`_trackBall()` 內有 4 組彼此獨立又功能重疊的救援機制**（`src/game.js:294-468`）：
   - stuck detection（`speed < BALL.stuckSpeed` 持續 `stuckTimeout` 秒）
   - 「卡在洞口分隔牆頂」偵測（`ballTimer > 2.5` 且高度/z 條件）
   - wedged-ball anchor 偵測（位移 `lastTrackPos` 3 秒內移動 < 3.0）
   - continuous overlap guard（位移 `continuousOverlapPos` 在 `continuousOverlapTime` 秒內移動 < 5.0）

   四組各自維護 timer/position 快照、各自呼叫 `_findOpenSpot` 重新丟球，`recoveryTries > 5`
   的判斷也重複了 4 次。目前測試（`run.js`「no permanently stuck ball」「every shot resolved」等）
   全部通過，代表現有行為是正確的，但這個方法已經有點難讀，如果之後要再加防呆或調參數，
   建議先把這四組的觸發條件列表比較過，避免不小心讓兩組同時觸發、互相搶著搬球。這次任務
   範圍不含重構，未動它。
2. **README 的「27 項檢查」字樣已經過期**：`test/run.js` 目前實際輸出 29/29（外加 `test:timestep`
   27 項、`test/timestep-check` 24 項、`test:ux` 10 項、`test:offline` 定性檢查非計數式），
   之後有人改測試數量時記得一併更新 README 措辭，這次未動（屬於文件用語問題，非功能缺陷）。
3. **`.qoder/settings.local.json`** 是未加入 `.gitignore` 的本機工具權限設定檔（非本專案程式碼），
   目前是 untracked 狀態。是否要加進 `.gitignore` 或直接忽略，留給使用者決定，本次未動。

## 驗收清單（本機已實測，全數通過）

依序執行，前兩項不需要 server / 不需要瀏覽器：

```bash
node test/timestep.js
# 期望：27/27 checks passed（純 Node，測 FixedTimestepRunner 本身）

CHROME_PATH=/home/nash/.cache/puppeteer/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell \
  node test/offline-check.js
# 期望：最後一行 "OFFLINE BUILD OK"，errors: none（需先 npm run build）

CHROME_PATH=/home/nash/.cache/puppeteer/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell \
  node test/timestep-check.js
# 期望：24/24 checks passed（載入 game.html，需先 npm run build）
```

以下兩項需要先另開一個終端跑 `npm run serve`（或背景執行 `node serve.mjs 8181`）：

```bash
CHROME_PATH=/home/nash/.cache/puppeteer/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell \
  node test/ux-check.js
# 期望：10/10 PASS

CHROME_PATH=/home/nash/.cache/puppeteer/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell \
  node test/run.js
# 期望：29/29 checks passed（含混沌測試、卡球/越界防呆、多球結算等）
```

跑完記得關掉背景 server（`pkill -f "node serve.mjs 8181"`），避免佔用 8181 port。

## 既有玩法（簡述，供不熟悉專案的 worker 快速上手）

起始 10 顆球，一次投入一顆；按鈕/SPACE 觸發紅燈輪盤，再按一次鎖定本球目標球道
（2/4/6/8/10 倍率之一）。拉桿蓄力發射，鋼珠落入 9 個倍率洞（1/2/3/5/10/5/3/2/1）之一，
命中鎖定的目標道才依「基礎分數 × 洞口倍率」計分，其餘洞不退珠。`BALLS = 0` 時結算。
完整規則見 `README.md` 的「遊玩」一節。

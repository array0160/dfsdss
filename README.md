# TimePortal RVM v13

這一版停止使用 MediaPipe Selfie Segmentation。

## 新架構

```text
觀眾手機
└─ 只傳送正常相機 MediaStream

大螢幕
├─ 接收手機影片
├─ TensorFlow.js 載入 Robust Video Matting
├─ 保存 r1、r2、r3、r4 recurrent states
├─ 取得 fgr 與 pha
└─ 與 background.jpg 合成
```

RVM 的四組 recurrent states 會逐幀交給下一次推論，
不是自行對遮罩做固定平均。

## 檔案

將以下檔案放在 GitHub Pages 專案根目錄：

- `index.html`
- `style.css`
- `script.js`
- `background.jpg`

## 使用方式

首頁：

```text
https://你的網址/
```

大螢幕：

```text
https://你的網址/?mode=screen
```

大螢幕會產生手機 QR Code。

## 畫質選項

大螢幕可以選擇：

- 高清：RVM 最長邊 1280
- 標準：RVM 最長邊 960
- 相容：RVM 最長邊 640

手機仍會盡量傳送 1280×720 的原始影片。
畫質選項只控制固定大螢幕端的 RVM 推論負擔。

## 模型來源

程式預設從官方 RVM `tfjs` branch 經 jsDelivr 載入：

```text
https://cdn.jsdelivr.net/gh/PeterL1n/RobustVideoMatting@tfjs/model/model.json
```

並以 GitHub Raw 作為備援。

正式展覽若要避免外部模型 CDN，可以把官方 `model` 資料夾
放到網站根目錄，然後在 `script.js` 的 `RVM_MODEL_URLS`
加入：

```js
"./model/model.json"
```

## 授權提醒

Robust Video Matting 官方專案採 GPL-3.0。
若專案要封閉商業交付、販售或以其他方式散布，
需要先確認 GPL-3.0 對整體交付方式的要求。


## v14：第一張畫面與載入狀態修正

v13 收到手機串流後會把原始 video 隱藏，因此在 RVM 模型下載、
WebGL shader 編譯或第一幀推論期間，使用者只能看到背景照片。

v14 改為：

- 手機 LIVE 一收到便立即顯示。
- RVM 第一張去背畫面成功後，才淡出原始 LIVE video。
- 狀態分開顯示「連線」、「模型下載」與「第一張畫面等待秒數」。
- 30 秒仍無第一張去背畫面時顯示明確警告。
- 預設使用官方 TensorFlow.js starter 相同等級的 640 尺度。
- 960 與 1280 改成手動提高的選項。

正常情況下不需要一直盯著空白背景：
連線成功後應立即看到未去背 LIVE，之後再切換成 RVM 去背 LIVE。


## v15：三項實測修正

### 1. 觀眾連線後人物出現太慢

- 大螢幕開啟時，同時建立 PeerJS 房間並下載 RVM。
- 在顯示 QR Code 前先以 640×384 假影格完成一次 GPU 預熱。
- 預熱包含 fgr、pha 與 r1～r4 recurrent state 路徑。
- 觀眾只有在「模型與 GPU 已預熱」後才會看到 QR Code。

因此等待時間被移到工作人員開啟大螢幕的準備階段，
而不是讓觀眾掃碼後才等待第一張人物。

### 2. 手機人物比老照片亮

大螢幕新增：

- 人物亮度滑桿，預設 84%
- 人物飽和度滑桿，預設 72%
- 輕微暖色調

只處理人物 fgr，不改 background.jpg。

### 3. 手機轉向

手機會比較：

- viewport 直橫方向
- videoWidth / videoHeight 的實際方向

只有兩者不一致時才送出 ±90° 補轉 metadata。
大螢幕在送入 RVM 以前以 TensorFlow.js 旋轉影格，
不依賴 WebRTC 是否正確傳遞旋轉資訊。


## v16：透明人物、方向同步與拍照精修

### 1. 整塊手機畫面亮度不同

LIVE Canvas 不再重畫 background.jpg。

現在：

- `.screen-stage` 只顯示一次 background.jpg
- RVM Canvas 只輸出 RGBA 透明人物
- 背景區域 Alpha 為 0

因此不會再出現一個與手機影片尺寸相同、亮度不同的矩形區塊。

### 2. 手機轉向

新增 PeerJS DataConnection。

手機轉向時不再重啟相機與媒體通話，而是傳送：

- portrait / landscape
- orientation angle
- viewport 尺寸
- 相機 frame 尺寸

大螢幕收到後，依遠端 video 的實際寬高判斷是否需要補轉，
並在送入 RVM 前旋轉 Tensor。

大螢幕另保留「手動旋轉 90°」按鈕作為瀏覽器例外時的備援。

### 3. 拍照精修

手機與大螢幕都新增「拍照」按鈕。

拍照時：

1. 凍結當前 LIVE 影格
2. 以最長邊最高 1280 重新處理
3. 同一影格執行 4 次 RVM recurrent refinement
4. 使用 3×3 morphological opening 清理小型背景殘留
5. 套用人物亮度與飽和度
6. 與 background.jpg 合成 PNG
7. 在大螢幕預覽與下載

這會比 LIVE 畫面慢，但可改善手指縫、小白塊與瞬間抖動。
它仍無法保證所有頭髮或手指細縫百分之百正確。


## v17：強制方向、老照片色調與連拍精修

### 手機方向

自動方向仍保留，但不同手機與瀏覽器對 WebRTC 旋轉 metadata
的處理不一致，因此 v17 新增手機端「旋轉影像 90°」。

按鈕不是旋轉手機預覽，而是把命令送到大螢幕：

```text
0° → 90° → 180° → -90° → 0°
```

一旦使用強制旋轉，自動方向不會再覆蓋它。
大螢幕可按「恢復自動方向」。

### 老照片色調分析

網站載入 background.jpg 後，會分析：

- 水平 15%～85%
- 垂直 25%～95%

也就是人物通常出現的中央偏下區域。

這張背景圖的 fallback 實測值約為：

```text
平均 RGB：122 / 107 / 102
標準差：20 / 45 / 39
```

預設人物設定：

```text
亮度：82%
飽和度：60%
背景色調融合：52%
```

調色還包含：

- 降低對比
- 提起黑位
- 暗部偏洋紅
- 亮部偏青綠
- 有限制的 mean/std 色彩轉移

### 拍照不再只抓一張

v17 會在約 0.6 秒內連拍 7 張，
以簡化 Laplacian 清晰度評分挑選最不模糊的一張，再執行：

- 最長邊最高 1280
- downsample ratio 0.68
- 5 次 recurrent refinement
- 較強的 3×3 Alpha opening
- Alpha 收緊與輕度平滑
- 比 LIVE 更強的背景色調融合

這能降低「一定要完全靜止」的要求，但手機快門造成的嚴重動態模糊
仍無法由去背模型憑空恢復。


## v18：固定橫向與鏡頭框

### 旋轉不再清空人物

v17 旋轉時會立刻改變可見 Canvas 尺寸，因此 Canvas 被瀏覽器清空，
看起來像人物突然透明；舊 CSS 同時顯示「重新建立 LIVE 串流」，
但實際上旋轉本來不需要重新建立 WebRTC。

v18 改為：

1. 旋轉要求先進入待處理狀態
2. 目前人物畫面繼續保留
3. 在沒有其他推論執行時才重設 RVM recurrent state
4. 新方向先畫到離線 renderCanvas
5. 新畫面完整完成後才一次替換可見 Canvas

旋轉不會停止手機相機、不會關閉 PeerJS 通話，
也不會重新啟動首次連線的 30 秒計時器。

### 預設橫向

手機 LIVE 第一次到達後：

- 收到橫向 frame：使用 0°
- 收到直向 frame：預設補轉 90°

之後方向只由手機或電腦的「旋轉影像 90°」控制，
不再讓各瀏覽器不一致的 orientation metadata 自動覆蓋畫面。

### 調鏡頭框

大螢幕新增「調鏡頭框」。

開啟後：

- 顯示目前手機完整畫面
- 白色框線表示實際手機影像範圍
- 滑鼠拖曳：移動人物／鏡頭框
- 滑鼠滾輪：放大或縮小
- 也可使用「放大」「縮小」「框置中」

再次按「完成鏡頭框」：

- 隱藏原始手機畫面
- 回到老照片與透明人物的 LIVE 合成
- 保留剛才設定的位置與大小

設定會儲存在瀏覽器 localStorage。
拍照精修輸出的 PNG 也會套用相同鏡頭框。


## v19：拍照穩定性與放大清晰度

### 拍照改成安全模式

v18 拍照會同時使用：

- 7 張連拍
- 清晰度分析
- 最高 1280 輸入
- 5 次 RVM executeAsync
- 高解析度 Alpha morphology
- PNG 編碼

這會大幅增加 WebGL GPU 記憶體，在部分電腦會讓 TensorFlow.js
長時間無回應，甚至造成瀏覽器分頁失去反應。

v19 的「快速拍照」不再重新跑模型：

1. 複製目前已完成的透明 RVM LIVE Canvas
2. 與 background.jpg 合成
3. 直接輸出 PNG

照片品質接近螢幕當下畫面，但可靠性遠高於舊版精修。

### 鏡頭框放大不再硬放大 RVM 結果

v18：

```text
手機 1280 → RVM 640 → CSS 放大 2×
```

等效可用細節只剩約 320，必然模糊。

v19：

```text
手機 1280 → 先裁切需要的 640 區域 → RVM 640
```

因此在手機原始串流解析度允許的範圍內，
放大會比舊版清楚很多。

仍有物理限制：

- 手機只傳 640 時，無法創造 1280 細節
- 放大超過原始影像可用像素仍會模糊
- WebRTC 壓縮與失焦無法由程式完全恢復

鏡頭框縮放下限改為 1×，避免縮小後顯示手機畫面以外的空白。


## v20：鏡頭框重新設計

v19 的編輯方式是移動完整影像，綠框固定不動。
而且 1.00× 時沒有任何可移動空間，所以拖曳看起來像失效。

v20 改為真正的裁切框：

- 編輯時顯示完整手機 LIVE
- 綠框直接表示最後保留範圍
- 拖曳綠框：改變裁切位置
- 滑桿：1.00×～3.00×
- 滾輪與按鈕也可調整倍率
- 按「顯示完整畫面」恢復 1.00× 置中

1.00× 代表整張手機畫面，因此數學上無法左右移動。
若在 1.00× 直接拖曳，v20 會自動切成 1.15×，
讓使用者立即看到裁切框移動。

裁切會先作用在手機原始影像，再送進 RVM；
完成鏡頭框後，LIVE 與快速拍照都會使用同一裁切設定。


## v21：修正下載照片上下不對齊

使用者提供的結果中，人物圖層底部出現水平切線。
原因不是鏡頭框失效，而是兩個畫面比例不同：

```text
手機／RVM 人物 Canvas：約 16:9
background.jpg：1536×1049，約 1.464:1
```

v20 拍照時使用 `contain` 把 16:9 人物放進 1.464:1 背景，
因此人物 Canvas 上下會留下透明區域，形成明顯的水平邊界。

v21 改為單一合成座標：

1. 讀取 background.jpg 的實際比例
2. 鏡頭框固定使用同一比例
3. 從手機原始 LIVE 先裁切成背景比例
4. 再送入 RVM
5. RVM 透明人物 Canvas 維持背景比例
6. LIVE 與下載照片直接 1:1 疊合

因此：

- 手機是 16:9 時，1.00× 會先裁掉部分左右畫面
- 這是為了讓人物與老照片上下完全對齊
- 不再使用照片階段的 `contain`
- 不再出現上下透明帶或水平切線


## v22：WebRTC / ICE 連線檢測

這版針對「模型與 GPU 已預熱，但一直停在正在接收手機 LIVE」加入檢測。

### 大螢幕顯示

- PeerJS media call 是否存在
- MediaStream event 是否觸發
- connectionState
- iceConnectionState
- iceGatheringState
- signalingState
- selected candidate pair
- local / remote candidate 類型
- inbound bytes、frames、解析度與 FPS
- 手機傳送端回報
- 資料通道是否正常

### 手機顯示

- 相機 track readyState / enabled / muted
- 相機實際解析度與 FPS
- WebRTC connection / ICE 狀態
- outbound bytes、encoded frames
- selected candidate 類型
- 傳送嘗試次數

### 快速判讀

```text
DataConnection 已連線 + media ICE failed
→ 網路阻擋媒體，正式環境需要 TURN

ICE checking 超過 12 秒
→ NAT / 防火牆路徑卡住，不是 GPU

connection connected + outbound frames 0
→ 手機相機或編碼未送出

MediaStream 已到達 + RVM 第一張很慢
→ 才是固定電腦 GPU / RVM 效能問題
```

大螢幕可按「要求手機重傳 LIVE」，手機不會重開相機，
只會關閉並重建 PeerJS 媒體通話。


## v23：房間握手與媒體通話到達確認

v22 截圖顯示「尚未收到手機通話」，代表問題發生在 ICE 之前：
大螢幕連 `peer.on("call")` 都沒有收到。

v23 新增三段式確認：

```text
手機資料通道 mobileHello
→ 大螢幕 helloAck
→ 手機媒體通話
→ 大螢幕 mediaCallReceived
→ WebRTC ICE / MediaStream
```

### 可判斷的情況

- 連 mobileHello 都沒有：
  手機可能掃到舊 QR、舊房間、舊快取，或 PeerJS signaling 被阻擋。
- mobileHello 成功，但 mediaCallReceived 沒有：
  手機相機已開，但 PeerJS 媒體通話沒有送到大螢幕。
- mediaCallReceived 成功，但 MediaStream 沒有：
  才進入 ICE / NAT / TURN 問題。
- MediaStream 已到達，但人物慢：
  才是 RVM / GPU 效能。

### 其他改動

- QR Code 加入一次性 session 參數，降低手機重用舊頁面的機會。
- 手機會檢查 Room ID 與 Build 是否和大螢幕一致。
- 大螢幕 12 秒沒收到手機資料連線會直接顯示「舊 QR／舊房間」提示。
- 手機媒體通話 7 秒沒被大螢幕確認，會自動重試一次。
- 重試只重建 PeerJS 媒體通話，不重開手機相機。


## v24：大螢幕本機 PeerJS 自我檢測

大螢幕新增「測試這台電腦」。

測試會在同一個瀏覽器內建立第二個臨時 Peer，然後：

1. 連上 PeerJS Cloud
2. 呼叫目前大螢幕 Room ID
3. 建立 WebRTC DataChannel
4. 送出 ping
5. 由大螢幕 Peer 回傳 pong

### 成功代表

- PeerJS JavaScript 已正常下載
- 此電腦可以連 PeerJS Cloud
- Room ID 有效
- 大螢幕可以收到 PeerJS connection
- WebRTC DataChannel 可建立

這時手機仍完全未連入，應檢查手機頁面、舊 QR、快取或手機網路。

### 失敗代表

此電腦或目前網路連 PeerJS Cloud / WebRTC 有問題。
可先切換手機熱點測試，再考慮自架 PeerServer。

另外新增「複製手機網址」，可直接把目前一次性手機 URL 傳到手機，
避免掃到舊 QR Code。

v23 部分提示顯示出字面上的 `\n`，v24 已修正為正常換行。


## v25：手機卡在「正在取得相機」的檢測

手機截圖顯示：

```text
build: v24.0.0
secureContext: true
getUserMedia: true
正在取得相機…
```

這代表程式尚未進到 PeerJS / WebRTC。
`getUserMedia: true` 只表示瀏覽器有這個 API，不表示相機權限已授予。

v25 新增：

- camera Permissions API 狀態
- videoinput 裝置數
- enumerateDevices 錯誤
- document visibility
- supported constraints
- 12 秒 getUserMedia timeout
- 8 秒 video.play timeout
- 「最簡單模式重試」
- 相機取得後才用 applyConstraints 提高至理想 1280×720
- 相機預覽成功後立即顯示，不必等 PeerJS
- 手機頁面載入後先做 Room handshake，不必等相機

### 判讀

```text
permission: denied
→ 到網址列鎖頭／網站設定，把相機改為允許

permission: prompt + 12 秒逾時
→ 權限提示未處理，或瀏覽器權限 UI 卡住

permission: granted + 12 秒逾時
→ 相機可能被其他 App 使用，或手機瀏覽器相機模組卡住

相機已取得，但 video.play timeout
→ 相機權限正常，問題在影片預覽／瀏覽器播放
```

「最簡單模式重試」只使用：

```js
{ audio: false, video: true }
```

取得相機後才嘗試套用畫質，不會因手機不支援 1280×720 而卡在啟動階段。


## v26：修正相機成功卻顯示 Error

手機畫面已證明相機預覽成功，但 WebRTC 尚未建立。
v25 同時從「頁面預連線」與「相機啟動」呼叫
`ensureDataConnection()`，第二次呼叫可能關掉第一次仍在握手的
DataConnection，形成競態。

v26：

- DataConnection 握手改成 singleton Promise
- 多個呼叫等待同一次握手
- hello / ack 綁定當次 local connection
- 相機成功後，PeerJS 失敗不會停止相機預覽
- 「相機失敗」與「LIVE 連線失敗」分開顯示
- 錯誤狀態顯示實際 message
- 重新傳送 LIVE 可在握手失效時強制建立新資料連線


## v27：後鏡頭畫質修正

網路測試已確認網域 B 會阻擋目前的 PeerJS / WebRTC 路徑；
Taipei Free 可用，表示程式與電腦 A 本身正常。
正式跨網域使用仍需要 TURN，或使用允許 WebRTC 的網路。

後鏡頭模糊的主要程式原因是：

- 舊版只使用 `facingMode: ideal environment`
- 多鏡頭手機可能選到超廣角、微距、景深或低解析副鏡
- 舊版 `applyConstraints()` 失敗時會靜默保留低解析度
- WebRTC 可能為維持流暢度自動降低解析度

v27 新增：

- 自動後鏡頭主鏡選擇
- 相機來源下拉選單，可手動選擇所有瀏覽器暴露的鏡頭
- 優先排除 ultra / macro / tele / depth 類副鏡
- Samsung 常見 `camera2 0` 主鏡加權
- 後鏡頭理想 1920×1080
- 前鏡頭理想 1280×720
- `resizeMode: none` 偏好
- `contentHint: detail`
- 顯示實際 width / height / FPS / facingMode / resizeMode
- 顯示該鏡頭能力上限
- 後鏡頭實際寬度低於 1000px 時顯示警告
- WebRTC sender 後鏡頭最高 4.5 Mbps
- `degradationPreference: maintain-resolution`

若「自動後鏡頭主鏡」仍選錯，請從相機來源逐一選擇，
以實際解析度最高且視角正常的那一項為主鏡。


## v28：不同電腦解析度自動顯示完整背景

舊版的背景、RVM Canvas 與鏡頭框各自填滿整個瀏覽器，
再分別依靠 CSS `contain` 對齊。不同螢幕比例、瀏覽器縮放、
Windows 顯示比例與工具列高度可能造成裁切或細小錯位。

v28 將下列所有圖層放入同一個 `composition-viewport`：

- background.jpg
- 手機原始預覽
- RVM 透明人物
- 鏡頭框預覽
- 裁切框與拖曳區域

`composition-viewport` 永遠維持 background.jpg 的原始比例，
並以 contain 方式放入目前瀏覽器可見區。因此不同電腦只會
出現必要的上下或左右黑邊，不會裁掉背景圖。

### 即時偵測來源

- window resize
- Visual Viewport resize / scroll
- 螢幕方向改變
- 全螢幕進入／離開
- background.jpg 載入
- ResizeObserver

畫面會顯示：

- 瀏覽器實際可見尺寸
- 背景圖原始尺寸
- 實際 composition 顯示尺寸
- 上下／左右黑邊
- devicePixelRatio
- Visual Viewport scale

### 展示控制

- 重新偵測全圖
- 進入／離開全螢幕
- 隱藏控制面板
- 顯示控制面板
- 瀏覽器 100% 縮放提示

下載照片仍使用 background.jpg 原始解析度，不受電腦螢幕尺寸影響。


## v29.0.0 新增

- 可切換背景來源：`background.jpg` 或 `background.mp4`。
- 若專案目錄放入 `background.mp4`，大螢幕可在控制面板直接切成 MP4 背景。
- 可按「載入本機 MP4 測試」先看動態背景效果。
- 新增「人物下方陰影」滑桿，會在 LIVE 與拍照結果都加上接地陰影，提升人物站在場景裡的感覺。

### MP4 使用方式
1. 把你的影片命名成 `background.mp4`。
2. 與 `index.html / script.js / style.css` 放在同一層。
3. 開啟 `?mode=screen` 後，在右側把背景來源切成 `background.mp4（動態）`。
4. 若沒有放 `background.mp4`，系統會自動退回 `background.jpg`。

### 陰影說明
- 這版加的是「接地陰影」，不是精準光線追蹤。
- 目的不是做戲劇化投影，而是讓人物下半部不要像浮在照片上。
- 若覺得太重，可把「人物下方陰影」往下拉。

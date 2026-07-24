(() => {
  "use strict";

  const BUILD_ID = "v29.0.0";
  const app = document.getElementById("app");
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") || "home";
  const room = params.get("room") || "";

  /*
    官方 RVM TensorFlow.js branch 的模型位置。
    第一個使用 jsDelivr CDN；第二個作為備援。
    正式展覽若要完全自主管理，可把官方 model 資料夾放到
    ./model/，再把 "./model/model.json" 放到陣列第一個。
  */
  const RVM_MODEL_URLS = [
    "https://cdn.jsdelivr.net/gh/PeterL1n/RobustVideoMatting@tfjs/model/model.json",
    "https://raw.githubusercontent.com/PeterL1n/RobustVideoMatting/tfjs/model/model.json",
  ];

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  function go(nextMode, extra = {}) {
    const query = new URLSearchParams({
      mode: nextMode,
      ...extra,
    });

    location.href = `${location.pathname}?${query.toString()}`;
  }

  function browserInfo() {
    const ua = navigator.userAgent || "";

    return {
      ua,
      isLine: /Line\/|LIFF/i.test(ua),
      secure: window.isSecureContext,
      mediaDevices: Boolean(navigator.mediaDevices),
      getUserMedia: Boolean(
        navigator.mediaDevices?.getUserMedia
      ),
      webgl2: Boolean(
        document
          .createElement("canvas")
          .getContext("webgl2")
      ),
    };
  }

  function formatError(error, title = "發生錯誤") {
    const info = browserInfo();

    return [
      title,
      `error.name: ${error?.name || "UnknownError"}`,
      `error.message: ${
        error?.message || String(error || "未知錯誤")
      }`,
      `secureContext: ${info.secure}`,
      `getUserMedia: ${info.getUserMedia}`,
      `WebGL2: ${info.webgl2}`,
      `URL: ${location.href}`,
      `userAgent: ${info.ua}`,
    ].join("\n");
  }

  function showError(
    error,
    target = "#errorBox",
    title = "發生錯誤"
  ) {
    console.error(title, error);

    const box = $(target);
    if (!box) return;

    box.textContent = formatError(error, title);
    box.classList.remove("hidden");
  }

  async function createPeer(options = undefined) {
    if (!window.Peer) {
      throw new Error(
        "PeerJS 尚未載入，請檢查網路或 CDN。"
      );
    }

    return new Promise((resolve, reject) => {
      const peer = new Peer(options);
      const timer = setTimeout(() => {
        peer.destroy();
        reject(new Error("PeerJS 連線逾時。"));
      }, 15000);

      peer.once("open", () => {
        clearTimeout(timer);
        resolve(peer);
      });

      peer.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }


  function resolvePeerConnection(mediaConnection) {
    return (
      mediaConnection?.peerConnection ||
      mediaConnection?._negotiator?._pc ||
      mediaConnection?._pc ||
      null
    );
  }

  async function waitForPeerConnection(
    mediaConnection,
    timeoutMs = 6000
  ) {
    const startedAt = performance.now();

    while (
      performance.now() - startedAt <
      timeoutMs
    ) {
      const pc =
        resolvePeerConnection(mediaConnection);

      if (pc) return pc;

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }

    return null;
  }

  function bytesLabel(value) {
    const bytes = Number(value || 0);

    if (bytes >= 1024 * 1024) {
      return `${(
        bytes /
        1024 /
        1024
      ).toFixed(2)} MB`;
    }

    if (bytes >= 1024) {
      return `${(
        bytes /
        1024
      ).toFixed(1)} KB`;
    }

    return `${bytes} B`;
  }

  function candidateLabel(candidate) {
    if (!candidate) return "尚未選定";

    return [
      candidate.candidateType || "?",
      candidate.protocol || "?",
      candidate.networkType || "",
      candidate.address
        ? `${candidate.address}:${
            candidate.port || "?"
          }`
        : "",
    ].filter(Boolean).join(" / ");
  }

  async function collectRtcDiagnostics(
    pc,
    direction
  ) {
    const result = {
      signalingState:
        pc?.signalingState || "unknown",
      iceGatheringState:
        pc?.iceGatheringState || "unknown",
      iceConnectionState:
        pc?.iceConnectionState || "unknown",
      connectionState:
        pc?.connectionState || "unknown",
      localCandidate: null,
      remoteCandidate: null,
      candidatePairState: "尚未選定",
      media: null,
    };

    if (!pc?.getStats) return result;

    const reports = await pc.getStats();
    const byId = new Map();

    reports.forEach((report) => {
      byId.set(report.id, report);
    });

    let pair = null;

    reports.forEach((report) => {
      if (
        report.type === "transport" &&
        report.selectedCandidatePairId
      ) {
        pair =
          byId.get(
            report.selectedCandidatePairId
          ) || pair;
      }
    });

    if (!pair) {
      reports.forEach((report) => {
        if (
          report.type === "candidate-pair" &&
          report.state === "succeeded" &&
          (report.nominated ||
            report.selected)
        ) {
          pair = report;
        }
      });
    }

    if (pair) {
      result.candidatePairState =
        pair.state || "succeeded";
      result.localCandidate =
        byId.get(pair.localCandidateId) ||
        null;
      result.remoteCandidate =
        byId.get(pair.remoteCandidateId) ||
        null;
    }

    reports.forEach((report) => {
      const isVideo =
        report.kind === "video" ||
        report.mediaType === "video";

      if (!isVideo) return;

      if (
        direction === "inbound" &&
        report.type === "inbound-rtp" &&
        !report.isRemote
      ) {
        result.media = {
          direction: "inbound",
          bytes:
            report.bytesReceived || 0,
          packets:
            report.packetsReceived || 0,
          packetsLost:
            report.packetsLost || 0,
          frames:
            report.framesDecoded ??
            report.framesReceived ??
            0,
          framesPerSecond:
            report.framesPerSecond || 0,
          width:
            report.frameWidth || 0,
          height:
            report.frameHeight || 0,
          jitter:
            report.jitter || 0,
        };
      }

      if (
        direction === "outbound" &&
        report.type === "outbound-rtp" &&
        !report.isRemote
      ) {
        result.media = {
          direction: "outbound",
          bytes:
            report.bytesSent || 0,
          packets:
            report.packetsSent || 0,
          frames:
            report.framesEncoded ??
            report.framesSent ??
            0,
          framesPerSecond:
            report.framesPerSecond || 0,
          width:
            report.frameWidth || 0,
          height:
            report.frameHeight || 0,
          qualityLimitationReason:
            report.qualityLimitationReason ||
            "none",
        };
      }
    });

    return result;
  }

  function delay(milliseconds) {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  function waitForEvent(
    target,
    eventName,
    timeoutMs,
    test = null
  ) {
    return new Promise((resolve, reject) => {
      let timer = null;

      const cleanup = () => {
        clearTimeout(timer);
        target?.removeEventListener?.(
          eventName,
          handler
        );
        target?.off?.(eventName, handler);
      };

      const handler = (value) => {
        if (test && !test(value)) {
          return;
        }

        cleanup();
        resolve(value);
      };

      target?.addEventListener?.(
        eventName,
        handler,
        { once: !test }
      );

      target?.on?.(eventName, handler);

      timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `等待 ${eventName} 超過 ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
    });
  }

  function diagnoseRtc(
    diagnostic,
    {
      elapsedSeconds = 0,
      streamReceived = false,
      role = "screen",
    } = {}
  ) {
    if (streamReceived) {
      return {
        level: "ok",
        message:
          role === "screen"
            ? "WebRTC 媒體已到達。若人物仍慢，才是 RVM／GPU 效能問題。"
            : "手機正在傳送 WebRTC 影像。",
      };
    }

    if (
      diagnostic.connectionState === "failed" ||
      diagnostic.iceConnectionState === "failed"
    ) {
      return {
        level: "failed",
        message:
          "ICE 媒體路徑失敗。通常是 NAT／防火牆阻擋；正式展場需要 TURN 中繼伺服器。",
      };
    }

    if (
      diagnostic.connectionState === "connected" &&
      (
        !diagnostic.media ||
        diagnostic.media.frames === 0
      )
    ) {
      return {
        level: "warning",
        message:
          role === "screen"
            ? "WebRTC 已連上，但尚未收到影片影格。請檢查手機相機 track 是否正常送出。"
            : "WebRTC 已連上，但瀏覽器尚未編碼送出影格。",
      };
    }

    if (
      elapsedSeconds >= 12 &&
      [
        "new",
        "checking",
        "disconnected",
      ].includes(
        diagnostic.iceConnectionState
      )
    ) {
      return {
        level: "warning",
        message:
          "已等待超過 12 秒，ICE 仍未完成。這通常不是 GPU，而是網路路徑卡住；可先按「重新傳送 LIVE」，若不同網路仍失敗則需要 TURN。",
      };
    }

    return {
      level: "normal",
      message: "WebRTC 正在協商媒體路徑。",
    };
  }

  function formatRtcDiagnostics({
    title,
    diagnostic,
    diagnosis,
    elapsedSeconds,
    extraLines = [],
  }) {
    const media = diagnostic.media;

    return [
      title,
      `等待：${elapsedSeconds.toFixed(1)} 秒`,
      `診斷：${diagnosis.message}`,
      "",
      `connectionState: ${diagnostic.connectionState}`,
      `iceConnectionState: ${diagnostic.iceConnectionState}`,
      `iceGatheringState: ${diagnostic.iceGatheringState}`,
      `signalingState: ${diagnostic.signalingState}`,
      `candidatePair: ${diagnostic.candidatePairState}`,
      `local candidate: ${candidateLabel(
        diagnostic.localCandidate
      )}`,
      `remote candidate: ${candidateLabel(
        diagnostic.remoteCandidate
      )}`,
      media
        ? `${
            media.direction === "inbound"
              ? "收到"
              : "送出"
          }：${bytesLabel(media.bytes)}｜frames ${
            media.frames
          }｜${media.width || "?"}×${
            media.height || "?"
          }｜${Number(
            media.framesPerSecond || 0
          ).toFixed(1)} fps`
        : "RTP video stats: 尚未出現",
      media?.packetsLost !== undefined
        ? `封包：${media.packets}｜遺失 ${
            media.packetsLost
          }｜jitter ${Number(
            media.jitter || 0
          ).toFixed(4)}`
        : "",
      media?.qualityLimitationReason
        ? `傳送限制：${
            media.qualityLimitationReason
          }`
        : "",
      ...extraLines,
    ].filter(Boolean).join("\n");
  }

  function renderHome() {
    app.innerHTML = `
      <section class="page">
        <div class="panel">
          <h1>TimePortal</h1>
          <p>RVM 時間一致性人物去背</p>

          <div class="actions">
            <button class="primary" id="screenBtn">
              我是工作人員
            </button>
            <button id="mobileBtn">
              我是觀眾
            </button>
          </div>

          <p class="note">
            工作人員在大螢幕開啟。觀眾掃描 QR Code，
            手機只傳送正常相機影片；人物去背由大螢幕端的
            Robust Video Matting 執行。
          </p>

          <div class="debug-box">
build: ${BUILD_ID}
mobile: raw WebRTC camera
screen: RVM TensorFlow.js recurrent states
          </div>
        </div>
      </section>`;

    $("#screenBtn").onclick = () => go("screen");
    $("#mobileBtn").onclick = () => go("mobile");
  }

  async function renderScreen() {
    app.innerHTML = `
      <section class="screen-stage">
        <div
          class="composition-viewport"
          id="compositionViewport"
        >
          <img
            id="backgroundLayerImage"
            class="background-layer"
            alt="背景圖"
          />
          <video
            id="backgroundLayerVideo"
            class="background-layer hidden"
            autoplay
            muted
            loop
            playsinline
          ></video>

          <video
            id="remoteVideo"
            autoplay
            playsinline
            muted
          ></video>

          <canvas id="rvmCanvas"></canvas>
          <canvas id="framePreviewCanvas"></canvas>
          <div class="frame-outline" id="frameOutline"></div>
          <div class="frame-editor-hit" id="frameEditorHit"></div>
        </div>

        <button
          class="show-controls-btn"
          id="showControlsBtn"
          type="button"
        >
          顯示控制面板
        </button>

        <aside class="screen-overlay">
          <h2>掃描 QR Code</h2>
          <div id="qrCode"></div>

          <p class="room" id="roomText">
            正在建立房間…
          </p>

          <div class="status-pill" id="screenStatus">
            初始化…
          </div>

          <div class="rvm-progress" id="rvmProgress">
            RVM：尚未開始
          </div>

          <div class="quality-row">
            <label for="bgModeSelect">背景來源</label>
            <select id="bgModeSelect">
              <option value="image" selected>background.jpg（靜態）</option>
              <option value="video">background.mp4（動態）</option>
            </select>
            <button id="bgVideoUploadBtn" type="button">
              載入本機 MP4 測試
            </button>
            <input
              id="bgVideoFileInput"
              class="hidden"
              type="file"
              accept="video/mp4,video/webm,video/ogg"
            />
            <div class="palette-note" id="bgStatus">
              背景模式：background.jpg
            </div>
          </div>

          <div class="quality-row">
            <label for="qualitySelect">
              RVM 處理解析度
            </label>
            <select id="qualitySelect">
              <option value="640" selected>
                官方起始：最長邊 640
              </option>
              <option value="960">
                標準：最長邊 960
              </option>
              <option value="1280">
                高清：最長邊 1280（較重）
              </option>
            </select>
          </div>

          <div class="tone-control">
            <label for="brightnessRange">人物亮度</label>
            <output id="brightnessValue">82%</output>
            <input
              id="brightnessRange"
              type="range"
              min="60"
              max="110"
              step="1"
              value="82"
            />
          </div>

          <div class="tone-control">
            <label for="saturationRange">人物飽和度</label>
            <output id="saturationValue">60%</output>
            <input
              id="saturationRange"
              type="range"
              min="0"
              max="120"
              step="1"
              value="60"
            />
          </div>

          <div class="tone-control">
            <label for="colorMatchRange">背景色調融合</label>
            <output id="colorMatchValue">52%</output>
            <input
              id="colorMatchRange"
              type="range"
              min="0"
              max="85"
              step="1"
              value="52"
            />
          </div>

          <div class="tone-control">
            <label for="shadowStrengthRange">人物下方陰影</label>
            <output id="shadowStrengthValue">28%</output>
            <input
              id="shadowStrengthRange"
              type="range"
              min="0"
              max="60"
              step="1"
              value="28"
            />
          </div>

          <div class="palette-note" id="paletteNote">
            正在分析 background.jpg 的老照片色調…
          </div>

          <div class="capture-actions">
            <button id="captureBtn" disabled>
              快速拍照
            </button>
            <button id="rotateBtn">
              旋轉影像 90°
            </button>
            <button id="landscapeBtn">
              重設為橫向
            </button>
            <button id="frameBtn" disabled>
              調鏡頭框
            </button>
          </div>

          <div class="frame-controls">
            <button id="zoomOutBtn" disabled>
              顯示更多
            </button>
            <button id="zoomInBtn" disabled>
              放大人物
            </button>
            <button id="resetFrameBtn" disabled>
              顯示完整畫面
            </button>
          </div>

          <div class="frame-zoom-row">
            <label for="frameZoomRange">裁切倍率</label>
            <input
              id="frameZoomRange"
              type="range"
              min="100"
              max="300"
              step="1"
              value="100"
              disabled
            />
            <output id="frameZoomValue">1.00×</output>
          </div>

          <div class="frame-help">
            綠框就是最後會保留的手機範圍。
            拖曳綠框改位置；滑桿、滾輪或按鈕改大小。
            1.00× 是完整畫面，完整畫面沒有空間可以左右移動。
          </div>

          <div class="frame-status" id="frameStatus">
            鏡頭框：尚未連線
          </div>

          <div class="alignment-note">
            綠框比例固定跟目前背景相同。
            LIVE、鏡頭框與下載照片會使用同一組座標。
          </div>

          <div class="rotation-note">
            預設以橫向顯示。旋轉只會在下一張 RVM 畫面完成時切換，
            不會重建手機 LIVE，也不會清空目前畫面。
          </div>

          <p class="build-label">
            程式版本：${BUILD_ID}
          </p>

          <div class="display-fit-status" id="displayFitStatus">
            正在偵測螢幕尺寸與背景比例…
          </div>

          <div class="display-actions">
            <button id="refitDisplayBtn">
              重新偵測全圖
            </button>
            <button id="fullscreenBtn">
              進入全螢幕
            </button>
            <button id="hideControlsBtn">
              隱藏控制面板
            </button>
            <button id="resetBrowserZoomHintBtn">
              顯示縮放提示
            </button>
          </div>

          <div class="handshake-badge" id="screenHandshake">
            房間已建立，尚未收到手機資料連線。
          </div>

          <div class="connection-diagnostics" id="screenDiagnosticPanel">
            <h3>LIVE 連線檢測</h3>
            <pre id="screenDiagnostics">尚未收到手機通話。</pre>
            <div class="diagnostic-actions">
              <button id="localPeerTestBtn">
                測試這台電腦
              </button>
              <button id="copyMobileUrlBtn">
                複製手機網址
              </button>
              <button id="requestRetryBtn" disabled>
                要求手機重傳 LIVE
              </button>
              <button id="copyDiagnosticsBtn">
                複製檢測內容
              </button>
              <button id="reloadRoomBtn">
                重新建立房間
              </button>
            </div>

            <div class="self-test-result" id="selfTestResult">
              尚未執行大螢幕本機 PeerJS 自我檢測。
            </div>
          </div>

          <div class="error-box hidden" id="errorBox"></div>
        </aside>

        <section class="photo-layer hidden" id="photoLayer">
          <div class="photo-card">
            <h2>TimePortal 留影照片</h2>

            <div class="photo-loading hidden" id="photoLoading">
              正在重新運算照片…
            </div>

            <canvas id="photoCanvas" class="hidden"></canvas>

            <p class="photo-note" id="photoNote">
              這版直接保存目前已穩定顯示的 LIVE 去背畫面。
              若背景為 MP4，下載照片會保存當下那一幀。
            </p>

            <div class="safe-photo-note">
              優先避免當機；照片品質會接近螢幕當下看到的效果。
            </div>

            <div class="photo-score" id="photoScore"></div>

            <div class="capture-actions">
              <button class="primary" id="downloadPhotoBtn" disabled>
                下載照片
              </button>
              <button id="closePhotoBtn">
                關閉
              </button>
            </div>
          </div>
        </section>
      </section>`;

    const stage = $(".screen-stage");
    const compositionViewport = $("#compositionViewport");
    const backgroundLayerImage = $("#backgroundLayerImage");
    const backgroundLayerVideo = $("#backgroundLayerVideo");
    const displayFitStatus = $("#displayFitStatus");
    const refitDisplayBtn = $("#refitDisplayBtn");
    const fullscreenBtn = $("#fullscreenBtn");
    const hideControlsBtn = $("#hideControlsBtn");
    const showControlsBtn = $("#showControlsBtn");
    const resetBrowserZoomHintBtn = $("#resetBrowserZoomHintBtn");
    const status = $("#screenStatus");
    const progress = $("#rvmProgress");
    const roomText = $("#roomText");
    const bgModeSelect = $("#bgModeSelect");
    const bgVideoUploadBtn = $("#bgVideoUploadBtn");
    const bgVideoFileInput = $("#bgVideoFileInput");
    const bgStatus = $("#bgStatus");
    const qualitySelect = $("#qualitySelect");
    const brightnessRange = $("#brightnessRange");
    const brightnessValue = $("#brightnessValue");
    const saturationRange = $("#saturationRange");
    const saturationValue = $("#saturationValue");
    const colorMatchRange = $("#colorMatchRange");
    const colorMatchValue = $("#colorMatchValue");
    const shadowStrengthRange = $("#shadowStrengthRange");
    const shadowStrengthValue = $("#shadowStrengthValue");
    const paletteNote = $("#paletteNote");
    const captureBtn = $("#captureBtn");
    const rotateBtn = $("#rotateBtn");
    const landscapeBtn = $("#landscapeBtn");
    const frameBtn = $("#frameBtn");
    const zoomOutBtn = $("#zoomOutBtn");
    const zoomInBtn = $("#zoomInBtn");
    const resetFrameBtn = $("#resetFrameBtn");
    const frameZoomRange = $("#frameZoomRange");
    const frameZoomValue = $("#frameZoomValue");
    const frameStatus = $("#frameStatus");
    const framePreviewCanvas = $("#framePreviewCanvas");
    const frameOutline = $("#frameOutline");
    const frameEditorHit = $("#frameEditorHit");
    const photoLayer = $("#photoLayer");
    const photoLoading = $("#photoLoading");
    const photoCanvas = $("#photoCanvas");
    const photoNote = $("#photoNote");
    const photoScore = $("#photoScore");
    const screenHandshake = $("#screenHandshake");
    const screenDiagnosticPanel = $("#screenDiagnosticPanel");
    const screenDiagnostics = $("#screenDiagnostics");
    const localPeerTestBtn = $("#localPeerTestBtn");
    const copyMobileUrlBtn = $("#copyMobileUrlBtn");
    const selfTestResult = $("#selfTestResult");
    const requestRetryBtn = $("#requestRetryBtn");
    const copyDiagnosticsBtn = $("#copyDiagnosticsBtn");
    const reloadRoomBtn = $("#reloadRoomBtn");
    const downloadPhotoBtn = $("#downloadPhotoBtn");
    const closePhotoBtn = $("#closePhotoBtn");
    const remoteVideo = $("#remoteVideo");
    const outputCanvas = $("#rvmCanvas");
    const outputCtx = outputCanvas.getContext("2d");
    const renderCanvas = document.createElement("canvas");
    const renderCtx = renderCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const backgroundImage = new Image();
    backgroundImage.src = "./background.jpg";
    backgroundLayerImage.src = "./background.jpg";

    backgroundLayerVideo.muted = true;
    backgroundLayerVideo.loop = true;
    backgroundLayerVideo.playsInline = true;
    backgroundLayerVideo.src = "./background.mp4";

    const backgroundCanvas =
      document.createElement("canvas");
    const backgroundCtx =
      backgroundCanvas.getContext("2d");

    const shadowSampleCanvas =
      document.createElement("canvas");
    shadowSampleCanvas.width = 192;
    shadowSampleCanvas.height = 192;
    const shadowSampleCtx =
      shadowSampleCanvas.getContext("2d", {
        willReadFrequently: true,
      });

    let peer = null;
    let activeCall = null;
    let model = null;
    let modelPromise = null;
    let processing = false;
    let frameBusy = false;
    let lastVideoTime = -1;
    let mirrorInput = false;
    let recurrent = [];
    let downsampleTensor = null;
    let backgroundTensor = null;
    let cachedWidth = 0;
    let cachedHeight = 0;
    let frameCounter = 0;
    let lastFpsAt = performance.now();
    let displayedFps = 0;
    let inferenceMs = 0;
    let firstRvmFrameRendered = false;
    let streamReceivedAt = 0;
    let watchdogTimer = null;
    let mediaArrivalTimer = null;
    let rtcDiagnosticTimer = null;
    let mediaCallStartedAt = 0;
    let mediaStreamReceived = false;
    let latestScreenDiagnosticText = "";
    let lastSenderDiagnosticText = "";
    let screenRoomId = "";
    let currentMobileUrl = "";
    let mobileHelloReceived = false;
    let mediaCallAcknowledged = false;
    let qrWaitingTimer = null;
    let modelPhase = "尚未開始";
    let connectionPhase = "尚未連線";
    let modelWarm = false;
    let remoteRotationDegrees = 0;
    let manualRotationOverride = 0;
    let pendingRotation = null;
    let defaultLandscapeApplied = false;
    let frameEditing = false;
    let framePreviewRunning = false;
    let dragPointerId = null;
    let dragLastX = 0;
    let dragLastY = 0;
    let fitRaf = 0;
    let lastFitMetrics = null;
    let compositionResizeObserver = null;

    let frameTransform = {
      scale: 1,
      centerX: 0.5,
      centerY: 0.5,
    };

    try {
      const savedFrame = JSON.parse(
        localStorage.getItem(
          "timeportal-frame-v21"
        ) || "null"
      );

      if (
        savedFrame &&
        Number.isFinite(savedFrame.scale)
      ) {
        frameTransform = {
          scale: Math.min(
            3,
            Math.max(1, savedFrame.scale)
          ),
          centerX: Number.isFinite(
            savedFrame.centerX
          )
            ? savedFrame.centerX
            : 0.5,
          centerY: Number.isFinite(
            savedFrame.centerY
          )
            ? savedFrame.centerY
            : 0.5,
        };
      }
    } catch (error) {
      console.warn(
        "Cannot restore frame transform.",
        error
      );
    }

    let personBrightness = 0.82;
    let personSaturation = 0.60;
    let personColorMatch = 0.52;

    shadowStrengthValue.textContent =
      `${Math.round(shadowStrength * 100)}%`;

    /*
      這張背景圖中央偏下區域的實測 fallback：
      mean ≈ [0.480, 0.419, 0.401]
      std  ≈ [0.080, 0.178, 0.152]
      網頁仍會在載入 background.jpg 後重新取樣。
    */
    let backgroundPalette = {
      mean: [0.480, 0.419, 0.401],
      std: [0.080, 0.178, 0.152],
    };

    let paletteMeanTensor = null;
    let paletteStdTensor = null;
    let photoBusy = false;
    let latestPhotoUrl = "";
    let mobileDataConnection = null;
    let mobileOrientation = {
      portrait: true,
      angle: 0,
      viewportWidth: 0,
      viewportHeight: 0,
      sourceWidth: 0,
      sourceHeight: 0,
    };

    let backgroundMode = "image";
    let backgroundVideoAvailable = false;
    let backgroundVideoObjectUrl = "";
    let backgroundVideoPendingPlay = false;
    let shadowStrength = 0.28;
    let lastShadowGeometry = null;
    let shadowFrameCounter = 0;


    function getBackgroundSourceLabel() {
      return backgroundMode === "video"
        ? "background.mp4"
        : "background.jpg";
    }

    function currentBackgroundElement() {
      if (
        backgroundMode === "video" &&
        backgroundVideoAvailable &&
        backgroundLayerVideo.readyState >= 2 &&
        backgroundLayerVideo.videoWidth &&
        backgroundLayerVideo.videoHeight
      ) {
        return backgroundLayerVideo;
      }

      return backgroundImage;
    }

    function currentBackgroundDimensions() {
      const source = currentBackgroundElement();

      if (source === backgroundLayerVideo) {
        return {
          width: backgroundLayerVideo.videoWidth || 1536,
          height: backgroundLayerVideo.videoHeight || 1049,
        };
      }

      return {
        width: backgroundImage.naturalWidth || 1536,
        height: backgroundImage.naturalHeight || 1049,
      };
    }

    function updateBackgroundUi() {
      const usingVideo =
        backgroundMode === "video" &&
        backgroundVideoAvailable;

      backgroundLayerImage.classList.toggle(
        "hidden",
        usingVideo
      );

      backgroundLayerVideo.classList.toggle(
        "hidden",
        !usingVideo
      );

      bgModeSelect.value = backgroundMode;

      if (backgroundMode === "video") {
        bgStatus.textContent = backgroundVideoAvailable
          ? "背景模式：MP4 動態背景（已啟用）"
          : "背景模式：找不到可播放的 background.mp4，已暫時退回 JPG。";
      } else {
        bgStatus.textContent =
          "背景模式：background.jpg";
      }
    }

    async function ensureBackgroundVideoPlayback() {
      if (!backgroundVideoAvailable) return false;

      try {
        await backgroundLayerVideo.play();
        backgroundVideoPendingPlay = false;
        return true;
      } catch (error) {
        backgroundVideoPendingPlay = true;
        console.warn(
          "Background video autoplay blocked.",
          error
        );
        return false;
      }
    }

    function drawMediaCover(ctx, media, width, height) {
      const naturalWidth =
        media === backgroundLayerVideo
          ? media.videoWidth
          : media.naturalWidth;
      const naturalHeight =
        media === backgroundLayerVideo
          ? media.videoHeight
          : media.naturalHeight;

      if (!naturalWidth || !naturalHeight) {
        ctx.fillStyle = "#262626";
        ctx.fillRect(0, 0, width, height);
        return;
      }

      const scale = Math.max(
        width / naturalWidth,
        height / naturalHeight
      );

      const drawWidth = naturalWidth * scale;
      const drawHeight = naturalHeight * scale;

      ctx.drawImage(
        media,
        (width - drawWidth) / 2,
        (height - drawHeight) / 2,
        drawWidth,
        drawHeight
      );
    }

    async function switchBackgroundMode(nextMode) {
      backgroundMode = nextMode === "video" ? "video" : "image";

      if (backgroundMode === "video") {
        await ensureBackgroundVideoPlayback();
      }

      updateBackgroundUi();
      analyzeBackgroundPalette();
      disposeCachedTensors();
      resetRvmState();
      fitCompositionToViewport("背景切換");
    }

    function analyzeBackgroundPalette() {
      const source = currentBackgroundElement();
      const sourceWidth =
        source === backgroundLayerVideo
          ? source.videoWidth
          : source.naturalWidth;
      const sourceHeight =
        source === backgroundLayerVideo
          ? source.videoHeight
          : source.naturalHeight;

      if (!sourceWidth || !sourceHeight) {
        return;
      }

      const sampleCanvas =
        document.createElement("canvas");
      const sampleCtx =
        sampleCanvas.getContext("2d", {
          willReadFrequently: true,
        });

      sampleCanvas.width = 96;
      sampleCanvas.height = 96;

      sampleCtx.drawImage(
        source,
        0,
        0,
        sampleCanvas.width,
        sampleCanvas.height
      );

      const pixels = sampleCtx.getImageData(
        0,
        0,
        sampleCanvas.width,
        sampleCanvas.height
      ).data;

      const x0 = Math.floor(sampleCanvas.width * 0.15);
      const x1 = Math.ceil(sampleCanvas.width * 0.85);
      const y0 = Math.floor(sampleCanvas.height * 0.25);
      const y1 = Math.ceil(sampleCanvas.height * 0.95);

      const sum = [0, 0, 0];
      const squareSum = [0, 0, 0];
      let count = 0;

      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index =
            (y * sampleCanvas.width + x) * 4;

          for (let channel = 0; channel < 3; channel += 1) {
            const value =
              pixels[index + channel] / 255;

            sum[channel] += value;
            squareSum[channel] += value * value;
          }

          count += 1;
        }
      }

      const mean = sum.map(
        (value) => value / Math.max(1, count)
      );

      const std = squareSum.map(
        (value, channel) =>
          Math.sqrt(
            Math.max(
              0.0004,
              value / Math.max(1, count) -
                mean[channel] * mean[channel]
            )
          )
      );

      backgroundPalette = {
        mean,
        std,
      };

      paletteMeanTensor?.dispose();
      paletteStdTensor?.dispose();
      paletteMeanTensor = null;
      paletteStdTensor = null;

      if (window.tf) {
        ensurePaletteTensors();
      }

      const rgb = mean.map(
        (value) => Math.round(value * 255)
      );

      paletteNote.textContent = [
        `已分析 ${getBackgroundSourceLabel()} 的中央偏下區域`,
        `目標平均 RGB：${rgb.join(" / ")}`,
        `預設：亮度 ${Math.round(personBrightness*100)}%、飽和度 ${Math.round(personSaturation*100)}%、融合 ${Math.round(personColorMatch*100)}%`,
      ].join("\n");
    }

    function ensurePaletteTensors() {
      if (!window.tf) return;

      if (!paletteMeanTensor) {
        paletteMeanTensor = tf.tensor4d(
          backgroundPalette.mean,
          [1, 1, 1, 3]
        );
      }

      if (!paletteStdTensor) {
        paletteStdTensor = tf.tensor4d(
          backgroundPalette.std,
          [1, 1, 1, 3]
        );
      }
    }

    backgroundImage.addEventListener(
      "load",
      () => {
        analyzeBackgroundPalette();
        disposeCachedTensors();
        resetRvmState();
        fitCompositionToViewport(
          "背景圖片載入"
        );
        updateBackgroundUi();
      }
    );

    backgroundLayerVideo.addEventListener(
      "loadeddata",
      async () => {
        backgroundVideoAvailable = true;
        await ensureBackgroundVideoPlayback();
        updateBackgroundUi();

        if (backgroundMode === "video") {
          analyzeBackgroundPalette();
          disposeCachedTensors();
          resetRvmState();
          fitCompositionToViewport(
            "背景影片載入"
          );
        }
      }
    );

    backgroundLayerVideo.addEventListener(
      "error",
      () => {
        backgroundVideoAvailable = false;
        updateBackgroundUi();
      }
    );

    if (backgroundImage.complete) {
      analyzeBackgroundPalette();
    }

    updateBackgroundUi();

    bgModeSelect.addEventListener(
      "change",
      () => {
        switchBackgroundMode(
          bgModeSelect.value
        );
      }
    );

    bgVideoUploadBtn.addEventListener(
      "click",
      () => {
        bgVideoFileInput.click();
      }
    );

    bgVideoFileInput.addEventListener(
      "change",
      async (event) => {
        const file =
          event.target.files?.[0];
        if (!file) return;

        if (backgroundVideoObjectUrl) {
          URL.revokeObjectURL(
            backgroundVideoObjectUrl
          );
        }

        backgroundVideoObjectUrl =
          URL.createObjectURL(file);
        backgroundLayerVideo.src =
          backgroundVideoObjectUrl;
        backgroundVideoAvailable = false;
        backgroundMode = "video";
        bgModeSelect.value = "video";
        updateBackgroundUi();
      }
    );

    function setStatus(lines) {
      status.textContent = Array.isArray(lines)
        ? lines.join("\n")
        : lines;
    }

    function setProgress(message, state = "normal") {
      progress.textContent = message;
      progress.classList.toggle(
        "warning-state",
        state === "warning"
      );
      progress.classList.toggle(
        "error-state",
        state === "error"
      );
    }

    function refreshProgress(extra = "") {
      const elapsed = streamReceivedAt
        ? Math.round((performance.now() - streamReceivedAt) / 1000)
        : 0;

      setProgress([
        `連線：${connectionPhase}`,
        `模型：${modelPhase}`,
        streamReceivedAt && !firstRvmFrameRendered
          ? `等待第一張去背畫面：${elapsed} 秒`
          : "",
        extra,
      ].filter(Boolean).join("\n"));
    }


    function setHandshakeState(
      text,
      level = "normal"
    ) {
      screenHandshake.textContent = text;
      screenHandshake.classList.toggle(
        "ok",
        level === "ok"
      );
      screenHandshake.classList.toggle(
        "warning",
        level === "warning"
      );
      screenHandshake.classList.toggle(
        "failed",
        level === "failed"
      );
    }

    function startQrWaitingTimer() {
      clearTimeout(qrWaitingTimer);

      qrWaitingTimer = setTimeout(() => {
        if (
          mobileHelloReceived ||
          activeCall
        ) {
          return;
        }

        setHandshakeState([
          "尚未收到任何手機連線。",
          "請確認手機掃描的是目前畫面上的 QR Code，",
          "且手機頁面已顯示目前版本。",
          "若手機仍停在舊頁面，請關閉分頁後重新掃碼。",
        ].join("\n"), "warning");

        setScreenDiagnostic([
          "目前連 PeerJS 資料通道都尚未到達。",
          "這還不是 GPU、RVM 或 ICE 問題。",
          "",
          `screen room: ${screenRoomId || "?"}`,
          "可能原因：",
          "1. 手機掃到舊房間 QR Code",
          "2. 手機沒有開啟相機頁面",
          "3. 手機仍載入舊版快取",
          "4. PeerJS signaling 被網路阻擋",
        ].join("\n"), "warning");
      }, 12000);
    }

    function setScreenDiagnostic(
      text,
      level = "normal"
    ) {
      latestScreenDiagnosticText = text;
      screenDiagnostics.textContent = text;

      screenDiagnosticPanel.classList.toggle(
        "ok",
        level === "ok"
      );
      screenDiagnosticPanel.classList.toggle(
        "warning",
        level === "warning"
      );
      screenDiagnosticPanel.classList.toggle(
        "failed",
        level === "failed"
      );
    }

    function stopRtcDiagnostics() {
      clearInterval(rtcDiagnosticTimer);
      rtcDiagnosticTimer = null;
      clearTimeout(mediaArrivalTimer);
      mediaArrivalTimer = null;
    }

    async function startScreenRtcDiagnostics(
      mediaConnection
    ) {
      stopRtcDiagnostics();
      mediaCallStartedAt = performance.now();
      mediaStreamReceived = false;

      setScreenDiagnostic(
        "已收到 PeerJS 通話要求，正在取得底層 RTCPeerConnection…",
        "normal"
      );

      const pc = await waitForPeerConnection(
        mediaConnection
      );

      if (!pc) {
        setScreenDiagnostic([
          "無法讀取底層 RTCPeerConnection。",
          "PeerJS 通話存在，但瀏覽器連線細節不可用。",
          "仍可按「要求手機重傳 LIVE」測試。",
        ].join("\n"), "warning");
        return;
      }

      const refresh = async () => {
        try {
          const elapsedSeconds =
            (
              performance.now() -
              mediaCallStartedAt
            ) / 1000;

          const diagnostic =
            await collectRtcDiagnostics(
              pc,
              "inbound"
            );

          const diagnosis = diagnoseRtc(
            diagnostic,
            {
              elapsedSeconds,
              streamReceived:
                mediaStreamReceived,
              role: "screen",
            }
          );

          setScreenDiagnostic(
            formatRtcDiagnostics({
              title:
                "大螢幕 WebRTC 接收端",
              diagnostic,
              diagnosis,
              elapsedSeconds,
              extraLines: [
                `PeerJS media call: ${
                  activeCall ? "存在" : "無"
                }`,
                `MediaStream event: ${
                  mediaStreamReceived
                    ? "已觸發"
                    : "尚未觸發"
                }`,
                `資料通道: ${
                  mobileDataConnection?.open
                    ? "已連線"
                    : "未連線"
                }`,
                lastSenderDiagnosticText
                  ? `\\n手機端回報：\\n${lastSenderDiagnosticText}`
                  : "",
              ],
            }),
            diagnosis.level
          );
        } catch (error) {
          setScreenDiagnostic(
            `讀取 WebRTC stats 失敗：${
              error?.message || error
            }`,
            "warning"
          );
        }
      };

      [
        "connectionstatechange",
        "iceconnectionstatechange",
        "icegatheringstatechange",
        "signalingstatechange",
      ].forEach((eventName) => {
        pc.addEventListener(
          eventName,
          () => void refresh()
        );
      });

      await refresh();

      rtcDiagnosticTimer =
        setInterval(
          () => void refresh(),
          1000
        );

      mediaArrivalTimer = setTimeout(() => {
        if (mediaStreamReceived) return;

        connectionPhase =
          "WebRTC 媒體尚未到達";
        refreshProgress(
          "模型與 GPU 已準備好；目前卡在手機到大螢幕的 WebRTC 媒體連線。"
        );

        setStatus([
          "手機通話要求已收到",
          "但 15 秒內沒有收到 LIVE 影片",
          "請查看下方 LIVE 連線檢測。",
        ]);
      }, 15000);
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(
          text
        );
        return true;
      } catch (_) {
        const area =
          document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        const copied =
          document.execCommand("copy");
        area.remove();
        return copied;
      }
    }

    function setSelfTestResult(
      text,
      level = "normal"
    ) {
      selfTestResult.textContent = text;
      selfTestResult.classList.toggle(
        "ok",
        level === "ok"
      );
      selfTestResult.classList.toggle(
        "warning",
        level === "warning"
      );
      selfTestResult.classList.toggle(
        "failed",
        level === "failed"
      );
    }

    function waitForConnectionOpen(
      connection,
      timeoutMs = 8000
    ) {
      if (connection?.open) {
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `DataConnection ${timeoutMs}ms 內未開啟`
            )
          );
        }, timeoutMs);

        connection.once("open", () => {
          clearTimeout(timer);
          resolve();
        });

        connection.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
    }

    function waitForSelfTestPong(
      connection,
      token,
      timeoutMs = 8000
    ) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          connection.off?.("data", handler);
          reject(
            new Error(
              `已建立 DataConnection，但 ${timeoutMs}ms 內未收到 pong`
            )
          );
        }, timeoutMs);

        const handler = (data) => {
          if (
            !data ||
            data.type !== "screenSelfTestPong" ||
            data.token !== token
          ) {
            return;
          }

          clearTimeout(timer);
          connection.off?.("data", handler);
          resolve(data);
        };

        connection.on("data", handler);
      });
    }

    async function runLocalPeerSelfTest() {
      if (!screenRoomId || !peer) {
        setSelfTestResult(
          "房間尚未建立，無法執行自我檢測。",
          "failed"
        );
        return;
      }

      localPeerTestBtn.disabled = true;
      localPeerTestBtn.textContent = "檢測中…";

      let probePeer = null;
      let probeConnection = null;

      const token =
        `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 10)}`;

      const startedAt = performance.now();

      setSelfTestResult([
        "步驟 1/3：建立第二個測試 Peer…",
        `目標 Room：${screenRoomId}`,
        "這個測試不需要手機。",
      ].join("\n"));

      try {
        probePeer = await createPeer({
          debug: 1,
        });

        setSelfTestResult([
          "步驟 2/3：測試 Peer 已取得 ID。",
          `Probe Peer：${probePeer.id}`,
          "正在透過 PeerJS Cloud 呼叫目前大螢幕 Room…",
        ].join("\n"));

        probeConnection = probePeer.connect(
          screenRoomId,
          {
            reliable: true,
            serialization: "json",
            metadata: {
              kind: "screenSelfTest",
              token,
              build: BUILD_ID,
            },
          }
        );

        await waitForConnectionOpen(
          probeConnection,
          10000
        );

        setSelfTestResult([
          "步驟 3/3：DataConnection 已開啟。",
          "正在送出 ping 並等待大螢幕自己回覆…",
        ].join("\n"));

        const pongPromise =
          waitForSelfTestPong(
            probeConnection,
            token,
            8000
          );

        probeConnection.send({
          type: "screenSelfTestPing",
          token,
          sentAt: Date.now(),
        });

        await pongPromise;

        const elapsed =
          performance.now() - startedAt;

        setSelfTestResult([
          "本機 PeerJS 自我檢測：成功",
          `耗時：${elapsed.toFixed(0)} ms`,
          "",
          "這代表：",
          "✓ 這台電腦不缺少 PeerJS 下載",
          "✓ 瀏覽器可連到 PeerJS Cloud",
          "✓ 目前大螢幕 Room 可被呼叫",
          "✓ WebRTC DataChannel 可建立",
          "",
          "若手機仍完全沒出現，問題在手機頁面、手機快取、掃到舊 QR，或手機所在網路，而不是這台電腦缺少安裝。",
        ].join("\n"), "ok");
      } catch (error) {
        const message =
          error?.message || String(error);

        setSelfTestResult([
          "本機 PeerJS 自我檢測：失敗",
          `error: ${message}`,
          "",
          "這台電腦或目前網路無法完整建立 PeerJS 連線。",
          "可先換成手機熱點測試；若仍失敗，需檢查防火牆、代理伺服器或改用自架 PeerServer。",
        ].join("\n"), "failed");
      } finally {
        try {
          probeConnection?.close();
        } catch (_) {
          // no-op
        }

        try {
          probePeer?.destroy();
        } catch (_) {
          // no-op
        }

        localPeerTestBtn.disabled = false;
        localPeerTestBtn.textContent =
          "測試這台電腦";
      }
    }

    localPeerTestBtn.addEventListener(
      "click",
      () => {
        void runLocalPeerSelfTest();
      }
    );

    copyMobileUrlBtn.addEventListener(
      "click",
      async () => {
        if (!currentMobileUrl) {
          copyMobileUrlBtn.textContent =
            "網址尚未建立";
          return;
        }

        const copied = await copyText(
          currentMobileUrl
        );

        copyMobileUrlBtn.textContent =
          copied
            ? "手機網址已複製"
            : "複製失敗";

        setTimeout(() => {
          copyMobileUrlBtn.textContent =
            "複製手機網址";
        }, 1600);
      }
    );

    requestRetryBtn.addEventListener(
      "click",
      () => {
        if (!mobileDataConnection?.open) {
          setScreenDiagnostic(
            `${latestScreenDiagnosticText}\\n\\n無法要求重傳：手機資料通道未連線。`,
            "warning"
          );
          return;
        }

        mobileDataConnection.send({
          type: "retryMedia",
        });

        setStatus(
          "已要求手機重新傳送 LIVE…"
        );
      }
    );

    copyDiagnosticsBtn.addEventListener(
      "click",
      async () => {
        const copied = await copyText(
          latestScreenDiagnosticText
        );

        copyDiagnosticsBtn.textContent =
          copied
            ? "已複製"
            : "複製失敗";

        setTimeout(() => {
          copyDiagnosticsBtn.textContent =
            "複製檢測內容";
        }, 1500);
      }
    );

    reloadRoomBtn.addEventListener(
      "click",
      () => {
        location.reload();
      }
    );

    function disposeRecurrent() {
      if (recurrent.length) {
        window.tf?.dispose(recurrent);
      }

      recurrent = [];
    }

    function resetRvmState() {
      disposeRecurrent();

      if (!window.tf) return;

      recurrent = [
        tf.scalar(0),
        tf.scalar(0),
        tf.scalar(0),
        tf.scalar(0),
      ];

      lastVideoTime = -1;
    }

    function disposeCachedTensors() {
      backgroundTensor?.dispose();
      backgroundTensor = null;

      downsampleTensor?.dispose();
      downsampleTensor = null;

      cachedWidth = 0;
      cachedHeight = 0;
    }

    function drawBackgroundCover(width, height) {
      backgroundCanvas.width = width;
      backgroundCanvas.height = height;

      backgroundCtx.setTransform(1, 0, 0, 1, 0, 0);
      backgroundCtx.clearRect(0, 0, width, height);

      drawMediaCover(
        backgroundCtx,
        currentBackgroundElement(),
        width,
        height
      );
    }

    function compositionAspect() {
      const dimensions =
        currentBackgroundDimensions();

      return (
        dimensions.width / dimensions.height
      );
    }


    function readViewportMetrics() {
      const visual =
        window.visualViewport;

      const width = Math.max(
        1,
        Math.floor(
          visual?.width ||
          document.documentElement.clientWidth ||
          window.innerWidth ||
          1
        )
      );

      const height = Math.max(
        1,
        Math.floor(
          visual?.height ||
          document.documentElement.clientHeight ||
          window.innerHeight ||
          1
        )
      );

      return {
        width,
        height,
        scale:
          Number(visual?.scale || 1),
        dpr:
          Number(window.devicePixelRatio || 1),
        screenWidth:
          Number(window.screen?.width || 0),
        screenHeight:
          Number(window.screen?.height || 0),
        availableWidth:
          Number(
            window.screen?.availWidth || 0
          ),
        availableHeight:
          Number(
            window.screen?.availHeight || 0
          ),
      };
    }

    function setDisplayFitStatus(
      text,
      warning = false
    ) {
      displayFitStatus.textContent = text;
      displayFitStatus.classList.toggle(
        "warning",
        warning
      );
    }

    function fitCompositionToViewport(
      reason = "即時偵測"
    ) {
      cancelAnimationFrame(fitRaf);

      fitRaf = requestAnimationFrame(() => {
        const viewport =
          readViewportMetrics();

        /*
          stage 使用 visualViewport 的實際可見 CSS 尺寸，
          避免瀏覽器工具列、Windows 顯示縮放或全螢幕切換後
          仍沿用舊的 100vh。
        */
        stage.style.width =
          `${viewport.width}px`;
        stage.style.height =
          `${viewport.height}px`;

        const aspect =
          compositionAspect();

        let fittedWidth =
          viewport.width;
        let fittedHeight =
          fittedWidth / aspect;

        if (
          fittedHeight >
          viewport.height
        ) {
          fittedHeight =
            viewport.height;
          fittedWidth =
            fittedHeight * aspect;
        }

        /*
          使用整數 CSS pixel，並確保不超出 viewport。
          背景、RVM、鏡頭框都共享這一個盒子。
        */
        fittedWidth = Math.max(
          1,
          Math.min(
            viewport.width,
            Math.floor(fittedWidth)
          )
        );

        fittedHeight = Math.max(
          1,
          Math.min(
            viewport.height,
            Math.floor(fittedHeight)
          )
        );

        compositionViewport.style.width =
          `${fittedWidth}px`;
        compositionViewport.style.height =
          `${fittedHeight}px`;

        const horizontalBars =
          Math.max(
            0,
            viewport.width -
              fittedWidth
          );

        const verticalBars =
          Math.max(
            0,
            viewport.height -
              fittedHeight
          );

        const dimensions =
          currentBackgroundDimensions();
        const naturalWidth =
          dimensions.width || 1536;
        const naturalHeight =
          dimensions.height || 1049;

        const visualScaleWarning =
          Math.abs(
            viewport.scale - 1
          ) > 0.04;

        lastFitMetrics = {
          viewport,
          fittedWidth,
          fittedHeight,
          naturalWidth,
          naturalHeight,
          horizontalBars,
          verticalBars,
          reason,
        };

        setDisplayFitStatus([
          "全圖模式：已自動套用",
          `觸發：${reason}`,
          `瀏覽器可見區：${viewport.width}×${viewport.height}`,
          `背景原圖：${naturalWidth}×${naturalHeight}`,
          `實際顯示：${fittedWidth}×${fittedHeight}`,
          horizontalBars > 1
            ? `左右留黑：各約 ${Math.round(horizontalBars / 2)}px`
            : "",
          verticalBars > 1
            ? `上下留黑：各約 ${Math.round(verticalBars / 2)}px`
            : "",
          `DPR：${viewport.dpr.toFixed(2)}｜瀏覽器縮放：${viewport.scale.toFixed(2)}`,
          visualScaleWarning
            ? "提醒：瀏覽器頁面可能不是 100% 縮放；仍會顯示完整圖片，但可按 Ctrl+0 重設。"
            : "背景不裁切；不同電腦只會出現必要的黑邊。",
        ].filter(Boolean).join("\n"), visualScaleWarning);

        /*
          composition box 改變後，鏡頭框與預覽需即時重算。
        */
        applyFrameTransform();
      });
    }

    function scheduleCompositionFit(
      reason
    ) {
      fitCompositionToViewport(reason);
    }

    async function toggleFullscreen() {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement
            .requestFullscreen?.();
        } else {
          await document.exitFullscreen?.();
        }
      } catch (error) {
        setDisplayFitStatus([
          lastFitMetrics
            ? displayFitStatus.textContent
            : "全圖模式仍有效。",
          "",
          `全螢幕失敗：${
            error?.message ||
            error?.name ||
            "瀏覽器不允許"
          }`,
        ].join("\n"), true);
      }
    }

    refitDisplayBtn.addEventListener(
      "click",
      () => {
        fitCompositionToViewport(
          "手動重新偵測"
        );
      }
    );

    fullscreenBtn.addEventListener(
      "click",
      () => {
        void toggleFullscreen();
      }
    );

    hideControlsBtn.addEventListener(
      "click",
      () => {
        stage.classList.add(
          "controls-hidden"
        );
      }
    );

    showControlsBtn.addEventListener(
      "click",
      () => {
        stage.classList.remove(
          "controls-hidden"
        );
      }
    );

    resetBrowserZoomHintBtn.addEventListener(
      "click",
      () => {
        setDisplayFitStatus([
          displayFitStatus.textContent,
          "",
          "Windows / Chrome：按 Ctrl+0 回到 100%。",
          "macOS：按 Command+0。",
          "本程式即使不是 100% 仍會 contain 顯示完整圖片。",
        ].join("\n"), true);
      }
    );

    document.addEventListener(
      "fullscreenchange",
      () => {
        fullscreenBtn.textContent =
          document.fullscreenElement
            ? "離開全螢幕"
            : "進入全螢幕";

        scheduleCompositionFit(
          "全螢幕狀態改變"
        );
      }
    );

    window.addEventListener(
      "orientationchange",
      () => {
        setTimeout(() => {
          scheduleCompositionFit(
            "螢幕方向改變"
          );
        }, 120);
      }
    );

    window.visualViewport?.addEventListener(
      "resize",
      () => {
        scheduleCompositionFit(
          "visualViewport resize"
        );
      }
    );

    window.visualViewport?.addEventListener(
      "scroll",
      () => {
        scheduleCompositionFit(
          "visualViewport scroll"
        );
      }
    );

    compositionResizeObserver =
      new ResizeObserver(() => {
        applyFrameTransform();
      });

    compositionResizeObserver.observe(
      compositionViewport
    );

    function getTargetSize(
      sourceWidth,
      sourceHeight
    ) {
      const requestedMax = Number(
        qualitySelect.value || 640
      );

      const targetAspect =
        compositionAspect();

      /*
        不再沿用手機的 16:9 輸出比例。
        從 16 的倍數中找出最接近 background.jpg 比例、
        且不超過品質上限的尺寸。
      */
      let best = {
        width: 608,
        height: 416,
        score: Infinity,
        area: 0,
      };

      for (
        let width = 320;
        width <= requestedMax;
        width += 16
      ) {
        const height =
          Math.round(
            width / targetAspect / 16
          ) * 16;

        if (
          height < 320 ||
          Math.max(width, height) > requestedMax
        ) {
          continue;
        }

        const error = Math.abs(
          width / height - targetAspect
        );

        const area = width * height;

        if (
          error < best.score - 0.000001 ||
          (
            Math.abs(error - best.score) < 0.000001 &&
            area > best.area
          )
        ) {
          best = {
            width,
            height,
            score: error,
            area,
          };
        }
      }

      return {
        width: best.width,
        height: best.height,
      };
    }

    function getDownsampleRatio(width, height) {
      const longest = Math.max(width, height);

      if (longest >= 1600) return 0.25;
      if (longest >= 1000) return 0.375;
      return 0.5;
    }

    function ensureCachedTensors(width, height) {
      if (
        cachedWidth === width &&
        cachedHeight === height &&
        backgroundTensor &&
        downsampleTensor
      ) {
        return;
      }

      disposeCachedTensors();
      resetRvmState();

      cachedWidth = width;
      cachedHeight = height;

      drawBackgroundCover(width, height);

      backgroundTensor = tf.tidy(() =>
        tf.browser
          .fromPixels(backgroundCanvas)
          .toFloat()
          .div(255)
          .expandDims(0)
      );

      downsampleTensor = tf.scalar(
        getDownsampleRatio(width, height)
      );

      /*
        不在這裡改可見 Canvas 尺寸。
        尺寸一變 Canvas 會被清空，舊版因此轉向時整個人物透明。
        v18 先在 renderCanvas 完成新畫面，再一次切換。
      */
    }

    async function warmupRvmModel(loadedModel) {
      if (modelWarm) return;

      modelPhase = "GPU 預熱中";
      refreshProgress(
        "完成後才會顯示 QR Code，觀眾掃碼後可更快出現人物。"
      );

      let dummySrc = null;
      let dummyRatio = null;
      let dummyStates = [];
      let outputs = [];

      try {
        /*
          官方 TFJS starter 使用 640 級輸入。
          先跑一張 640×384，讓 WebGL shader、模型節點與
          recurrent state 路徑在觀眾連線前完成編譯。
        */
        dummySrc = tf.zeros([1, 384, 640, 3]);
        dummyRatio = tf.scalar(0.5);
        dummyStates = [
          tf.scalar(0),
          tf.scalar(0),
          tf.scalar(0),
          tf.scalar(0),
        ];

        outputs = await loadedModel.executeAsync(
          {
            src: dummySrc,
            r1i: dummyStates[0],
            r2i: dummyStates[1],
            r3i: dummyStates[2],
            r4i: dummyStates[3],
            downsample_ratio: dummyRatio,
          },
          [
            "fgr",
            "pha",
            "r1o",
            "r2o",
            "r3o",
            "r4o",
          ]
        );

        /*
          強制等 GPU 工作完成，而不只是建立 lazy tensor。
        */
        await outputs[1].data();

        modelWarm = true;
        modelPhase =
          `模型與 GPU 已預熱｜TFJS ${tf.getBackend()}`;
        refreshProgress(
          "RVM 已準備完成，現在可以讓觀眾掃 QR Code。"
        );
      } finally {
        tf.dispose([
          dummySrc,
          dummyRatio,
          ...dummyStates,
          ...outputs,
        ].filter(Boolean));
      }
    }

    async function loadRvmModel() {
      if (model) return model;
      if (modelPromise) return modelPromise;

      modelPromise = (async () => {
        if (!window.tf) {
          throw new Error(
            "TensorFlow.js 尚未載入。"
          );
        }

        modelPhase = "初始化 TensorFlow.js";
        refreshProgress();

        await tf.setBackend("webgl");
        await tf.ready();

        let lastError = null;

        for (const modelUrl of RVM_MODEL_URLS) {
          try {
            modelPhase = modelUrl.includes("jsdelivr")
              ? "從 jsDelivr 下載"
              : "從 GitHub Raw 下載";
            refreshProgress();

            const loaded = await tf.loadGraphModel(
              modelUrl,
              {
                onProgress: (fraction) => {
                  modelPhase =
                    `下載模型 ${Math.round(fraction * 100)}%`;
                  refreshProgress();
                },
              }
            );

            model = loaded;
            modelPhase =
              `模型已下載｜TFJS ${tf.getBackend()}`;
            refreshProgress();

            await warmupRvmModel(model);
            resetRvmState();

            return model;
          } catch (error) {
            console.warn(
              "RVM model source failed:",
              modelUrl,
              error
            );
            lastError = error;
          }
        }

        throw lastError ||
          new Error("所有 RVM 模型來源皆載入失敗。");
      })();

      try {
        return await modelPromise;
      } catch (error) {
        modelPromise = null;
        throw error;
      }
    }

    function normalizedRotation(value) {
      const normalized =
        ((Number(value) % 360) + 360) % 360;

      if (normalized === 270) return -90;
      if (normalized === 180) return 180;
      if (normalized === 90) return 90;
      return 0;
    }

    function effectiveRotation() {
      return normalizedRotation(
        manualRotationOverride
      );
    }

    function landscapeRotationForVideo() {
      if (
        !remoteVideo.videoWidth ||
        !remoteVideo.videoHeight
      ) {
        return 0;
      }

      return remoteVideo.videoHeight >
        remoteVideo.videoWidth
        ? 90
        : 0;
    }

    function requestRotation(nextRotation) {
      pendingRotation =
        normalizedRotation(nextRotation);

      setStatus([
        "旋轉已排入下一張畫面",
        `目標角度：${pendingRotation}°`,
        "目前畫面會保留，不會重新建立 LIVE 串流。",
      ]);

      mobileDataConnection?.send?.({
        type: "rotationApplied",
        rotation: pendingRotation,
        automatic: false,
      });
    }

    function commitPendingRotation() {
      if (pendingRotation === null) {
        return;
      }

      manualRotationOverride =
        normalizedRotation(pendingRotation);
      pendingRotation = null;

      /*
        只在沒有其他推論執行時重設 recurrent state。
        不清空 display canvas、不停止 WebRTC、不重開相機。
      */
      disposeCachedTensors();
      resetRvmState();

      setStatus([
        "正在套用新方向",
        `影像角度：${effectiveRotation()}°`,
        "舊畫面會保留到新畫面運算完成。",
      ]);
    }

    function resetLandscapeRotation() {
      requestRotation(
        landscapeRotationForVideo()
      );
    }

    function getSourceCropGeometry(
      sourceWidth,
      sourceHeight
    ) {
      const targetAspect =
        compositionAspect();

      let baseWidth = sourceWidth;
      let baseHeight = sourceHeight;

      if (
        sourceWidth / sourceHeight >
        targetAspect
      ) {
        baseHeight = sourceHeight;
        baseWidth =
          baseHeight * targetAspect;
      } else {
        baseWidth = sourceWidth;
        baseHeight =
          baseWidth / targetAspect;
      }

      const zoom = Math.max(
        1,
        Number(frameTransform.scale || 1)
      );

      const cropWidth = Math.max(
        32,
        Math.min(
          sourceWidth,
          Math.round(baseWidth / zoom)
        )
      );

      const cropHeight = Math.max(
        32,
        Math.min(
          sourceHeight,
          Math.round(baseHeight / zoom)
        )
      );

      const halfX =
        cropWidth / sourceWidth / 2;
      const halfY =
        cropHeight / sourceHeight / 2;

      const centerX = Math.min(
        1 - halfX,
        Math.max(
          halfX,
          frameTransform.centerX
        )
      );

      const centerY = Math.min(
        1 - halfY,
        Math.max(
          halfY,
          frameTransform.centerY
        )
      );

      const startX = Math.max(
        0,
        Math.min(
          sourceWidth - cropWidth,
          Math.round(
            centerX * sourceWidth -
            cropWidth / 2
          )
        )
      );

      const startY = Math.max(
        0,
        Math.min(
          sourceHeight - cropHeight,
          Math.round(
            centerY * sourceHeight -
            cropHeight / 2
          )
        )
      );

      return {
        startX,
        startY,
        cropWidth,
        cropHeight,
        centerX,
        centerY,
        halfX,
        halfY,
      };
    }

    function createInputTensor(
      source,
      targetWidth,
      targetHeight
    ) {
      return tf.tidy(() => {
        let frame = tf.browser
          .fromPixels(source)
          .toFloat();

        const rotation = effectiveRotation();

        if (rotation === 90) {
          frame = tf.reverse(
            tf.transpose(frame, [1, 0, 2]),
            1
          );
        } else if (rotation === -90) {
          frame = tf.reverse(
            tf.transpose(frame, [1, 0, 2]),
            0
          );
        } else if (Math.abs(rotation) === 180) {
          frame = tf.reverse(frame, [0, 1]);
        }

        if (mirrorInput) {
          frame = frame.reverse(1);
        }

        /*
          無論手機是 16:9 或其他比例，先裁切成
          background.jpg 的固定比例，再送進 RVM。
          因此人物透明 Canvas 與老照片能逐像素對齊。
        */
        const crop = getSourceCropGeometry(
          frame.shape[1],
          frame.shape[0]
        );

        frame = tf.slice(
          frame,
          [crop.startY, crop.startX, 0],
          [
            crop.cropHeight,
            crop.cropWidth,
            3,
          ]
        );

        if (
          frame.shape[0] !== targetHeight ||
          frame.shape[1] !== targetWidth
        ) {
          frame = tf.image.resizeBilinear(
            frame,
            [targetHeight, targetWidth],
            true
          );
        }

        frame = frame.div(255);

        return frame.expandDims(0);
      });
    }

    function gradeForeground(
      foreground,
      alpha,
      matchStrength = personColorMatch
    ) {
      ensurePaletteTensors();

      /*
        先做這張老照片的固定基礎風格：
        - 降低飽和度
        - 降低對比
        - 提起黑位，模擬舊照片褪色
        - 暗部偏洋紅、亮部偏青綠
      */
      const originalLuminance = foreground
        .mul([0.299, 0.587, 0.114])
        .sum(-1, true);

      let graded = originalLuminance
        .add(
          foreground
            .sub(originalLuminance)
            .mul(personSaturation)
        )
        .sub(0.5)
        .mul(0.82)
        .add(0.5)
        .mul(personBrightness);

      const gradedLuminance = graded
        .mul([0.299, 0.587, 0.114])
        .sum(-1, true);

      const shadowWeight = tf
        .scalar(1)
        .sub(
          gradedLuminance
            .sub(0.12)
            .div(0.42)
            .clipByValue(0, 1)
        );

      const highlightWeight =
        gradedLuminance
          .sub(0.56)
          .div(0.38)
          .clipByValue(0, 1);

      graded = graded
        .add(
          shadowWeight.mul(
            [0.030, -0.014, 0.022]
          )
        )
        .add(
          highlightWeight.mul(
            [-0.020, 0.030, 0.021]
          )
        )
        .mul(0.965)
        .add(0.018)
        .clipByValue(0, 1);

      /*
        再依 background.jpg 的中央偏下區域，
        對人物做有限度的 mean/std 色彩轉移。
        只混合一部分，避免膚色完全被背景吃掉。
      */
      const weight = alpha
        .clipByValue(0.10, 1)
        .square();

      const weightSum = weight
        .sum([1, 2], true)
        .add(0.0001);

      const personMean = graded
        .mul(weight)
        .sum([1, 2], true)
        .div(weightSum);

      const personVariance = graded
        .sub(personMean)
        .square()
        .mul(weight)
        .sum([1, 2], true)
        .div(weightSum);

      const personStd = personVariance
        .add(0.0006)
        .sqrt();

      const gain = paletteStdTensor
        .div(personStd)
        .clipByValue(0.72, 1.08);

      const matched = graded
        .sub(personMean)
        .mul(gain)
        .add(paletteMeanTensor)
        .clipByValue(0, 1);

      const strength = Math.max(
        0,
        Math.min(0.85, matchStrength)
      );

      return graded
        .mul(1 - strength)
        .add(matched.mul(strength))
        .clipByValue(0, 1);
    }

    function saveFrameTransform() {
      try {
        localStorage.setItem(
          "timeportal-frame-v21",
          JSON.stringify(frameTransform)
        );
      } catch (error) {
        console.warn(
          "Cannot save frame transform.",
          error
        );
      }
    }

    function currentLogicalAspect() {
      return compositionAspect();
    }

    function applyFrameTransform() {
      const stageWidth =
        Math.max(
          1,
          compositionViewport.clientWidth
        );
      const stageHeight =
        Math.max(
          1,
          compositionViewport.clientHeight
        );

      frameTransform.scale = Math.min(
        3,
        Math.max(1, frameTransform.scale)
      );

      const rotation = effectiveRotation();
      const quarterTurn =
        Math.abs(rotation) === 90;

      const sourceWidth = quarterTurn
        ? (
          remoteVideo.videoHeight ||
          framePreviewCanvas.width ||
          16
        )
        : (
          remoteVideo.videoWidth ||
          framePreviewCanvas.width ||
          16
        );

      const sourceHeight = quarterTurn
        ? (
          remoteVideo.videoWidth ||
          framePreviewCanvas.height ||
          9
        )
        : (
          remoteVideo.videoHeight ||
          framePreviewCanvas.height ||
          9
        );

      const sourceAspect =
        sourceWidth / sourceHeight;

      const previewWidth = Math.min(
        stageWidth,
        stageHeight * sourceAspect
      );

      const previewHeight =
        previewWidth / sourceAspect;

      const previewLeft =
        (stageWidth - previewWidth) / 2;

      const previewTop =
        (stageHeight - previewHeight) / 2;

      const crop = getSourceCropGeometry(
        sourceWidth,
        sourceHeight
      );

      frameTransform.centerX =
        crop.centerX;
      frameTransform.centerY =
        crop.centerY;

      const cropDisplayWidth =
        previewWidth *
        (crop.cropWidth / sourceWidth);

      const cropDisplayHeight =
        previewHeight *
        (crop.cropHeight / sourceHeight);

      const centerPixelX =
        previewLeft +
        crop.centerX * previewWidth;

      const centerPixelY =
        previewTop +
        crop.centerY * previewHeight;

      framePreviewCanvas.style.transform =
        "none";
      outputCanvas.style.transform =
        "none";

      frameOutline.style.width =
        `${cropDisplayWidth}px`;

      frameOutline.style.height =
        `${cropDisplayHeight}px`;

      frameOutline.style.left =
        `${
          centerPixelX -
          cropDisplayWidth / 2
        }px`;

      frameOutline.style.top =
        `${
          centerPixelY -
          cropDisplayHeight / 2
        }px`;

      frameZoomRange.value = String(
        Math.round(
          frameTransform.scale * 100
        )
      );

      frameZoomValue.textContent =
        `${frameTransform.scale.toFixed(2)}×`;

      frameStatus.textContent = [
        `裁切倍率：${frameTransform.scale.toFixed(2)}×`,
        `中心 X ${(frameTransform.centerX * 100).toFixed(1)}%`,
        `Y ${(frameTransform.centerY * 100).toFixed(1)}%`,
        `輸出比例：${compositionAspect().toFixed(3)}`,
      ].join("｜");

      saveFrameTransform();
    }

    function setFrameEditing(enabled) {
      frameEditing = Boolean(enabled);
      stage.classList.toggle(
        "frame-editing",
        frameEditing
      );

      frameBtn.textContent = frameEditing
        ? "完成鏡頭框"
        : "調鏡頭框";

      zoomOutBtn.disabled = !frameEditing;
      zoomInBtn.disabled = !frameEditing;
      resetFrameBtn.disabled = !frameEditing;
      frameZoomRange.disabled = !frameEditing;

      if (frameEditing) {
        startFramePreviewLoop();
      }

      applyFrameTransform();
    }

    function changeFrameScale(multiplier) {
      frameTransform.scale = Math.min(
        3,
        Math.max(
          1,
          frameTransform.scale * multiplier
        )
      );

      applyFrameTransform();
    }

    function resetFrameTransform() {
      frameTransform = {
        scale: 1,
        centerX: 0.5,
        centerY: 0.5,
      };

      applyFrameTransform();
    }

    function drawPreviewFrame() {
      if (
        !frameEditing ||
        remoteVideo.readyState < 2 ||
        !remoteVideo.videoWidth ||
        !remoteVideo.videoHeight
      ) {
        return;
      }

      const sourceWidth = remoteVideo.videoWidth;
      const sourceHeight = remoteVideo.videoHeight;
      const rotation = effectiveRotation();

      const quarterTurn =
        Math.abs(rotation) === 90;

      const targetWidth = quarterTurn
        ? sourceHeight
        : sourceWidth;
      const targetHeight = quarterTurn
        ? sourceWidth
        : sourceHeight;

      const rotatedCanvas =
        document.createElement("canvas");
      rotatedCanvas.width = targetWidth;
      rotatedCanvas.height = targetHeight;

      const rotatedCtx =
        rotatedCanvas.getContext("2d");

      rotatedCtx.save();

      if (rotation === 90) {
        rotatedCtx.translate(
          targetWidth,
          0
        );
        rotatedCtx.rotate(Math.PI / 2);
      } else if (rotation === -90) {
        rotatedCtx.translate(
          0,
          targetHeight
        );
        rotatedCtx.rotate(-Math.PI / 2);
      } else if (
        Math.abs(rotation) === 180
      ) {
        rotatedCtx.translate(
          targetWidth,
          targetHeight
        );
        rotatedCtx.rotate(Math.PI);
      }

      rotatedCtx.drawImage(
        remoteVideo,
        0,
        0,
        sourceWidth,
        sourceHeight
      );
      rotatedCtx.restore();

      framePreviewCanvas.width = targetWidth;
      framePreviewCanvas.height = targetHeight;

      const previewCtx =
        framePreviewCanvas.getContext("2d");

      previewCtx.setTransform(
        1,
        0,
        0,
        1,
        0,
        0
      );
      previewCtx.clearRect(
        0,
        0,
        targetWidth,
        targetHeight
      );

      if (mirrorInput) {
        previewCtx.translate(
          targetWidth,
          0
        );
        previewCtx.scale(-1, 1);
      }

      previewCtx.drawImage(
        rotatedCanvas,
        0,
        0
      );

      applyFrameTransform();
    }

    function startFramePreviewLoop() {
      if (framePreviewRunning) return;
      framePreviewRunning = true;

      const loop = () => {
        if (!frameEditing) {
          framePreviewRunning = false;
          return;
        }

        drawPreviewFrame();
        requestAnimationFrame(loop);
      };

      requestAnimationFrame(loop);
    }

    frameBtn.addEventListener(
      "click",
      () => {
        setFrameEditing(!frameEditing);
      }
    );

    zoomOutBtn.addEventListener(
      "click",
      () => changeFrameScale(0.90)
    );

    zoomInBtn.addEventListener(
      "click",
      () => changeFrameScale(1.10)
    );

    resetFrameBtn.addEventListener(
      "click",
      resetFrameTransform
    );

    frameZoomRange.addEventListener(
      "input",
      () => {
        frameTransform.scale =
          Number(frameZoomRange.value) / 100;

        applyFrameTransform();
      }
    );

    frameEditorHit.addEventListener(
      "pointerdown",
      (event) => {
        /*
          完整畫面時沒有可移動空間。
          使用者直接拖曳時，自動進入 1.15×，
          避免看起來像按鈕壞掉。
        */
        if (frameTransform.scale <= 1.001) {
          frameTransform.scale = 1.15;
          applyFrameTransform();
        }

        dragPointerId = event.pointerId;
        dragLastX = event.clientX;
        dragLastY = event.clientY;
        frameEditorHit.classList.add(
          "dragging"
        );
        frameEditorHit.setPointerCapture(
          event.pointerId
        );
      }
    );

    frameEditorHit.addEventListener(
      "pointermove",
      (event) => {
        if (
          dragPointerId !== event.pointerId
        ) {
          return;
        }

        const dx =
          event.clientX - dragLastX;
        const dy =
          event.clientY - dragLastY;

        dragLastX = event.clientX;
        dragLastY = event.clientY;

        const rotation =
          effectiveRotation();

        const quarterTurn =
          Math.abs(rotation) === 90;

        const sourceWidth = quarterTurn
          ? remoteVideo.videoHeight
          : remoteVideo.videoWidth;

        const sourceHeight = quarterTurn
          ? remoteVideo.videoWidth
          : remoteVideo.videoHeight;

        const sourceAspect =
          sourceWidth / sourceHeight;

        const stageWidth =
          Math.max(1, stage.clientWidth);
        const stageHeight =
          Math.max(1, stage.clientHeight);

        const previewWidth = Math.min(
          stageWidth,
          stageHeight * sourceAspect
        );

        const previewHeight =
          previewWidth / sourceAspect;

        frameTransform.centerX +=
          dx / Math.max(1, previewWidth);

        frameTransform.centerY +=
          dy / Math.max(1, previewHeight);

        applyFrameTransform();
      }
    );

    function finishFrameDrag(event) {
      if (
        dragPointerId !== event.pointerId
      ) {
        return;
      }

      dragPointerId = null;
      frameEditorHit.classList.remove(
        "dragging"
      );

      try {
        frameEditorHit.releasePointerCapture(
          event.pointerId
        );
      } catch (_) {
        // no-op
      }
    }

    frameEditorHit.addEventListener(
      "pointerup",
      finishFrameDrag
    );

    frameEditorHit.addEventListener(
      "pointercancel",
      finishFrameDrag
    );

    frameEditorHit.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();

        changeFrameScale(
          Math.exp(-event.deltaY * 0.0012)
        );
      },
      { passive: false }
    );

    window.addEventListener(
      "resize",
      () => {
        scheduleCompositionFit(
          "window resize"
        );
      }
    );

    fitCompositionToViewport(
      "頁面初始化"
    );

    async function processFrame() {
      commitPendingRotation();

      if (
        !model ||
        remoteVideo.readyState < 2 ||
        !remoteVideo.videoWidth ||
        !remoteVideo.videoHeight
      ) {
        return;
      }

      const sourceWidth = remoteVideo.videoWidth;
      const sourceHeight = remoteVideo.videoHeight;
      const currentRotation = effectiveRotation();
      const quarterTurn =
        Math.abs(currentRotation) === 90;

      const logicalWidth = quarterTurn
        ? sourceHeight
        : sourceWidth;
      const logicalHeight = quarterTurn
        ? sourceWidth
        : sourceHeight;

      const target = getTargetSize(
        logicalWidth,
        logicalHeight
      );

      ensureCachedTensors(
        target.width,
        target.height
      );

      const oldRecurrent = recurrent;
      const startedAt = performance.now();

      let src = null;
      let fgr = null;
      let pha = null;
      let r1o = null;
      let r2o = null;
      let r3o = null;
      let r4o = null;
      let composite = null;

      try {
        src = createInputTensor(
          remoteVideo,
          target.width,
          target.height
        );

        [
          fgr,
          pha,
          r1o,
          r2o,
          r3o,
          r4o,
        ] = await model.executeAsync(
          {
            src,
            r1i: oldRecurrent[0],
            r2i: oldRecurrent[1],
            r3i: oldRecurrent[2],
            r4i: oldRecurrent[3],
            downsample_ratio: downsampleTensor,
          },
          [
            "fgr",
            "pha",
            "r1o",
            "r2o",
            "r3o",
            "r4o",
          ]
        );

        /*
          官方 RVM 輸出：
          - fgr：模型估計的高清人物前景
          - pha：連續 Alpha
          - r1o~r4o：交給下一幀的時間記憶
        */
        composite = tf.tidy(() => {
          /*
            LIVE 畫面只輸出「透明人物」，不再把 background.jpg
            重新畫進手機影片大小的矩形 Canvas。
            背景只由 .screen-stage 的 CSS 顯示一次，
            因此不會再出現整塊手機範圍亮度不同的矩形。
          */
          const gradedForeground =
            gradeForeground(
              fgr,
              pha,
              personColorMatch
            );

          const cleanAlpha = pha
            .sub(0.015)
            .div(0.97)
            .clipByValue(0, 1);

          return tf
            .concat(
              [gradedForeground, cleanAlpha],
              -1
            )
            .squeeze(0);
        });

        renderCanvas.width = target.width;
        renderCanvas.height = target.height;

        await tf.browser.toPixels(
          composite,
          renderCanvas
        );

        /*
          新方向／新尺寸已完整運算完畢後才更新可見 Canvas。
          因此轉向期間會保留上一張人物，不會突然透明。
        */
        if (
          outputCanvas.width !== target.width ||
          outputCanvas.height !== target.height
        ) {
          outputCanvas.width = target.width;
          outputCanvas.height = target.height;
        }

        outputCtx.setTransform(
          1,
          0,
          0,
          1,
          0,
          0
        );
        outputCtx.clearRect(
          0,
          0,
          outputCanvas.width,
          outputCanvas.height
        );

        shadowFrameCounter += 1;
        if (
          !lastShadowGeometry ||
          shadowFrameCounter % 4 === 0
        ) {
          lastShadowGeometry =
            estimateShadowGeometry(
              renderCanvas
            );
        }

        drawGroundShadow(
          outputCtx,
          outputCanvas.width,
          outputCanvas.height,
          lastShadowGeometry
        );

        outputCtx.drawImage(
          renderCanvas,
          0,
          0
        );

        applyFrameTransform();

        if (!firstRvmFrameRendered) {
          firstRvmFrameRendered = true;
          stage.classList.add("rvm-ready");
          clearTimeout(watchdogTimer);
          modelPhase = "第一張去背畫面已完成";
          refreshProgress(
            "現在顯示的是 LIVE RVM 去背結果。"
          );
        }

        recurrent = [r1o, r2o, r3o, r4o];
        r1o = r2o = r3o = r4o = null;

        inferenceMs =
          performance.now() - startedAt;

        frameCounter += 1;
        const now = performance.now();
        const elapsed = now - lastFpsAt;

        if (elapsed >= 1000) {
          displayedFps =
            (frameCounter * 1000) / elapsed;
          frameCounter = 0;
          lastFpsAt = now;
        }

        const track =
          remoteVideo.srcObject
            ?.getVideoTracks?.()[0];
        const settings =
          track?.getSettings?.() || {};

        connectionPhase = "手機 LIVE 已接收";
        modelPhase = "RVM 持續推論";
        refreshProgress();

        setStatus([
          "連線：成功｜RVM 運作中",
          `手機影片：${sourceWidth}×${sourceHeight}`,
          `補轉：${effectiveRotation()}°`,
          `RVM 輸出：${target.width}×${target.height}`,
          `合成比例：${compositionAspect().toFixed(3)}`,
          `Track：${settings.width || "?"}×${
            settings.height || "?"
          }`,
          `推論：${inferenceMs.toFixed(0)} ms`,
          `輸出：約 ${displayedFps.toFixed(1)} FPS`,
          `TFJS：${tf.getBackend()}`,
        ]);
      } finally {
        tf.dispose([
          src,
          fgr,
          pha,
          composite,
          ...oldRecurrent,
          r1o,
          r2o,
          r3o,
          r4o,
        ].filter(Boolean));
      }
    }

    function estimateShadowGeometry(sourceCanvas) {
      if (!sourceCanvas.width || !sourceCanvas.height) {
        return null;
      }

      shadowSampleCtx.clearRect(
        0,
        0,
        shadowSampleCanvas.width,
        shadowSampleCanvas.height
      );
      shadowSampleCtx.drawImage(
        sourceCanvas,
        0,
        0,
        shadowSampleCanvas.width,
        shadowSampleCanvas.height
      );

      const pixels = shadowSampleCtx.getImageData(
        0,
        0,
        shadowSampleCanvas.width,
        shadowSampleCanvas.height
      ).data;

      let minX = shadowSampleCanvas.width;
      let maxX = -1;
      let minY = shadowSampleCanvas.height;
      let maxY = -1;

      for (let y = 0; y < shadowSampleCanvas.height; y += 1) {
        for (let x = 0; x < shadowSampleCanvas.width; x += 1) {
          const alpha =
            pixels[(y * shadowSampleCanvas.width + x) * 4 + 3];

          if (alpha > 24) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX < minX || maxY < minY) {
        return null;
      }

      const bandTop = Math.max(
        minY,
        maxY - Math.max(4, Math.round((maxY - minY) * 0.18))
      );

      let weightedX = 0;
      let weightSum = 0;
      let bandMinX = shadowSampleCanvas.width;
      let bandMaxX = -1;

      for (let y = bandTop; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const alpha =
            pixels[(y * shadowSampleCanvas.width + x) * 4 + 3];

          if (alpha > 18) {
            weightedX += x * alpha;
            weightSum += alpha;
            if (x < bandMinX) bandMinX = x;
            if (x > bandMaxX) bandMaxX = x;
          }
        }
      }

      const scaleX =
        sourceCanvas.width / shadowSampleCanvas.width;
      const scaleY =
        sourceCanvas.height / shadowSampleCanvas.height;
      const centerX =
        weightSum > 0
          ? (weightedX / weightSum) * scaleX
          : ((minX + maxX) / 2) * scaleX;
      const bodyWidth =
        (Math.max(
          8,
          (bandMaxX >= bandMinX ? bandMaxX - bandMinX : maxX - minX)
        )) * scaleX;
      const baseY = maxY * scaleY;

      return {
        centerX,
        baseY,
        bodyWidth,
        bodyHeight: Math.max(1, (maxY - minY) * scaleY),
      };
    }

    function drawGroundShadow(
      ctx,
      width,
      height,
      geometry,
      strength = shadowStrength
    ) {
      if (!geometry || strength <= 0.001) {
        return;
      }

      const radiusX = Math.max(
        18,
        geometry.bodyWidth * 0.50
      );
      const radiusY = Math.max(
        6,
        radiusX * 0.16
      );
      const centerX = Math.max(
        radiusX,
        Math.min(width - radiusX, geometry.centerX)
      );
      const centerY = Math.min(
        height - radiusY * 0.4,
        geometry.baseY + radiusY * 0.35
      );

      ctx.save();
      const gradient = ctx.createRadialGradient(
        centerX,
        centerY,
        radiusY * 0.35,
        centerX,
        centerY,
        radiusX
      );
      gradient.addColorStop(
        0,
        `rgba(0,0,0,${(0.20 * strength).toFixed(3)})`
      );
      gradient.addColorStop(
        0.65,
        `rgba(0,0,0,${(0.08 * strength).toFixed(3)})`
      );
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(
        centerX,
        centerY,
        radiusX,
        radiusY,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.restore();
    }

    function scaleShadowGeometry(
      geometry,
      scaleX,
      scaleY
    ) {
      if (!geometry) return null;

      return {
        centerX: geometry.centerX * scaleX,
        baseY: geometry.baseY * scaleY,
        bodyWidth: geometry.bodyWidth * scaleX,
        bodyHeight: geometry.bodyHeight * scaleY,
      };
    }

    function getStillTargetSize() {
      const sourceWidth = remoteVideo.videoWidth;
      const sourceHeight = remoteVideo.videoHeight;
      const quarterTurn =
        Math.abs(effectiveRotation()) === 90;

      const logicalWidth = quarterTurn
        ? sourceHeight
        : sourceWidth;
      const logicalHeight = quarterTurn
        ? sourceWidth
        : sourceHeight;

      const requestedMax = Math.min(
        1280,
        Math.max(logicalWidth, logicalHeight)
      );

      const scale = Math.min(
        1,
        requestedMax /
          Math.max(logicalWidth, logicalHeight)
      );

      return {
        width: Math.max(
          320,
          Math.round(
            (logicalWidth * scale) / 32
          ) * 32
        ),
        height: Math.max(
          320,
          Math.round(
            (logicalHeight * scale) / 32
          ) * 32
        ),
      };
    }

    function sleep(milliseconds) {
      return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      });
    }

    function snapshotRemoteVideo() {
      const canvas = document.createElement("canvas");

      canvas.width = remoteVideo.videoWidth;
      canvas.height = remoteVideo.videoHeight;

      const context = canvas.getContext("2d");
      context.drawImage(
        remoteVideo,
        0,
        0,
        canvas.width,
        canvas.height
      );

      return canvas;
    }

    function sharpnessScore(sourceCanvas) {
      const sample =
        document.createElement("canvas");
      const context = sample.getContext("2d", {
        willReadFrequently: true,
      });

      const maxSide = 224;
      const scale = Math.min(
        1,
        maxSide /
          Math.max(
            sourceCanvas.width,
            sourceCanvas.height
          )
      );

      sample.width = Math.max(
        64,
        Math.round(sourceCanvas.width * scale)
      );
      sample.height = Math.max(
        64,
        Math.round(sourceCanvas.height * scale)
      );

      context.drawImage(
        sourceCanvas,
        0,
        0,
        sample.width,
        sample.height
      );

      const imageData = context.getImageData(
        0,
        0,
        sample.width,
        sample.height
      ).data;

      const x0 = Math.floor(sample.width * 0.10);
      const x1 = Math.ceil(sample.width * 0.90);
      const y0 = Math.floor(sample.height * 0.08);
      const y1 = Math.ceil(sample.height * 0.92);

      let score = 0;
      let count = 0;

      const luminanceAt = (x, y) => {
        const index =
          (y * sample.width + x) * 4;

        return (
          imageData[index] * 0.299 +
          imageData[index + 1] * 0.587 +
          imageData[index + 2] * 0.114
        );
      };

      for (let y = y0 + 1; y < y1 - 1; y += 1) {
        for (let x = x0 + 1; x < x1 - 1; x += 1) {
          const center = luminanceAt(x, y);

          /*
            簡化 Laplacian focus metric。
            分數越高，通常代表動態模糊越少。
          */
          const laplacian = Math.abs(
            luminanceAt(x - 1, y) +
            luminanceAt(x + 1, y) +
            luminanceAt(x, y - 1) +
            luminanceAt(x, y + 1) -
            4 * center
          );

          score += laplacian;
          count += 1;
        }
      }

      return score / Math.max(1, count);
    }

    async function captureSharpestBurst(
      requester
    ) {
      const frameCount = 7;
      let bestCanvas = null;
      let bestScore = -Infinity;

      for (
        let frameIndex = 0;
        frameIndex < frameCount;
        frameIndex += 1
      ) {
        photoLoading.textContent =
          `正在連拍並挑選最清楚畫面… ${
            frameIndex + 1
          }/${frameCount}`;

        requester?.send?.({
          type: "captureStatus",
          status: "burst",
          current: frameIndex + 1,
          total: frameCount,
        });

        const candidate =
          snapshotRemoteVideo();
        const score =
          sharpnessScore(candidate);

        if (score > bestScore) {
          bestCanvas = candidate;
          bestScore = score;
        }

        if (frameIndex < frameCount - 1) {
          await sleep(85);
        }
      }

      return {
        canvas: bestCanvas,
        score: bestScore,
      };
    }

    async function canvasBlob(canvas) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(
              new Error("無法建立 PNG 照片。")
            );
          }
        }, "image/png");
      });
    }

    async function captureHighQualityPhoto(
      requester = mobileDataConnection
    ) {
      if (
        photoBusy ||
        !firstRvmFrameRendered ||
        !outputCanvas.width ||
        !outputCanvas.height
      ) {
        return;
      }

      photoBusy = true;
      captureBtn.disabled = true;
      downloadPhotoBtn.disabled = true;
      photoLayer.classList.remove("hidden");
      photoLoading.classList.remove("hidden");
      photoCanvas.classList.add("hidden");
      photoScore.textContent = "";
      photoLoading.textContent =
        "正在保存目前 LIVE 去背畫面…";

      requester?.send?.({
        type: "captureStatus",
        status: "processing",
      });

      try {
        /*
          先複製目前已完成的 RVM 畫面。
          不再重新呼叫 executeAsync，因此不會和 LIVE GPU 推論搶資源。
        */
        const personSnapshot =
          document.createElement("canvas");

        personSnapshot.width =
          outputCanvas.width;
        personSnapshot.height =
          outputCanvas.height;

        const personCtx =
          personSnapshot.getContext("2d");

        personCtx.drawImage(
          outputCanvas,
          0,
          0
        );

        const bgDimensions =
          currentBackgroundDimensions();
        const finalWidth =
          bgDimensions.width || 1498;
        const finalHeight =
          bgDimensions.height || 1024;

        photoCanvas.width = finalWidth;
        photoCanvas.height = finalHeight;

        const photoCtx =
          photoCanvas.getContext("2d");

        photoCtx.setTransform(
          1,
          0,
          0,
          1,
          0,
          0
        );

        photoCtx.clearRect(
          0,
          0,
          finalWidth,
          finalHeight
        );

        drawMediaCover(
          photoCtx,
          currentBackgroundElement(),
          finalWidth,
          finalHeight
        );

        const scaledShadow =
          scaleShadowGeometry(
            lastShadowGeometry ||
              estimateShadowGeometry(personSnapshot),
            finalWidth / outputCanvas.width,
            finalHeight / outputCanvas.height
          );

        drawGroundShadow(
          photoCtx,
          finalWidth,
          finalHeight,
          scaledShadow,
          Math.min(0.55, shadowStrength * 1.1)
        );

        photoCtx.drawImage(
          personSnapshot,
          0,
          0,
          finalWidth,
          finalHeight
        );

        /*
          讓瀏覽器有機會先更新 loading UI，
          再進行 PNG 編碼。
        */
        await new Promise((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
          });
        });

        if (latestPhotoUrl) {
          URL.revokeObjectURL(latestPhotoUrl);
        }

        const blob = await canvasBlob(
          photoCanvas
        );

        latestPhotoUrl =
          URL.createObjectURL(blob);

        photoLoading.classList.add("hidden");
        photoCanvas.classList.remove("hidden");
        downloadPhotoBtn.disabled = false;

        photoNote.textContent =
          `完成：${photoCanvas.width}×${photoCanvas.height}。` +
          "這張照片直接保存目前螢幕的穩定 LIVE 人物，" +
          "沒有再次啟動高負載 RVM。";

        photoScore.textContent =
          "安全模式：不做 7 張連拍、不做 5 次模型精修，避免 GPU 當機。";

        requester?.send?.({
          type: "captureStatus",
          status: "ready",
        });
      } catch (error) {
        photoLoading.textContent =
          `照片產生失敗：${error?.message || error}`;

        photoNote.textContent =
          "LIVE 畫面不受影響，可以關閉後繼續使用。";

        requester?.send?.({
          type: "captureStatus",
          status: "error",
          message:
            error?.message || String(error),
        });

        showError(
          error,
          "#errorBox",
          "快速拍照失敗"
        );
      } finally {
        photoBusy = false;
        captureBtn.disabled =
          !remoteVideo.srcObject;
      }
    }

    async function inferenceLoop() {
      if (processing) return;
      processing = true;

      try {
        await loadRvmModel();

        while (
          processing &&
          remoteVideo.srcObject
        ) {
          await tf.nextFrame();

          if (
            photoBusy ||
            frameBusy ||
            remoteVideo.readyState < 2 ||
            remoteVideo.currentTime === lastVideoTime
          ) {
            continue;
          }

          frameBusy = true;
          lastVideoTime = remoteVideo.currentTime;

          try {
            await processFrame();
          } catch (error) {
            processing = false;
            showError(
              error,
              "#errorBox",
              "RVM 人物去背失敗"
            );
            modelPhase = "推論失敗";
        refreshProgress();
        setStatus("RVM：failed");
          } finally {
            frameBusy = false;
          }
        }
      } catch (error) {
        processing = false;
        showError(
          error,
          "#errorBox",
          "RVM 模型載入失敗"
        );
        modelPhase = "模型載入失敗";
        refreshProgress();
        setStatus("RVM 模型：failed");
      }
    }

    function stopInference() {
      processing = false;
      frameBusy = false;
      lastVideoTime = -1;
      firstRvmFrameRendered = false;
      streamReceivedAt = 0;
      clearTimeout(watchdogTimer);
      stage.classList.remove("rvm-ready");
      disposeRecurrent();
      disposeCachedTensors();

      const ctx = outputCanvas.getContext("2d");
      ctx?.clearRect(
        0,
        0,
        outputCanvas.width,
        outputCanvas.height
      );
    }

    captureBtn.addEventListener(
      "click",
      () => {
        void captureHighQualityPhoto();
      }
    );

    closePhotoBtn.addEventListener(
      "click",
      () => {
        photoLayer.classList.add("hidden");
      }
    );

    downloadPhotoBtn.addEventListener(
      "click",
      () => {
        if (!latestPhotoUrl) return;

        const now = new Date();
        const stamp = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
          "-",
          String(now.getHours()).padStart(2, "0"),
          String(now.getMinutes()).padStart(2, "0"),
          String(now.getSeconds()).padStart(2, "0"),
        ].join("");

        const link = document.createElement("a");
        link.href = latestPhotoUrl;
        link.download =
          `TimePortal-${stamp}.png`;
        link.click();
      }
    );

    qualitySelect.addEventListener(
      "change",
      () => {
        disposeCachedTensors();
        resetRvmState();
      }
    );

    function recomputeRemoteRotation() {
      /*
        v18 預設固定橫向，不再讓不可靠的手機 orientation
        自動覆蓋畫面。方向只由：
        1. 首次連線的橫向預設
        2. 手機／電腦的「旋轉影像 90°」
        控制。
      */
      return;
    }

    function applyOrientationMessage(data) {
      mobileOrientation = {
        portrait: Boolean(data.portrait),
        angle: Number(data.angle || 0),
        viewportWidth:
          Number(data.viewportWidth || 0),
        viewportHeight:
          Number(data.viewportHeight || 0),
        sourceWidth:
          Number(data.sourceWidth || 0),
        sourceHeight:
          Number(data.sourceHeight || 0),
      };

      recomputeRemoteRotation();
    }

    function updateToneControls() {
      personBrightness =
        Number(brightnessRange.value) / 100;
      personSaturation =
        Number(saturationRange.value) / 100;
      personColorMatch =
        Number(colorMatchRange.value) / 100;

      brightnessValue.textContent =
        `${brightnessRange.value}%`;
      saturationValue.textContent =
        `${saturationRange.value}%`;
      colorMatchValue.textContent =
        `${colorMatchRange.value}%`;
    }

    brightnessRange.addEventListener(
      "input",
      updateToneControls
    );

    saturationRange.addEventListener(
      "input",
      updateToneControls
    );

    colorMatchRange.addEventListener(
      "input",
      updateToneControls
    );

    updateToneControls();

    rotateBtn.addEventListener(
      "click",
      () => {
        requestRotation(
          effectiveRotation() + 90
        );
      }
    );

    landscapeBtn.addEventListener(
      "click",
      resetLandscapeRotation
    );

    remoteVideo.addEventListener(
      "resize",
      recomputeRemoteRotation
    );

    try {
      setStatus("正在同時建立房間與預熱 RVM…");
      connectionPhase = "建立 PeerJS 房間";
      modelPhase = "準備下載／預熱";
      refreshProgress(
        "QR Code 會在模型與 GPU 預熱完成後出現。"
      );

      const [readyPeer] = await Promise.all([
        createPeer(),
        loadRvmModel(),
      ]);

      peer = readyPeer;

      const roomId = peer.id;
      screenRoomId = roomId;
      roomText.textContent = `Room: ${roomId}`;

      setHandshakeState([
        "房間已建立，等待手機掃描目前 QR Code。",
        `Room: ${roomId}`,
        `Build: ${BUILD_ID}`,
      ].join("\n"));

      startQrWaitingTimer();

      const mobileUrl = new URL(location.href);
      mobileUrl.search = new URLSearchParams({
        mode: "mobile",
        room: roomId,
        build: BUILD_ID,
        session: `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      }).toString();

      if (!window.QRCode) {
        throw new Error(
          "QR Code 函式庫尚未載入。"
        );
      }

      const qrTarget = $("#qrCode");
      qrTarget.innerHTML = "";

      currentMobileUrl =
        mobileUrl.toString();

      new QRCode(qrTarget, {
        text: currentMobileUrl,
        width: 260,
        height: 260,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });

      connectionPhase = "等待手機";
      refreshProgress();
      setStatus("連線：等待手機");

      peer.on("connection", (connection) => {
        if (
          connection.metadata?.kind ===
          "screenSelfTest"
        ) {
          const expectedToken =
            connection.metadata?.token;

          connection.on("data", (data) => {
            if (
              !data ||
              data.type !==
                "screenSelfTestPing" ||
              data.token !== expectedToken
            ) {
              return;
            }

            connection.send({
              type: "screenSelfTestPong",
              token: expectedToken,
              receivedAt: Date.now(),
            });
          });

          return;
        }

        mobileDataConnection?.close();
        mobileDataConnection = connection;

        setHandshakeState(
          "已收到手機資料連線，正在確認房間與版本…"
        );

        connection.on("data", (data) => {
          if (!data || typeof data !== "object") {
            return;
          }

          if (data.type === "mobileHello") {
            mobileHelloReceived = true;
            clearTimeout(qrWaitingTimer);

            const roomMatches =
              data.room === screenRoomId;
            const buildMatches =
              data.build === BUILD_ID;

            setHandshakeState([
              "手機已連入此房間。",
              `手機 Peer: ${data.peerId || "?"}`,
              `Room: ${data.room || "?"} ${
                roomMatches ? "✓" : "✗"
              }`,
              `Build: ${data.build || "?"} ${
                buildMatches ? "✓" : "✗"
              }`,
              roomMatches && buildMatches
                ? "等待手機送出相機 LIVE…"
                : "房間或版本不一致，請重新掃描目前 QR Code。",
            ].join("\n"),
            roomMatches && buildMatches
              ? "ok"
              : "failed"
            );

            connection.send({
              type: "helloAck",
              room: screenRoomId,
              build: BUILD_ID,
              ok:
                roomMatches &&
                buildMatches,
            });
          } else if (
            data.type === "orientation"
          ) {
            applyOrientationMessage(data);
          } else if (
            data.type === "rotateRelative"
          ) {
            requestRotation(
              effectiveRotation() +
                Number(data.degrees || 90)
            );
          } else if (
            data.type === "senderDiagnostic"
          ) {
            lastSenderDiagnosticText =
              data.text || "";
          } else if (data.type === "capture") {
            void captureHighQualityPhoto(
              connection
            );
          }
        });

        connection.on("open", () => {
          requestRetryBtn.disabled = false;

          connection.send({
            type: "screenReady",
            build: BUILD_ID,
            room: screenRoomId,
          });
        });

        connection.on("close", () => {
          requestRetryBtn.disabled = true;
        });
      });

      peer.on("call", (call) => {
        activeCall?.close();
        activeCall = call;
        mediaCallAcknowledged = true;

        setHandshakeState([
          "手機媒體通話已到達大螢幕。",
          "正在建立 WebRTC 影片路徑…",
        ].join("\n"), "ok");

        mobileDataConnection?.send?.({
          type: "mediaCallReceived",
          build: BUILD_ID,
          room: screenRoomId,
        });

        mirrorInput =
          call.metadata?.facingMode === "user";

        mobileOrientation = {
          portrait:
            Number(call.metadata?.viewportHeight || 0) >=
            Number(call.metadata?.viewportWidth || 0),
          angle:
            Number(call.metadata?.orientationAngle || 0),
          viewportWidth:
            Number(call.metadata?.viewportWidth || 0),
          viewportHeight:
            Number(call.metadata?.viewportHeight || 0),
          sourceWidth:
            Number(call.metadata?.sourceWidth || 0),
          sourceHeight:
            Number(call.metadata?.sourceHeight || 0),
        };

        remoteRotationDegrees = 0;

        connectionPhase = "正在接收手機 LIVE";
        refreshProgress();
        setStatus("連線：正在接收手機 LIVE…");
        call.answer();
        void startScreenRtcDiagnostics(call);

        call.on("stream", async (stream) => {
          mediaStreamReceived = true;
          clearTimeout(mediaArrivalTimer);

          setHandshakeState([
            "手機 LIVE 影片已到達。",
            "接下來若人物出現慢，才是 RVM／GPU 效能。",
          ].join("\n"), "ok");
          mediaArrivalTimer = null;

          stopInference();

          remoteVideo.srcObject = stream;

          try {
            await remoteVideo.play();

            if (!defaultLandscapeApplied) {
              manualRotationOverride =
                landscapeRotationForVideo();
              defaultLandscapeApplied = true;
              disposeCachedTensors();
              resetRvmState();
            }

            captureBtn.disabled = false;
            frameBtn.disabled = false;
            applyFrameTransform();

            connectionPhase = "手機 LIVE 已接收";
            streamReceivedAt = performance.now();
            modelPhase = model
              ? "模型已載入，準備第一張畫面"
              : "模型仍在下載／初始化";
            refreshProgress(
              "目前先顯示未去背的手機 LIVE 畫面。"
            );

            resetRvmState();
            setStatus([
              "手機 LIVE 已收到",
              `影片：${remoteVideo.videoWidth || "?"}×${
                remoteVideo.videoHeight || "?"
              }`,
              "等待 RVM 第一張去背畫面…",
            ]);

            watchdogTimer = setTimeout(() => {
              if (firstRvmFrameRendered) return;

              setProgress([
                "手機 LIVE 正常，但 RVM 尚未完成第一張畫面。",
                "這不是還在錄影；目前是模型推論過慢或模型載入失敗。",
                "已保留手機 LIVE 畫面，請先改用「官方起始 640」。",
                "此警告只會用於首次連線，不會因旋轉按鈕重新計時。",
              ].join("\n"), "warning");
            }, 30000);

            void inferenceLoop();
          } catch (error) {
            showError(
              error,
              "#errorBox",
              "大螢幕無法播放手機影片"
            );
          }
        });

        call.on("close", () => {
          stopRtcDiagnostics();
          stopInference();
          remoteVideo.srcObject = null;
          captureBtn.disabled = true;
          frameBtn.disabled = true;
          setFrameEditing(false);
          setStatus("連線：手機已離線");
        });

        call.on("error", (error) => {
          stopRtcDiagnostics();
          stopInference();
          showError(
            error,
            "#errorBox",
            "WebRTC 通話錯誤"
          );
          setStatus("連線：failed");
        });
      });

      peer.on("disconnected", () => {
        setStatus("PeerJS：重新連接…");

        try {
          peer.reconnect();
        } catch (error) {
          showError(
            error,
            "#errorBox",
            "PeerJS 重新連線失敗"
          );
        }
      });

      peer.on("error", (error) => {
        showError(
          error,
          "#errorBox",
          "PeerJS 錯誤"
        );
      });
    } catch (error) {
      setStatus("初始化：failed");
      showError(
        error,
        "#errorBox",
        "大螢幕初始化失敗"
      );
    }

    window.addEventListener(
      "beforeunload",
      () => {
        clearTimeout(qrWaitingTimer);
        cancelAnimationFrame(fitRaf);
        compositionResizeObserver?.disconnect();
        stopRtcDiagnostics();
        stopInference();
        activeCall?.close();
        mobileDataConnection?.close();
        peer?.destroy();
        model?.dispose?.();
        if (latestPhotoUrl) {
          URL.revokeObjectURL(latestPhotoUrl);
        }
        backgroundTensor?.dispose();
        downsampleTensor?.dispose();
        paletteMeanTensor?.dispose();
        paletteStdTensor?.dispose();
      }
    );
  }

  function renderMobile() {
    const info = browserInfo();

    app.innerHTML = `
      <section class="mobile-stage">
        <video
          id="cameraVideo"
          autoplay
          playsinline
          muted
        ></video>

        <div class="mobile-shade"></div>

        <div class="mobile-toolbar">
          <div class="mobile-buttons">
            <button id="switchBtn" disabled>
              切換鏡頭
            </button>
            <button
              class="rotate-force"
              id="mobileRotateBtn"
              disabled
            >
              旋轉影像 90°
            </button>
            <button id="mobileCaptureBtn" disabled>
              拍照
            </button>
          </div>

          <div class="mobile-status" id="mobileStatus">
            尚未開啟相機
          </div>
        </div>

        <div class="handshake-badge" id="mobileHandshake">
          正在確認大螢幕房間…
        </div>

        <details class="mobile-diagnostic-panel" id="mobileDiagnosticPanel">
          <summary>LIVE 連線檢測</summary>

          <div class="mobile-camera-select">
            <label for="liveCameraDeviceSelect">
              目前相機來源
            </label>
            <select id="liveCameraDeviceSelect">
              <option value="auto:user">
                自動前鏡頭
              </option>
              <option value="auto:environment">
                自動後鏡頭主鏡
              </option>
            </select>
          </div>

          <pre id="mobileDiagnostics">尚未建立相機與 WebRTC。</pre>
          <div class="diagnostic-actions">
            <button id="mobileRetryLiveBtn" disabled>
              重新傳送 LIVE
            </button>
            <button id="mobileCopyDiagnosticsBtn">
              複製檢測
            </button>
          </div>
        </details>

        <section id="startLayer">
          <div class="panel">
            <h2>手機相機</h2>

            <p>
              手機只傳送正常相機影片，不在手機執行人物去背。
              人物去背與時間穩定由大螢幕端 RVM 執行。
            </p>

            <div class="actions">
              <button
                class="primary"
                id="startBtn"
                type="button"
              >
                開啟相機
              </button>
            </div>

            <p
              class="start-status"
              id="startStatus"
            >
              等待按下「開啟相機」
            </p>

            ${
              info.isLine
                ? `
                  <div class="warning">
                    偵測到 LINE 內建瀏覽器。
                    請改用系統 Chrome、Samsung Internet
                    或 Safari。
                  </div>`
                : ""
            }

            <div
              class="error-box hidden"
              id="errorBox"
            ></div>

            <div class="camera-preflight" id="cameraPreflight">
              正在檢查相機權限與裝置…
            </div>

            <div class="mobile-camera-select">
              <label for="cameraDeviceSelect">
                相機來源
              </label>
              <select id="cameraDeviceSelect">
                <option value="auto:user">
                  自動前鏡頭
                </option>
                <option value="auto:environment">
                  自動後鏡頭主鏡
                </option>
              </select>
            </div>

            <div class="camera-quality-report" id="cameraQualityReport">
              尚未取得相機實際畫質。
            </div>

            <div class="camera-help-actions">
              <button id="simpleCameraBtn" type="button">
                最簡單模式重試
              </button>
              <button id="reloadMobileBtn" type="button">
                重新載入手機頁面
              </button>
            </div>

            <div class="debug-box">
build: ${BUILD_ID}
secureContext: ${info.secure}
getUserMedia: ${info.getUserMedia}
room: ${room || "(未指定)"}
mobile processing: none
            </div>
          </div>
        </section>
      </section>`;

    const video = $("#cameraVideo");
    const startLayer = $("#startLayer");
    const startBtn = $("#startBtn");
    const switchBtn = $("#switchBtn");
    const mobileRotateBtn = $("#mobileRotateBtn");
    const mobileCaptureBtn = $("#mobileCaptureBtn");
    const mobileHandshake = $("#mobileHandshake");
    const mobileDiagnosticPanel = $("#mobileDiagnosticPanel");
    const mobileDiagnostics = $("#mobileDiagnostics");
    const mobileRetryLiveBtn = $("#mobileRetryLiveBtn");
    const mobileCopyDiagnosticsBtn = $("#mobileCopyDiagnosticsBtn");
    const cameraPreflight = $("#cameraPreflight");
    const cameraDeviceSelect = $("#cameraDeviceSelect");
    const liveCameraDeviceSelect = $("#liveCameraDeviceSelect");
    const cameraQualityReport = $("#cameraQualityReport");
    const simpleCameraBtn = $("#simpleCameraBtn");
    const reloadMobileBtn = $("#reloadMobileBtn");
    const status = $("#mobileStatus");
    const startStatus = $("#startStatus");

    let stream = null;
    let peer = null;
    let call = null;
    let dataConnection = null;
    let dataConnectionPromise = null;
    let dataConnectionGeneration = 0;
    let facingMode = "user";
    let starting = false;
    let orientationTimer = null;
    let mobileRtcTimer = null;
    let mobileCallStartedAt = 0;
    let latestMobileDiagnosticText = "";
    let mediaAttempt = 0;
    let screenHandshakeReady = false;
    let mediaCallAckTimer = null;
    let automaticMediaRetryUsed = false;
    let cameraRequestGeneration = 0;
    let forceSimpleCameraMode = false;
    let latestCameraPreflight = "";
    let cameraPreviewReady = false;
    let availableVideoDevices = [];
    let selectedCameraDeviceId = "";
    let selectedCameraMode = "auto:user";
    let lastCameraSettings = {};
    let lastCameraCapabilities = {};
    let senderQualitySummary = "尚未設定";

    function setStatus(message) {
      status.textContent = message;
      startStatus.textContent = message;
    }


    function setMobileHandshake(
      text,
      level = "normal"
    ) {
      mobileHandshake.textContent = text;
      mobileHandshake.classList.toggle(
        "ok",
        level === "ok"
      );
      mobileHandshake.classList.toggle(
        "warning",
        level === "warning"
      );
      mobileHandshake.classList.toggle(
        "failed",
        level === "failed"
      );
    }

    function setMobileDiagnostic(text) {
      latestMobileDiagnosticText = text;
      mobileDiagnostics.textContent = text;

      if (dataConnection?.open) {
        dataConnection.send({
          type: "senderDiagnostic",
          text,
        });
      }
    }

    function stopMobileRtcDiagnostics() {
      clearInterval(mobileRtcTimer);
      mobileRtcTimer = null;
    }

    async function startMobileRtcDiagnostics(
      mediaConnection
    ) {
      stopMobileRtcDiagnostics();
      mobileCallStartedAt =
        performance.now();

      setMobileDiagnostic(
        "正在取得手機端底層 RTCPeerConnection…"
      );

      const pc = await waitForPeerConnection(
        mediaConnection
      );

      if (!pc) {
        setMobileDiagnostic(
          "無法讀取底層 RTCPeerConnection。可按「重新傳送 LIVE」重新建立媒體通話。"
        );
        return;
      }

      const refresh = async () => {
        try {
          const elapsedSeconds =
            (
              performance.now() -
              mobileCallStartedAt
            ) / 1000;

          const diagnostic =
            await collectRtcDiagnostics(
              pc,
              "outbound"
            );

          const diagnosis = diagnoseRtc(
            diagnostic,
            {
              elapsedSeconds,
              streamReceived: Boolean(
                diagnostic.media &&
                diagnostic.media.frames > 0
              ),
              role: "mobile",
            }
          );

          const track =
            stream?.getVideoTracks?.()[0];
          const settings =
            track?.getSettings?.() || {};

          setMobileDiagnostic(
            formatRtcDiagnostics({
              title:
                "手機 WebRTC 傳送端",
              diagnostic,
              diagnosis,
              elapsedSeconds,
              extraLines: [
                `傳送嘗試：${mediaAttempt}`,
                `camera track: ${
                  track?.readyState || "無"
                }｜enabled ${
                  track?.enabled ?? "?"
                }｜muted ${
                  track?.muted ?? "?"
                }`,
                `camera settings: ${
                  settings.width || "?"
                }×${
                  settings.height || "?"
                } @ ${
                  settings.frameRate || "?"
                } fps`,
                `資料通道: ${
                  dataConnection?.open
                    ? "已連線"
                    : "未連線"
                }`,
              ],
            })
          );
        } catch (error) {
          setMobileDiagnostic(
            `讀取手機 WebRTC stats 失敗：${
              error?.message || error
            }`
          );
        }
      };

      [
        "connectionstatechange",
        "iceconnectionstatechange",
        "icegatheringstatechange",
        "signalingstatechange",
      ].forEach((eventName) => {
        pc.addEventListener(
          eventName,
          () => void refresh()
        );
      });

      await refresh();

      mobileRtcTimer =
        setInterval(
          () => void refresh(),
          1000
        );
    }

    mobileRetryLiveBtn.addEventListener(
      "click",
      async () => {
        mobileRetryLiveBtn.disabled = true;
        setStatus(
          "正在重新建立媒體通話；相機不會重開…"
        );

        try {
          if (
            !dataConnection?.open ||
            !screenHandshakeReady
          ) {
            await ensureDataConnection({
              forceReconnect: true,
            });
          }

          await callScreen();
        } catch (error) {
          showError(
            error,
            "#errorBox",
            "重新傳送 LIVE 失敗"
          );
        } finally {
          mobileRetryLiveBtn.disabled =
            !stream;
        }
      }
    );

    mobileCopyDiagnosticsBtn.addEventListener(
      "click",
      async () => {
        const copied = await copyText(
          latestMobileDiagnosticText
        );

        mobileCopyDiagnosticsBtn.textContent =
          copied
            ? "已複製"
            : "複製失敗";

        setTimeout(() => {
          mobileCopyDiagnosticsBtn.textContent =
            "複製檢測";
        }, 1500);
      }
    );

    function updatePreviewMirror() {
      video.classList.toggle(
        "selfie",
        facingMode === "user"
      );
    }

    function getOrientationAngle() {
      const raw =
        screen.orientation?.angle ??
        window.orientation ??
        0;

      return (
        (Number(raw) % 360) + 360
      ) % 360;
    }

    function getRequiredRotation() {
      const viewportPortrait =
        innerHeight >= innerWidth;
      const videoPortrait =
        video.videoHeight >= video.videoWidth;

      /*
        若 video frame 已經跟 viewport 同方向，不補轉。
        若瀏覽器仍送出舊方向尺寸，再依裝置角度補 ±90°。
      */
      if (viewportPortrait === videoPortrait) {
        return 0;
      }

      return getOrientationAngle() === 270
        ? -90
        : 90;
    }

    function orientationPayload() {
      return {
        type: "orientation",
        portrait: innerHeight >= innerWidth,
        angle: getOrientationAngle(),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        sourceWidth: video.videoWidth,
        sourceHeight: video.videoHeight,
      };
    }

    function sendOrientation() {
      if (
        dataConnection?.open
      ) {
        dataConnection.send(
          orientationPayload()
        );
      }
    }

    function setCameraPreflight(
      text,
      level = "normal"
    ) {
      latestCameraPreflight = text;
      cameraPreflight.textContent = text;
      cameraPreflight.classList.toggle(
        "ok",
        level === "ok"
      );
      cameraPreflight.classList.toggle(
        "warning",
        level === "warning"
      );
      cameraPreflight.classList.toggle(
        "failed",
        level === "failed"
      );
    }

    async function cameraPermissionState() {
      try {
        if (!navigator.permissions?.query) {
          return "permissions API 不支援";
        }

        const result =
          await navigator.permissions.query({
            name: "camera",
          });

        return result.state || "unknown";
      } catch (_) {
        return "瀏覽器不提供 camera 權限查詢";
      }
    }

    function cameraLabelText(device) {
      return String(
        device?.label || ""
      ).trim();
    }

    function isFrontCameraLabel(label) {
      return /front|user|前鏡|前置|自拍|facing front/i.test(
        label
      );
    }

    function isRearCameraLabel(label) {
      return /back|rear|environment|後鏡|后镜|後置|背面|facing back/i.test(
        label
      );
    }

    function cameraDeviceScore(
      device,
      requestedFacing
    ) {
      const label =
        cameraLabelText(device);
      let score = 0;

      if (requestedFacing === "environment") {
        if (isRearCameraLabel(label)) score += 120;
        if (isFrontCameraLabel(label)) score -= 250;

        /*
          多鏡頭手機常把超廣角、微距或景深鏡頭也暴露給瀏覽器。
          這些鏡頭在室內可能很暗或解析度較低。
        */
        if (/main|primary|standard|default|主鏡|主摄/i.test(label)) {
          score += 45;
        }

        if (/ultra|ultrawide|超廣|超广|macro|微距|tele|望遠|长焦|depth|景深/i.test(label)) {
          score -= 55;
        }

        /*
          Samsung / Android 常見的 camera2 0 通常是主要後鏡，
          但仍保留手動選擇器以處理例外。
        */
        if (/camera2[\s_-]*0\b/i.test(label)) {
          score += 30;
        }
      } else {
        if (isFrontCameraLabel(label)) score += 120;
        if (isRearCameraLabel(label)) score -= 250;
        if (/camera2[\s_-]*1\b/i.test(label)) {
          score += 20;
        }
      }

      if (label) score += 5;
      return score;
    }

    function chooseBestCameraDevice(
      devices,
      requestedFacing
    ) {
      const candidates = devices
        .filter(
          (device) =>
            device.kind === "videoinput"
        )
        .map((device) => ({
          device,
          score: cameraDeviceScore(
            device,
            requestedFacing
          ),
        }))
        .sort(
          (a, b) =>
            b.score - a.score
        );

      return candidates[0]?.device || null;
    }

    function setCameraQualityReport(
      text,
      warning = false
    ) {
      cameraQualityReport.textContent = text;
      cameraQualityReport.classList.toggle(
        "warning",
        warning
      );
    }

    function syncCameraSelectors(value) {
      selectedCameraMode = value;
      cameraDeviceSelect.value = value;
      liveCameraDeviceSelect.value = value;
    }

    function rebuildCameraSelectors() {
      const currentValue =
        selectedCameraMode;

      const buildOptions = (select) => {
        select.innerHTML = "";

        const front =
          document.createElement("option");
        front.value = "auto:user";
        front.textContent = "自動前鏡頭";
        select.appendChild(front);

        const rear =
          document.createElement("option");
        rear.value =
          "auto:environment";
        rear.textContent =
          "自動後鏡頭主鏡";
        select.appendChild(rear);

        availableVideoDevices.forEach(
          (device, index) => {
            const option =
              document.createElement("option");

            option.value =
              `device:${device.deviceId}`;

            option.textContent =
              cameraLabelText(device) ||
              `相機 ${index + 1}`;

            select.appendChild(option);
          }
        );

        if (
          Array.from(select.options).some(
            (option) =>
              option.value === currentValue
          )
        ) {
          select.value = currentValue;
        } else {
          select.value =
            facingMode === "environment"
              ? "auto:environment"
              : "auto:user";
        }
      };

      buildOptions(cameraDeviceSelect);
      buildOptions(liveCameraDeviceSelect);
    }

    function selectedDeviceFromMode() {
      if (
        selectedCameraMode.startsWith(
          "device:"
        )
      ) {
        const id =
          selectedCameraMode.slice(
            "device:".length
          );

        return availableVideoDevices.find(
          (device) =>
            device.deviceId === id
        ) || null;
      }

      return chooseBestCameraDevice(
        availableVideoDevices,
        facingMode
      );
    }

    function inferFacingFromDevice(device) {
      const label =
        cameraLabelText(device);

      if (isRearCameraLabel(label)) {
        return "environment";
      }

      if (isFrontCameraLabel(label)) {
        return "user";
      }

      return facingMode;
    }

    function desiredCameraQuality() {
      if (facingMode === "environment") {
        return {
          width: 1920,
          height: 1080,
          maxBitrate: 4_500_000,
        };
      }

      return {
        width: 1280,
        height: 720,
        maxBitrate: 3_000_000,
      };
    }

    function formatCapabilityRange(value) {
      if (
        !value ||
        typeof value !== "object"
      ) {
        return "?";
      }

      return `${value.min ?? "?"}–${
        value.max ?? "?"
      }`;
    }

    function updateCameraQualityDisplay(
      track,
      label = ""
    ) {
      const settings =
        track?.getSettings?.() || {};
      const capabilities =
        track?.getCapabilities?.() || {};

      lastCameraSettings = settings;
      lastCameraCapabilities =
        capabilities;

      const warning =
        facingMode === "environment" &&
        Number(settings.width || 0) < 1000;

      setCameraQualityReport([
        `鏡頭：${
          label ||
          track?.label ||
          "(瀏覽器未提供名稱)"
        }`,
        `實際：${settings.width || "?"}×${
          settings.height || "?"
        } @ ${
          settings.frameRate || "?"
        } fps`,
        `facingMode：${
          settings.facingMode || facingMode
        }`,
        `resizeMode：${
          settings.resizeMode || "?"
        }`,
        `能力 width：${formatCapabilityRange(
          capabilities.width
        )}`,
        `能力 height：${formatCapabilityRange(
          capabilities.height
        )}`,
        `WebRTC：${senderQualitySummary}`,
        warning
          ? "警告：後鏡頭實際寬度低於 1000px，可能選到副鏡頭或瀏覽器降畫質。請從相機來源改選其他後鏡頭。"
          : "",
      ].filter(Boolean).join("\n"), warning);
    }

    async function inspectCameraEnvironment() {
      const permission =
        await cameraPermissionState();

      let devices = [];
      let enumerateError = "";

      try {
        devices =
          await navigator.mediaDevices
            ?.enumerateDevices?.() || [];
      } catch (error) {
        enumerateError =
          error?.message || String(error);
      }

      const videoDevices = devices.filter(
        (device) =>
          device.kind === "videoinput"
      );

      const supported =
        navigator.mediaDevices
          ?.getSupportedConstraints?.() || {};

      const text = [
        "手機相機預檢",
        `permission: ${permission}`,
        `document: ${document.visibilityState}`,
        `secureContext: ${window.isSecureContext}`,
        `video devices: ${videoDevices.length}`,
        `labels visible: ${
          videoDevices.filter(
            (device) => device.label
          ).length
        }`,
        `facingMode constraint: ${
          supported.facingMode === true
        }`,
        `width constraint: ${
          supported.width === true
        }`,
        `height constraint: ${
          supported.height === true
        }`,
        enumerateError
          ? `enumerateDevices error: ${enumerateError}`
          : "",
      ].filter(Boolean).join("\n");

      setCameraPreflight(
        text,
        permission === "denied"
          ? "failed"
          : permission === "prompt"
            ? "warning"
            : "normal"
      );

      availableVideoDevices =
        videoDevices;

      rebuildCameraSelectors();

      return {
        permission,
        videoDevices,
        supported,
      };
    }

    function cameraTimeoutError(
      label,
      timeoutMs
    ) {
      const error = new Error(
        `${label} 超過 ${
          timeoutMs / 1000
        } 秒仍沒有回應。可能是相機權限視窗未處理、瀏覽器卡住，或相機正被其他 App 使用。`
      );

      error.name = "CameraTimeoutError";
      return error;
    }

    async function getUserMediaWithTimeout(
      constraints,
      label,
      timeoutMs = 12000
    ) {
      const generation =
        ++cameraRequestGeneration;

      let timedOut = false;
      let timer = null;

      const request =
        navigator.mediaDevices.getUserMedia(
          constraints
        );

      request.then((lateStream) => {
        if (
          timedOut ||
          generation !==
            cameraRequestGeneration
        ) {
          lateStream
            .getTracks()
            .forEach(
              (track) => track.stop()
            );
        }
      }).catch(() => {
        // The awaited race handles this rejection.
      });

      const timeout = new Promise(
        (_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(
              cameraTimeoutError(
                label,
                timeoutMs
              )
            );
          }, timeoutMs);
        }
      );

      try {
        return await Promise.race([
          request,
          timeout,
        ]);
      } finally {
        clearTimeout(timer);
      }
    }

    async function waitForVideoPlayback(
      timeoutMs = 8000
    ) {
      const playPromise = video.play();

      const timeout = new Promise(
        (_, reject) => {
          setTimeout(() => {
            const error = new Error(
              `相機權限已取得，但影片預覽 ${timeoutMs / 1000} 秒內沒有開始播放。`
            );
            error.name =
              "VideoPlaybackTimeout";
            reject(error);
          }, timeoutMs);
        }
      );

      await Promise.race([
        playPromise,
        timeout,
      ]);
    }

    async function acquireCamera() {
      if (!window.isSecureContext) {
        const error = new Error(
          "相機必須使用 HTTPS 或 localhost。"
        );
        error.name = "SecurityError";
        throw error;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        const error = new Error(
          "此瀏覽器不支援 getUserMedia。"
        );
        error.name = "NotSupportedError";
        throw error;
      }

      const environment =
        await inspectCameraEnvironment();

      if (
        environment.permission === "denied"
      ) {
        const error = new Error(
          "此網站的相機權限已被拒絕。請點網址列左側鎖頭／網站設定，將相機改成允許，再重新載入。"
        );
        error.name = "NotAllowedError";
        throw error;
      }

      const selectedDevice =
        selectedDeviceFromMode();

      if (selectedDevice) {
        facingMode =
          inferFacingFromDevice(
            selectedDevice
          );
        selectedCameraDeviceId =
          selectedDevice.deviceId;
      } else {
        selectedCameraDeviceId = "";
      }

      const desired =
        desiredCameraQuality();

      /*
        已經取得過權限、有 deviceId 時，直接指定鏡頭。
        第一次尚未取得權限時，先以 facingMode 開啟，
        權限成功後再列出鏡頭供手動修正。
      */
      let constraints;

      if (
        !forceSimpleCameraMode &&
        selectedCameraDeviceId
      ) {
        constraints = {
          audio: false,
          video: {
            deviceId: {
              exact:
                selectedCameraDeviceId,
            },
            width: {
              ideal: desired.width,
            },
            height: {
              ideal: desired.height,
            },
            aspectRatio: {
              ideal: 16 / 9,
            },
            frameRate: {
              ideal: 30,
              max: 30,
            },
            resizeMode: {
              ideal: "none",
            },
          },
        };
      } else if (forceSimpleCameraMode) {
        constraints = {
          audio: false,
          video: true,
        };
      } else {
        constraints = {
          audio: false,
          video: {
            facingMode: {
              ideal: facingMode,
            },
          },
        };
      }

      setStatus(
        environment.permission === "prompt"
          ? "請處理瀏覽器的相機權限提示…"
          : "正在取得指定相機…"
      );

      const cameraStream =
        await getUserMediaWithTimeout(
          constraints,
          "getUserMedia",
          12000
        );

      let track =
        cameraStream.getVideoTracks()[0];

      if (!track) {
        cameraStream
          .getTracks()
          .forEach(
            (item) => item.stop()
          );

        throw new Error(
          "瀏覽器回傳的 MediaStream 沒有 video track。"
        );
      }

      if ("contentHint" in track) {
        track.contentHint = "detail";
      }

      /*
        如果第一次權限成功後才取得相機標籤，
        再判斷瀏覽器是否選到非主鏡；必要時用 deviceId 重開。
      */
      const refreshed =
        await inspectCameraEnvironment();

      const bestDevice =
        selectedDeviceFromMode();

      const currentDeviceId =
        track.getSettings?.()
          ?.deviceId || "";

      if (
        !forceSimpleCameraMode &&
        bestDevice?.deviceId &&
        bestDevice.deviceId !==
          currentDeviceId
      ) {
        cameraStream
          .getTracks()
          .forEach(
            (item) => item.stop()
          );

        selectedCameraDeviceId =
          bestDevice.deviceId;
        facingMode =
          inferFacingFromDevice(
            bestDevice
          );

        const reopened =
          await getUserMediaWithTimeout(
            {
              audio: false,
              video: {
                deviceId: {
                  exact:
                    bestDevice.deviceId,
                },
                width: {
                  ideal: desired.width,
                },
                height: {
                  ideal: desired.height,
                },
                aspectRatio: {
                  ideal: 16 / 9,
                },
                frameRate: {
                  ideal: 30,
                  max: 30,
                },
                resizeMode: {
                  ideal: "none",
                },
              },
            },
            "指定主鏡頭",
            12000
          );

        track =
          reopened.getVideoTracks()[0];

        if ("contentHint" in track) {
          track.contentHint = "detail";
        }

        updateCameraQualityDisplay(
          track,
          cameraLabelText(bestDevice)
        );

        return reopened;
      }

      /*
        對同一鏡頭要求較高解析度。
        applyConstraints 失敗仍保留相機，不阻止 LIVE。
      */
      if (
        !forceSimpleCameraMode &&
        track.applyConstraints
      ) {
        try {
          const capabilities =
            track.getCapabilities?.() || {};

          const targetWidth = Math.min(
            desired.width,
            Number(
              capabilities.width?.max ||
              desired.width
            )
          );

          const targetHeight = Math.min(
            desired.height,
            Number(
              capabilities.height?.max ||
              desired.height
            )
          );

          await Promise.race([
            track.applyConstraints({
              width: {
                ideal: targetWidth,
              },
              height: {
                ideal: targetHeight,
              },
              aspectRatio: {
                ideal: 16 / 9,
              },
              frameRate: {
                ideal: 30,
                max: 30,
              },
              resizeMode: {
                ideal: "none",
              },
            }),
            new Promise((_, reject) => {
              setTimeout(() => {
                reject(
                  new Error(
                    "applyConstraints timeout"
                  )
                );
              }, 5000);
            }),
          ]);
        } catch (error) {
          console.warn(
            "Camera quality constraints skipped.",
            error
          );
        }
      }

      updateCameraQualityDisplay(
        track,
        cameraLabelText(bestDevice) ||
          track.label
      );

      return cameraStream;
    }

    async function ensurePeer() {
      if (peer && !peer.destroyed) {
        return peer;
      }

      peer = await createPeer();

      peer.on("error", (error) => {
        showError(
          error,
          "#errorBox",
          "手機 PeerJS 錯誤"
        );
      });

      return peer;
    }

    function handleScreenDataMessage(
      connection,
      data
    ) {
      if (!data || typeof data !== "object") {
        return;
      }

      if (data.type === "captureStatus") {
        if (data.status === "processing") {
          setStatus(
            "大螢幕正在保存目前 LIVE 畫面…"
          );
        } else if (data.status === "burst") {
          setStatus("正在產生照片…");
        } else if (data.status === "ready") {
          setStatus(
            "照片精修完成，可在大螢幕下載"
          );
        } else if (data.status === "error") {
          setStatus(
            `照片精修失敗：${
              data.message || "未知錯誤"
            }`
          );
        }
      } else if (
        data.type === "rotationApplied"
      ) {
        setStatus([
          "大螢幕已套用方向",
          `目前角度：${data.rotation}°`,
          "手機 LIVE 串流維持原連線。",
        ].join("\n"));
      } else if (
        data.type === "mediaCallReceived"
      ) {
        clearTimeout(mediaCallAckTimer);

        setMobileHandshake([
          "大螢幕已收到媒體通話。",
          "正在建立 WebRTC 影片路徑…",
        ].join("\n"), "ok");
      } else if (
        data.type === "retryMedia"
      ) {
        setStatus(
          "大螢幕要求重新傳送 LIVE…"
        );

        void callScreen().catch((error) => {
          showError(
            error,
            "#errorBox",
            "大螢幕要求重傳失敗"
          );
        });
      }
    }

    async function ensureDataConnection({
      forceReconnect = false,
    } = {}) {
      if (!room) {
        throw new Error(
          "手機網址沒有大螢幕 Room ID。"
        );
      }

      await ensurePeer();

      if (
        !forceReconnect &&
        dataConnection?.open &&
        screenHandshakeReady
      ) {
        return dataConnection;
      }

      /*
        頁面預連線與按下相機會同時呼叫這裡。
        所有呼叫必須等待同一個 Promise，不能互相關掉連線。
      */
      if (
        !forceReconnect &&
        dataConnectionPromise
      ) {
        return dataConnectionPromise;
      }

      const generation =
        ++dataConnectionGeneration;

      const attempt = (async () => {
        if (forceReconnect) {
          try {
            dataConnection?.close();
          } catch (_) {
            // no-op
          }
        }

        screenHandshakeReady = false;

        setMobileHandshake([
          "正在連接大螢幕房間…",
          `Room: ${room}`,
          `Build: ${BUILD_ID}`,
        ].join("\n"));

        const connection = peer.connect(
          room,
          {
            reliable: true,
            serialization: "json",
          }
        );

        dataConnection = connection;

        await new Promise(
          (resolve, reject) => {
            const timer = setTimeout(() => {
              reject(
                new Error(
                  "8 秒內無法建立大螢幕資料連線"
                )
              );
            }, 8000);

            connection.once("open", () => {
              clearTimeout(timer);
              resolve();
            });

            connection.once(
              "error",
              (error) => {
                clearTimeout(timer);
                reject(
                  error instanceof Error
                    ? error
                    : new Error(
                        String(
                          error?.message ||
                          error ||
                          "PeerJS DataConnection error"
                        )
                      )
                );
              }
            );
          }
        );

        if (
          generation !==
          dataConnectionGeneration
        ) {
          throw new Error(
            "此連線已被較新的連線取代。"
          );
        }

        const ack = await new Promise(
          (resolve, reject) => {
            const timer = setTimeout(() => {
              connection.off?.(
                "data",
                handler
              );

              reject(
                new Error(
                  "已連上 PeerJS，但大螢幕 6 秒內未確認此房間"
                )
              );
            }, 6000);

            const handler = (data) => {
              if (
                !data ||
                data.type !== "helloAck"
              ) {
                return;
              }

              clearTimeout(timer);
              connection.off?.(
                "data",
                handler
              );

              if (!data.ok) {
                reject(
                  new Error(
                    "大螢幕回報 Room 或版本不一致"
                  )
                );
                return;
              }

              resolve(data);
            };

            connection.on(
              "data",
              handler
            );

            connection.send({
              type: "mobileHello",
              peerId: peer.id,
              room,
              build: BUILD_ID,
              session:
                params.get("session") || "",
              userAgent:
                navigator.userAgent,
            });
          }
        );

        if (
          generation !==
          dataConnectionGeneration
        ) {
          throw new Error(
            "房間確認完成時，此連線已被取代。"
          );
        }

        screenHandshakeReady = true;
        mobileCaptureBtn.disabled = false;
        mobileRotateBtn.disabled = false;

        setMobileHandshake([
          "已確認大螢幕房間。",
          `Room: ${ack.room}`,
          `Build: ${ack.build}`,
          "可以送出相機 LIVE。",
        ].join("\n"), "ok");

        connection.on(
          "data",
          (data) => {
            handleScreenDataMessage(
              connection,
              data
            );
          }
        );

        connection.on("close", () => {
          if (
            dataConnection !== connection
          ) {
            return;
          }

          screenHandshakeReady = false;
          mobileCaptureBtn.disabled = true;
          mobileRotateBtn.disabled = true;

          setMobileHandshake(
            "大螢幕資料連線已中斷，請按重新傳送 LIVE；仍失敗再重新掃描目前 QR Code。",
            "failed"
          );
        });

        sendOrientation();
        return connection;
      })();

      dataConnectionPromise = attempt;

      try {
        return await attempt;
      } catch (error) {
        if (
          dataConnectionGeneration ===
          generation
        ) {
          screenHandshakeReady = false;
        }

        throw (
          error instanceof Error
            ? error
            : new Error(
                String(
                  error?.message ||
                  error ||
                  "未知 PeerJS 握手錯誤"
                )
              )
        );
      } finally {
        if (
          dataConnectionPromise === attempt
        ) {
          dataConnectionPromise = null;
        }
      }
    }

    async function callScreen() {
      if (!room) {
        setStatus(
          "相機已開啟；網址沒有大螢幕房間"
        );
        return;
      }

      await ensurePeer();

      setStatus(
        "相機正常，正在確認大螢幕 Room…"
      );

      try {
        await ensureDataConnection();
      } catch (error) {
        const message =
          error?.message || String(error);

        setMobileHandshake([
          "相機已正常開啟，但大螢幕房間連線失敗。",
          `error: ${message}`,
          `Room: ${room}`,
          "請確認大螢幕仍開著同一個 Room，或按「重新傳送 LIVE」。",
        ].join("\n"), "failed");

        throw new Error(
          `大螢幕房間連線失敗：${message}`
        );
      }

      call?.close();
      stopMobileRtcDiagnostics();
      mediaAttempt += 1;

      call = peer.call(room, stream, {
        metadata: {
          facingMode,
          build: BUILD_ID,
          rotationDegrees: getRequiredRotation(),
          orientationAngle: getOrientationAngle(),
          sourceWidth: video.videoWidth,
          sourceHeight: video.videoHeight,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
        },
      });

      if (!call) {
        throw new Error(
          "無法建立手機到大螢幕的 WebRTC 通話。"
        );
      }

      mobileRetryLiveBtn.disabled = false;
      void startMobileRtcDiagnostics(call);

      /*
        提高 WebRTC 對解析度與細節的偏好。
        這不會創造相機不存在的細節，但可避免瀏覽器太早降解析度。
      */
      void (async () => {
        try {
          const pc =
            await waitForPeerConnection(
              call,
              5000
            );

          const sender =
            pc?.getSenders?.().find(
              (item) =>
                item.track?.kind ===
                "video"
            );

          if (!sender) {
            senderQualitySummary =
              "找不到 video sender";
            return;
          }

          const params =
            sender.getParameters();

          if (!params.encodings?.length) {
            params.encodings = [{}];
          }

          const desired =
            desiredCameraQuality();

          params.encodings[0].maxBitrate =
            desired.maxBitrate;
          params.encodings[0].maxFramerate =
            30;
          params.degradationPreference =
            "maintain-resolution";

          await sender.setParameters(
            params
          );

          senderQualitySummary =
            `${Math.round(
              desired.maxBitrate /
              1_000_000
            )} Mbps｜maintain-resolution`;

          updateCameraQualityDisplay(
            stream?.getVideoTracks?.()[0],
            stream?.getVideoTracks?.()[0]
              ?.label || ""
          );
        } catch (error) {
          senderQualitySummary =
            `瀏覽器未套用：${
              error?.message ||
              error?.name ||
              "unknown"
            }`;
        }
      })();

      clearTimeout(mediaCallAckTimer);

      mediaCallAckTimer = setTimeout(() => {
        if (
          automaticMediaRetryUsed ||
          !stream
        ) {
          setMobileHandshake([
            "大螢幕沒有收到媒體通話。",
            "這不是 GPU；可能是房間過期或 PeerJS signaling 未送達。",
            "請按「重新傳送 LIVE」，仍失敗就重新掃描目前 QR Code。",
          ].join("\n"), "failed");
          return;
        }

        automaticMediaRetryUsed = true;

        setMobileHandshake([
          "大螢幕 7 秒內未確認媒體通話。",
          "正在自動重試一次，手機相機不會重開…",
        ].join("\n"), "warning");

        void callScreen().catch((error) => {
          showError(
            error,
            "#errorBox",
            "自動重傳 LIVE 失敗"
          );
        });
      }, 7000);

      call.on("close", () => {
        stopMobileRtcDiagnostics();
        setStatus("大螢幕已離線");
      });

      call.on("error", (error) => {
        stopMobileRtcDiagnostics();
        showError(
          error,
          "#errorBox",
          "手機 WebRTC 通話錯誤"
        );
        setStatus("連線：failed");
      });

      const track =
        stream.getVideoTracks()[0];
      const settings =
        track?.getSettings?.() || {};

      setStatus([
        `連線：LIVE 已送出 ${settings.width || "?"}×${
          settings.height || "?"
        }`,
        `鏡頭：${track?.label || "(未提供名稱)"}`,
        `方向補轉：${getRequiredRotation()}°`,
      ].join("\n"));
    }

    async function startOrRestartCamera({
      hideLayer = true,
    } = {}) {
      if (starting) return;
      starting = true;

      startBtn.disabled = true;
      setStatus("正在取得相機…");
      cameraPreviewReady = false;

      try {
        automaticMediaRetryUsed = false;
        clearTimeout(mediaCallAckTimer);
        call?.close();
        stream
          ?.getTracks()
          .forEach((track) => track.stop());

        stream = await acquireCamera();
        video.srcObject = stream;
        updatePreviewMirror();

        setStatus(
          "相機已取得，正在啟動手機預覽…"
        );

        await waitForVideoPlayback();
        cameraPreviewReady = true;

        switchBtn.disabled = false;
        mobileRetryLiveBtn.disabled = false;

        /*
          相機預覽成功後就先關閉啟動畫面。
          即使後面的 PeerJS 連線失敗，使用者仍能確認相機正常。
        */
        if (hideLayer) {
          startLayer.classList.add("hidden");
        }

        setStatus(
          "手機相機正常，正在連接大螢幕…"
        );

        try {
          await callScreen();
          sendOrientation();

          status.classList.remove(
            "connection-error"
          );
          cameraPreflight.classList.remove(
            "connection-failed"
          );
        } catch (error) {
          const message =
            error?.message || String(error);

          setStatus(
            `相機正常；LIVE 連線失敗：${message}`
          );

          status.classList.add(
            "connection-error"
          );
          cameraPreflight.classList.add(
            "connection-failed"
          );

          showError(
            error,
            "#errorBox",
            "大螢幕 LIVE 連線失敗"
          );
        }
      } finally {
        starting = false;
        startBtn.disabled = false;
      }
    }

    simpleCameraBtn.addEventListener(
      "click",
      async () => {
        forceSimpleCameraMode = true;
        simpleCameraBtn.disabled = true;
        simpleCameraBtn.textContent =
          "最簡單模式啟動中…";

        try {
          await startOrRestartCamera();
        } catch (error) {
          showError(
            error,
            "#errorBox",
            "最簡單相機模式失敗"
          );
        } finally {
          simpleCameraBtn.disabled = false;
          simpleCameraBtn.textContent =
            "最簡單模式重試";
        }
      }
    );

    reloadMobileBtn.addEventListener(
      "click",
      () => {
        location.reload();
      }
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (
          !document.hidden &&
          backgroundMode === "video" &&
          backgroundVideoPendingPlay
        ) {
          ensureBackgroundVideoPlayback();
        }
        void inspectCameraEnvironment();
      }
    );

    /*
      手機頁面載入後先確認 Room，不必等相機權限。
      這能把「相機卡住」和「PeerJS 連不上」分開顯示。
    */
    syncCameraSelectors(
      "auto:user"
    );

    void inspectCameraEnvironment();

    if (room) {
      void ensureDataConnection().catch(
        (error) => {
          setMobileHandshake([
            "手機尚未連上大螢幕房間。",
            `error: ${
              error?.message || error
            }`,
            "相機可以正常開啟；按下開啟相機後會沿用同一次握手。",
          ].join("\\n"), "warning");
        }
      );
    }

    startBtn.addEventListener(
      "click",
      async (event) => {
        event.preventDefault();
        startBtn.textContent = "啟動中…";

        try {
          await startOrRestartCamera();
        } catch (error) {
          showError(
            error,
            "#errorBox",
            "手機相機啟動失敗"
          );

          if (
            error?.name ===
            "CameraTimeoutError"
          ) {
            setStatus(
              "相機要求逾時，請檢查網站相機權限後重試"
            );

            setCameraPreflight([
              latestCameraPreflight,
              "",
              "判斷：getUserMedia 沒有回覆。",
              "請點網址列鎖頭／網站設定 → 相機 → 允許。",
              "也請關閉其他正在使用相機的 App。",
              "之後按「最簡單模式重試」。",
            ].join("\n"), "failed");
          } else {
            setStatus(
              `相機失敗：${
                error?.message ||
                error?.name ||
                "未知錯誤"
              }`
            );
          }

          startBtn.textContent =
            "重新開啟相機";
        }
      }
    );

    async function changeCameraSelection(
      value
    ) {
      syncCameraSelectors(value);

      if (
        value === "auto:user"
      ) {
        facingMode = "user";
        selectedCameraDeviceId = "";
      } else if (
        value === "auto:environment"
      ) {
        facingMode = "environment";
        selectedCameraDeviceId = "";
      } else if (
        value.startsWith("device:")
      ) {
        selectedCameraDeviceId =
          value.slice(
            "device:".length
          );

        const device =
          availableVideoDevices.find(
            (item) =>
              item.deviceId ===
              selectedCameraDeviceId
          );

        facingMode =
          inferFacingFromDevice(device);
      }

      forceSimpleCameraMode = false;

      if (stream) {
        await startOrRestartCamera({
          hideLayer: false,
        });
      }
    }

    cameraDeviceSelect.addEventListener(
      "change",
      () => {
        void changeCameraSelection(
          cameraDeviceSelect.value
        ).catch((error) => {
          showError(
            error,
            "#errorBox",
            "切換相機來源失敗"
          );
        });
      }
    );

    liveCameraDeviceSelect.addEventListener(
      "change",
      () => {
        void changeCameraSelection(
          liveCameraDeviceSelect.value
        ).catch((error) => {
          showError(
            error,
            "#errorBox",
            "切換相機來源失敗"
          );
        });
      }
    );

    switchBtn.addEventListener(
      "click",
      async (event) => {
        event.preventDefault();
        switchBtn.disabled = true;

        facingMode =
          facingMode === "user"
            ? "environment"
            : "user";

        selectedCameraDeviceId = "";
        forceSimpleCameraMode = false;

        syncCameraSelectors(
          facingMode === "environment"
            ? "auto:environment"
            : "auto:user"
        );

        try {
          await startOrRestartCamera({
            hideLayer: false,
          });
        } catch (error) {
          showError(
            error,
            "#errorBox",
            "切換鏡頭失敗"
          );
        } finally {
          switchBtn.disabled = false;
        }
      }
    );

    mobileRotateBtn.addEventListener(
      "click",
      () => {
        if (!dataConnection?.open) {
          setStatus(
            "旋轉控制尚未連上大螢幕"
          );
          return;
        }

        dataConnection.send({
          type: "rotateRelative",
          degrees: 90,
        });

        setStatus(
          "已要求大螢幕旋轉 90°；LIVE 不會重新連線。"
        );
      }
    );

    mobileCaptureBtn.addEventListener(
      "click",
      () => {
        if (!dataConnection?.open) {
          setStatus(
            "拍照控制尚未連上大螢幕"
          );
          return;
        }

        dataConnection.send({
          type: "capture",
        });

        setStatus(
          "已送出拍照要求，正在精修…"
        );
      }
    );

    function scheduleOrientationUpdate() {
      if (!stream) return;

      clearTimeout(orientationTimer);
      setStatus(
        "偵測到手機轉向，正在同步大螢幕…"
      );

      orientationTimer = setTimeout(
        () => {
          sendOrientation();

          setStatus([
            "手機方向已同步",
            `角度：${getOrientationAngle()}°`,
            `相機：${video.videoWidth}×${video.videoHeight}`,
          ].join("\n"));
        },
        250
      );
    }

    window.addEventListener(
      "orientationchange",
      scheduleOrientationUpdate
    );

    screen.orientation?.addEventListener?.(
      "change",
      scheduleOrientationUpdate
    );

    window.addEventListener(
      "resize",
      scheduleOrientationUpdate
    );

    window.addEventListener(
      "beforeunload",
      () => {
        clearTimeout(mediaCallAckTimer);
        stopMobileRtcDiagnostics();
        call?.close();
        dataConnection?.close();
        peer?.destroy();
        stream
          ?.getTracks()
          .forEach((track) => track.stop());
      }
    );
  }

  window.addEventListener("error", (event) => {
    console.error(
      "Unhandled window error",
      event.error || event.message
    );

    if (event.error) {
      showError(
        event.error,
        "#errorBox",
        "未捕捉的 JavaScript 錯誤"
      );
    }
  });

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      console.error(
        "Unhandled promise rejection",
        event.reason
      );

      showError(
        event.reason,
        "#errorBox",
        "未捕捉的 Promise 錯誤"
      );
    }
  );

  if (mode === "screen") {
    void renderScreen();
  } else if (mode === "mobile") {
    renderMobile();
  } else {
    renderHome();
  }
})();

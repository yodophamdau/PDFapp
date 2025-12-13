let currentTemplate = "3blocks";      // デフォルト：在留カード（画像2枚）
let currentImageBlock = null;
// ================== IndexedDB (Image Storage) ==================
const DB_NAME = "pdfAppImageDB";
const DB_VERSION = 1;
const STORE_NAME = "images";

function openImageDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveImageToDB(key, blob) {
  const db = await openImageDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadImageFromDB(key) {
  const db = await openImageDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function deleteImageFromDB(key) {
  const db = await openImageDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
  });
}

// ====== localStorage key ======
const STORAGE_KEY = "nyukokuAppState_v1";

// 単一画面のみ
const editorScreen = document.getElementById("editor-screen");

// A4全体（PDFにする要素）
const a4Page = document.getElementById("a4-page");
// 実際のレイアウトを置く中央エリア
const a4Inner = document.getElementById("a4-inner");
const a4Wrapper = document.getElementById("a4-wrapper");
// ----- Block selection highlight -----
function setActiveBlock(targetBlock) {
  if (!a4Inner) return;

  const blocks = a4Inner.querySelectorAll(".block");
  blocks.forEach((b) => b.classList.remove("is-selected"));

  if (targetBlock) {
    targetBlock.classList.add("is-selected");
  }
}

function clearActiveBlockHighlight() {
  setActiveBlock(null);
}


// toolbar関連
const backButton = document.getElementById("back-button");
const exportButton = document.getElementById("export-pdf");
const layoutToggleButton = document.getElementById("layout-toggle");

// ファイル名入力
const fileNameInput = document.getElementById("file-name");
const imageInputGallery = document.getElementById("image-input-gallery");
const imageInputCamera  = document.getElementById("image-input-camera");

// 画像ソース選択モーダル
const imageSourceModal      = document.getElementById("image-source-modal");
const imageSourceGalleryBtn = document.getElementById("image-source-gallery");
const imageSourceCameraBtn  = document.getElementById("image-source-camera");
const imageSourceCancelBtn  = document.getElementById("image-source-cancel");

// ===== Cropper elements =====
const cropModal  = document.getElementById("crop-modal");
const cropCanvas = document.getElementById("crop-canvas");
const cropStage = cropCanvas?.parentElement; // .crop-stage
const cropZoom   = document.getElementById("crop-zoom");
const cropPanY   = document.getElementById("crop-pan-y");
const cropCancel = document.getElementById("crop-cancel");
const cropApply  = document.getElementById("crop-apply");
function updateRangeFill(el, invert = false) {
  if (!el) return;
  const min = parseFloat(el.min || "0");
  const max = parseFloat(el.max || "1");
  const val = parseFloat(el.value || "0");

  const t = (val - min) / (max - min || 1);
  let pct = Math.max(0, Math.min(1, t)) * 100;

  // nếu hướng fill bị ngược, bật invert
  if (invert) pct = 100 - pct;

  el.style.setProperty("--fill", `${pct}%`);
}

let cropImg = null;           // HTMLImageElement
let cropBlock = null;         // block đang crop
let cropAspect = 1;           // tỉ lệ khung crop = tỉ lệ block
let cropScale = 1;            // zoom
let cropMinScale = 1;
let cropMaxScale = 3;
let cropOffsetX = 0;          // pan
let cropOffsetY = 0;
let cropMaxPanX = 0;
let cropMaxPanY = 0;

let isDragging = false;
let lastX = 0, lastY = 0;

if (cropPanY) {
  cropPanY.value = "0";
  cropPanY.disabled = false;
  cropPanY.style.opacity = "1";
}

function openCropper(file, block) {
  if (!file || !block || !cropModal) return;

  cropBlock = block;

  // lấy tỉ lệ block thật (để crop “đúng form”)
  const w = block.clientWidth || 1;
  const h = block.clientHeight || 1;
  cropAspect = w / h;

  // chỉnh stage theo tỉ lệ
  const stage = cropCanvas.parentElement; // .crop-stage
  stage.style.aspectRatio = `${cropAspect}`;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    cropImg = img;

    // reset trạng thái
    cropScale = 1;
    cropOffsetX = 0;
    cropOffsetY = 0;

    // tính minScale để ảnh luôn phủ kín khung crop
    const { cw, ch } = getCropCanvasSize();
    const sx = cw / img.naturalWidth;
    const sy = ch / img.naturalHeight;

    const cover = Math.max(sx, sy);
    const contain = Math.min(sx, sy);

    // ✅ Baseline = cover => mặc định full, không có khoảng trắng
    cropMinScale = cover;

    // ✅ cho phép kéo xuống dưới 1.0 để “contain” khi cần
    const minFactor = contain / cover; // <= 1

    // ✅ scale ban đầu = cover
    cropScale = cropMinScale;

    // ✅ slider là factor tương đối so với cover
    if (cropZoom) {
      cropZoom.min = String(minFactor);
      cropZoom.max = "3";
      cropZoom.step = "0.01";

      // ✅ default = 1.0 (cover)
      cropZoom.value = "1";
    } else {
      console.warn("Missing #crop-zoom in HTML");
    }

    // ✅ Hiện modal trước để canvas có kích thước thật
    document.body.classList.add("crop-open");
    cropModal.classList.remove("hidden");
    cropCanvas?.parentElement?.classList.remove("dragging");
    // ✅ set chiều dài slider dọc đúng bằng chiều cao vùng crop
    requestAnimationFrame(() => {
      if (!cropPanY || !cropCanvas) return;
      const h = cropCanvas.getBoundingClientRect().height;
      cropPanY.style.width = `${Math.max(140, Math.floor(h))}px`;
    });
    // ✅ Đợi DOM layout xong rồi mới set size canvas + draw
    requestAnimationFrame(() => {
      resizeCropCanvas();
      drawCrop();
    });
  };
  img.src = url;
}

function closeCropper() {
  if (!cropModal) return;
  cropModal.classList.add("hidden");

  // ✅ Re-enable toolbar after closing crop modal
  document.body.classList.remove("crop-open");

  cropImg = null;
  cropBlock = null;
  isDragging = false;
}

function getCropCanvasSize() {
  const rect = cropCanvas.getBoundingClientRect();
  // fallback nếu chưa render
  return { cw: Math.max(1, rect.width), ch: Math.max(1, rect.height) };
}

function resizeCropCanvas() {
  const rect = cropCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cropCanvas.width  = Math.max(1, Math.round(rect.width  * dpr));
  cropCanvas.height = Math.max(1, Math.round(rect.height * dpr));
}

function clampPan() {
  if (!cropImg) return;

  const cw = cropCanvas.width;
  const ch = cropCanvas.height;

  const drawW = cropImg.naturalWidth * cropScale * (cropCanvas.width / (cropCanvas.getBoundingClientRect().width * (window.devicePixelRatio||1)));
  const drawH = cropImg.naturalHeight * cropScale * (cropCanvas.height / (cropCanvas.getBoundingClientRect().height * (window.devicePixelRatio||1)));

  // center-based pan clamp
  const maxX = Math.max(0, (drawW - cw) / 2);
  const maxY = Math.max(0, (drawH - ch) / 2);

  cropOffsetX = Math.min(maxX, Math.max(-maxX, cropOffsetX));
  cropOffsetY = Math.min(maxY, Math.max(-maxY, cropOffsetY));
}

function clampPan() {
  if (!cropImg || !cropCanvas) return;

  const cw = cropCanvas.width;
  const ch = cropCanvas.height;

  const sx = cw / cropImg.naturalWidth;
  const sy = ch / cropImg.naturalHeight;
  const base = Math.max(sx, sy); // ✅ contain

  const rel = cropScale / cropMinScale;
  const finalScale = base * rel;

  const drawW = cropImg.naturalWidth * finalScale;
  const drawH = cropImg.naturalHeight * finalScale;

  cropMaxPanX = Math.max(0, (drawW - cw) / 2);
  cropMaxPanY = Math.max(0, (drawH - ch) / 2);

  cropOffsetX = Math.min(cropMaxPanX, Math.max(-cropMaxPanX, cropOffsetX));
  cropOffsetY = Math.min(cropMaxPanY, Math.max(-cropMaxPanY, cropOffsetY));

  // ✅ Sync slider dọc (min/max/value) + disable khi không thể kéo
  if (cropPanY) {
    cropPanY.min = String(-cropMaxPanY);
    cropPanY.max = String(cropMaxPanY);
    cropPanY.step = "1";
    cropPanY.value = String(cropOffsetY);
    updateRangeFill(cropPanY);

    const disabled = cropMaxPanY <= 0;
    cropPanY.disabled = disabled;
    cropPanY.style.opacity = disabled ? "0.35" : "1";
  }
}


function drawCrop() {
  if (!cropImg) return;

  const ctx = cropCanvas.getContext("2d");
  if (!ctx) return;

  // scale logic: map to canvas pixel space
  const cw = cropCanvas.width;
  const ch = cropCanvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.restore();

  const sx = cw / cropImg.naturalWidth;
  const sy = ch / cropImg.naturalHeight;
  const base = Math.max(sx, sy); // ✅ contain

  // cropScale là absolute scale tính từ contain baseline
  const rel = cropScale / cropMinScale;
  const finalScale = base * rel;

  const drawW = cropImg.naturalWidth * finalScale;
  const drawH = cropImg.naturalHeight * finalScale;

  clampPan();

  const x = (cw - drawW) / 2 + cropOffsetX;
  const y = (ch - drawH) / 2 + cropOffsetY;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cropImg, x, y, drawW, drawH);
}
if (cropZoom) {
  const applyZoom = () => {
    const factor = parseFloat(cropZoom.value) || 1;
    cropScale = cropMinScale * factor;

    // ✅ cập nhật fill cho slider ngang
    updateRangeFill(cropZoom);

    cropStage?.classList.add("dragging");
    drawCrop();

    clearTimeout(applyZoom._t);
    applyZoom._t = setTimeout(() => {
      cropStage?.classList.remove("dragging");
    }, 150);
  };

  cropZoom.addEventListener("input", applyZoom, { passive: true });
  cropZoom.addEventListener("change", applyZoom, { passive: true });
}


// ✅ FIX: Chrome device-mode đôi khi không kéo được range native => tự kéo bằng chuột
if (cropZoom) {
  let draggingZoom = false;

  const setZoomByClientX = (clientX) => {
    const rect = cropZoom.getBoundingClientRect();
    const min = parseFloat(cropZoom.min || "1");
    const max = parseFloat(cropZoom.max || "3");

    let t = (clientX - rect.left) / rect.width;
    t = Math.max(0, Math.min(1, t));

    const v = min + (max - min) * t;
    cropZoom.value = String(v);
    updateRangeFill(cropZoom);

    // gọi y như khi kéo slider
    const factor = parseFloat(cropZoom.value) || 1;
    cropScale = cropMinScale * factor;
    drawCrop();
  };

  cropZoom.addEventListener("mousedown", (e) => {
    draggingZoom = true;
    setZoomByClientX(e.clientX);
  });

  window.addEventListener("mousemove", (e) => {
    if (!draggingZoom) return;
    setZoomByClientX(e.clientX);
  });

  window.addEventListener("mouseup", () => {
    draggingZoom = false;
  });
}

if (cropPanY) {
  const applyPanY = () => {
    cropOffsetY = parseFloat(cropPanY.value) || 0;

    // ✅ cập nhật fill cho slider dọc
    updateRangeFill(cropPanY, true);

    drawCrop(); // drawCrop sẽ clamp + sync lại luôn
  };
  cropPanY.addEventListener("input", applyPanY, { passive: true });
  cropPanY.addEventListener("change", applyPanY, { passive: true });
}



// ✅ Fix dứt điểm: kéo slider thì canvas không được cướp thao tác
if (cropZoom && cropCanvas) {
  const lockCanvas = (e) => {
    // ❌ ĐỪNG preventDefault ở đây: sẽ làm slider không kéo được (đặc biệt trên Chrome)
    e.stopPropagation();

    // nếu đang drag canvas thì hủy
    isDragging = false;

    // tạm thời cho canvas không ăn hit-test khi kéo slider
    cropCanvas.style.pointerEvents = "none";
  };

  const unlockCanvas = (e) => {
    e.stopPropagation();
    cropCanvas.style.pointerEvents = "auto";
  };


  if (cropZoom) {
    cropZoom.addEventListener("pointerdown", lockCanvas, { capture: true });
    cropZoom.addEventListener("pointerup", unlockCanvas, { capture: true });
    cropZoom.addEventListener("pointercancel", unlockCanvas, { capture: true });
  }
}


if (cropZoom) {
  cropZoom.addEventListener("pointerdown", () => { isDragging = false; }, { passive: true });
  cropZoom.addEventListener("touchstart",  () => { isDragging = false; }, { passive: true });
}

// kéo ảnh (pan) bằng Pointer Events
if (cropCanvas) {
  cropCanvas.addEventListener("pointerdown", (e) => {
    isDragging = true;
    cropStage?.classList.add("dragging");
    lastX = e.clientX;
    lastY = e.clientY;
    cropCanvas.setPointerCapture(e.pointerId);
  });

  cropCanvas.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    // scale theo dpr để kéo “đúng tay”
    const dpr = window.devicePixelRatio || 1;
    cropOffsetX += dx * dpr;
    cropOffsetY += dy * dpr;
    drawCrop();
  });

  const endDrag = (e) => {
    isDragging = false;
    cropStage?.classList.remove("dragging");
    // ✅ QUAN TRỌNG: thả pointer capture để slider kéo được
    try {
      cropCanvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  cropCanvas.addEventListener("pointerup", endDrag);
  cropCanvas.addEventListener("pointercancel", endDrag);

}

// đóng bằng overlay
if (cropModal) {
  cropModal.addEventListener("click", (e) => {
    if (e.target === cropModal) closeCropper();
  });
}
if (cropCancel) cropCancel.addEventListener("click", closeCropper);

// Apply => xuất ảnh đã crop thành Blob rồi gắn vào block + lưu state
if (cropApply) {
  cropApply.addEventListener("click", async () => {
    if (!cropBlock) return;

    // xuất blob từ canvas (ảnh đã “đúng khung”)
    const blob = await new Promise((resolve) =>
      cropCanvas.toBlob(resolve, "image/jpeg", 0.95)
    );
    if (!blob) return;

    // gắn vào block
    cropBlock.innerHTML = "";
    cropBlock.classList.remove("placeholder");
    const img = document.createElement("img");
    img.src = URL.createObjectURL(blob);
    cropBlock.appendChild(img);

    // nếu bạn đang dùng IndexedDB cho ảnh thì lưu luôn (nếu hàm tồn tại)
    try {
      if (typeof saveImageToDB === "function") {
        const id = cropBlock.dataset.blockId;
        const key = `${currentTemplate}_image_${id}`;
        await saveImageToDB(key, blob);
      }
    } catch (e) {
      console.warn("saveImageToDB error:", e);
    }

    saveAppState();
    closeCropper();
  });
}

// resize => giữ canvas nét
window.addEventListener("resize", () => {
  if (!cropModal || cropModal.classList.contains("hidden")) return;
  resizeCropCanvas();
  drawCrop();
});


// 選択されたファイルを現在の画像ブロックに反映
function applyFileToCurrentImageBlock(file) {
  if (!file || !currentImageBlock) return;

  // Chỉ mở cropper, không set ảnh / không save ở đây
  openCropper(file, currentImageBlock);
}


// Photos（フォトライブラリ）を選択
if (imageSourceGalleryBtn) {
  imageSourceGalleryBtn.addEventListener("click", () => {
    if (!currentImageBlock) return;
    imageSourceModal.classList.add("hidden");
    imageInputGallery.value = "";
    imageInputGallery.click();
  });
}

// Camera（カメラ撮影）を選択
if (imageSourceCameraBtn) {
  imageSourceCameraBtn.addEventListener("click", () => {
    if (!currentImageBlock) return;
    imageSourceModal.classList.add("hidden");
    imageInputCamera.value = "";
    imageInputCamera.click();
  });
}

// キャンセル
if (imageSourceCancelBtn) {
  imageSourceCancelBtn.addEventListener("click", () => {
    imageSourceModal.classList.add("hidden");
    currentImageBlock = null;
  });
}

// モーダルの外側をタップしたら閉じる（キャンセル扱い）
if (imageSourceModal) {
  imageSourceModal.addEventListener("click", (e) => {
    // 直接 overlay 部分(#image-source-modal) をタップしたときだけ閉じる
    if (e.target === imageSourceModal) {
      imageSourceModal.classList.add("hidden");
      currentImageBlock = null; // どのブロックも選択中ではない状態に戻す
    }
  });
}


fileNameInput.addEventListener("input", () => {
  saveAppState();
});

// テキスト入力モーダル関連
const textModal = document.getElementById("text-edit-modal");
const inputGcode = document.getElementById("input-gcode");
const inputNyukokubi = document.getElementById("input-nyukokubi");
const inputKaisha = document.getElementById("input-kaisha");
const inputNamae = document.getElementById("input-namae");
const textClearBtn = document.getElementById("text-clear");
const textSaveBtn = document.getElementById("text-save");

// 今どのテキストブロックを編集しているか
let currentTextBlock = null;

// ================== レイアウト構築共通関数 ==================

function buildLayoutForCurrentTemplate() {
  a4Inner.innerHTML = "";
  a4Inner.className = "";

  if (currentTemplate === "3blocks") {
    // 在留カード用：画像2枚 + テキスト
    a4Inner.classList.add("layout-3blocks");

    createSpacer("top");
    createBlock(1, "image", "タップして画像1を選択"); // blockId 1
    createSpacer("mid-1");
    createBlock(2, "image", "タップして画像2を選択"); // blockId 2
    createSpacer("mid-2");
    createBlock(3, "text", "タップしてテキスト入力"); // blockId 3
    createSpacer("bottom");
  } else if (currentTemplate === "2blocks") {
    // キャッシュカード用：画像1枚 + テキスト
    a4Inner.classList.add("layout-2blocks");

    createSpacer("top");
    createSpacer("mid-1");
    createBlock(1, "image", "タップして画像を選択");   // blockId 1
    createSpacer("mid-2");
    createBlock(2, "text", "タップしてテキスト入力"); // blockId 2
    createSpacer("bottom");
  }
  updateLayoutToggleLabel();
}

function playLayoutSwitchAnim() {
  if (!a4Inner) return;

  // remove -> reflow -> add để animation chạy lại mỗi lần bấm
  a4Inner.classList.remove("layout-switch-anim");
  void a4Inner.offsetWidth; // force reflow
  a4Inner.classList.add("layout-switch-anim");

  // dọn class sau khi chạy xong
  setTimeout(() => {
    a4Inner.classList.remove("layout-switch-anim");
  }, 450);
}

function playLayoutFlash() {
  if (!a4Inner) return;

  // Vì layout vừa rebuild → phải query lại block
  const blocks = a4Inner.querySelectorAll(".block");

  blocks.forEach((b, i) => {
    b.classList.remove("layout-flash");
    void b.offsetWidth; // force reflow

    // ✨ stagger nhẹ cho pro hơn
    setTimeout(() => {
      b.classList.add("layout-flash");
    }, i * 60);
  });

  // Dọn class sau khi animation xong
  setTimeout(() => {
    blocks.forEach((b) => b.classList.remove("layout-flash"));
  }, 450);
}


// レイアウト切替ボタンのラベル更新
function updateLayoutToggleLabel() {
  if (!layoutToggleButton) return;

  // 3blocks = 在留カード, 2blocks = キャッシュカード
  if (currentTemplate === "3blocks") {
    layoutToggleButton.classList.add("is-3");
    layoutToggleButton.classList.remove("is-2");
  } else {
    layoutToggleButton.classList.add("is-2");
    layoutToggleButton.classList.remove("is-3");
  }
}

// スペーサー（上・下・中間）
function createSpacer(position) {
  const spacer = document.createElement("div");
  spacer.classList.add("spacer", `spacer-${position}`);
  a4Inner.appendChild(spacer);
}

// 1ブロック生成（画像 or テキスト）
function createBlock(index, type, placeholder) {
  const block = document.createElement("div");
  block.classList.add("block", `block-${index}`, "placeholder");
  block.dataset.type = type;
  block.dataset.blockId = String(index);
  block.textContent = placeholder;

  block.addEventListener("click", () => {
    // 👉 tô viền xanh block đang được chọn
    setActiveBlock(block);

    const blockType = block.dataset.type;
    if (blockType === "image") {
      handleImageBlockClick(block);
    } else if (blockType === "text") {
      handleTextBlockClick(block);
    }
  });

  a4Inner.appendChild(block);
}


// ================== 画像処理 ==================
// Click vào bất cứ đâu KHÔNG phải block → clear block highlight
if (editorScreen) {
  editorScreen.addEventListener("click", (e) => {
    // 1) Nếu click vào block (hoặc phần tử con bên trong block) → không clear
    if (e.target.closest(".block")) return;

    // 2) Nếu đang mở text modal và click vào bên trong panel modal → không clear
    if (
      typeof textModal !== "undefined" &&
      textModal &&
      !textModal.classList.contains("hidden") &&
      textModal.contains(e.target)
    ) {
      return;
    }

    // 3) Còn lại (top bar, bottom bar, khoảng trống trong A4, wallpaper, v.v.) → clear highlight
    clearActiveBlockHighlight();
  });
}


// 画像ブロッククリック → iPhone標準のファイル選択ポップアップを直接開く
function handleImageBlockClick(block) {
  currentImageBlock = block;

  // dùng input "gallery" vì nó là type="file" accept="image/*"
  // → iPhone sẽ hiện sheet mặc định: Photo Library / Take Photo / Choose File
  if (!imageInputGallery) return;

  imageInputGallery.value = "";   // reset để lần sau change vẫn chạy
  imageInputGallery.click();      // gọi trực tiếp popup mặc định của iOS
}

// Photos（フォト）から選択された画像
if (imageInputGallery) {
  imageInputGallery.addEventListener("change", () => {
    const file = imageInputGallery.files[0];
    applyFileToCurrentImageBlock(file);
    imageInputGallery.value = "";
    // 選択後、currentImageBlockはそのままでもOK
  });
}

// Camera で撮影された画像
if (imageInputCamera) {
  imageInputCamera.addEventListener("change", () => {
    const file = imageInputCamera.files[0];
    applyFileToCurrentImageBlock(file);
    imageInputCamera.value = "";
  });
}


// ================== テキストモーダル ==================

// テキストブロッククリック → モーダルで4項目編集
function handleTextBlockClick(block) {
  currentTextBlock = block;

  // 既に保存されている値があれば復元
  inputGcode.value = block.dataset.gcode || "";
  inputNyukokubi.value = block.dataset.nyukokubi || "";
  inputKaisha.value = block.dataset.kaisha || "";
  inputNamae.value = block.dataset.namae || "";

  textModal.classList.remove("hidden");
}

// クリア → 4 ô input về rỗng（モーダルは開いたまま）
if (textClearBtn) {
  textClearBtn.addEventListener("click", () => {
    inputGcode.value = "";
    inputNyukokubi.value = "";
    inputKaisha.value = "";
    inputNamae.value = "";
  });
}

// モーダルの外側をタップしたら閉じる（キャンセル扱い）
if (textModal) {
  textModal.addEventListener("click", (e) => {
    // overlay phần tối (chính #text-edit-modal) mới đóng
    if (e.target === textModal) {
      textModal.classList.add("hidden");
      currentTextBlock = null;

      // đóng modal → bỏ luôn viền xanh block đang chọn
      clearActiveBlockHighlight();
    }
  });
}


// 保存 → 4項目を反映してブロックに表示
textSaveBtn.addEventListener("click", () => {
  if (!currentTextBlock) return;

  const gcode = inputGcode.value.trim();
  const nyukokubi = inputNyukokubi.value.trim();
  const kaisha = inputKaisha.value.trim();
  const namae = inputNamae.value.trim();

  // ブロックのdata属性に保持（後で編集のとき復元できるように）
  currentTextBlock.dataset.gcode = gcode;
  currentTextBlock.dataset.nyukokubi = nyukokubi;
  currentTextBlock.dataset.kaisha = kaisha;
  currentTextBlock.dataset.namae = namae;

  // ブロックの表示内容を表形式で描画
  renderTextContent(currentTextBlock, gcode, nyukokubi, kaisha, namae);

  // ファイル名自動生成：テキスト保存のたびに常に更新
  const part1 = gcode || "";
  const part3 = kaisha || "";
  const part4 = namae || "";
  const autoName = (part1 + "次" + "-" + part3 + "-" + part4).trim();
  if (autoName) {
    fileNameInput.value = autoName;
  }

  saveAppState();

  // モーダルを閉じる
  textModal.classList.add("hidden");
  currentTextBlock = null;

  // đóng modal bằng nút SAVE → bỏ luôn highlight block
  clearActiveBlockHighlight();
});

// ================== 状態保存 / 復元 ==================
// テキストブロックの中身を「ラベル＋値」の表として描画
function renderTextContent(block, gcode, nyukokubi, kaisha, namae) {
  const hasAny = gcode || nyukokubi || kaisha || namae;

  if (!hasAny) {
    // 何も入っていない場合はプレースホルダーに戻す
    block.classList.add("placeholder");
    block.innerHTML = "";
    block.textContent = "タップしてテキスト入力";
    return;
  }

  block.classList.remove("placeholder");
  block.innerHTML = "";

  const container = document.createElement("div");
  container.classList.add("info-table");

  const rows = [
    ["入国G：", gcode],
    ["入国日：", nyukokubi],
    ["会社名：", kaisha],
    ["氏名：", namae],
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.classList.add("info-row");

    const labelSpan = document.createElement("span");
    labelSpan.classList.add("info-label");
    labelSpan.textContent = label;

    const valueSpan = document.createElement("span");
    valueSpan.classList.add("info-value");
    valueSpan.textContent = value || "";

    row.appendChild(labelSpan);
    row.appendChild(valueSpan);
    container.appendChild(row);
  });

  block.appendChild(container);
}


function saveAppState() {
  if (!currentTemplate) return;

  const state = {
    currentTemplate,
    fileName: fileNameInput.value || "",
    blocks: []
  };

  const blocks = a4Inner.querySelectorAll(".block");
  blocks.forEach((block) => {
    const type = block.dataset.type;
    const blockId = block.dataset.blockId || null;
    const isPlaceholder = block.classList.contains("placeholder");

    const b = {
      type,
      blockId,
      isPlaceholder
    };

    if (type === "image") {
      b.hasImage = !!block.querySelector("img");
    }else if (type === "text") {
      b.gcode = block.dataset.gcode || "";
      b.nyukokubi = block.dataset.nyukokubi || "";
      b.kaisha = block.dataset.kaisha || "";
      b.namae = block.dataset.namae || "";
    }

    state.blocks.push(b);
  });

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("saveAppState error:", e);
  }
}

// 戻り値：復元できたら true, 何もなければ false
function restoreAppState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.warn("restoreAppState load error:", e);
    return false;
  }
  if (!raw) return false;

  let state;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    console.warn("restoreAppState parse error:", e);
    return false;
  }

  if (!state.currentTemplate) return false;

  currentTemplate = state.currentTemplate;

  buildLayoutForCurrentTemplate();

  fileNameInput.value = state.fileName || "";

  // ブロックへ反映
  const blocks = a4Inner.querySelectorAll(".block");
  blocks.forEach((block) => {
    const type = block.dataset.type;
    const id = block.dataset.blockId;
    const savedBlock = state.blocks.find(
      (b) => b.type === type && String(b.blockId) === String(id)
    );
    if (!savedBlock) return;

    block.classList.remove("placeholder");
    block.innerHTML = "";

    if (type === "image") {
      if (savedBlock.hasImage) {
        const key = `${currentTemplate}_image_${id}`;
        loadImageFromDB(key).then((blob) => {
          if (blob) {
            const img = document.createElement("img");
            img.src = URL.createObjectURL(blob);
            block.appendChild(img);
            block.classList.remove("placeholder");
          }
        });
      } else {
        block.classList.add("placeholder");
        block.textContent =
          currentTemplate === "3blocks" && id === "1"
            ? "タップして画像1を選択"
            : currentTemplate === "3blocks" && id === "2"
            ? "タップして画像2を選択"
            : "タップして画像を選択";
      }
    } else if (type === "text") {
      const gcode = savedBlock.gcode || "";
      const nyukokubi = savedBlock.nyukokubi || "";
      const kaisha = savedBlock.kaisha || "";
      const namae = savedBlock.namae || "";

      block.dataset.gcode = gcode;
      block.dataset.nyukokubi = nyukokubi;
      block.dataset.kaisha = kaisha;
      block.dataset.namae = namae;

      renderTextContent(block, gcode, nyukokubi, kaisha, namae);
    }
  });

  updateLayoutToggleLabel();
  return true;
}

// ================== Clear All (PDF保存後 or Back) ==================

function clearAllData() {
  // 1. localStorage削除
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn("localStorage remove error:", e);
  }

  // 2. ファイル名リセット
  if (fileNameInput) {
    fileNameInput.value = "";
  }

  // 3. ブロックリセット（プレースホルダーに戻す）
  const blocks = a4Inner.querySelectorAll(".block");
  blocks.forEach((block) => {
    const type = block.dataset.type;
    const id = block.dataset.blockId;

    block.innerHTML = "";
    block.classList.add("placeholder");

    // data属性も削除
    delete block.dataset.gcode;
    delete block.dataset.nyukokubi;
    delete block.dataset.kaisha;
    delete block.dataset.namae;

    const span = document.createElement("span");
    if (type === "image") {
      if (currentTemplate === "3blocks" && id === "1") {
        span.textContent = "タップして画像1を選択";
      } else if (currentTemplate === "3blocks" && id === "2") {
        span.textContent = "タップして画像2を選択";
      } else {
        span.textContent = "タップして画像を選択";
      }
    } else if (type === "text") {
      span.textContent = "タップしてテキスト入力";
    } else {
      span.textContent = "";
    }

    block.appendChild(span);
  });
  ["1", "2"].forEach((id) => {
    const key = `${currentTemplate}_image_${id}`;
    deleteImageFromDB(key);
  });
  saveAppState();
}

function isIOSLike() {
  const ua = navigator.userAgent || "";
  // iPhone/iPad/iPod, và iPadOS đôi khi báo "Macintosh" nhưng có touch
  return /iPad|iPhone|iPod/i.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ================== Shortcuts Save Helper ==================
async function sendPdfToShortcuts(pdfBlob, fileName) {
  // 1) Blob -> Base64
  const buffer = await pdfBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);

  // 2) payload: FileName||Base64
  const payload = `${fileName}.pdf||${b64}`;

  // 3) gọi shortcut (đổi "SavePDF" đúng tên shortcut của bạn)
  const shortcutName = "PDFmaker";
  const url =
    `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}` +
    `&input=${encodeURIComponent(payload)}`;

  window.location.href = url;
}

// ================== PDF保存 ==================

exportButton.addEventListener("click", () => {
  const ok = confirm("PDFを保存しますか？");
  if (!ok) return;

  document.body.classList.add("pdf-mode"); // bật chế độ PDF (ẩn toolbar, bottom bar...)

  const element = a4Page;
  const fileName = fileNameInput.value || "document";

  // Đợi 1 chút cho layout trong pdf-mode ổn định
  setTimeout(() => {
    // Lấy global từ html2pdf.bundle.min.js
    const h2c = window.html2canvas;
    const JsPDF = window.jsPDF;

    if (!h2c || !JsPDF) {
      alert("PDFライブラリの読み込みに失敗しました。");
      document.body.classList.remove("pdf-mode");
      return;
    }

    h2c(element, {
      scale: 4.5,
      useCORS: true,
    })
      .then((canvas) => {
        const imgData = canvas.toDataURL("image/jpeg", 1); 

        // Tạo PDF A4 1 trang
        const pdf = new JsPDF({
          orientation: "portrait",
          unit: "mm",
          format: "a4",
        });

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        // Giữ tỉ lệ hình, fit vào trang A4 và căn giữa
        const imgWidthPx = canvas.width;
        const imgHeightPx = canvas.height;
        const imgAspect = imgWidthPx / imgHeightPx;
        const pageAspect = pageWidth / pageHeight;

        let renderWidth, renderHeight;
        if (imgAspect > pageAspect) {
          // ảnh “ngang” hơn → fit theo chiều ngang trang
          renderWidth = pageWidth;
          renderHeight = renderWidth / imgAspect;
        } else {
          // ảnh “dọc” hơn → fit theo chiều dọc trang
          renderHeight = pageHeight;
          renderWidth = renderHeight * imgAspect;
        }

        const x = (pageWidth - renderWidth) / 2;
        const y = (pageHeight - renderHeight) / 2;

        pdf.addImage(imgData, "JPEG", x, y, renderWidth, renderHeight);

        // ✅ iPhone: tạo blob rồi gửi sang Shortcuts để Save File
        const pdfBlob = pdf.output("blob");

        // bỏ pdf-mode trước khi nhảy sang Shortcuts (để khi quay lại app không bị “ẩn UI”)
        document.body.classList.remove("pdf-mode");

        if (isIOSLike()) {
          sendPdfToShortcuts(pdfBlob, fileName);
        } else {
          // ✅ PC/Chrome/Edge/Safari: tải file trực tiếp
          downloadBlob(pdfBlob, `${fileName}.pdf`);
        }
        return; // kết thúc luôn
      })
      .catch((err) => {
        console.error(err);
        alert("PDF作成中にエラーが発生しました。");
      })
      .finally(() => {
        document.body.classList.remove("pdf-mode");
      });
  }, 50);
});


// ================== Top bar ボタン ==================

// 戻るボタン：レイアウトは維持したまま中身だけリセット
backButton.addEventListener("click", () => {
  const ok = confirm("入力内容をすべてリセットしますか？");
  if (!ok) return;
  clearAllData();
});

// レイアウト切替ボタン
layoutToggleButton.addEventListener("click", () => {
  const ok = confirm(
    "レイアウトを切り替えると、入力中の内容はリセットされます。\nよろしいですか？"
  );
  if (!ok) return;

  // テンプレートを切り替え
  currentTemplate = currentTemplate === "3blocks" ? "2blocks" : "3blocks";

  // 状態をリセットして再構築
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn("localStorage remove error:", e);
  }

  fileNameInput.value = "";

  buildLayoutForCurrentTemplate();
  playLayoutSwitchAnim();
  playLayoutFlash();
  saveAppState();
});

// ================== 初期ロード ==================

window.addEventListener("DOMContentLoaded", () => {
  const restored = restoreAppState();
  if (!restored) {
    // 保存がなければデフォルト3blocksで構築
    currentTemplate = "3blocks";
    buildLayoutForCurrentTemplate();
    fileNameInput.value = "";
  }
});




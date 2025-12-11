let currentTemplate = "3blocks";      // デフォルト：在留カード（画像2枚）
let currentImageBlock = null;

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


// 選択されたファイルを現在の画像ブロックに反映
function applyFileToCurrentImageBlock(file) {
  if (!file || !currentImageBlock) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    currentImageBlock.innerHTML = "";
    currentImageBlock.classList.remove("placeholder");

    const img = document.createElement("img");
    img.src = e.target.result;
    currentImageBlock.appendChild(img);

    saveAppState();
  };

  reader.readAsDataURL(file);
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
      const img = block.querySelector("img");
      b.imageSrc = img ? img.src : null;
    } else if (type === "text") {
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
      if (savedBlock.imageSrc) {
        const img = document.createElement("img");
        img.src = savedBlock.imageSrc;
        block.appendChild(img);
      } else {
        // 画像がない場合はプレースホルダーに戻す
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

  saveAppState();
}

// ================== PDF保存 ==================
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
      scale: 3,
      useCORS: true,
    })
      .then((canvas) => {
        const imgData = canvas.toDataURL("image/png");

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
        pdf.save(fileName + ".pdf");
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



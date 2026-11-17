const FUNCTIONS_URL = "https://efcezxsrvxmvojacukkm.supabase.co/functions/v1";
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

const $ = (id) => document.getElementById(id);
const el = {
  drop: $("drop"), file: $("file"), preview: $("preview"), hint: $("drop-hint"),
  tone: $("tone"), go: $("go"), status: $("status"), step1: $("step1"), step2: $("step2"),
  error: $("error"), features: $("features"), featuresList: $("features-list"),
  result: $("result"), regen: $("regen"),
};

let imageDataUrl = null;
let features = null;
let busy = false;

function showError(msg) {
  el.error.textContent = msg;
  el.error.hidden = !msg;
}

function setStep(step1, step2) {
  el.step1.className = step1;
  el.step2.className = step2;
}

function setBusy(on) {
  busy = on;
  el.go.disabled = on || !imageDataUrl;
  el.regen.disabled = on;
  el.go.textContent = on ? "생성 중..." : "초안 만들기";
}

// 이미지를 긴 변 1024px 이하로 줄여 JPEG data URL로 변환
function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // PNG 투명 배경 대비
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽을 수 없습니다.")); };
    img.src = url;
  });
}

async function handleFile(file) {
  showError("");
  if (!file) return;
  if (!TYPES.includes(file.type)) return showError("jpg, png, webp 형식만 올릴 수 있어요.");
  if (file.size > MAX_BYTES) return showError("사진은 5MB 이하여야 해요.");
  try {
    imageDataUrl = await toDataUrl(file);
  } catch (e) {
    imageDataUrl = null;
    return showError(e.message);
  }
  el.preview.src = imageDataUrl;
  el.preview.hidden = false;
  el.hint.hidden = true;
  features = null;
  el.features.hidden = true;
  el.result.hidden = true;
  el.status.hidden = true;
  setBusy(false);
}

async function callFunction(name, body) {
  let res;
  try {
    res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("서버에 연결할 수 없어요. 네트워크를 확인해 주세요.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청에 실패했어요. (${res.status})`);
  return data;
}

function renderFeatures(f) {
  const rows = [
    ["주요 대상", f.subject],
    ["색상", (f.colors || []).join(", ")],
    ["장소/배경", f.setting],
    ["분위기", f.mood],
    ["시간/날씨", f.time_weather],
    ["키워드", (f.keywords || []).join(", ")],
  ].filter(([, v]) => v);
  el.featuresList.replaceChildren();
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    el.featuresList.append(dt, dd);
  }
  el.features.hidden = false;
}

function formatPost(p, withHashtags) {
  const tags = (p.hashtags || []).map((t) => "#" + String(t).replace(/^#/, "")).join(" ");
  return tags && withHashtags ? `${p.body}\n\n${tags}` : p.body;
}

function renderPosts(posts) {
  for (const [id, key] of [["card-instagram", "instagram"], ["card-threads", "threads"]]) {
    const text = formatPost(posts[key], true);
    const card = $(id);
    card.querySelector(".text").textContent = text;
    card.querySelector(".count").textContent = `${[...text].length}자`;
  }
  el.result.hidden = false;
}

async function writePosts() {
  setStep("done", "active");
  const { posts } = await callFunction("write-posts", {
    features,
    tone: el.tone.value.trim() || undefined,
  });
  renderPosts(posts);
  setStep("done", "done");
}

async function run() {
  if (busy || !imageDataUrl) return;
  showError("");
  el.result.hidden = true;
  el.status.hidden = false;
  setBusy(true);
  try {
    if (!features) {
      setStep("active", "");
      ({ features } = await callFunction("analyze-photo", { image: imageDataUrl }));
      renderFeatures(features);
    }
    await writePosts();
  } catch (e) {
    showError(e.message);
    el.status.hidden = true;
  } finally {
    setBusy(false);
  }
}

// 특성은 그대로 두고 2단계만 다시 호출
async function regenerate() {
  if (busy || !features) return;
  showError("");
  el.status.hidden = false;
  setBusy(true);
  try {
    await writePosts();
  } catch (e) {
    showError(e.message);
    el.status.hidden = true;
  } finally {
    setBusy(false);
  }
}

el.file.addEventListener("change", () => handleFile(el.file.files[0]));
el.drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.file.click(); }
});
for (const ev of ["dragenter", "dragover"]) {
  el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.add("over"); });
}
for (const ev of ["dragleave", "drop"]) {
  el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.remove("over"); });
}
el.drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
el.go.addEventListener("click", run);
el.regen.addEventListener("click", regenerate);

document.querySelectorAll(".card .copy").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = btn.closest(".card").querySelector(".text").textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "복사됨 ✓";
    } catch {
      btn.textContent = "복사 실패";
    }
    setTimeout(() => (btn.textContent = "복사"), 1500);
  });
});

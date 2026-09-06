const ASSET_ROOT = "/generated-assets/L0--L3(%E5%A4%A7%E6%A2%85%E6%B2%99)";
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ZOOM_MS = REDUCED_MOTION ? 1 : 520;
const OVERLAP_MS = REDUCED_MOTION ? 0 : 500;
const SETTLE_MS = REDUCED_MOTION ? 1 : 520;

const LAYERS = [
  { id: "L0", title: "盐田", eyebrow: "盐田视觉总览", description: "点击大梅沙，沿着海岸进入下一层。", crumb: "总览", image: `${ASSET_ROOT}/L0.png`, video: `${ASSET_ROOT}/L0%20%E7%9B%90%E7%94%B0%E6%80%BB%E8%A7%88%E5%BE%AE%E5%8A%A8%E8%A7%86%E9%A2%91.mp4`, hotspot: { label: "大梅沙", x: 0.734, y: 0.588, focusX: 0.734, focusY: 0.588 } },
  { id: "L1", title: "大梅沙", eyebrow: "海岸手绘地图", description: "当前使用本地静态图。点击沙滩泳区继续深入。", crumb: "大梅沙", image: `${ASSET_ROOT}/L1.png`, video: null, hotspot: { label: "沙滩泳区", x: 0.562, y: 0.623, focusX: 0.562, focusY: 0.623 } },
  { id: "L2", title: "沙滩泳区", eyebrow: "大梅沙沙滩剖面", description: "当前使用本地静态图。点击愿望天使继续深入。", crumb: "沙滩泳区", image: `${ASSET_ROOT}/L2.png`, video: null, hotspot: { label: "愿望天使", x: 0.434, y: 0.417, focusX: 0.434, focusY: 0.417 } },
  { id: "L3", title: "愿望天使", eyebrow: "愿望天使 · 羽翼人雕塑", description: "当前使用本地静态介绍图。", crumb: "愿望天使", image: `${ASSET_ROOT}/L3.png`, video: null, hotspot: null },
];

const $ = (selector) => document.querySelector(selector);
const mediaStack = $("#mediaStack");
const hotspotLayer = $("#hotspotLayer");
const breadcrumbs = $("#breadcrumbs");
const backButton = $("#backButton");
const mediaStatus = $("#mediaStatus");
const mediaBadge = $("#mediaBadge");
const levelLabel = $("#levelLabel");
const sceneEyebrow = $("#sceneEyebrow");
const sceneTitle = $("#sceneTitle");
const sceneDescription = $("#sceneDescription");
const motionNotice = $("#motionNotice");
const transitionStatus = $("#transitionStatus");
const footerHint = $("#footerHint");
const cursor = document.createElement("span");
cursor.className = "stage-cursor";
cursor.setAttribute("aria-hidden", "true");
$("#viewer").append(cursor);

let currentIndex = 0;
let isTransitioning = false;
let currentFrame = null;
let cursorTimer = 0;
const layerAt = (index) => LAYERS[index];

function showNotice(message) {
  motionNotice.textContent = message;
  motionNotice.hidden = !message;
}

function setMediaState(badge, status, fallback = false) {
  mediaBadge.textContent = badge;
  mediaStatus.textContent = status;
  showNotice(fallback ? status : "");
}

function focusStyle(frame, focus) {
  frame.style.setProperty("--focus-x", `${(focus?.focusX ?? 0.5) * 100}%`);
  frame.style.setProperty("--focus-y", `${(focus?.focusY ?? 0.5) * 100}%`);
}

function buildFrame(layer) {
  const frame = document.createElement("div");
  frame.className = "media-frame";
  focusStyle(frame, layer.hotspot);
  const image = new Image();
  image.alt = `${layer.title}本地画面`;
  image.src = layer.image;
  image.addEventListener("error", () => showNotice("本地图片加载失败；请检查素材路径。"), { once: true });
  frame.append(image);
  if (layer.video) {
    const video = document.createElement("video");
    video.src = layer.video;
    video.muted = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.setAttribute("aria-label", `${layer.title}微动视频`);
    video.addEventListener("canplay", async () => {
      try {
        await video.play();
        if (frame !== currentFrame) return;
        image.style.visibility = "hidden";
        setMediaState("动态视频", "L0 本地微动视频正在播放");
      } catch {
        if (frame === currentFrame) setMediaState("静态图回退", "浏览器阻止自动播放，已使用 L0.png", true);
      }
    }, { once: true });
    video.addEventListener("error", () => {
      if (frame === currentFrame) setMediaState("静态图回退", "L0 视频无法加载，已使用 L0.png", true);
      video.remove();
    }, { once: true });
    frame.append(video);
  }
  return frame;
}

function setLayerMeta(index) {
  const layer = layerAt(index);
  levelLabel.textContent = `${layer.id} / ${layer.crumb}`;
  sceneEyebrow.textContent = layer.eyebrow;
  sceneTitle.textContent = layer.title;
  sceneDescription.textContent = layer.description;
  footerHint.textContent = layer.hotspot ? `点击“${layer.hotspot.label}”继续深入` : "已到达当前导览终点";
  backButton.hidden = index === 0;
  if (layer.video) setMediaState("视频加载中", "正在尝试播放 L0 本地视频");
  else setMediaState("静态图降级", `${layer.id} 暂无微动视频，已使用本地静态图`, true);
}

function renderBreadcrumbs() {
  breadcrumbs.replaceChildren();
  const labels = ["盐田", ...LAYERS.slice(0, currentIndex + 1).map((layer) => layer.crumb)];
  labels.forEach((label, index) => {
    if (index) {
      const separator = document.createElement("span");
      separator.className = "separator";
      separator.setAttribute("aria-hidden", "true");
      separator.textContent = "›";
      breadcrumbs.append(separator);
    }
    const crumb = document.createElement("button");
    crumb.className = "crumb";
    crumb.type = "button";
    crumb.textContent = label;
    if (index === labels.length - 1) {
      crumb.disabled = true;
      crumb.setAttribute("aria-current", "page");
    } else {
      crumb.addEventListener("click", () => goTo(index === 0 ? 0 : index - 1));
    }
    breadcrumbs.append(crumb);
  });
}

function moveCursorTo(hotspot, clicked) {
  cursor.style.left = `${hotspot.x * 100}%`;
  cursor.style.top = `${hotspot.y * 100}%`;
  cursor.classList.add("is-visible");
  cursor.classList.toggle("is-clicked", clicked);
  window.clearTimeout(cursorTimer);
  cursorTimer = window.setTimeout(() => cursor.classList.remove("is-visible", "is-clicked"), clicked ? 380 : 900);
}

function renderHotspots() {
  hotspotLayer.replaceChildren();
  const hotspot = layerAt(currentIndex).hotspot;
  if (!hotspot) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hotspot";
  button.style.left = `${hotspot.x * 100}%`;
  button.style.top = `${hotspot.y * 100}%`;
  button.setAttribute("aria-label", `进入${hotspot.label}`);
  button.innerHTML = `<span class="hotspot__ring" aria-hidden="true"></span><span class="hotspot__label">${hotspot.label}</span>`;
  button.addEventListener("pointerenter", () => moveCursorTo(hotspot, false));
  button.addEventListener("focus", () => moveCursorTo(hotspot, false));
  button.addEventListener("click", () => {
    moveCursorTo(hotspot, true);
    goTo(currentIndex + 1);
  });
  hotspotLayer.append(button);
}

async function goTo(nextIndex) {
  if (isTransitioning || nextIndex === currentIndex || !layerAt(nextIndex)) return;
  isTransitioning = true;
  const fromIndex = currentIndex;
  const fromLayer = layerAt(fromIndex);
  const toLayer = layerAt(nextIndex);
  const forward = nextIndex > fromIndex;
  const focus = (forward ? fromLayer.hotspot : toLayer.hotspot) || { focusX: 0.5, focusY: 0.5 };
  const outgoing = currentFrame;
  const incoming = buildFrame(toLayer);
  focusStyle(incoming, focus);
  incoming.style.opacity = "0";
  incoming.style.transform = "scale(1.5)";
  mediaStack.append(incoming);
  hotspotLayer.replaceChildren();
  transitionStatus.textContent = forward ? `深入 ${toLayer.title} / 聚焦中` : `退回 ${toLayer.title} / 聚焦中`;

  const outgoingZoom = forward
    ? [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(1.5)", opacity: 1 }]
    : [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(.78)", opacity: 1 }];
  await outgoing?.animate(outgoingZoom, { duration: ZOOM_MS, easing: "cubic-bezier(.22,.75,.25,1)", fill: "both" }).finished.catch(() => {});
  transitionStatus.textContent = `${toLayer.title} / 交叉溶解`;
  await Promise.all([
    outgoing?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: OVERLAP_MS, easing: "linear", fill: "both" }).finished.catch(() => {}),
    incoming.animate([{ opacity: 0, transform: "scale(1.5)" }, { opacity: 1, transform: "scale(1.5)" }], { duration: OVERLAP_MS, easing: "linear", fill: "both" }).finished.catch(() => {}),
  ]);
  transitionStatus.textContent = `${toLayer.title} / 收束中`;
  await incoming.animate([{ opacity: 1, transform: "scale(1.5)" }, { opacity: 1, transform: "scale(1)" }], { duration: SETTLE_MS, easing: "cubic-bezier(.22,.75,.25,1)", fill: "both" }).finished.catch(() => {});
  outgoing?.remove();
  currentFrame = incoming;
  currentIndex = nextIndex;
  setLayerMeta(currentIndex);
  renderBreadcrumbs();
  renderHotspots();
  if (toLayer.hotspot) window.setTimeout(() => moveCursorTo(toLayer.hotspot, false), 120);
  transitionStatus.textContent = `${toLayer.id} / 本地素材就绪`;
  isTransitioning = false;
}

function initialise() {
  currentFrame = buildFrame(layerAt(0));
  mediaStack.append(currentFrame);
  setLayerMeta(0);
  renderBreadcrumbs();
  renderHotspots();
  window.setTimeout(() => moveCursorTo(layerAt(0).hotspot, false), 420);
  backButton.addEventListener("click", () => goTo(currentIndex - 1));
}

initialise();

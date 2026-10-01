const CANVAS_WIDTH = 32;
const CANVAS_HEIGHT = 32;

const ZOOM_LEVELS = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const GRID_MIN_ZOOM = 8;

const CHECKER_LIGHT = "#d9d9e0";
const CHECKER_DARK = "#b9b9c4";

const TOOL_SHORTCUTS = {
  KeyB: "pencil",
  KeyE: "eraser",
  KeyG: "fill",
  KeyI: "picker",
  KeyL: "line",
  KeyR: "rectangle",
  KeyO: "ellipse",
};

const BRUSH_TOOLS = ["pencil", "eraser"];
const SHAPE_TOOLS = ["line", "rectangle", "ellipse"];

const workspace = document.getElementById("workspace");
const editorCanvas = document.getElementById("editorCanvas");
const context = editorCanvas.getContext("2d");

const toolInfo = document.getElementById("toolInfo");
const cursorInfo = document.getElementById("cursorInfo");
const sizeInfo = document.getElementById("sizeInfo");
const zoomInfo = document.getElementById("zoomInfo");

const toolButtons = document.querySelectorAll(".toolButton");
const colorPicker = document.getElementById("colorPicker");
const fillShapesBox = document.getElementById("fillShapes");
const themeToggleButton = document.getElementById("themeToggleButton");
const shortcutsButton = document.getElementById("shortcutsButton");
const shortcutsOverlay = document.getElementById("shortcutsOverlay");
const closeShortcutButton = document.getElementById("closeShortcutsButton");
const layerPanel = document.getElementById("layerPanel");
const collapseLayersButton = document.getElementById("collapseLayerButton");

// null means transparent
const pixelGrid = createEmptyGrid(CANVAS_WIDTH, CANVAS_HEIGHT);

const view = {
  zoomIndex: ZOOM_LEVELS.indexOf(12),
  offsetX: 0,
  offsetY: 0,
};

let activeTool = "pencil";
let paintColor = colorPicker.value;
let drag = null;

let hoveredPixel = null;
let isPanning = false;
let isSpaceHeld = false;
let lastPointerX = 0;
let lastPointerY = 0;

function createEmptyGrid(width, height) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(new Array(width).fill(null));
  }
  return rows;
}

function cloneGrid(grid) {
  return grid.map((row) => row.slice());
}

function restoreGrid(target, source) {
  for (let y = 0; y < source.length; y++) {
    for (let x = 0; x < source[y].length; x++) {
      target[y][x] = source[y][x];
    }
  }
}

function getZoom() {
  return ZOOM_LEVELS[view.zoomIndex];
}

function centerCanvasInView() {
  const zoom = getZoom();
  view.offsetX = Math.round((workspace.clientWidth - CANVAS_WIDTH * zoom) / 2);
  view.offsetY = Math.round((workspace.clientHeight - CANVAS_HEIGHT * zoom) / 2);
}

function resizeCanvasToWorkspace() {
  const ratio = window.devicePixelRatio || 1;
  editorCanvas.width = workspace.clientWidth * ratio;
  editorCanvas.height = workspace.clientHeight * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  render();
}

function getPointerPosition(event) {
  const bounds = editorCanvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

// not clamped on purpose, strokes can leave the canvas and come back
function getPixelUnderPointer(screenX, screenY) {
  const zoom = getZoom();
  return {
    x: Math.floor((screenX - view.offsetX) / zoom),
    y: Math.floor((screenY - view.offsetY) / zoom),
  };
}

function isInsideCanvas(x, y) {
  return x >= 0 && x < CANVAS_WIDTH && y >= 0 && y < CANVAS_HEIGHT;
}

function clampToCanvas(pixel) {
  return {
    x: Math.min(Math.max(pixel.x, 0), CANVAS_WIDTH - 1),
    y: Math.min(Math.max(pixel.y, 0), CANVAS_HEIGHT - 1),
  };
}

function setPixel(x, y, color) {
  if (!isInsideCanvas(x, y)) return;
  pixelGrid[y][x] = color;
}

function toggleTheme(){
  const isLight = document.body.dataset.theme = "light";
  document.body.dataset.theme = isLight ? "dark" : "light";
}

function toggleLayerPanelCollapse(){
  const iscollapsed = layerPanel.classList.toggle("isCollapsed");
  collapseLayersButton.textContent = iscollapsed ? "▸" : "▾";
}

function setShortcutsVisible(isVisible){
  shortcutsOverlay.classList.toggle("isHidden", !isVisible);
}

function changeZoom(direction, anchorX, anchorY) {
  const nextIndex = view.zoomIndex + direction;
  if (nextIndex < 0 || nextIndex >= ZOOM_LEVELS.length) return;

  // keep the pixel under the cursor where it is while zooming
  const oldZoom = getZoom();
  const imageX = (anchorX - view.offsetX) / oldZoom;
  const imageY = (anchorY - view.offsetY) / oldZoom;

  view.zoomIndex = nextIndex;
  const newZoom = getZoom();
  view.offsetX = Math.round(anchorX - imageX * newZoom);
  view.offsetY = Math.round(anchorY - imageY * newZoom);
  render();
}

// bresenham, includes both end points
function getLinePoints(from, to) {
  const points = [];
  const deltaX = Math.abs(to.x - from.x);
  const deltaY = Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;

  let x = from.x;
  let y = from.y;
  let error = deltaX - deltaY;

  while (true) {
    points.push({ x, y });
    if (x === to.x && y === to.y) break;

    const doubleError = error * 2;
    if (doubleError > -deltaY) {
      error -= deltaY;
      x += stepX;
    }
    if (doubleError < deltaX) {
      error += deltaX;
      y += stepY;
    }
  }
  return points;
}

function isSideStep(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function isDiagonalStep(a, b) {
  return Math.abs(a.x - b.x) === 1 && Math.abs(a.y - b.y) === 1;
}

// pixel perfect: when the path turns a corner (an L shape) the corner pixel
// is extra, the two pixels around it already touch diagonally
function dropCornerPixel(path, nextPoint) {
  if (path.length < 2) return;

  const before = path[path.length - 2];
  const corner = path[path.length - 1];
  const makesL =
    isSideStep(before, corner) &&
    isSideStep(corner, nextPoint) &&
    isDiagonalStep(before, nextPoint);

  if (makesL) path.pop();
}

function getRectanglePoints(from, to, isFilled) {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);

  const points = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const isOnEdge = x === left || x === right || y === top || y === bottom;
      if (isFilled || isOnEdge) points.push({ x, y });
    }
  }
  return points;
}

// a pixel belongs to the ellipse when its center is inside the curve,
// the outline is the ones that have an outside neighbour
function getEllipsePoints(from, to, isFilled) {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);

  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const radiusX = (right - left + 1) / 2;
  const radiusY = (bottom - top + 1) / 2;

  function isInsideEllipse(x, y) {
    const relativeX = (x - centerX) / radiusX;
    const relativeY = (y - centerY) / radiusY;
    return relativeX * relativeX + relativeY * relativeY <= 1;
  }

  const points = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (!isInsideEllipse(x, y)) continue;

      const touchesOutside =
        !isInsideEllipse(x + 1, y) ||
        !isInsideEllipse(x - 1, y) ||
        !isInsideEllipse(x, y + 1) ||
        !isInsideEllipse(x, y - 1);
      if (isFilled || touchesOutside) points.push({ x, y });
    }
  }
  return points;
}

// shift held: make the end pixel so the shape is a square / circle,
// and never bigger than the space left inside the canvas
function makeSquareEnd(start, end) {
  const goesLeft = end.x < start.x;
  const goesUp = end.y < start.y;
  const roomX = goesLeft ? start.x : CANVAS_WIDTH - 1 - start.x;
  const roomY = goesUp ? start.y : CANVAS_HEIGHT - 1 - start.y;

  const wantedSize = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  const size = Math.min(wantedSize, roomX, roomY);

  return {
    x: start.x + (goesLeft ? -size : size),
    y: start.y + (goesUp ? -size : size),
  };
}

function floodFill(startPixel, newColor) {
  if (!isInsideCanvas(startPixel.x, startPixel.y)) return;

  const targetColor = pixelGrid[startPixel.y][startPixel.x];
  if (targetColor === newColor) return;

  const pending = [startPixel];
  while (pending.length > 0) {
    const { x, y } = pending.pop();
    if (!isInsideCanvas(x, y)) continue;
    if (pixelGrid[y][x] !== targetColor) continue;

    pixelGrid[y][x] = newColor;
    pending.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
  }
}

function pickColorAt(pixel) {
  if (!isInsideCanvas(pixel.x, pixel.y)) return;

  const color = pixelGrid[pixel.y][pixel.x];
  if (color === null) return;

  paintColor = color;
  colorPicker.value = color;
}

function startDrag(pixel) {
  const isShape = SHAPE_TOOLS.includes(activeTool);
  const startPixel = isShape ? clampToCanvas(pixel) : pixel;

  drag = {
    tool: activeTool,
    color: activeTool === "eraser" ? null : paintColor,
    snapshot: cloneGrid(pixelGrid),
    startPixel,
    endPixel: startPixel,
    path: [startPixel],
  };
  redrawDrag();
}

function extendBrushPath(pixel) {
  const lastPoint = drag.path[drag.path.length - 1];
  if (pixel.x === lastPoint.x && pixel.y === lastPoint.y) return;

  // first point of the line is the last point of the path already
  const newPoints = getLinePoints(lastPoint, pixel).slice(1);
  for (const point of newPoints) {
    if (drag.tool === "pencil") dropCornerPixel(drag.path, point);
    drag.path.push(point);
  }
}

function updateDrag(pixel, keepSquare) {
  if (BRUSH_TOOLS.includes(drag.tool)) {
    extendBrushPath(pixel);
  } else {
    const endPixel = clampToCanvas(pixel);
    const isRoundShape = drag.tool !== "line";
    drag.endPixel = keepSquare && isRoundShape
      ? makeSquareEnd(drag.startPixel, endPixel)
      : endPixel;
  }
  redrawDrag();
}

function getDragPoints() {
  const { tool, startPixel, endPixel } = drag;
  if (BRUSH_TOOLS.includes(tool)) return drag.path;
  if (tool === "line") return getLinePoints(startPixel, endPixel);
  if (tool === "rectangle") return getRectanglePoints(startPixel, endPixel, fillShapesBox.checked);
  return getEllipsePoints(startPixel, endPixel, fillShapesBox.checked);
}

// always redraw from the snapshot, so a dropped corner pixel or a shape
// that got smaller gets the old colors back
function redrawDrag() {
  restoreGrid(pixelGrid, drag.snapshot);
  for (const point of getDragPoints()) {
    setPixel(point.x, point.y, drag.color);
  }
}

function selectTool(toolName) {
  activeTool = toolName;
  for (const button of toolButtons) {
    button.classList.toggle("isActive", button.dataset.tool === toolName);
  }
  updateStatusBar();
}

function drawCheckerboard(zoom) {
  for (let y = 0; y < CANVAS_HEIGHT; y++) {
    for (let x = 0; x < CANVAS_WIDTH; x++) {
      context.fillStyle = (x + y) % 2 === 0 ? CHECKER_LIGHT : CHECKER_DARK;
      context.fillRect(view.offsetX + x * zoom, view.offsetY + y * zoom, zoom, zoom);
    }
  }
}

function drawPixels(zoom) {
  for (let y = 0; y < CANVAS_HEIGHT; y++) {
    for (let x = 0; x < CANVAS_WIDTH; x++) {
      const color = pixelGrid[y][x];
      if (color === null) continue;
      context.fillStyle = color;
      context.fillRect(view.offsetX + x * zoom, view.offsetY + y * zoom, zoom, zoom);
    }
  }
}

function drawGridLines(zoom) {
  const left = view.offsetX;
  const top = view.offsetY;
  const width = CANVAS_WIDTH * zoom;
  const height = CANVAS_HEIGHT * zoom;

  context.strokeStyle = "rgba(0, 0, 0, 0.18)";
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x <= CANVAS_WIDTH; x++) {
    const lineX = left + x * zoom + 0.5;
    context.moveTo(lineX, top);
    context.lineTo(lineX, top + height);
  }
  for (let y = 0; y <= CANVAS_HEIGHT; y++) {
    const lineY = top + y * zoom + 0.5;
    context.moveTo(left, lineY);
    context.lineTo(left + width, lineY);
  }
  context.stroke();
}

function drawHoverOutline(zoom) {
  if (!hoveredPixel || isPanning) return;
  context.strokeStyle = "#ff4d6d";
  context.lineWidth = 2;
  context.strokeRect(
    view.offsetX + hoveredPixel.x * zoom + 1,
    view.offsetY + hoveredPixel.y * zoom + 1,
    zoom - 2,
    zoom - 2
  );
}

function updateStatusBar() {
  toolInfo.textContent = `tool: ${activeTool}`;
  sizeInfo.textContent = `${CANVAS_WIDTH} x ${CANVAS_HEIGHT}`;
  zoomInfo.textContent = `zoom ${getZoom() * 100}%`;
  cursorInfo.textContent = hoveredPixel
    ? `x: ${hoveredPixel.x}  y: ${hoveredPixel.y}`
    : "x: -  y: -";
}

function render() {
  const zoom = getZoom();
  context.clearRect(0, 0, workspace.clientWidth, workspace.clientHeight);

  drawCheckerboard(zoom);
  drawPixels(zoom);
  if (zoom >= GRID_MIN_ZOOM) drawGridLines(zoom);
  drawHoverOutline(zoom);
  updateStatusBar();
}

function updateCursorStyle() {
  if (isPanning) editorCanvas.style.cursor = "grabbing";
  else if (isSpaceHeld) editorCanvas.style.cursor = "grab";
  else editorCanvas.style.cursor = "crosshair";
}

function startPanning(event) {
  isPanning = true;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  editorCanvas.setPointerCapture(event.pointerId);
  updateCursorStyle();
}

function endPointerAction() {
  isPanning = false;
  drag = null;
  updateCursorStyle();
  render();
}

editorCanvas.addEventListener("pointerdown", (event) => {
  const isMiddleButton = event.button === 1;
  const isSpaceDrag = event.button === 0 && isSpaceHeld;
  if (isMiddleButton || isSpaceDrag) {
    event.preventDefault();
    startPanning(event);
    return;
  }

  if (event.button !== 0) return;

  const position = getPointerPosition(event);
  const pixel = getPixelUnderPointer(position.x, position.y);

  if (activeTool === "picker") {
    pickColorAt(pixel);
    return;
  }
  if (activeTool === "fill") {
    floodFill(pixel, paintColor);
    render();
    return;
  }

  editorCanvas.setPointerCapture(event.pointerId);
  startDrag(pixel);
  render();
});

editorCanvas.addEventListener("pointermove", (event) => {
  const position = getPointerPosition(event);
  const pixel = getPixelUnderPointer(position.x, position.y);

  if (isPanning) {
    view.offsetX += event.clientX - lastPointerX;
    view.offsetY += event.clientY - lastPointerY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  } else if (drag) {
    updateDrag(pixel, event.shiftKey);
  }

  hoveredPixel = isInsideCanvas(pixel.x, pixel.y) ? pixel : null;
  render();
});

editorCanvas.addEventListener("pointerup", endPointerAction);
editorCanvas.addEventListener("pointercancel", endPointerAction);

editorCanvas.addEventListener("pointerleave", () => {
  hoveredPixel = null;
  render();
});

themeToggleButton.addEventListener("click", toggleTheme);
collapseLayersButton.addEventListener("click", toggleLayerPanelCollapse);
shortcutsButton.addEventListener("click", () => setShortcutsVisible(true));
closeShortcutButton.addEventListener("click", () => setShortcutsVisible(false));
shortcutsOverlay.addEventListener("click", (event) => {
  if(event.target === shortcutsOverlay) setShortcutsVisible(false);
});

editorCanvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const position = getPointerPosition(event);
    const direction = event.deltaY < 0 ? 1 : -1;
    changeZoom(direction, position.x, position.y);
  },
  { passive: false }
);

toolButtons.forEach((button) => {
  button.addEventListener("click", () => selectTool(button.dataset.tool));
});

colorPicker.addEventListener("input", () => {
  paintColor = colorPicker.value;
});

// a focused button would react to the space bar, and space is our pan key
document.addEventListener("click", (event) => {
  if (event.target.matches("button")) event.target.blur();
});
colorPicker.addEventListener("change", () => colorPicker.blur());

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    isSpaceHeld = true;
    updateCursorStyle();
  }
  if (event.code === "Digit0") {
    centerCanvasInView();
    render();
  }
  if(event.key === "?"){
    setShortcutsVisible(true);
  }
  if(event.code === "Escape"){
    setShortcutsVisible(false);
  }

  const shortcutTool = TOOL_SHORTCUTS[event.code];
  if (shortcutTool && !event.ctrlKey && !event.metaKey) {
    selectTool(shortcutTool);
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    isSpaceHeld = false;
    updateCursorStyle();
  }
});

window.addEventListener("resize", () => {
  resizeCanvasToWorkspace();
});

centerCanvasInView();
resizeCanvasToWorkspace();
selectTool("pencil");
updateCursorStyle();

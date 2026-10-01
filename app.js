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

const addLayerButton = document.getElementById("addLayerButton");
const layerList = document.getElementById("layerList");
const opacitySlider = document.getElementById("opacitySlider");
const opacityValue = document.getElementById("opacityValue");

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

let layers = [];
let activeLayerId = null;
let nextLayerNumber = 1;

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

function createLayer(name) {
  return {
    id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    grid: createEmptyGrid(CANVAS_WIDTH, CANVAS_HEIGHT),
    isVisible: true,
    opacity: 100,
  };
}

function getActiveLayer() {
  return layers.find((layer) => layer.id === activeLayerId);
}

function addLayer() {
  const layer = createLayer(`Layer ${nextLayerNumber}`);
  nextLayerNumber += 1;

  const activeIndex = layers.findIndex((existing) => existing.id === activeLayerId);
  layers.splice(activeIndex + 1, 0, layer);
  activeLayerId = layer.id;

  renderLayerList();
  render();
}

function deleteLayer(layerId) {
  if (layers.length <= 1) return;

  const removedIndex = layers.findIndex((layer) => layer.id === layerId);
  layers.splice(removedIndex, 1);

  if (activeLayerId === layerId) {
    const fallbackIndex = Math.max(0, removedIndex - 1);
    activeLayerId = layers[fallbackIndex].id;
  }

  renderLayerList();
  render();
}

function selectLayer(layerId) {
  activeLayerId = layerId;
  renderLayerList();
}

function renameLayer(layerId, name) {
  const layer = layers.find((existing) => existing.id === layerId);
  if (layer) layer.name = name || layer.name;
}

function toggleLayerVisibility(layerId) {
  const layer = layers.find((existing) => existing.id === layerId);
  if (!layer) return;

  layer.isVisible = !layer.isVisible;
  renderLayerList();
  render();
}

function setActiveLayerOpacity(opacity) {
  const layer = getActiveLayer();
  if (!layer) return;

  layer.opacity = opacity;
  opacityValue.textContent = `${opacity}%`;
  render();
}

function renderLayerList() {
  layerList.innerHTML = "";

  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index];

    const row = document.createElement("div");
    row.className = "layerRow";
    row.classList.toggle("isActive", layer.id === activeLayerId);

    const visibilityBox = document.createElement("input");
    visibilityBox.type = "checkbox";
    visibilityBox.className = "layerVisibility";
    visibilityBox.checked = layer.isVisible;
    visibilityBox.title = "Toggle visibility";
    visibilityBox.addEventListener("click", (event) => event.stopPropagation());
    visibilityBox.addEventListener("change", () => toggleLayerVisibility(layer.id));

    const nameField = document.createElement("input");
    nameField.type = "text";
    nameField.className = "layerName";
    nameField.value = layer.name;
    nameField.addEventListener("click", (event) => event.stopPropagation());
    nameField.addEventListener("change", () => renameLayer(layer.id, nameField.value.trim()));

    const deleteButton = document.createElement("button");
    deleteButton.className = "deleteLayerButton";
    deleteButton.textContent = "\u00d7";
    deleteButton.title = "Delete layer";
    deleteButton.disabled = layers.length <= 1;
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteLayer(layer.id);
    });

    row.append(visibilityBox, nameField, deleteButton);
    row.addEventListener("click", () => selectLayer(layer.id));
    layerList.appendChild(row);
  }

  const activeLayer = getActiveLayer();
  if (activeLayer) {
    opacitySlider.value = activeLayer.opacity;
    opacityValue.textContent = `${activeLayer.opacity}%`;
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

function setPixel(grid, x, y, color) {
  if (!isInsideCanvas(x, y)) return;
  grid[y][x] = color;
}

function changeZoom(direction, anchorX, anchorY) {
  const nextIndex = view.zoomIndex + direction;
  if (nextIndex < 0 || nextIndex >= ZOOM_LEVELS.length) return;

  const oldZoom = getZoom();
  const imageX = (anchorX - view.offsetX) / oldZoom;
  const imageY = (anchorY - view.offsetY) / oldZoom;

  view.zoomIndex = nextIndex;
  const newZoom = getZoom();
  view.offsetX = Math.round(anchorX - imageX * newZoom);
  view.offsetY = Math.round(anchorY - imageY * newZoom);
  render();
}

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

function makeSquareEnd(start, end) {
  const goesLeft = end.x < start.x;
  const goesUp = end.y < start.y;
  const roomX = goesLeft ? start.x : CANVAS_WIDTH - 1 - start.x;
  const roomY = goesUp ? start.y : CANVAS_HEIGHT - 1 - start.y;

  const wantedSize = Math.max(
    Math.abs(end.x - start.x),
    Math.abs(end.y - start.y)
  );

  const size = Math.min(wantedSize, roomX, roomY);

  return {
    x: start.x + (goesLeft ? -size : size),
    y: start.y + (goesUp ? -size : size),
  };
}

function floodFill(grid, startPixel, newColor) {
  if (!isInsideCanvas(startPixel.x, startPixel.y)) return;

  const targetColor = grid[startPixel.y][startPixel.x];
  if (targetColor === newColor) return;

  const pending = [startPixel];

  while (pending.length > 0) {
    const { x, y } = pending.pop();

    if (!isInsideCanvas(x, y)) continue;
    if (grid[y][x] !== targetColor) continue;

    grid[y][x] = newColor;

    pending.push(
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 }
    );
  }
}

function pickColorAt(pixel) {
  if (!isInsideCanvas(pixel.x, pixel.y)) return;

  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index];

    if (!layer.isVisible) continue;

    const color = layer.grid[pixel.y][pixel.x];

    if (color !== null) {
      paintColor = color;
      colorPicker.value = color;
      return;
    }
  }
}

function startDrag(pixel) {
  const isShape = SHAPE_TOOLS.includes(activeTool);
  const startPixel = isShape ? clampToCanvas(pixel) : pixel;

  drag = {
    tool: activeTool,
    color: activeTool === "eraser" ? null : paintColor,
    layer: getActiveLayer(),
    snapshot: cloneGrid(getActiveLayer().grid),
    startPixel,
    endPixel: startPixel,
    path: [startPixel],
  };

  redrawDrag();
}

function extendBrushPath(pixel) {
  const lastPoint = drag.path[drag.path.length - 1];

  if (pixel.x === lastPoint.x && pixel.y === lastPoint.y) return;

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

    drag.endPixel =
      keepSquare && isRoundShape
        ? makeSquareEnd(drag.startPixel, endPixel)
        : endPixel;
  }

  redrawDrag();
}

function getDragPoints() {
  const { tool, startPixel, endPixel } = drag;

  if (BRUSH_TOOLS.includes(tool)) return drag.path;

  if (tool === "line") {
    return getLinePoints(startPixel, endPixel);
  }

  if (tool === "rectangle") {
    return getRectanglePoints(
      startPixel,
      endPixel,
      fillShapesBox.checked
    );
  }

  return getEllipsePoints(
    startPixel,
    endPixel,
    fillShapesBox.checked
  );
}

function redrawDrag() {
  restoreGrid(drag.layer.grid, drag.snapshot);

  for (const point of getDragPoints()) {
    setPixel(
      drag.layer.grid,
      point.x,
      point.y,
      drag.color
    );
  }
}

function selectTool(toolName) {
  activeTool = toolName;

  for (const button of toolButtons) {
    button.classList.toggle(
      "isActive",
      button.dataset.tool === toolName
    );
  }

  updateStatusBar();
}

function drawCheckerboard(zoom) {
  for (let y = 0; y < CANVAS_HEIGHT; y++) {
    for (let x = 0; x < CANVAS_WIDTH; x++) {
      context.fillStyle =
        (x + y) % 2 === 0
          ? CHECKER_LIGHT
          : CHECKER_DARK;

      context.fillRect(
        view.offsetX + x * zoom,
        view.offsetY + y * zoom,
        zoom,
        zoom
      );
    }
  }
}

function drawLayers(zoom) {
  for (const layer of layers) {
    if (!layer.isVisible || layer.opacity === 0) continue;

    context.globalAlpha = layer.opacity / 100;

    for (let y = 0; y < CANVAS_HEIGHT; y++) {
      for (let x = 0; x < CANVAS_WIDTH; x++) {
        const color = layer.grid[y][x];

        if (color === null) continue;

        context.fillStyle = color;

        context.fillRect(
          view.offsetX + x * zoom,
          view.offsetY + y * zoom,
          zoom,
          zoom
        );
      }
    }
  }

  context.globalAlpha = 1;
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
  const activeLayer = getActiveLayer();

  toolInfo.textContent = activeLayer
    ? `tool: ${activeTool}  layer: ${activeLayer.name}`
    : `tool: ${activeTool}`;

  sizeInfo.textContent = `${CANVAS_WIDTH} x ${CANVAS_HEIGHT}`;
  zoomInfo.textContent = `zoom ${getZoom() * 100}%`;

  cursorInfo.textContent = hoveredPixel
    ? `x: ${hoveredPixel.x}  y: ${hoveredPixel.y}`
    : "x: -  y: -";
}

function render() {
  const zoom = getZoom();

  context.clearRect(
    0,
    0,
    workspace.clientWidth,
    workspace.clientHeight
  );

  drawCheckerboard(zoom);
  drawLayers(zoom);

  if (zoom >= GRID_MIN_ZOOM) {
    drawGridLines(zoom);
  }

  drawHoverOutline(zoom);
  updateStatusBar();
}

function updateCursorStyle() {
  if (isPanning) {
    editorCanvas.style.cursor = "grabbing";
  } else if (isSpaceHeld) {
    editorCanvas.style.cursor = "grab";
  } else {
    editorCanvas.style.cursor = "crosshair";
  }
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
    floodFill(
      getActiveLayer().grid,
      pixel,
      paintColor
    );

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

  hoveredPixel =
    isInsideCanvas(pixel.x, pixel.y)
      ? pixel
      : null;

  render();
});

editorCanvas.addEventListener(
  "pointerup",
  endPointerAction
);

editorCanvas.addEventListener(
  "pointercancel",
  endPointerAction
);

editorCanvas.addEventListener("pointerleave", () => {
  hoveredPixel = null;
  render();
});

editorCanvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();

    const position = getPointerPosition(event);
    const direction =
      event.deltaY < 0
        ? 1
        : -1;

    changeZoom(
      direction,
      position.x,
      position.y
    );
  },
  { passive: false }
);

toolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectTool(button.dataset.tool);
  });
});

colorPicker.addEventListener("input", () => {
  paintColor = colorPicker.value;
});

addLayerButton.addEventListener(
  "click",
  addLayer
);

opacitySlider.addEventListener("input", () => {
  setActiveLayerOpacity(
    Number(opacitySlider.value)
  );
});

document.addEventListener("click", (event) => {
  if (event.target.matches("button")) {
    event.target.blur();
  }
});

colorPicker.addEventListener("change", () => {
  colorPicker.blur();
});

opacitySlider.addEventListener("change", () => {
  opacitySlider.blur();
});

window.addEventListener("keydown", (event) => {
  if (event.target.matches("input")) return;

  if (event.code === "Space") {
    event.preventDefault();
    isSpaceHeld = true;
    updateCursorStyle();
  }

  if (event.code === "Digit0") {
    centerCanvasInView();
    render();
  }

  const shortcutTool = TOOL_SHORTCUTS[event.code];

  if (
    shortcutTool &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
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

function setUpInitialLayer() {
  const layer = createLayer(
    `Layer ${nextLayerNumber}`
  );

  nextLayerNumber += 1;

  layers.push(layer);
  activeLayerId = layer.id;
}

setUpInitialLayer();
renderLayerList();
centerCanvasInView();
resizeCanvasToWorkspace();
selectTool("pencil");
updateCursorStyle();

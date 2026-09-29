const CANVAS_WIDTH = 32;
const CANVAS_HEIGHT = 32;

const ZOOM_LEVELS = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const GRID_MIN_ZOOM = 8;

const CHECKER_LIGHT = "#d9d9e0";
const CHECKER_DARK = "#b9b9c4";

const workspace = document.getElementById("workspace");
const editorCanvas = document.getElementById("editorCanvas");
const context = editorCanvas.getContext("2d");

const cursorInfo = document.getElementById("cursorInfo");
const sizeInfo = document.getElementById("sizeInfo");
const zoomInfo = document.getElementById("zoomInfo");

const pixelGrid = createEmptyGrid(CANVAS_WIDTH, CANVAS_HEIGHT);
const view = {
    zoomIndex: ZOOM_LEVELS.indexOf(12),
    offsetX: 0,
    offsetY: 0,
};

let hoveredPixel = null;
let isPanning = false;
let isSpaceHeld = false;
let lastPointerX = 0;
let lastPointerY = 0;

function createEmptyGrid(width, height){
    const rows = [];
    for(let y = 0; y < height; y++){
        rows.push(new Array(width).fill(null));
    }
    return rows;
}

function getZoom(){
    return ZOOM_LEVELS[view.zoomIndex];
}

function centerCanvasInView(){
    const zoom = getZoom();
    view.offsetX = Math.round((workspace.clientWidth - CANVAS_WIDTH * zoom) / 2);
    view.offsetY = Math.round((workspace.clientHeight - CANVAS_HEIGHT * zoom) / 2);
}

function resizeCanvasToWorkspace(){
    const ratio = window.devicePixelRatio || 1;
    editorCanvas.width = workspace.clientWidth * ratio;
    editorCanvas.height = workspace.clientHeight * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    render();
}

function screenToPixel(screenX, screenY){
    const zoom = getZoom();
    const pixelX = Math.floor((screenX - view.offsetX) / zoom);
    const pixelY = Math.floor((screenY - view.offsetY) / zoom);
    const isInside = 
        pixelX >= 0 && pixelX < CANVAS_WIDTH && pixelY >= 0 && pixelY < CANVAS_HEIGHT;
    return isInside ? { x: pixelX, y: pixelY } : null;
}

function changeZoom(direction, anchorX, anchorY){
    const nextIndex = view.zoomIndex + direction;
    if(nextIndex < 0 || nextIndex >= ZOOM_LEVELS.length) return;

    const oldZoom = getZoom();
    const imageX = (anchorX - view.offsetX) / oldZoom;
    const imageY = (anchorY - view.offsetY) / oldZoom;

    view.zoomIndex = nextIndex;
    const newZoom = getZoom();
    view.offsetX = Math.round(anchorX - imageX * newZoom);
    view.offsetY = Math.round(anchorY - imageY * newZoom);
}

function drawCheckerboard(zoom){
    for(let y = 0; y < CANVAS_HEIGHT; y++){
        for(let x = 0; x < CANVAS_WIDTH; x++){
            context.fillstyle = (x + y) % 2 === 0 ? CHECKER_LIGHT : CHECKER_DARK;
            context.fillRect(view.offsetX + x * zoom, view.offsetY + y * zoom, zoom, zoom);
        }
    }
}

function drawPixels(zoom){
    for(let y = 0; y < CANVAS_HEIGHT; y++){
        for(let x = 0; x < CANVAS_WIDTH; x++){
            const color = pixelGrid[y][x];
            if(color === null) continue;
            context.fillstyle = color;
            context.fillRect(view.offsetX + x * zoom, view.offsetY + y * zoom, zoom, zoom);
        }
    }
}

function drawGridLines(zoom){
    const left = view.offsetX;
    const top = view.offsetY;
    const width = CANVAS_WIDTH * zoom;
    const height = CANVAS_HEIGHT * zoom;

    context.strokeStyle = "rgba(0, 0, 0, 0.18)";
    context.lineWidth = 1;
    context.beginPath();
    for(let x = 0; x <= CANVAS_WIDTH; x++){
        const lineX = left + x * zoom + 0.5;
        context.moveTo(lineX, top);
        context.lineTo(lineX, top + height);
    }
    for(let y = 0; y <= CANVAS_HEIGHT; y++){
        const lineY = top + y * zoom + 0.5;
        context.moveTo(left, lineY);
        context.lineTo(left + width, lineY);
    }
    context.stroke();
}

function drawHoverOutline(zoom){
    if(!hoveredPixel || isPanning) return;
    context.strokeStyle = "#ff4d6d";
    context.lineWidth = 2;
    context.strokeRect(
        view.offsetX + hoveredPixel.x * zoom + 1,
        view.offsetY + hoveredPixel.y * zoom + 1,
        zoom - 2,
        zoom - 2
    );
}

function updateStatusBar(){
    sizeInfo.textContent = `${CANVAS_WIDTH} x ${CANVAS_HEIGHT}`;
    zoomInfo.textContent = `zoom ${getZoom() * 100}%`;
    cursorInfo.textContent = hoveredPixel
        ? `x: ${hoveredPixel.x} y: ${hoveredPixel.y}`
        : "x: - y: -"; 
}

function render(){
    const zoom = getZoom();
    context.clearRect(0, 0, workspace.clientWidth, workspace.clientHeight);

    drawCheckerboard(zoom);
    drawPixels(zoom);
    if(zoom >= GRID_MIN_ZOOM) drawGridLines(zoom);
    drawHoverOutline(zoom);
    updateStatusBar();
}

function updateStatusBar(){
    if(isPanning) editorCanvas.style.cursor = "grabbing";
    else if (isSpaceHeld) editorCanvas.style.cursor = "grab";
    else editorCanvas.style.cursor = "crosshair";
}

function startPanning(event){
    isPanning = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    editorCanvas.setPointerCapture(event.pointerId);
    udpateCursorStyle();
}

editorCanvas.addEventListener("pointerdown", (event) => {
    const isMiddleButton = event.button === 1;
    const isSpaceDrag = event.button === 0 && isSpaceHeld;
    if(isMiddleButton || isSpaceDrag){
        event.preventDefault();
        startPanning(event);
    }
});

editorCanvas.addEventListener("pointermove", (event) => {
    const bounds = editorCanvas.getBoundingClientRect();
    const screenX = event.clientX - bounds.left;
    const screenY = event.clientY - bounds.top;

    if(isPanning){
        view.offsetX += event.clientX - lastPointerX;
        view.offsetY += event.clientY - lastPointerY;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
    }
    hoveredPixel = screenToPixel(screenX, screenY);
    render();
});

editorCanvas.addEventListener("pointerup", () => {
    isPanning = false;
    udpateCursorStyle();
});

editorCanvas.addEventListener("pointerleave", () => {
    hoveredPixel = null;
    render();
});

editorCanvas.addEventListener(
    "wheel",
    (event) => {
        event.preventDefault();
        const bounds = editorCanvas.getBoundingClientRect();
        const direction = event.deltaY < 0 ? 1 : -1;
        changeZoom(direction, event.clientX - bounds.left, event.clientX, event.clientY - bounds.top);
    },
    { passive: false }
);

window.addEventListener("keydown", (event) => {
    if(event.code === "Space"){
        event.preventDefault();
        isSpaceHeld = true;
        udpateCursorStyle();
    }
    if(event.code === "Digit0"){
        centerCanvasInView();
        render();
    }
});

window.addEventListener("keyup", (event) => {
    if(event.code === "Space"){
        isSpaceHeld = false;
        udpateCursorStyle();
    }
});

window.addEventListener("resize", () => {
    resizeCanvasToWorkspace();
});

centerCanvasInView();
resizeCanvasToWorkspace();
udpateCursorStyle();
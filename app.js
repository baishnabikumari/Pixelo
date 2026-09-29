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


/**
 * app.js - Application initialization, event wiring, keyboard shortcuts
 */

import { state, screenToWorld, computeSnapPoint, undo, redo, pushHistory, zoomExtents, makeEntityBase } from './core.js';
import { render } from './render.js';
import {
  TOOLS, activateTool, deleteSelected, selectAll,
  commitText, polylineTool,
} from './tools.js';
import {
  log, logError, updateStatusBar,
  renderLayerPanel, renderPropertiesPanel,
  initColorPicker, createNewLayer,
} from './ui.js';
import { exportDXF, saveJSON, loadJSON } from './dxf.js';

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initCanvas();
  initToolbar();
  initModeToggles();
  initHeaderButtons();
  initCommandLine();
  initTextInputOverlay();
  initColorPicker();
  initAI();

  // Initial render
  renderLayerPanel();
  render();
  updateStatusBar();

  // Set viewport center
  const container = document.getElementById('canvas-container');
  state.view.x = container.clientWidth / 2;
  state.view.y = container.clientHeight / 2;
  render();

  // Activate default tool
  activateTool('SELECT');

  log('XNH 2DCAD ready. Type a command or select a tool.');
  log('Shortcuts: L=Line  PL=Pline  REC=Rect  C=Circle  A=Arc  T=Text  M=Move  CP=Copy  F8=Ortho  F3=Snap');
});

// ─────────────────────────────────────────────────────────────────────────────
// Canvas Events
// ─────────────────────────────────────────────────────────────────────────────

function initCanvas() {
  const container = document.getElementById('canvas-container');

  // ── Mouse Down ──────────────────────────────────────────────────────────────
  container.addEventListener('mousedown', (e) => {
    // Middle mouse button or Space+drag = pan
    if (e.button === 1) {
      startPan(e);
      return;
    }
    if (e.button === 2) {
      // Right-click: cancel current operation
      cancelCurrent();
      return;
    }

    const world = getWorldPos(e);
    const snap = computeSnapPoint(world);
    state.snapPoint = snap;

    const tool = TOOLS[state.tool];
    if (tool && tool.onMouseDown) tool.onMouseDown(e, world, snap);

    updateStatusBar();
    renderPropertiesPanel();
  });

  // ── Mouse Move ──────────────────────────────────────────────────────────────
  container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    state.mouseScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    state.mouseWorld = screenToWorld(state.mouseScreen.x, state.mouseScreen.y);

    // Pan
    if (state.isPanning && state.panStart) {
      state.view.x += e.clientX - state.panStart.x;
      state.view.y += e.clientY - state.panStart.y;
      state.panStart = { x: e.clientX, y: e.clientY };
      render();
      updateStatusBar();
      return;
    }

    const world = state.mouseWorld;
    const snap = computeSnapPoint(world);
    state.snapPoint = snap;

    const tool = TOOLS[state.tool];
    if (tool && tool.onMouseMove) tool.onMouseMove(e, world, snap);

    updateStatusBar();
  });

  // ── Mouse Up ────────────────────────────────────────────────────────────────
  window.addEventListener('mouseup', (e) => {
    if (state.isPanning) {
      stopPan();
      return;
    }
    if (e.button !== 0) return;

    const world = getWorldPos(e);
    const snap = computeSnapPoint(world);

    const tool = TOOLS[state.tool];
    if (tool && tool.onMouseUp) tool.onMouseUp(e, world, snap);

    updateStatusBar();
    renderPropertiesPanel();
  });

  // ── Wheel Zoom (cursor-centered) ────────────────────────────────────────────
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.005, Math.min(2000, state.view.zoom * factor));
    // Zoom centered on cursor
    state.view.x = mx - (mx - state.view.x) * (newZoom / state.view.zoom);
    state.view.y = my - (my - state.view.y) * (newZoom / state.view.zoom);
    state.view.zoom = newZoom;
    const snap = computeSnapPoint(state.mouseWorld);
    state.snapPoint = snap;
    render();
    updateStatusBar();
  }, { passive: false });

  // ── Double-click to finish polyline ─────────────────────────────────────────
  container.addEventListener('dblclick', (e) => {
    if (state.tool === 'POLYLINE' && state.isDrawing) {
      polylineTool._finish(false);
      e.preventDefault();
    }
  });

  // ── Prevent context menu ────────────────────────────────────────────────────
  container.addEventListener('contextmenu', e => e.preventDefault());
}

function getWorldPos(e) {
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  return screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pan helpers
// ─────────────────────────────────────────────────────────────────────────────

function startPan(e) {
  state.isPanning = true;
  state.panStart = { x: e.clientX, y: e.clientY };
  document.getElementById('canvas-container').classList.add('panning');
}

function stopPan() {
  state.isPanning = false;
  state.panStart = null;
  document.getElementById('canvas-container').classList.remove('panning');
  render();
}

let _spaceDown = false;

// Space bar for pan
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' && !e.target.matches('input, textarea') && !_spaceDown) {
    _spaceDown = true;
    // Will be handled in mousemove with isPanning flag
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ') _spaceDown = false;
});

// ─────────────────────────────────────────────────────────────────────────────
// Cancel current operation
// ─────────────────────────────────────────────────────────────────────────────

function cancelCurrent() {
  const tool = TOOLS[state.tool];
  if (tool && tool.onKeyDown) {
    tool.onKeyDown({ key: 'Escape', preventDefault: () => {} });
  }
  state.selectedIds = new Set();
  render();
  renderPropertiesPanel();
}

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar
// ─────────────────────────────────────────────────────────────────────────────

function initToolbar() {
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      activateTool(btn.dataset.tool);
      renderPropertiesPanel();
    });
  });

  document.getElementById('btn-delete').addEventListener('click', () => {
    deleteSelected();
    renderPropertiesPanel();
    updateStatusBar();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode Toggles (Ortho, Snap, Grid)
// ─────────────────────────────────────────────────────────────────────────────

function initModeToggles() {
  const orthoBtn = document.getElementById('btn-ortho');
  const snapBtn = document.getElementById('btn-snap');
  const gridBtn = document.getElementById('btn-grid');
  const zoomExtBtn = document.getElementById('btn-zoom-extents');

  orthoBtn.addEventListener('click', () => toggleOrtho());
  snapBtn.addEventListener('click', () => toggleSnap());
  gridBtn.addEventListener('click', () => toggleGrid());
  zoomExtBtn.addEventListener('click', () => doZoomExtents());

  // Status bar toggles
  document.getElementById('status-ortho').addEventListener('click', () => toggleOrtho());
  document.getElementById('status-snap').addEventListener('click', () => toggleSnap());
}

function toggleOrtho() {
  state.orthoEnabled = !state.orthoEnabled;
  document.getElementById('btn-ortho').classList.toggle('active', state.orthoEnabled);
  log(`Ortho: ${state.orthoEnabled ? 'ON' : 'OFF'}`);
  updateStatusBar();
  render();
}

function toggleSnap() {
  state.snapEnabled = !state.snapEnabled;
  document.getElementById('btn-snap').classList.toggle('active', state.snapEnabled);
  log(`Object Snap: ${state.snapEnabled ? 'ON' : 'OFF'}`);
  updateStatusBar();
}

function toggleGrid() {
  state.gridEnabled = !state.gridEnabled;
  document.getElementById('btn-grid').classList.toggle('active', state.gridEnabled);
  render();
}

function doZoomExtents() {
  const container = document.getElementById('canvas-container');
  zoomExtents(container.clientWidth, container.clientHeight);
  render();
  updateStatusBar();
}

// ─────────────────────────────────────────────────────────────────────────────
// Header Buttons (New, Save, Load, Undo, Redo, Export DXF)
// ─────────────────────────────────────────────────────────────────────────────

function initHeaderButtons() {
  document.getElementById('btn-undo').addEventListener('click', () => {
    if (undo()) { render(); renderLayerPanel(); renderPropertiesPanel(); updateStatusBar(); log('Undo'); }
  });

  document.getElementById('btn-redo').addEventListener('click', () => {
    if (redo()) { render(); renderLayerPanel(); renderPropertiesPanel(); updateStatusBar(); log('Redo'); }
  });

  document.getElementById('btn-export-dxf').addEventListener('click', () => {
    const dxf = exportDXF();
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'drawing.dxf'; a.click();
    URL.revokeObjectURL(url);
    log(`DXF exported (${state.entities.length} entities)`);
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    const json = saveJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'drawing.xnh'; a.click();
    URL.revokeObjectURL(url);
    log('Drawing saved as JSON');
  });

  document.getElementById('btn-load').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  document.getElementById('file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        loadJSON(ev.target.result);
        renderLayerPanel();
        render();
        renderPropertiesPanel();
        updateStatusBar();
        document.getElementById('file-name').textContent = file.name;
        log(`Loaded: ${file.name}`);
      } catch (err) {
        logError('Failed to load file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('btn-new').addEventListener('click', () => {
    if (state.entities.length > 0) {
      if (!confirm('Create new drawing? Unsaved changes will be lost.')) return;
    }
    state.entities = [];
    state.selectedIds = new Set();
    pushHistory();
    render();
    renderPropertiesPanel();
    updateStatusBar();
    document.getElementById('file-name').textContent = 'untitled.xnh';
    log('New drawing');
  });

  document.getElementById('btn-new-layer').addEventListener('click', () => {
    createNewLayer();
    renderLayerPanel();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Keyboard Shortcuts
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  const target = e.target;
  const isInput = target.matches('input, textarea, select');

  // Always handle F-keys and Ctrl/Cmd shortcuts
  if (e.key === 'F8') {
    toggleOrtho(); e.preventDefault(); return;
  }
  if (e.key === 'F3') {
    toggleSnap(); e.preventDefault(); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    if (undo()) { render(); renderLayerPanel(); renderPropertiesPanel(); updateStatusBar(); log('Undo'); }
    e.preventDefault(); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
    if (redo()) { render(); renderLayerPanel(); renderPropertiesPanel(); updateStatusBar(); log('Redo'); }
    e.preventDefault(); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    selectAll(); renderPropertiesPanel(); updateStatusBar(); e.preventDefault(); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    state.selectedIds = new Set(); render(); renderPropertiesPanel(); updateStatusBar(); e.preventDefault(); return;
  }

  // Don't intercept text inputs (unless Escape)
  if (isInput) {
    if (e.key === 'Escape') {
      target.blur();
    }
    return;
  }

  // Route to active tool
  const tool = TOOLS[state.tool];
  if (tool && tool.onKeyDown) {
    tool.onKeyDown(e);
    updateStatusBar();
  }

  // Delete/Backspace = delete selected
  if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
    deleteSelected();
    renderPropertiesPanel();
    updateStatusBar();
    e.preventDefault();
  }

  // Escape = deselect + cancel
  if (e.key === 'Escape') {
    if (state.selectedIds.size > 0) {
      state.selectedIds = new Set();
      render();
      renderPropertiesPanel();
      updateStatusBar();
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Command Line
// ─────────────────────────────────────────────────────────────────────────────

function initCommandLine() {
  const input = document.getElementById('cmd-input');

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cmd = input.value.trim().toUpperCase();
      input.value = '';
      if (cmd) processCommand(cmd);
      e.preventDefault();
      e.stopPropagation();
    }
    if (e.key === 'Escape') {
      cancelCurrent();
      input.blur();
      e.preventDefault();
      e.stopPropagation();
    }
    e.stopPropagation(); // Don't let keyboard shortcuts fire
  });
}

const CMD_ALIASES = {
  'L':    'LINE',
  'PL':   'POLYLINE',
  'REC':  'RECT',
  'RECTANG': 'RECT',
  'C':    'CIRCLE',
  'A':    'ARC',
  'T':    'TEXT',
  'TEXT': 'TEXT',
  'M':    'MOVE',
  'CP':   'COPY',
  'CO':   'COPY',
  'E':    'DELETE',
  'ERASE':'DELETE',
  'DEL':  'DELETE',
  'U':    'UNDO',
  'UNDO': 'UNDO',
  'REDO': 'REDO',
  'Z':    'ZOOM',
  'ZOOM': 'ZOOM',
  'ZE':   'ZOOM_EXTENTS',
  'ZW':   'ZOOM_WINDOW',
  'F8':   'ORTHO',
  'ORTHO':'ORTHO',
  'F3':   'SNAP',
  'SNAP': 'SNAP',
  'SELECT':'SELECT',
  'SEL':  'SELECT',
};

function processCommand(raw) {
  log(`> ${raw}`);

  // Check if it's a coordinate (x,y or @dx,dy)
  if (/^@?-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(raw)) {
    handleCoordInput(raw);
    return;
  }

  // Split into tokens
  const tokens = raw.split(/\s+/);
  const cmd = CMD_ALIASES[tokens[0]] || tokens[0];

  switch (cmd) {
    case 'LINE':
    case 'POLYLINE':
    case 'RECT':
    case 'CIRCLE':
    case 'ARC':
    case 'TEXT':
    case 'MOVE':
    case 'COPY':
    case 'SELECT':
      activateTool(cmd);
      break;

    case 'DELETE':
      deleteSelected();
      renderPropertiesPanel();
      updateStatusBar();
      break;

    case 'UNDO':
      if (undo()) { render(); renderLayerPanel(); renderPropertiesPanel(); updateStatusBar(); log('Undo'); }
      else log('Nothing to undo');
      break;

    case 'REDO':
      if (redo()) { render(); renderLayerPanel(); renderPropertiesPanel(); updateStatusBar(); log('Redo'); }
      else log('Nothing to redo');
      break;

    case 'ZOOM':
      if (tokens[1] === 'E' || tokens[1] === 'EXTENTS') {
        doZoomExtents(); log('Zoom: Extents');
      } else if (tokens[1] === 'A' || tokens[1] === 'ALL') {
        doZoomExtents(); log('Zoom: All');
      } else {
        log('Usage: Z E (extents)');
      }
      break;

    case 'ZOOM_EXTENTS':
      doZoomExtents();
      break;

    case 'ORTHO':
      toggleOrtho();
      break;

    case 'SNAP':
      toggleSnap();
      break;

    case 'GRID':
      toggleGrid();
      break;

    case 'NEW':
      document.getElementById('btn-new').click();
      break;

    case 'SAVE':
      document.getElementById('btn-save').click();
      break;

    case 'OPEN':
    case 'LOAD':
      document.getElementById('btn-load').click();
      break;

    case 'DXF':
    case 'EXPORT':
      document.getElementById('btn-export-dxf').click();
      break;

    case 'LAYER':
      if (tokens[1] === 'NEW') createNewLayer();
      renderLayerPanel();
      break;

    case 'HELP':
    case '?':
      log('Commands: L PL REC C A T M CP E U REDO Z E ORTHO SNAP GRID SAVE OPEN DXF');
      log('Coordinate input: x,y (absolute) or @dx,dy (relative)');
      break;

    default:
      log(`Unknown command: ${raw}. Type HELP for list.`);
  }
}

function handleCoordInput(raw) {
  const isRelative = raw.startsWith('@');
  const parts = raw.replace('@', '').split(',');
  const px = parseFloat(parts[0]);
  const py = parseFloat(parts[1]);

  let world;
  if (isRelative) {
    world = {
      x: state.mouseWorld.x + px,
      y: state.mouseWorld.y + py,
    };
  } else {
    world = { x: px, y: py };
  }

  // Simulate a click at this world position
  const tool = TOOLS[state.tool];
  if (tool && tool.onMouseDown) {
    const fakeSnap = { world };
    tool.onMouseDown({ button: 0, shiftKey: false, clientX: 0, clientY: 0 }, world, fakeSnap);
    updateStatusBar();
    renderPropertiesPanel();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Text Input Overlay
// ─────────────────────────────────────────────────────────────────────────────

function initTextInputOverlay() {
  const okBtn = document.getElementById('text-ok');
  const cancelBtn = document.getElementById('text-cancel');
  const input = document.getElementById('text-content-input');

  const submit = () => {
    commitText(input.value);
    renderPropertiesPanel();
    updateStatusBar();
  };

  okBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', () => {
    document.getElementById('text-input-overlay').classList.add('hidden');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { submit(); e.preventDefault(); }
    if (e.key === 'Escape') {
      document.getElementById('text-input-overlay').classList.add('hidden');
      e.preventDefault();
    }
    e.stopPropagation();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Integration (Gemini)
// ─────────────────────────────────────────────────────────────────────────────

function initAI() {
  const form = document.getElementById('ai-form');
  const input = document.getElementById('ai-input');
  const loader = document.getElementById('ai-loader');
  const icon = document.getElementById('ai-icon');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = input.value.trim();
    if (!prompt) return;

    // Check for API key
    const apiKey = typeof process !== 'undefined' && process.env?.API_KEY;
    if (!apiKey) {
      logError('AI: No API key found. Set process.env.API_KEY');
      return;
    }

    loader.classList.remove('hidden');
    icon.classList.add('hidden');
    log(`AI: Generating "${prompt}"...`);

    try {
      const { GoogleGenAI, Type } = await import('https://esm.sh/@google/genai@^1.39.0');
      const ai = new GoogleGenAI({ apiKey });

      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
        config: {
          systemInstruction: `You are a 2D CAD engine. Generate a JSON array of entities to draw the described shape.
Canvas size: approximately 1000x800 units. Center around x=500, y=400.
Entity types:
- line: { type:"line", startX, startY, endX, endY }
- circle: { type:"circle", cx, cy, r }
- rect: { type:"rect", x, y, width, height }
- arc: { type:"arc", cx, cy, r, startAngle, endAngle } (angles in radians, Y-down, 0=right, PI/2=down)
Use reasonable sizes and positions. Return ONLY the JSON array, no markdown.`,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ['line', 'circle', 'rect', 'arc'] },
                startX: { type: Type.NUMBER }, startY: { type: Type.NUMBER },
                endX: { type: Type.NUMBER }, endY: { type: Type.NUMBER },
                cx: { type: Type.NUMBER }, cy: { type: Type.NUMBER },
                r: { type: Type.NUMBER },
                x: { type: Type.NUMBER }, y: { type: Type.NUMBER },
                width: { type: Type.NUMBER }, height: { type: Type.NUMBER },
                startAngle: { type: Type.NUMBER }, endAngle: { type: Type.NUMBER },
              },
            },
          },
        },
      });

      const items = JSON.parse(response.text);
      if (!Array.isArray(items)) throw new Error('Expected array response');

      pushHistory();
      let count = 0;

      for (const item of items) {
        const base = makeEntityBase(item.type);
        let ent = null;
        switch (item.type) {
          case 'line':
            ent = { ...base, start: { x: item.startX, y: item.startY }, end: { x: item.endX, y: item.endY } };
            break;
          case 'circle':
            ent = { ...base, cx: item.cx, cy: item.cy, r: item.r };
            break;
          case 'rect':
            ent = { ...base, x: item.x, y: item.y, width: item.width, height: item.height };
            break;
          case 'arc':
            ent = { ...base, cx: item.cx, cy: item.cy, r: item.r, startAngle: item.startAngle || 0, endAngle: item.endAngle || Math.PI };
            break;
        }
        if (ent) { state.entities.push(ent); count++; }
      }

      log(`AI: Generated ${count} entities`);
      render();
      renderPropertiesPanel();
      updateStatusBar();
      input.value = '';

    } catch (err) {
      logError('AI error: ' + err.message);
      console.error(err);
    } finally {
      loader.classList.add('hidden');
      icon.classList.remove('hidden');
    }
  });
}

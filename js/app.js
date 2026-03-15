/**
 * app.js - Application initialization, event wiring, keyboard shortcuts
 */

import { state, genId, screenToWorld, computeSnapPoint, undo, redo, pushHistory, zoomExtents, makeEntityBase } from './core.js';
import { render } from './render.js';
import {
  TOOLS, activateTool, deleteSelected, selectAll,
  commitText, polylineTool, offsetTool, filletTool, arrayTool, hatchTool,
} from './tools.js';
import {
  log, logError, updateStatusBar,
  renderLayerPanel, renderPropertiesPanel,
  initColorPicker, createNewLayer,
} from './ui.js';
import { exportDXF, saveJSON, loadJSON, importDXF } from './dxf.js';

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initCanvas();
  initToolbar();
  initModeToggles();
  initHeaderButtons();
  initCommandLine();
  initToolbarTabs();
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
  log('Draw: L PL REC C A T  |  Edit: M CP O TR EX F S AR H  |  F8=Ortho F3=Snap');
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
  activateTool('SELECT');
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

function initToolbarTabs() {
  document.querySelectorAll('.toolbar-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      // Update tab buttons
      document.querySelectorAll('.toolbar-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Show/hide panels (use flex for visible, hidden for others)
      ['draw', 'edit', 'view', 'modes'].forEach(t => {
        const panel = document.getElementById(`tab-panel-${t}`);
        if (t === tab) {
          panel.classList.remove('hidden');
          panel.classList.add('flex');
        } else {
          panel.classList.add('hidden');
          panel.classList.remove('flex');
        }
      });
    });
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
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'dxf') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          _applyDXFImport(importDXF(ev.target.result), file.name);
        } catch (err) {
          logError('Failed to import DXF: ' + err.message);
        }
      };
      reader.readAsText(file);
    } else if (ext === 'dwg') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const bytes = new Uint8Array(ev.target.result);
        const magic = String.fromCharCode(...bytes.slice(0, 6));
        if (magic.startsWith('AC10')) {
          // Binary DWG - check if it might actually be text-based (DXF saved as .dwg)
          const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 200));
          if (text.includes('SECTION') || text.includes('ENTITIES')) {
            try {
              const fullText = new TextDecoder().decode(bytes);
              _applyDXFImport(importDXF(fullText), file.name);
            } catch (err) {
              logError('Failed to parse file: ' + err.message);
            }
          } else {
            logError('DWG binary format (AC1009-AC1032) cannot be imported directly.');
            log('Tip: Open the file in AutoCAD or FreeCAD and "Save As DXF", then import here.');
            log('Or use an online converter: cloudconvert.com, convertio.co');
          }
        } else {
          // Maybe it's a DXF with wrong extension
          const text = new TextDecoder().decode(bytes);
          try {
            _applyDXFImport(importDXF(text), file.name);
          } catch (err) {
            logError('Cannot parse file as DXF or DWG: ' + err.message);
          }
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // .xnh or .json
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
    }
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

function _applyDXFImport(result, filename) {
  pushHistory();
  // Merge/add layers
  for (const [name, ldata] of result.layers) {
    if (!state.layers.find(l => l.name === name)) {
      state.layers.push({
        id: genId(), name: ldata.name, color: ldata.color,
        visible: ldata.visible, locked: ldata.locked || false, lineType: 'solid',
      });
    }
  }
  // Ensure layer '0' exists
  if (!state.layers.find(l => l.name === '0')) {
    state.layers.push({ id: genId(), name: '0', color: '#ffffff', visible: true, locked: false, lineType: 'solid' });
  }

  let count = 0;
  for (const raw of result.entities) {
    const layerName = raw._layer || '0';
    let layer = state.layers.find(l => l.name === layerName);
    if (!layer) {
      layer = { id: genId(), name: layerName, color: '#ffffff', visible: true, locked: false, lineType: 'solid' };
      state.layers.push(layer);
    }
    const base = { id: genId(), type: raw._type, layerId: layer.id, color: null, lineType: null, lineWeight: null };
    let ent = null;
    switch (raw._type) {
      case 'line':     ent = { ...base, start: { x: raw.x1, y: raw.y1 }, end: { x: raw.x2, y: raw.y2 } }; break;
      case 'circle':   ent = { ...base, cx: raw.cx, cy: raw.cy, r: raw.r }; break;
      case 'arc':      ent = { ...base, cx: raw.cx, cy: raw.cy, r: raw.r, startAngle: raw.startAngle, endAngle: raw.endAngle }; break;
      case 'polyline': ent = { ...base, points: raw.points, closed: raw.closed }; break;
      case 'text':     ent = { ...base, x: raw.x, y: raw.y, text: raw.text, fontSize: raw.fontSize, angle: raw.angle }; break;
    }
    if (ent) { state.entities.push(ent); count++; }
  }

  renderLayerPanel();
  render();
  renderPropertiesPanel();
  updateStatusBar();
  document.getElementById('file-name').textContent = filename;
  log(`Imported ${count} entities from ${filename}`);
  if (state.entities.length > 0) doZoomExtents();
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

  // Escape = cancel + deselect + return to SELECT
  if (e.key === 'Escape') {
    state.selectedIds = new Set();
    activateTool('SELECT');
    render();
    renderPropertiesPanel();
    updateStatusBar();
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

  initCmdAutocomplete(input);
}

// ─────────────────────────────────────────────────────────────────────────────
// Command Autocomplete
// ─────────────────────────────────────────────────────────────────────────────

const CMD_DEFS = [
  { name:'SELECT',   alias:'ESC',  desc:'Select / deselect entities',      icon:'<path d="M3 3l7 17 2.5-7.5 7.5-2.5L3 3z"/><path d="M13 13l5 5"/>' },
  { name:'LINE',     alias:'L',    desc:'Draw a line segment',              icon:'<line x1="5" y1="19" x2="19" y2="5"/>' },
  { name:'POLYLINE', alias:'PL',   desc:'Draw multi-segment polyline',      icon:'<polyline points="3,19 8,10 13,16 19,5"/>' },
  { name:'RECT',     alias:'REC',  desc:'Draw a rectangle',                 icon:'<rect x="3" y="5" width="18" height="14" rx="1"/>' },
  { name:'CIRCLE',   alias:'C',    desc:'Draw a circle (center+radius)',    icon:'<circle cx="12" cy="12" r="9"/>' },
  { name:'ARC',      alias:'A',    desc:'Draw a 3-point arc',               icon:'<path d="M4 20 Q4 4 20 4"/>' },
  { name:'TEXT',     alias:'T',    desc:'Place single-line text',           icon:'<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>' },
  { name:'MOVE',     alias:'M',    desc:'Move selected entities',           icon:'<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3"/><path d="M3 12h18M12 3v18"/>' },
  { name:'COPY',     alias:'CP',   desc:'Copy selected entities',           icon:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' },
  { name:'OFFSET',   alias:'O',    desc:'Offset a line/circle/arc',         icon:'<path d="M17 12H3M21 5H7M17 19H3"/>' },
  { name:'TRIM',     alias:'TR',   desc:'Trim entity at intersection',      icon:'<line x1="5" y1="12" x2="19" y2="12"/><path d="M12 5l-7 7 7 7"/>' },
  { name:'EXTEND',   alias:'EX',   desc:'Extend line to boundary',          icon:'<line x1="5" y1="12" x2="19" y2="12"/><path d="M12 5l7 7-7 7"/>' },
  { name:'FILLET',   alias:'F',    desc:'Fillet two lines with arc',        icon:'<path d="M3 21 L3 10 Q3 3 10 3 L21 3"/>' },
  { name:'STRETCH',  alias:'S',    desc:'Stretch entities by crossing box', icon:'<polyline points="5,12 10,7 10,17"/><line x1="10" y1="12" x2="19" y2="12"/>' },
  { name:'ARRAY',    alias:'AR',   desc:'Rectangular array of entities',    icon:'<rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><rect x="15" y="15" width="6" height="6"/>' },
  { name:'HATCH',    alias:'H',    desc:'Fill closed area with hatch',      icon:'<rect x="3" y="3" width="18" height="18"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>' },
  { name:'UNDO',     alias:'U',    desc:'Undo last action',                 icon:'<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>' },
  { name:'REDO',     alias:'',     desc:'Redo undone action',               icon:'<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>' },
  { name:'ZOOM',     alias:'Z E',  desc:'Zoom extents / window',            icon:'<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>' },
  { name:'ORTHO',    alias:'F8',   desc:'Toggle ortho mode',                icon:'<line x1="3" y1="3" x2="21" y2="3"/><line x1="3" y1="3" x2="3" y2="21"/>' },
  { name:'SNAP',     alias:'F3',   desc:'Toggle object snap',               icon:'<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>' },
  { name:'SAVE',     alias:'',     desc:'Save drawing as JSON',             icon:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>' },
  { name:'OPEN',     alias:'',     desc:'Open / import a drawing file',     icon:'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' },
  { name:'EXPORT',   alias:'DXF',  desc:'Export as DXF file',               icon:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>' },
  { name:'NEW',      alias:'',     desc:'Create new drawing',               icon:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>' },
  { name:'HELP',     alias:'?',    desc:'Show command list',                icon:'<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
];

function initCmdAutocomplete(input) {
  const suggestions = document.getElementById('cmd-suggestions');
  let activeIdx = -1;

  function getMatches(q) {
    if (!q) return [];
    const upper = q.toUpperCase();
    return CMD_DEFS.filter(d =>
      d.name.startsWith(upper) || d.alias.startsWith(upper)
    ).slice(0, 8);
  }

  function renderSuggestions(matches) {
    if (!matches.length) { suggestions.classList.add('hidden'); return; }
    suggestions.innerHTML = matches.map((d, idx) => `
      <div class="cmd-suggestion${idx === activeIdx ? ' active' : ''}" data-idx="${idx}">
        <svg class="cmd-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${d.icon}</svg>
        <span class="cmd-name">${d.name}</span>
        <span class="cmd-alias">${d.alias}</span>
        <span class="cmd-desc">${d.desc}</span>
      </div>`).join('');
    suggestions.classList.remove('hidden');

    suggestions.querySelectorAll('.cmd-suggestion').forEach(el => {
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        const idx = parseInt(el.dataset.idx);
        input.value = matches[idx].name;
        suggestions.classList.add('hidden');
        input.focus();
      });
    });
  }

  input.addEventListener('input', () => {
    activeIdx = -1;
    renderSuggestions(getMatches(input.value));
  });

  input.addEventListener('keydown', (e) => {
    const matches = getMatches(input.value);
    if (!matches.length) return;

    if (e.key === 'ArrowDown') {
      activeIdx = Math.min(activeIdx + 1, matches.length - 1);
      renderSuggestions(matches);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      activeIdx = Math.max(activeIdx - 1, -1);
      renderSuggestions(matches);
      e.preventDefault();
    } else if (e.key === 'Tab') {
      if (activeIdx >= 0) input.value = matches[activeIdx].name;
      else if (matches.length === 1) input.value = matches[0].name;
      suggestions.classList.add('hidden');
      e.preventDefault();
    }
    // Enter and Escape handled by existing keydown listener above
    if (e.key === 'Enter' || e.key === 'Escape') {
      suggestions.classList.add('hidden');
      activeIdx = -1;
    }
  });

  // Hide on blur
  input.addEventListener('blur', () => {
    setTimeout(() => suggestions.classList.add('hidden'), 150);
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
  'O':    'OFFSET',
  'OFFSET': 'OFFSET',
  'TR':   'TRIM',
  'TRIM': 'TRIM',
  'EX':   'EXTEND',
  'EXTEND': 'EXTEND',
  'F':    'FILLET',
  'FILLET': 'FILLET',
  'S':    'STRETCH',
  'STRETCH': 'STRETCH',
  'AR':   'ARRAY',
  'ARRAY': 'ARRAY',
  'H':    'HATCH',
  'HATCH': 'HATCH',
};

function processCommand(raw) {
  log(`> ${raw}`);

  // Check if it's a coordinate (x,y or @dx,dy)
  if (/^@?-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(raw)) {
    handleCoordInput(raw);
    return;
  }

  // Numeric input for tool distance parameters
  if (/^[\d.]+$/.test(raw)) {
    const val = parseFloat(raw);
    if (state.tool === 'OFFSET' && TOOLS.OFFSET.setDistance) {
      TOOLS.OFFSET.setDistance(val);
      return;
    }
    if (state.tool === 'FILLET' && TOOLS.FILLET.setRadius) {
      TOOLS.FILLET.setRadius(val);
      return;
    }
  }
  // Array configuration: "rows,cols" or "rows,cols,rowSpacing,colSpacing"
  if (state.tool === 'ARRAY' && /^\d+,\d+/.test(raw)) {
    const parts = raw.split(',').map(Number);
    if (parts.length >= 2) {
      const [rows, cols, rs = 50, cs = 50] = parts;
      TOOLS.ARRAY.configure(rows, cols, rs, cs);
      log(`Array configured: ${rows}x${cols}, spacing ${rs}/${cs}`);
      return;
    }
  }
  // Hatch pattern
  if (state.tool === 'HATCH' && ['solid', 'lines', 'cross'].includes(raw.toLowerCase())) {
    TOOLS.HATCH.setPattern(raw.toLowerCase());
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
    case 'OFFSET':
    case 'TRIM':
    case 'EXTEND':
    case 'FILLET':
    case 'STRETCH':
    case 'ARRAY':
    case 'HATCH':
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
      log('Edit: O=Offset  TR=Trim  EX=Extend  F=Fillet  S=Stretch  AR=Array  H=Hatch');
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

/**
 * tools.js - All drawing and edit tool implementations
 *
 * Each tool exposes:
 *   activate()         - called when tool is selected
 *   deactivate()       - called when switching away
 *   onMouseDown(e, world, snap)
 *   onMouseMove(e, world, snap)
 *   onMouseUp(e, world, snap)
 *   onKeyDown(e)
 */

import {
  state, genId, makeEntityBase, constrainPoint,
  circumcircle, arcPath, hitTest, translateEntity,
  pushHistory, dist,
} from './core.js';
import { render } from './render.js';
import { log } from './ui.js';

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

function resolvePoint(world, snap) {
  if (snap) return snap.world;
  return world;
}

function cancelDrawing() {
  state.isDrawing = false;
  state.drawPhase = 0;
  state.drawPoints = [];
  state.previewEntity = null;
  state.selectionBox = null;
  state.moveBase = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECT tool
// ─────────────────────────────────────────────────────────────────────────────

export const selectTool = {
  activate() {
    state.tool = 'SELECT';
    document.getElementById('canvas-container').className =
      document.getElementById('canvas-container').className
        .replace(/\b(crosshair|select-mode|move-mode|text-mode|panning)\b/g, '').trim() + ' select-mode';
    log('Select: click entity or drag to box select');
  },
  deactivate() { cancelDrawing(); },

  onMouseDown(e, world, snap) {
    if (e.button !== 0) return;
    const pt = resolvePoint(world, snap);

    const tol = 8 / state.view.zoom;
    const visibleEnts = state.entities.filter(ent => {
      const l = state.layers.find(x => x.id === ent.layerId);
      return l && l.visible && !l.locked;
    });

    // Hit test (reverse order = top-most first)
    const hit = visibleEnts.slice().reverse().find(ent => hitTest(ent, pt, tol));

    if (hit) {
      if (e.shiftKey) {
        // Toggle selection
        if (state.selectedIds.has(hit.id)) state.selectedIds.delete(hit.id);
        else state.selectedIds.add(hit.id);
      } else if (!state.selectedIds.has(hit.id)) {
        state.selectedIds = new Set([hit.id]);
      }
      // Don't start box selection when hitting an entity
    } else {
      // Start box selection
      if (!e.shiftKey) state.selectedIds = new Set();
      state.selectionBox = { start: pt, end: pt, crossing: false };
      state.isDrawing = true;
    }

    render();
  },

  onMouseMove(e, world, snap) {
    if (!state.isDrawing || !state.selectionBox) return;
    const pt = resolvePoint(world, snap);
    state.selectionBox.end = pt;
    // Crossing = dragged right to left
    state.selectionBox.crossing = pt.x < state.selectionBox.start.x;
    render();
  },

  onMouseUp(e, world, snap) {
    if (!state.isDrawing || !state.selectionBox) { state.isDrawing = false; return; }
    const box = state.selectionBox;
    state.selectionBox = null;
    state.isDrawing = false;

    const x1 = Math.min(box.start.x, box.end.x);
    const y1 = Math.min(box.start.y, box.end.y);
    const x2 = Math.max(box.start.x, box.end.x);
    const y2 = Math.max(box.start.y, box.end.y);

    // Only process if box has some area
    if (Math.abs(x2 - x1) < 2 / state.view.zoom && Math.abs(y2 - y1) < 2 / state.view.zoom) {
      render();
      return;
    }

    const visibleEnts = state.entities.filter(ent => {
      const l = state.layers.find(lx => lx.id === ent.layerId);
      return l && l.visible && !l.locked;
    });

    for (const ent of visibleEnts) {
      const b = _entBounds(ent);
      let selected;
      if (box.crossing) {
        // Crossing: any overlap
        selected = !(b.maxX < x1 || b.minX > x2 || b.maxY < y1 || b.minY > y2);
      } else {
        // Window: fully enclosed
        selected = b.minX >= x1 && b.maxX <= x2 && b.minY >= y1 && b.maxY <= y2;
      }
      if (selected) {
        if (e.shiftKey) {
          if (state.selectedIds.has(ent.id)) state.selectedIds.delete(ent.id);
          else state.selectedIds.add(ent.id);
        } else {
          state.selectedIds.add(ent.id);
        }
      }
    }

    render();
  },

  onKeyDown(e) {
    if (e.key === 'Escape') {
      state.selectedIds = new Set();
      cancelDrawing();
      render();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelected();
    }
  },
};

function _entBounds(ent) {
  // Quick bounds for selection test
  switch (ent.type) {
    case 'line': return { minX: Math.min(ent.start.x,ent.end.x), minY: Math.min(ent.start.y,ent.end.y), maxX: Math.max(ent.start.x,ent.end.x), maxY: Math.max(ent.start.y,ent.end.y) };
    case 'polyline': { const xs=ent.points.map(p=>p.x),ys=ent.points.map(p=>p.y); return {minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys)}; }
    case 'rect': return {minX:Math.min(ent.x,ent.x+ent.width),minY:Math.min(ent.y,ent.y+ent.height),maxX:Math.max(ent.x,ent.x+ent.width),maxY:Math.max(ent.y,ent.y+ent.height)};
    case 'circle': return {minX:ent.cx-ent.r,minY:ent.cy-ent.r,maxX:ent.cx+ent.r,maxY:ent.cy+ent.r};
    case 'arc': return {minX:ent.cx-ent.r,minY:ent.cy-ent.r,maxX:ent.cx+ent.r,maxY:ent.cy+ent.r};
    case 'text': return {minX:ent.x,minY:ent.y-ent.fontSize,maxX:ent.x+ent.text.length*ent.fontSize*0.6,maxY:ent.y};
    default: return {minX:0,minY:0,maxX:0,maxY:0};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LINE tool
// ─────────────────────────────────────────────────────────────────────────────

export const lineTool = {
  activate() {
    cancelDrawing();
    state.tool = 'LINE';
    log('Line: click start point');
  },
  deactivate() { cancelDrawing(); },

  onMouseDown(e, world, snap) {
    if (e.button !== 0) return;
    const pt = resolvePoint(world, snap);
    const constPt = constrainPoint(state.drawPoints[state.drawPoints.length - 1] || null, pt);

    if (!state.isDrawing) {
      // First click: start point
      state.isDrawing = true;
      state.drawPoints = [constPt];
      state.previewEntity = { ...makeEntityBase('line'), start: constPt, end: constPt };
      log(`Line: start (${constPt.x.toFixed(2)}, ${constPt.y.toFixed(2)})`);
    } else {
      // Second click: finish this segment, start new from end
      const start = state.drawPoints[state.drawPoints.length - 1];
      const end = constPt;
      const line = { ...makeEntityBase('line'), start: { ...start }, end: { ...end } };
      pushHistory();
      state.entities.push(line);
      state.drawPoints = [end]; // Continue from end
      state.previewEntity = { ...makeEntityBase('line'), start: end, end };
      log(`Line to (${end.x.toFixed(2)}, ${end.y.toFixed(2)})`);
    }
    render();
  },

  onMouseMove(e, world, snap) {
    if (!state.isDrawing) return;
    const raw = resolvePoint(world, snap);
    const prev = state.drawPoints[state.drawPoints.length - 1];
    const pt = constrainPoint(prev, raw);
    if (state.previewEntity) {
      state.previewEntity.start = prev;
      state.previewEntity.end = pt;
    }
    render();
  },

  onMouseUp() {},

  onKeyDown(e) {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      cancelDrawing();
      render();
      e.preventDefault();
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// POLYLINE tool
// ─────────────────────────────────────────────────────────────────────────────

export const polylineTool = {
  activate() {
    cancelDrawing();
    state.tool = 'POLYLINE';
    log('Polyline: click first point (Enter=finish, C=close)');
  },
  deactivate() { cancelDrawing(); },

  onMouseDown(e, world, snap) {
    if (e.button !== 0) return;
    const raw = resolvePoint(world, snap);
    const prev = state.drawPoints.length > 0 ? state.drawPoints[state.drawPoints.length - 1] : null;
    const pt = constrainPoint(prev, raw);

    if (!state.isDrawing) {
      state.isDrawing = true;
      state.drawPoints = [pt];
      log(`Polyline: start (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`);
    } else {
      state.drawPoints.push(pt);
      log(`Polyline: add point (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`);
    }

    // Update preview
    if (state.drawPoints.length >= 2) {
      state.previewEntity = {
        ...makeEntityBase('polyline'),
        points: [...state.drawPoints],
        closed: false,
      };
    }
    render();
  },

  onMouseMove(e, world, snap) {
    if (!state.isDrawing || state.drawPoints.length === 0) return;
    const raw = resolvePoint(world, snap);
    const prev = state.drawPoints[state.drawPoints.length - 1];
    const pt = constrainPoint(prev, raw);

    if (state.drawPoints.length >= 1) {
      state.previewEntity = {
        ...makeEntityBase('polyline'),
        points: [...state.drawPoints, pt],
        closed: false,
      };
    }
    render();
  },

  onMouseUp() {},

  _finish(close = false) {
    if (!state.isDrawing || state.drawPoints.length < 2) {
      cancelDrawing();
      render();
      return;
    }
    const ent = {
      ...makeEntityBase('polyline'),
      points: [...state.drawPoints],
      closed: close,
    };
    pushHistory();
    state.entities.push(ent);
    log(`Polyline: ${ent.points.length} points${close ? ' (closed)' : ''}`);
    cancelDrawing();
    render();
  },

  onKeyDown(e) {
    if (e.key === 'Escape') {
      cancelDrawing(); render(); e.preventDefault();
    }
    if (e.key === 'Enter' || e.key === ' ') {
      this._finish(false); e.preventDefault();
    }
    if (e.key.toLowerCase() === 'c' && state.isDrawing && state.drawPoints.length >= 3) {
      this._finish(true); e.preventDefault();
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// RECT tool
// ─────────────────────────────────────────────────────────────────────────────

export const rectTool = {
  activate() {
    cancelDrawing();
    state.tool = 'RECT';
    log('Rectangle: click first corner');
  },
  deactivate() { cancelDrawing(); },

  onMouseDown(e, world, snap) {
    if (e.button !== 0) return;
    const pt = resolvePoint(world, snap);

    if (!state.isDrawing) {
      state.isDrawing = true;
      state.drawPoints = [pt];
      log(`Rect: first corner (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`);
    } else {
      const start = state.drawPoints[0];
      const ent = {
        ...makeEntityBase('rect'),
        x: start.x, y: start.y,
        width: pt.x - start.x,
        height: pt.y - start.y,
      };
      pushHistory();
      state.entities.push(ent);
      log(`Rect: ${Math.abs(ent.width).toFixed(2)} x ${Math.abs(ent.height).toFixed(2)}`);
      cancelDrawing();
    }
    render();
  },

  onMouseMove(e, world, snap) {
    if (!state.isDrawing) return;
    const pt = resolvePoint(world, snap);
    const start = state.drawPoints[0];
    state.previewEntity = {
      ...makeEntityBase('rect'),
      x: start.x, y: start.y,
      width: pt.x - start.x,
      height: pt.y - start.y,
    };
    render();
  },

  onMouseUp() {},
  onKeyDown(e) { if (e.key === 'Escape') { cancelDrawing(); render(); e.preventDefault(); } },
};

// ─────────────────────────────────────────────────────────────────────────────
// CIRCLE tool
// ─────────────────────────────────────────────────────────────────────────────

export const circleTool = {
  activate() {
    cancelDrawing();
    state.tool = 'CIRCLE';
    log('Circle: click center point');
  },
  deactivate() { cancelDrawing(); },

  onMouseDown(e, world, snap) {
    if (e.button !== 0) return;
    const pt = resolvePoint(world, snap);

    if (!state.isDrawing) {
      state.isDrawing = true;
      state.drawPoints = [pt];
      log(`Circle: center (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`);
    } else {
      const center = state.drawPoints[0];
      const r = dist(center, pt);
      if (r < 0.001) { log('Circle: radius too small'); return; }
      const ent = { ...makeEntityBase('circle'), cx: center.x, cy: center.y, r };
      pushHistory();
      state.entities.push(ent);
      log(`Circle: r=${r.toFixed(2)}`);
      cancelDrawing();
    }
    render();
  },

  onMouseMove(e, world, snap) {
    if (!state.isDrawing) return;
    const pt = resolvePoint(world, snap);
    const center = state.drawPoints[0];
    const r = dist(center, pt);
    state.previewEntity = { ...makeEntityBase('circle'), cx: center.x, cy: center.y, r };
    render();
  },

  onMouseUp() {},
  onKeyDown(e) { if (e.key === 'Escape') { cancelDrawing(); render(); e.preventDefault(); } },
};

// ─────────────────────────────────────────────────────────────────────────────
// ARC tool (3-point: start, point-on-arc, end)
// ─────────────────────────────────────────────────────────────────────────────

export const arcTool = {
  activate() {
    cancelDrawing();
    state.tool = 'ARC';
    state.drawPhase = 0;
    log('Arc: click start point');
  },
  deactivate() { cancelDrawing(); },

  onMouseDown(e, world, snap) {
    if (e.button !== 0) return;
    const pt = resolvePoint(world, snap);

    if (state.drawPhase === 0) {
      state.drawPoints = [pt];
      state.drawPhase = 1;
      state.isDrawing = true;
      log(`Arc: start (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`);
    } else if (state.drawPhase === 1) {
      state.drawPoints.push(pt);
      state.drawPhase = 2;
      log(`Arc: mid (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`);
    } else if (state.drawPhase === 2) {
      state.drawPoints.push(pt);
      const [p1, p2, p3] = state.drawPoints;
      const circle = circumcircle(p1, p2, p3);
      if (!circle) { log('Arc: points are collinear'); cancelDrawing(); render(); return; }
      const startAngle = Math.atan2(p1.y - circle.cy, p1.x - circle.cx);
      const endAngle = Math.atan2(p3.y - circle.cy, p3.x - circle.cx);
      const ent = {
        ...makeEntityBase('arc'),
        cx: circle.cx, cy: circle.cy, r: circle.r,
        startAngle, endAngle,
      };
      pushHistory();
      state.entities.push(ent);
      log(`Arc: r=${circle.r.toFixed(2)}`);
      cancelDrawing();
    }
    render();
  },

  onMouseMove(e, world, snap) {
    if (!state.isDrawing) return;
    const pt = resolvePoint(world, snap);

    if (state.drawPhase === 1 && state.drawPoints.length === 1) {
      // Show line preview from start to cursor
      state.previewEntity = {
        ...makeEntityBase('line'),
        start: state.drawPoints[0],
        end: pt,
      };
    } else if (state.drawPhase === 2 && state.drawPoints.length === 2) {
      const [p1, p2] = state.drawPoints;
      const circle = circumcircle(p1, p2, pt);
      if (circle) {
        const startAngle = Math.atan2(p1.y - circle.cy, p1.x - circle.cx);
        const endAngle = Math.atan2(pt.y - circle.cy, pt.x - circle.cx);
        state.previewEntity = {
          ...makeEntityBase('arc'),
          cx: circle.cx, cy: circle.cy, r: circle.r,
          startAngle, endAngle,
        };
      }
    }
    render();
  },

  onMouseUp() {},
  onKeyDown(e) { if (e.key === 'Escape') { cancelDrawing(); render(); e.preventDefault(); } },
};

// ─────────────────────────────────────────────────────────────────────────────
// TEXT tool
// ─────────────────────────────────────────────────────────────────────────────

export const textTool = {
  activate() {
    cancelDrawing();
    state.tool = 'TEXT';
    log('Text: click insertion point');
  },
  deactivate() {
    cancelDrawing();
    _hideTextInput();
  },

  onMouseDown(e, world, snap) {
    if (e.button !== 0) return;
    const pt = resolvePoint(world, snap);
    state.textInsertPoint = pt;
    _showTextInput(e.clientX, e.clientY);
  },

  onMouseMove() {},
  onMouseUp() {},
  onKeyDown(e) { if (e.key === 'Escape') { _hideTextInput(); cancelDrawing(); render(); } },
};

function _showTextInput(clientX, clientY) {
  const overlay = document.getElementById('text-input-overlay');
  const input = document.getElementById('text-content-input');
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  overlay.style.left = Math.min(clientX - rect.left, rect.width - 220) + 'px';
  overlay.style.top = Math.min(clientY - rect.top - 80, rect.height - 100) + 'px';
  overlay.classList.remove('hidden');
  input.value = '';
  input.focus();
}

function _hideTextInput() {
  document.getElementById('text-input-overlay').classList.add('hidden');
}

export function commitText(textContent) {
  _hideTextInput();
  if (!textContent.trim() || !state.textInsertPoint) return;
  const ent = {
    ...makeEntityBase('text'),
    x: state.textInsertPoint.x,
    y: state.textInsertPoint.y,
    text: textContent,
    fontSize: 14, // world units
    angle: 0,
  };
  pushHistory();
  state.entities.push(ent);
  log(`Text: "${textContent}"`);
  state.textInsertPoint = null;
  render();
}

// ─────────────────────────────────────────────────────────────────────────────
// MOVE tool
// ─────────────────────────────────────────────────────────────────────────────

export const moveTool = {
  _origEntities: null,

  activate() {
    cancelDrawing();
    state.tool = 'MOVE';
    if (state.selectedIds.size === 0) {
      log('Move: select entities first, then press M');
    } else {
      log(`Move: click base point (${state.selectedIds.size} selected)`);
    }
  },
  deactivate() {
    cancelDrawing();
    this._origEntities = null;
  },

  onMouseDown(e, world, snap) {
    if (e.button !== 0) return;
    if (state.selectedIds.size === 0) return;
    const pt = resolvePoint(world, snap);

    if (!state.isDrawing) {
      state.isDrawing = true;
      state.moveBase = pt;
      // Save original positions
      this._origEntities = {};
      for (const id of state.selectedIds) {
        const ent = state.entities.find(x => x.id === id);
        if (ent) this._origEntities[id] = JSON.parse(JSON.stringify(ent));
      }
      log(`Move: base point (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`);
    } else {
      // Apply move
      const base = state.moveBase;
      const dx = pt.x - base.x;
      const dy = pt.y - base.y;
      pushHistory();
      for (const id of state.selectedIds) {
        const idx = state.entities.findIndex(x => x.id === id);
        if (idx >= 0) {
          state.entities[idx] = translateEntity(state.entities[idx], dx, dy);
        }
      }
      log(`Move: dx=${dx.toFixed(2)}, dy=${dy.toFixed(2)}`);
      cancelDrawing();
      this._origEntities = null;
    }
    render();
  },

  onMouseMove(e, world, snap) {
    if (!state.isDrawing || !state.moveBase || !this._origEntities) return;
    const pt = resolvePoint(world, snap);
    const constPt = constrainPoint(state.moveBase, pt);
    const dx = constPt.x - state.moveBase.x;
    const dy = constPt.y - state.moveBase.y;

    // Apply temporary translation to selected entities
    for (const id of state.selectedIds) {
      const idx = state.entities.findIndex(x => x.id === id);
      if (idx >= 0 && this._origEntities[id]) {
        state.entities[idx] = translateEntity(this._origEntities[id], dx, dy);
      }
    }
    render();
  },

  onMouseUp() {},
  onKeyDown(e) {
    if (e.key === 'Escape') {
      // Restore originals
      if (this._origEntities) {
        for (const id of state.selectedIds) {
          const idx = state.entities.findIndex(x => x.id === id);
          if (idx >= 0 && this._origEntities[id]) {
            state.entities[idx] = JSON.parse(JSON.stringify(this._origEntities[id]));
          }
        }
        this._origEntities = null;
      }
      cancelDrawing();
      render();
      e.preventDefault();
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// COPY tool
// ─────────────────────────────────────────────────────────────────────────────

export const copyTool = {
  _origEntities: null,

  activate() {
    cancelDrawing();
    state.tool = 'COPY';
    if (state.selectedIds.size === 0) {
      log('Copy: select entities first, then press CP');
    } else {
      log(`Copy: click base point (${state.selectedIds.size} selected)`);
    }
  },
  deactivate() {
    cancelDrawing();
    this._origEntities = null;
  },

  onMouseDown(e, world, snap) {
    if (e.button !== 0) return;
    if (state.selectedIds.size === 0) return;
    const pt = resolvePoint(world, snap);

    if (!state.isDrawing) {
      state.isDrawing = true;
      state.moveBase = pt;
      this._origEntities = {};
      for (const id of state.selectedIds) {
        const ent = state.entities.find(x => x.id === id);
        if (ent) this._origEntities[id] = JSON.parse(JSON.stringify(ent));
      }
      log(`Copy: base point (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`);
    } else {
      const base = state.moveBase;
      const dx = pt.x - base.x;
      const dy = pt.y - base.y;
      pushHistory();
      const newIds = new Set();
      for (const id of state.selectedIds) {
        const orig = this._origEntities[id];
        if (!orig) continue;
        const copy = translateEntity(orig, dx, dy);
        copy.id = genId();
        state.entities.push(copy);
        newIds.add(copy.id);
      }
      // Restore originals to original position
      for (const id of state.selectedIds) {
        const idx = state.entities.findIndex(x => x.id === id);
        if (idx >= 0 && this._origEntities[id]) {
          state.entities[idx] = JSON.parse(JSON.stringify(this._origEntities[id]));
        }
      }
      state.selectedIds = newIds;
      log(`Copied ${newIds.size} entities`);
      // Allow another copy (keep tool active with same base behavior)
      state.isDrawing = false;
      state.moveBase = null;
    }
    render();
  },

  onMouseMove(e, world, snap) {
    if (!state.isDrawing || !state.moveBase || !this._origEntities) return;
    const pt = resolvePoint(world, snap);
    const constPt = constrainPoint(state.moveBase, pt);
    const dx = constPt.x - state.moveBase.x;
    const dy = constPt.y - state.moveBase.y;

    // Temporarily show preview copies (don't actually move originals)
    // We'll show them in the preview layer
    state.previewEntity = null;
    // Hack: directly update entities for preview, will be restored on cancel
    for (const id of state.selectedIds) {
      const idx = state.entities.findIndex(x => x.id === id);
      if (idx >= 0 && this._origEntities[id]) {
        state.entities[idx] = translateEntity(this._origEntities[id], dx, dy);
      }
    }
    render();
  },

  onMouseUp() {},
  onKeyDown(e) {
    if (e.key === 'Escape') {
      if (this._origEntities) {
        for (const id of state.selectedIds) {
          const idx = state.entities.findIndex(x => x.id === id);
          if (idx >= 0 && this._origEntities[id]) {
            state.entities[idx] = JSON.parse(JSON.stringify(this._origEntities[id]));
          }
        }
        this._origEntities = null;
      }
      cancelDrawing();
      render();
      e.preventDefault();
    }
    if (e.key === 'Enter') {
      cancelDrawing();
      this._origEntities = null;
      render();
      e.preventDefault();
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Operations (Delete, Select All, etc.)
// ─────────────────────────────────────────────────────────────────────────────

export function deleteSelected() {
  if (state.selectedIds.size === 0) return;
  pushHistory();
  state.entities = state.entities.filter(e => !state.selectedIds.has(e.id));
  const count = state.selectedIds.size;
  state.selectedIds = new Set();
  log(`Deleted ${count} entit${count === 1 ? 'y' : 'ies'}`);
  render();
}

export function selectAll() {
  state.selectedIds = new Set(
    state.entities
      .filter(ent => {
        const l = state.layers.find(x => x.id === ent.layerId);
        return l && l.visible && !l.locked;
      })
      .map(e => e.id)
  );
  render();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool registry
// ─────────────────────────────────────────────────────────────────────────────

export const TOOLS = {
  SELECT: selectTool,
  LINE: lineTool,
  POLYLINE: polylineTool,
  RECT: rectTool,
  CIRCLE: circleTool,
  ARC: arcTool,
  TEXT: textTool,
  MOVE: moveTool,
  COPY: copyTool,
};

export function activateTool(toolName) {
  const prev = TOOLS[state.tool];
  if (prev && prev.deactivate) prev.deactivate();

  const tool = TOOLS[toolName];
  if (!tool) return;

  state.tool = toolName;
  tool.activate();

  // Update toolbar buttons
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === toolName);
  });

  // Update canvas cursor
  const container = document.getElementById('canvas-container');
  const cursorMap = {
    SELECT: 'select-mode',
    MOVE: 'move-mode',
    COPY: 'move-mode',
    TEXT: 'text-mode',
  };
  container.className = container.className
    .replace(/\b(select-mode|move-mode|text-mode)\b/g, '').trim();
  const cur = cursorMap[toolName];
  if (cur) container.classList.add(cur);
}

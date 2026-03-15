/**
 * core.js - Global state, geometry utilities, snap system, undo/redo history
 */

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

export const state = {
  // Drawing data
  entities: [],
  layers: [
    { id: 'layer0', name: '0', color: '#c9d1d9', visible: true, locked: false, lineType: 'solid', lineWeight: 0.25 },
    { id: 'layer1', name: 'Construction', color: '#58a6ff', visible: true, locked: false, lineType: 'dashed', lineWeight: 0.18 },
    { id: 'layer2', name: 'Dimensions', color: '#f0b429', visible: true, locked: false, lineType: 'solid', lineWeight: 0.18 },
    { id: 'layer3', name: 'Notes', color: '#f87171', visible: true, locked: false, lineType: 'solid', lineWeight: 0.18 },
  ],
  activeLayerId: 'layer0',

  // Viewport
  view: { x: 0, y: 0, zoom: 1 },

  // Tool state
  tool: 'SELECT',
  isDrawing: false,
  drawPhase: 0,         // Phase within a tool (e.g., 0=first click, 1=second click)
  drawPoints: [],       // Accumulated world-coord points for current op
  previewEntity: null,  // Entity shown as drawing preview

  // Selection
  selectedIds: new Set(),
  selectionBox: null,   // { start:{x,y}, end:{x,y}, crossing:bool }

  // Snap
  snapEnabled: true,
  snapPoint: null,      // { world:{x,y}, type:string } - current best snap
  gridEnabled: true,
  gridSize: 20,

  // Ortho
  orthoEnabled: false,

  // Mouse
  mouseWorld: { x: 0, y: 0 },
  mouseScreen: { x: 0, y: 0 },

  // Pan
  isPanning: false,
  panStart: null,       // { x, y } screen coords

  // Move/Copy tool
  moveBase: null,       // base point in world coords

  // Text tool
  textInsertPoint: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

let _idCounter = Date.now();
export const genId = () => (++_idCounter).toString(36);

export const worldToScreen = (wx, wy) => ({
  x: wx * state.view.zoom + state.view.x,
  y: wy * state.view.zoom + state.view.y,
});

export const screenToWorld = (sx, sy) => ({
  x: (sx - state.view.x) / state.view.zoom,
  y: (sy - state.view.y) / state.view.zoom,
});

// ─────────────────────────────────────────────────────────────────────────────
// Geometry
// ─────────────────────────────────────────────────────────────────────────────

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const angle2 = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
export const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export function applyOrtho(start, curr) {
  const dx = Math.abs(curr.x - start.x);
  const dy = Math.abs(curr.y - start.y);
  return dx >= dy
    ? { x: curr.x, y: start.y }
    : { x: start.x, y: curr.y };
}

/** Apply ortho constraint if enabled */
export function constrainPoint(start, curr) {
  if (state.orthoEnabled && start) return applyOrtho(start, curr);
  return curr;
}

/** Build arc SVG path from center, radius, startAngle, endAngle (radians, Y-down) */
export function arcPath(cx, cy, r, startAngle, endAngle) {
  // Compute angular sweep (clockwise in SVG/Y-down)
  let sweep = endAngle - startAngle;
  // Normalize to [0, 2π)
  while (sweep < 0) sweep += Math.PI * 2;
  while (sweep >= Math.PI * 2) sweep -= Math.PI * 2;
  const largeArc = sweep > Math.PI ? 1 : 0;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  if (Math.abs(sweep) < 1e-6) return `M ${x1} ${y1}`;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

/** Find circumscribed circle through 3 points. Returns {cx,cy,r} or null if collinear. */
export function circumcircle(p1, p2, p3) {
  const ax = p1.x, ay = p1.y;
  const bx = p2.x, by = p2.y;
  const cx = p3.x, cy = p3.y;
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-10) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
  return { cx: ux, cy: uy, r: Math.hypot(ax - ux, ay - uy) };
}

/** Hit test a single entity against a world point. Returns true if within tolerance. */
export function hitTest(ent, p, tolWorld) {
  switch (ent.type) {
    case 'line':
      return distToSegment(p, ent.start, ent.end) <= tolWorld;
    case 'polyline': {
      const pts = ent.closed ? [...ent.points, ent.points[0]] : ent.points;
      for (let i = 0; i < pts.length - 1; i++) {
        if (distToSegment(p, pts[i], pts[i + 1]) <= tolWorld) return true;
      }
      return false;
    }
    case 'rect': {
      const x2 = ent.x + ent.width, y2 = ent.y + ent.height;
      const sides = [
        [{ x: ent.x, y: ent.y }, { x: x2, y: ent.y }],
        [{ x: x2, y: ent.y }, { x: x2, y: y2 }],
        [{ x: x2, y: y2 }, { x: ent.x, y: y2 }],
        [{ x: ent.x, y: y2 }, { x: ent.x, y: ent.y }],
      ];
      return sides.some(([a, b]) => distToSegment(p, a, b) <= tolWorld);
    }
    case 'circle':
      return Math.abs(dist(p, { x: ent.cx, y: ent.cy }) - ent.r) <= tolWorld;
    case 'arc': {
      const d = dist(p, { x: ent.cx, y: ent.cy });
      if (Math.abs(d - ent.r) > tolWorld) return false;
      const a = Math.atan2(p.y - ent.cy, p.x - ent.cx);
      return isAngleOnArc(a, ent.startAngle, ent.endAngle);
    }
    case 'text': {
      const tw = (ent.text.length * ent.fontSize * 0.6);
      const th = ent.fontSize;
      return p.x >= ent.x - tolWorld && p.x <= ent.x + tw + tolWorld &&
             p.y >= ent.y - th - tolWorld && p.y <= ent.y + tolWorld;
    }
    default:
      return false;
  }
}

/** Check if angle `a` lies on arc from startAngle to endAngle (CW in Y-down) */
function isAngleOnArc(a, startAngle, endAngle) {
  let sweep = endAngle - startAngle;
  while (sweep < 0) sweep += Math.PI * 2;
  let offset = a - startAngle;
  while (offset < 0) offset += Math.PI * 2;
  return offset <= sweep;
}

/** Get bounding box of an entity {minX, minY, maxX, maxY} */
export function entityBounds(ent) {
  switch (ent.type) {
    case 'line':
      return {
        minX: Math.min(ent.start.x, ent.end.x),
        minY: Math.min(ent.start.y, ent.end.y),
        maxX: Math.max(ent.start.x, ent.end.x),
        maxY: Math.max(ent.start.y, ent.end.y),
      };
    case 'polyline': {
      const xs = ent.points.map(p => p.x), ys = ent.points.map(p => p.y);
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    }
    case 'rect':
      return { minX: Math.min(ent.x, ent.x + ent.width), minY: Math.min(ent.y, ent.y + ent.height), maxX: Math.max(ent.x, ent.x + ent.width), maxY: Math.max(ent.y, ent.y + ent.height) };
    case 'circle':
      return { minX: ent.cx - ent.r, minY: ent.cy - ent.r, maxX: ent.cx + ent.r, maxY: ent.cy + ent.r };
    case 'arc':
      return { minX: ent.cx - ent.r, minY: ent.cy - ent.r, maxX: ent.cx + ent.r, maxY: ent.cy + ent.r };
    case 'text':
      return { minX: ent.x, minY: ent.y - ent.fontSize, maxX: ent.x + ent.text.length * ent.fontSize * 0.6, maxY: ent.y };
    default:
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
}

/** Translate an entity by dx, dy - returns a new entity */
export function translateEntity(ent, dx, dy) {
  const e = JSON.parse(JSON.stringify(ent));
  switch (e.type) {
    case 'line':
      e.start.x += dx; e.start.y += dy;
      e.end.x += dx; e.end.y += dy;
      break;
    case 'polyline':
      e.points = e.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      break;
    case 'rect':
      e.x += dx; e.y += dy;
      break;
    case 'circle':
    case 'arc':
      e.cx += dx; e.cy += dy;
      break;
    case 'text':
      e.x += dx; e.y += dy;
      break;
  }
  return e;
}

// ─────────────────────────────────────────────────────────────────────────────
// Snap System
// ─────────────────────────────────────────────────────────────────────────────

const SNAP_SCREEN_TOLERANCE = 12; // pixels

export function computeSnapPoint(mouseWorld) {
  if (!state.snapEnabled) {
    // Still snap to grid if grid snap is enabled
    const gs = state.gridSize;
    const gx = Math.round(mouseWorld.x / gs) * gs;
    const gy = Math.round(mouseWorld.y / gs) * gs;
    return { world: { x: gx, y: gy }, type: 'grid' };
  }

  const tol = SNAP_SCREEN_TOLERANCE / state.view.zoom;
  const candidates = [];

  for (const ent of state.entities) {
    const layer = state.layers.find(l => l.id === ent.layerId);
    if (!layer || !layer.visible) continue;

    switch (ent.type) {
      case 'line':
        candidates.push({ point: ent.start, type: 'endpoint', pri: 1 });
        candidates.push({ point: ent.end, type: 'endpoint', pri: 1 });
        candidates.push({ point: midpoint(ent.start, ent.end), type: 'midpoint', pri: 2 });
        break;

      case 'polyline':
        for (let i = 0; i < ent.points.length; i++) {
          candidates.push({ point: ent.points[i], type: 'endpoint', pri: 1 });
          if (i < ent.points.length - 1)
            candidates.push({ point: midpoint(ent.points[i], ent.points[i + 1]), type: 'midpoint', pri: 2 });
        }
        if (ent.closed && ent.points.length > 1)
          candidates.push({ point: midpoint(ent.points[ent.points.length - 1], ent.points[0]), type: 'midpoint', pri: 2 });
        break;

      case 'rect': {
        const c = [
          { x: ent.x, y: ent.y },
          { x: ent.x + ent.width, y: ent.y },
          { x: ent.x + ent.width, y: ent.y + ent.height },
          { x: ent.x, y: ent.y + ent.height },
        ];
        c.forEach(p => candidates.push({ point: p, type: 'endpoint', pri: 1 }));
        for (let i = 0; i < 4; i++)
          candidates.push({ point: midpoint(c[i], c[(i + 1) % 4]), type: 'midpoint', pri: 2 });
        // Center
        candidates.push({ point: { x: ent.x + ent.width / 2, y: ent.y + ent.height / 2 }, type: 'center', pri: 2 });
        break;
      }

      case 'circle':
        candidates.push({ point: { x: ent.cx, y: ent.cy }, type: 'center', pri: 1 });
        candidates.push({ point: { x: ent.cx + ent.r, y: ent.cy }, type: 'quadrant', pri: 2 });
        candidates.push({ point: { x: ent.cx - ent.r, y: ent.cy }, type: 'quadrant', pri: 2 });
        candidates.push({ point: { x: ent.cx, y: ent.cy + ent.r }, type: 'quadrant', pri: 2 });
        candidates.push({ point: { x: ent.cx, y: ent.cy - ent.r }, type: 'quadrant', pri: 2 });
        break;

      case 'arc': {
        candidates.push({ point: { x: ent.cx, y: ent.cy }, type: 'center', pri: 1 });
        candidates.push({ point: { x: ent.cx + ent.r * Math.cos(ent.startAngle), y: ent.cy + ent.r * Math.sin(ent.startAngle) }, type: 'endpoint', pri: 1 });
        candidates.push({ point: { x: ent.cx + ent.r * Math.cos(ent.endAngle), y: ent.cy + ent.r * Math.sin(ent.endAngle) }, type: 'endpoint', pri: 1 });
        const midA = (ent.startAngle + ent.endAngle) / 2;
        candidates.push({ point: { x: ent.cx + ent.r * Math.cos(midA), y: ent.cy + ent.r * Math.sin(midA) }, type: 'midpoint', pri: 2 });
        break;
      }
    }
  }

  // Grid snap candidate
  const gs = state.gridSize;
  const gx = Math.round(mouseWorld.x / gs) * gs;
  const gy = Math.round(mouseWorld.y / gs) * gs;
  candidates.push({ point: { x: gx, y: gy }, type: 'grid', pri: 3 });

  // Find best candidate
  let best = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = dist(mouseWorld, c.point);
    if (d < tol) {
      if (best === null || c.pri < best.pri || (c.pri === best.pri && d < bestDist)) {
        best = c;
        bestDist = d;
      }
    }
  }

  return best ? { world: best.point, type: best.type } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Undo / Redo History
// ─────────────────────────────────────────────────────────────────────────────

const MAX_HISTORY = 100;
let _historyStack = [];
let _historyIndex = -1;

export function takeSnapshot() {
  return {
    entities: JSON.parse(JSON.stringify(state.entities)),
    layers: JSON.parse(JSON.stringify(state.layers)),
    activeLayerId: state.activeLayerId,
  };
}

export function pushHistory() {
  // Drop any redo states
  _historyStack = _historyStack.slice(0, _historyIndex + 1);
  _historyStack.push(takeSnapshot());
  if (_historyStack.length > MAX_HISTORY) _historyStack.shift();
  _historyIndex = _historyStack.length - 1;
}

export function undo() {
  if (_historyIndex > 0) {
    _historyIndex--;
    _restoreSnapshot(_historyStack[_historyIndex]);
    return true;
  }
  return false;
}

export function redo() {
  if (_historyIndex < _historyStack.length - 1) {
    _historyIndex++;
    _restoreSnapshot(_historyStack[_historyIndex]);
    return true;
  }
  return false;
}

export function canUndo() { return _historyIndex > 0; }
export function canRedo() { return _historyIndex < _historyStack.length - 1; }

function _restoreSnapshot(snap) {
  state.entities = JSON.parse(JSON.stringify(snap.entities));
  state.layers = JSON.parse(JSON.stringify(snap.layers));
  state.activeLayerId = snap.activeLayerId;
  state.selectedIds = new Set();
}

// Initialize history with empty state
pushHistory();

// ─────────────────────────────────────────────────────────────────────────────
// Zoom to Extents
// ─────────────────────────────────────────────────────────────────────────────

export function zoomExtents(canvasW, canvasH) {
  if (state.entities.length === 0) {
    state.view = { x: canvasW / 2, y: canvasH / 2, zoom: 1 };
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ent of state.entities) {
    const b = entityBounds(ent);
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
  }
  const pw = maxX - minX, ph = maxY - minY;
  const margin = 40;
  const zoom = Math.min((canvasW - margin * 2) / (pw || 1), (canvasH - margin * 2) / (ph || 1));
  state.view.zoom = Math.max(0.01, Math.min(1000, zoom));
  state.view.x = canvasW / 2 - (minX + pw / 2) * state.view.zoom;
  state.view.y = canvasH / 2 - (minY + ph / 2) * state.view.zoom;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getActiveLayer() {
  return state.layers.find(l => l.id === state.activeLayerId);
}

export function getEntityLayer(ent) {
  return state.layers.find(l => l.id === ent.layerId);
}

export function getEffectiveColor(ent) {
  if (ent.color) return ent.color;
  const layer = getEntityLayer(ent);
  return layer ? layer.color : '#c9d1d9';
}

export function getEffectiveLineType(ent) {
  if (ent.lineType) return ent.lineType;
  const layer = getEntityLayer(ent);
  return layer ? layer.lineType : 'solid';
}

export function getEffectiveLineWeight(ent) {
  if (ent.lineWeight != null) return ent.lineWeight;
  const layer = getEntityLayer(ent);
  return layer ? layer.lineWeight : 0.25;
}

/** Build a new entity base object using active layer defaults */
export function makeEntityBase(type) {
  return {
    id: genId(),
    type,
    layerId: state.activeLayerId,
    color: null,
    lineType: null,
    lineWeight: null,
  };
}

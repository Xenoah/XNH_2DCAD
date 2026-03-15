/**
 * render.js - SVG rendering engine
 * Renders entities, preview, snap indicators, selection box, grid
 */

import {
  state, worldToScreen, screenToWorld,
  getEffectiveColor, getEffectiveLineType, getEffectiveLineWeight,
  arcPath,
} from './core.js';

// ─────────────────────────────────────────────────────────────────────────────
// SVG helpers
// ─────────────────────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, parent = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

/** Stroke dash array for a lineType */
function dashArray(lineType, scale = 1) {
  switch (lineType) {
    case 'dashed':  return `${12 * scale},${6 * scale}`;
    case 'dotted':  return `${2 * scale},${5 * scale}`;
    case 'center':  return `${20 * scale},${5 * scale},${2 * scale},${5 * scale}`;
    case 'phantom': return `${30 * scale},${5 * scale},${2 * scale},${5 * scale},${2 * scale},${5 * scale}`;
    default:        return 'none';
  }
}

function applyStroke(el, ent, overrideColor = null, extraWidth = 0) {
  const color = overrideColor || getEffectiveColor(ent);
  const lw = getEffectiveLineWeight(ent);
  const lt = getEffectiveLineType(ent);
  const strokeW = (lw / state.view.zoom) + extraWidth / state.view.zoom;
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', strokeW);
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  const da = dashArray(lt, 1 / state.view.zoom);
  if (da !== 'none') el.setAttribute('stroke-dasharray', da);
  return el;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity SVG element creation
// ─────────────────────────────────────────────────────────────────────────────

function createEntityElement(ent, isSelected = false, isPreview = false) {
  let el = null;
  const selColor = '#58a6ff';
  const selExtra = isSelected ? 1.5 : 0;

  switch (ent.type) {
    case 'line':
      el = svgEl('line', {
        x1: ent.start.x, y1: ent.start.y,
        x2: ent.end.x, y2: ent.end.y,
        fill: 'none',
      });
      break;

    case 'polyline': {
      const pts = ent.points.map(p => `${p.x},${p.y}`).join(' ');
      el = svgEl(ent.closed ? 'polygon' : 'polyline', {
        points: pts,
        fill: 'none',
      });
      break;
    }

    case 'rect':
      el = svgEl('rect', {
        x: ent.x, y: ent.y,
        width: Math.abs(ent.width), height: Math.abs(ent.height),
        // Handle negative width/height (drawn backwards)
        ...(ent.width < 0 ? { x: ent.x + ent.width } : {}),
        ...(ent.height < 0 ? { y: ent.y + ent.height } : {}),
        fill: 'none',
      });
      break;

    case 'circle':
      el = svgEl('circle', {
        cx: ent.cx, cy: ent.cy, r: Math.abs(ent.r),
        fill: 'none',
      });
      break;

    case 'arc':
      el = svgEl('path', {
        d: arcPath(ent.cx, ent.cy, ent.r, ent.startAngle, ent.endAngle),
        fill: 'none',
      });
      break;

    case 'text': {
      const textAttrs = {
        x: ent.x, y: ent.y,
        'font-size': ent.fontSize,
        'font-family': 'monospace',
        fill: isSelected ? selColor : getEffectiveColor(ent),
      };
      if (ent.angle) textAttrs.transform = `rotate(${ent.angle * 180 / Math.PI}, ${ent.x}, ${ent.y})`;
      el = svgEl('text', textAttrs);
      el.textContent = ent.text;
      return el; // Text doesn't use stroke
    }

    default:
      return null;
  }

  if (!el) return null;

  if (isPreview) {
    el.setAttribute('stroke', '#fbbf24');
    el.setAttribute('stroke-width', 1.5 / state.view.zoom);
    el.setAttribute('stroke-dasharray', `${8 / state.view.zoom},${4 / state.view.zoom}`);
    el.setAttribute('fill', 'none');
  } else {
    applyStroke(el, ent, isSelected ? selColor : null, selExtra);
    // Selection highlight: add a wider transparent hit area
    if (isSelected) {
      el.setAttribute('filter', 'none');
    }
  }

  return el;
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection handles (small squares at key points)
// ─────────────────────────────────────────────────────────────────────────────

function getEntityHandlePoints(ent) {
  switch (ent.type) {
    case 'line': return [ent.start, ent.end];
    case 'polyline': return ent.points;
    case 'rect': return [
      { x: ent.x, y: ent.y },
      { x: ent.x + ent.width, y: ent.y },
      { x: ent.x + ent.width, y: ent.y + ent.height },
      { x: ent.x, y: ent.y + ent.height },
    ];
    case 'circle': return [{ x: ent.cx, y: ent.cy }];
    case 'arc': return [
      { x: ent.cx, y: ent.cy },
      { x: ent.cx + ent.r * Math.cos(ent.startAngle), y: ent.cy + ent.r * Math.sin(ent.startAngle) },
      { x: ent.cx + ent.r * Math.cos(ent.endAngle), y: ent.cy + ent.r * Math.sin(ent.endAngle) },
    ];
    case 'text': return [{ x: ent.x, y: ent.y }];
    default: return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main render function
// ─────────────────────────────────────────────────────────────────────────────

const entitiesLayer = () => document.getElementById('entities-layer');
const previewLayer = () => document.getElementById('preview-layer');
const snapLayer = () => document.getElementById('snap-layer');
const selBoxLayer = () => document.getElementById('selection-box-layer');
const viewport = () => document.getElementById('viewport');
const gridRect = () => document.getElementById('grid-rect');
const gridPatternSmall = () => document.getElementById('grid-pattern-small');
const gridPatternLarge = () => document.getElementById('grid-pattern-large');

export function render() {
  renderViewport();
  renderGrid();
  renderEntities();
  renderPreview();
  renderSnapIndicator();
  renderSelectionBox();
}

/** Update viewport SVG transform */
function renderViewport() {
  const vp = viewport();
  if (vp) vp.setAttribute('transform', `translate(${state.view.x},${state.view.y}) scale(${state.view.zoom})`);
}

/** Update grid pattern transform to follow viewport */
function renderGrid() {
  const gr = gridRect();
  if (!state.gridEnabled) {
    if (gr) gr.setAttribute('fill', 'none');
    return;
  }
  if (gr) gr.setAttribute('fill', 'url(#grid-pattern-large)');

  const gs = Math.max(1, state.gridSize * state.view.zoom);
  const lg = gs * 5;

  // Small grid
  const sp = gridPatternSmall();
  if (sp) {
    sp.setAttribute('width', gs);
    sp.setAttribute('height', gs);
    sp.setAttribute('x', state.view.x % gs);
    sp.setAttribute('y', state.view.y % gs);
    const path = sp.querySelector('path');
    if (path) path.setAttribute('d', `M ${gs} 0 L 0 0 0 ${gs}`);
  }

  // Large grid (5x)
  const lp = gridPatternLarge();
  if (lp) {
    lp.setAttribute('width', lg);
    lp.setAttribute('height', lg);
    lp.setAttribute('x', state.view.x % lg);
    lp.setAttribute('y', state.view.y % lg);
    const path = lp.querySelector('path');
    if (path) path.setAttribute('d', `M ${lg} 0 L 0 0 0 ${lg}`);
    // Update the inner small pattern reference
    const inner = lp.querySelector('rect');
    if (inner) { inner.setAttribute('width', lg); inner.setAttribute('height', lg); }
  }
}

/** Render all entities */
function renderEntities() {
  const layer = entitiesLayer();
  if (!layer) return;
  layer.innerHTML = '';

  for (const ent of state.entities) {
    const entLayer = state.layers.find(l => l.id === ent.layerId);
    if (!entLayer || !entLayer.visible) continue;

    const isSelected = state.selectedIds.has(ent.id);
    const el = createEntityElement(ent, isSelected);
    if (!el) continue;

    el.dataset.id = ent.id;
    layer.appendChild(el);

    // Selection handles
    if (isSelected) {
      const handles = getEntityHandlePoints(ent);
      const hs = 4 / state.view.zoom;
      handles.forEach(p => {
        svgEl('rect', {
          x: p.x - hs / 2, y: p.y - hs / 2,
          width: hs, height: hs,
          fill: '#58a6ff',
          stroke: '#0d1117',
          'stroke-width': 0.5 / state.view.zoom,
        }, layer);
      });
    }
  }
}

/** Render current drawing preview */
export function renderPreview() {
  const layer = previewLayer();
  if (!layer) return;
  layer.innerHTML = '';

  if (state.previewEntity) {
    const el = createEntityElement(state.previewEntity, false, true);
    if (el) layer.appendChild(el);
  }

  // For polyline: show already-placed points connected
  if ((state.tool === 'POLYLINE' || state.tool === 'LINE') && state.drawPoints.length > 0) {
    const pts = state.drawPoints;
    const curr = state.snapPoint ? state.snapPoint.world : state.mouseWorld;

    // Draw placed segments
    if (pts.length > 1) {
      const polyPts = pts.map(p => `${p.x},${p.y}`).join(' ');
      svgEl('polyline', {
        points: polyPts,
        fill: 'none',
        stroke: '#c9d1d9',
        'stroke-width': 1 / state.view.zoom,
        'stroke-linecap': 'round',
      }, layer);
    }

    // Dot at each placed vertex
    pts.forEach(p => {
      svgEl('circle', {
        cx: p.x, cy: p.y,
        r: 2.5 / state.view.zoom,
        fill: '#fbbf24',
        stroke: 'none',
      }, layer);
    });
  }

  // Arc tool: show placed points
  if (state.tool === 'ARC' && state.drawPoints.length > 0) {
    state.drawPoints.forEach(p => {
      svgEl('circle', {
        cx: p.x, cy: p.y,
        r: 2.5 / state.view.zoom,
        fill: '#fbbf24',
      }, layer);
    });
    if (state.drawPoints.length === 2) {
      // Show line from p1 to cursor as guide
      const p1 = state.drawPoints[0];
      const curr = state.snapPoint ? state.snapPoint.world : state.mouseWorld;
      svgEl('line', {
        x1: p1.x, y1: p1.y, x2: curr.x, y2: curr.y,
        stroke: '#484f58',
        'stroke-width': 0.5 / state.view.zoom,
        'stroke-dasharray': `${4 / state.view.zoom},${3 / state.view.zoom}`,
      }, layer);
    }
  }
}

/** Render snap indicator */
function renderSnapIndicator() {
  const layer = snapLayer();
  if (!layer) return;
  layer.innerHTML = '';

  const snap = state.snapPoint;
  if (!snap) return;

  const { x, y } = snap.world;
  const s = 5 / state.view.zoom;

  switch (snap.type) {
    case 'endpoint':
      // Yellow square
      svgEl('rect', {
        x: x - s, y: y - s, width: s * 2, height: s * 2,
        fill: 'none', stroke: '#fbbf24',
        'stroke-width': 1.5 / state.view.zoom,
        class: 'snap-indicator',
      }, layer);
      break;

    case 'midpoint':
      // Yellow triangle
      svgEl('polygon', {
        points: `${x},${y - s * 1.2} ${x - s},${y + s * 0.8} ${x + s},${y + s * 0.8}`,
        fill: 'none', stroke: '#fbbf24',
        'stroke-width': 1.5 / state.view.zoom,
        class: 'snap-indicator',
      }, layer);
      break;

    case 'center':
      // Yellow circle with crosshair
      svgEl('circle', {
        cx: x, cy: y, r: s,
        fill: 'none', stroke: '#fbbf24',
        'stroke-width': 1.5 / state.view.zoom,
        class: 'snap-indicator',
      }, layer);
      svgEl('line', { x1: x - s * 1.5, y1: y, x2: x + s * 1.5, y2: y, stroke: '#fbbf24', 'stroke-width': 0.8 / state.view.zoom }, layer);
      svgEl('line', { x1: x, y1: y - s * 1.5, x2: x, y2: y + s * 1.5, stroke: '#fbbf24', 'stroke-width': 0.8 / state.view.zoom }, layer);
      break;

    case 'quadrant':
      // Yellow diamond
      svgEl('polygon', {
        points: `${x},${y - s * 1.2} ${x + s},${y} ${x},${y + s * 1.2} ${x - s},${y}`,
        fill: 'none', stroke: '#fbbf24',
        'stroke-width': 1.5 / state.view.zoom,
        class: 'snap-indicator',
      }, layer);
      break;

    case 'grid':
      // Small green crosshair (only when snapping to grid, not when other snap is active)
      svgEl('line', { x1: x - s, y1: y, x2: x + s, y2: y, stroke: '#4ade80', 'stroke-width': 0.8 / state.view.zoom }, layer);
      svgEl('line', { x1: x, y1: y - s, x2: x, y2: y + s, stroke: '#4ade80', 'stroke-width': 0.8 / state.view.zoom }, layer);
      break;
  }
}

/** Render selection box */
function renderSelectionBox() {
  const layer = selBoxLayer();
  if (!layer) return;
  layer.innerHTML = '';

  const box = state.selectionBox;
  if (!box) return;

  const s = worldToScreen(box.start.x, box.start.y);
  const e = worldToScreen(box.end.x, box.end.y);
  const x = Math.min(s.x, e.x), y = Math.min(s.y, e.y);
  const w = Math.abs(e.x - s.x), h = Math.abs(e.y - s.y);

  const isCrossing = box.crossing;
  const strokeColor = isCrossing ? '#4ade80' : '#58a6ff';
  const fillColor = isCrossing ? 'rgba(74,222,128,0.06)' : 'rgba(88,166,255,0.06)';
  const da = isCrossing ? '6,4' : 'none';

  svgEl('rect', {
    x, y, width: w, height: h,
    fill: fillColor,
    stroke: strokeColor,
    'stroke-width': 1,
    'stroke-dasharray': da,
  }, layer);
}

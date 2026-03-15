/**
 * dxf.js - DXF R12 export
 *
 * Supports: LINE, CIRCLE, ARC, LWPOLYLINE (polyline/rect), TEXT
 * Coordinate system: Y is negated (converts from screen Y-down to DXF Y-up)
 */

import { state } from './core.js';

// ─────────────────────────────────────────────────────────────────────────────
// DXF Export
// ─────────────────────────────────────────────────────────────────────────────

export function exportDXF() {
  const lines = [];

  // Helper to emit a group code + value
  const g = (code, value) => { lines.push(String(code)); lines.push(String(value)); };

  // HEADER SECTION
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');  g(1, 'AC1009'); // AutoCAD R12
  g(9, '$INSBASE');  g(10, 0); g(20, 0); g(30, 0);
  g(9, '$EXTMIN');   g(10, 0); g(20, 0); g(30, 0);
  g(9, '$EXTMAX');   g(10, 1000); g(20, 1000); g(30, 0);
  g(9, '$UNITMODE'); g(70, 0);
  g(0, 'ENDSEC');

  // TABLES SECTION (layers)
  g(0, 'SECTION');
  g(2, 'TABLES');

  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, state.layers.length);

  for (const layer of state.layers) {
    g(0, 'LAYER');
    g(2, layer.name);
    g(70, layer.visible ? 0 : 1); // 0=on, 1=frozen/off
    g(62, colorToACI(layer.color)); // ACI color number
    g(6, lineTypeName(layer.lineType));
  }

  g(0, 'ENDTAB');

  // LTYPE table
  g(0, 'TABLE');
  g(2, 'LTYPE');
  g(70, 5);
  _emitLtype(g, 'CONTINUOUS', 'Solid line', []);
  _emitLtype(g, 'DASHED', 'Dashed', [12, -6]);
  _emitLtype(g, 'DOTTED', 'Dotted', [0, -5]);
  _emitLtype(g, 'CENTER', 'Center line', [20, -5, 0, -5]);
  _emitLtype(g, 'PHANTOM', 'Phantom', [30, -5, 0, -5, 0, -5]);
  g(0, 'ENDTAB');

  g(0, 'ENDSEC');

  // ENTITIES SECTION
  g(0, 'SECTION');
  g(2, 'ENTITIES');

  for (const ent of state.entities) {
    const layer = state.layers.find(l => l.id === ent.layerId);
    if (!layer) continue;
    const layerName = layer.name;
    const lt = lineTypeName(ent.lineType || layer.lineType);

    switch (ent.type) {
      case 'line':
        g(0, 'LINE');
        g(8, layerName);
        g(6, lt);
        g(10, ent.start.x.toFixed(6));
        g(20, (-ent.start.y).toFixed(6));
        g(30, 0);
        g(11, ent.end.x.toFixed(6));
        g(21, (-ent.end.y).toFixed(6));
        g(31, 0);
        break;

      case 'circle':
        g(0, 'CIRCLE');
        g(8, layerName);
        g(6, lt);
        g(10, ent.cx.toFixed(6));
        g(20, (-ent.cy).toFixed(6));
        g(30, 0);
        g(40, ent.r.toFixed(6));
        break;

      case 'arc': {
        // DXF arc: angles in degrees, Y-up, CCW from X-axis
        const startDeg = (-ent.startAngle * 180 / Math.PI + 360) % 360;
        const endDeg = (-ent.endAngle * 180 / Math.PI + 360) % 360;
        g(0, 'ARC');
        g(8, layerName);
        g(6, lt);
        g(10, ent.cx.toFixed(6));
        g(20, (-ent.cy).toFixed(6));
        g(30, 0);
        g(40, ent.r.toFixed(6));
        g(50, startDeg.toFixed(4));
        g(51, endDeg.toFixed(4));
        break;
      }

      case 'polyline':
        _emitPolyline(g, ent, layerName, lt);
        break;

      case 'rect':
        _emitRect(g, ent, layerName, lt);
        break;

      case 'text':
        g(0, 'TEXT');
        g(8, layerName);
        g(10, ent.x.toFixed(6));
        g(20, (-ent.y).toFixed(6));
        g(30, 0);
        g(40, ent.fontSize.toFixed(6));
        g(1, ent.text);
        if (ent.angle) g(50, (ent.angle * 180 / Math.PI).toFixed(4));
        break;

      case 'hatch':
        // Export as closed LWPOLYLINE (boundary)
        g(0, 'LWPOLYLINE');
        g(8, layerName);
        g(90, ent.boundary.length);
        g(70, 1); // closed
        for (const p of ent.boundary) {
          g(10, p.x.toFixed(6));
          g(20, (-p.y).toFixed(6));
        }
        break;
    }
  }

  g(0, 'ENDSEC');
  g(0, 'EOF');

  return lines.join('\n');
}

function _emitPolyline(g, ent, layerName, lt) {
  g(0, 'LWPOLYLINE');
  g(8, layerName);
  g(6, lt);
  g(90, ent.points.length);
  g(70, ent.closed ? 1 : 0);
  for (const p of ent.points) {
    g(10, p.x.toFixed(6));
    g(20, (-p.y).toFixed(6));
  }
}

function _emitRect(g, ent, layerName, lt) {
  const x1 = ent.x, y1 = ent.y;
  const x2 = ent.x + ent.width, y2 = ent.y + ent.height;
  const pts = [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
  g(0, 'LWPOLYLINE');
  g(8, layerName);
  g(6, lt);
  g(90, 4);
  g(70, 1); // closed
  for (const p of pts) {
    g(10, p.x.toFixed(6));
    g(20, (-p.y).toFixed(6));
  }
}

function _emitLtype(g, name, desc, pattern) {
  g(0, 'LTYPE');
  g(2, name);
  g(70, 0);
  g(3, desc);
  g(72, 65);
  g(73, pattern.length);
  const total = pattern.reduce((s, v) => s + Math.abs(v), 0);
  g(40, total.toFixed(6));
  for (const v of pattern) g(49, v.toFixed(6));
}

function lineTypeName(lt) {
  switch (lt) {
    case 'dashed':  return 'DASHED';
    case 'dotted':  return 'DOTTED';
    case 'center':  return 'CENTER';
    case 'phantom': return 'PHANTOM';
    default:        return 'CONTINUOUS';
  }
}

/**
 * Convert hex color to AutoCAD Color Index (ACI)
 * Returns closest standard ACI color. Falls back to 7 (white).
 */
function colorToACI(hex) {
  // Common mappings
  const map = {
    '#ff0000': 1, '#ff4040': 1, '#f87171': 1,
    '#ffff00': 2, '#fbbf24': 2, '#f0b429': 2,
    '#00ff00': 3, '#4ade80': 3, '#34d399': 3,
    '#00ffff': 4, '#22d3ee': 4, '#38bdf8': 4,
    '#0000ff': 5, '#60a5fa': 5, '#58a6ff': 5,
    '#ff00ff': 6, '#e879f9': 6, '#f472b6': 6,
    '#ffffff': 7, '#c9d1d9': 7, '#e2e8f0': 7,
    '#808080': 8, '#8b949e': 8, '#484f58': 8,
    '#c0c0c0': 9, '#a78bfa': 9,
  };

  const lc = hex.toLowerCase();
  if (map[lc] !== undefined) return map[lc];

  // Try to find closest by RGB distance
  const r1 = parseInt(hex.slice(1, 3), 16);
  const g1 = parseInt(hex.slice(3, 5), 16);
  const b1 = parseInt(hex.slice(5, 7), 16);

  const aciColors = [
    [1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0],
    [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255],
    [7, 255, 255, 255], [8, 128, 128, 128], [9, 192, 192, 192],
    [30, 255, 165, 0], [40, 255, 128, 0],
  ];

  let best = 7, bestDist = Infinity;
  for (const [aci, r2, g2, b2] of aciColors) {
    const d = (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
    if (d < bestDist) { bestDist = d; best = aci; }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON Save / Load
// ─────────────────────────────────────────────────────────────────────────────

export function saveJSON() {
  return JSON.stringify({
    version: 1,
    entities: state.entities,
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    view: state.view,
  }, null, 2);
}

export function loadJSON(jsonStr) {
  const data = JSON.parse(jsonStr);
  if (data.version !== 1) throw new Error('Unknown file version');
  state.entities = data.entities || [];
  state.layers = data.layers || [];
  state.activeLayerId = data.activeLayerId || 'layer0';
  if (data.view) state.view = data.view;
  state.selectedIds = new Set();
}

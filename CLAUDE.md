# XNH 2DCAD - Implementation Plan

## Overview
Browser-based AutoCAD-compatible 2D CAD editor. Pure JavaScript (ES Modules), SVG rendering, no framework, no build step required.

## File Structure
```
index.html          - Main UI shell (Tailwind CSS via CDN)
js/
  core.js           - State, geometry utilities, snap system, undo/redo history
  render.js         - SVG rendering engine (entities, preview, snap indicator, selection box)
  tools.js          - All drawing and edit tool implementations
  ui.js             - Layer panel, properties panel, status bar, command line UI
  dxf.js            - DXF export (lines, circles, arcs, polylines, text)
  app.js            - App initialization, event wiring, keyboard shortcuts
```

## Coordinate System
- Internal storage: Y-down (matches SVG screen coordinates)
- DXF export: Y negated (converts to AutoCAD standard Y-up)
- World units: arbitrary (1 unit default)

## Entity Types
```
line      - { id, type, layerId, color?, lineType?, lineWeight?, start:{x,y}, end:{x,y} }
polyline  - { id, type, layerId, ..., points:[{x,y}], closed:bool }
rect      - { id, type, layerId, ..., x, y, width, height }
circle    - { id, type, layerId, ..., cx, cy, r }
arc       - { id, type, layerId, ..., cx, cy, r, startAngle, endAngle }
text      - { id, type, layerId, ..., x, y, text, fontSize, angle }
```
Properties color/lineType/lineWeight = null means "by layer".

## Feature Roadmap

### P1 - Core Drawing (Implemented)
- [x] Line tool (L)
- [x] Polyline tool (PL) - multi-segment, close with C
- [x] Rectangle tool (REC/R)
- [x] Circle tool (C) - center + radius
- [x] Arc tool (A) - 3-point arc
- [x] Text tool (T) - single-line text
- [x] Select tool - click, box (window), crossing selection
- [x] Move (M) - base point + destination
- [x] Copy (CP) - base point + destination
- [x] Delete (E / Del key)
- [x] Undo (Ctrl+Z / U)
- [x] Redo (Ctrl+Y)
- [x] Object snap - endpoint, midpoint, center, quadrant, grid
- [x] Ortho mode (F8)
- [x] Grid display
- [x] Zoom - mouse wheel (cursor-centered), extents (Z E)
- [x] Pan - middle mouse button or Space+drag
- [x] Layer management - create, rename, color, visibility, lock
- [x] Properties panel - type, layer, coordinates
- [x] DXF export - comprehensive (line, circle, arc, polyline, text)
- [x] Command line - coordinate input (x,y and @dx,dy), tool commands
- [x] Keyboard shortcuts (standard AutoCAD-like)

### P2 - Edit Operations (Planned)
- [ ] Rotate (RO)
- [ ] Scale (SC)
- [ ] Mirror (MI)
- [ ] Offset (O)
- [ ] Trim (TR)
- [ ] Extend (EX)
- [ ] Fillet (F)
- [ ] Chamfer (CHA)

### P3 - Advanced (Planned)
- [ ] Linear/radial dimensions (DIM)
- [ ] Hatch patterns (H)
- [ ] Ellipse tool (EL)
- [ ] Spline tool (SPL)
- [ ] Block insert (I) / Block definition (B)
- [ ] DXF import
- [ ] JSON save/load (.xnh format)
- [ ] AI generation (Gemini)
- [ ] Intersection snap
- [ ] Perpendicular snap
- [ ] Tangent snap

## Keyboard Shortcuts
| Key         | Action              |
|-------------|---------------------|
| L           | Line tool           |
| PL          | Polyline tool       |
| REC         | Rectangle tool      |
| C           | Circle tool         |
| A           | Arc tool            |
| T           | Text tool           |
| M           | Move                |
| CP / CO     | Copy                |
| E           | Erase (delete sel.) |
| U / Ctrl+Z  | Undo                |
| Ctrl+Y      | Redo                |
| F8          | Toggle Ortho        |
| F3          | Toggle Snap         |
| Escape      | Cancel / Deselect   |
| Enter/Space | Finish polyline     |
| Delete      | Delete selected     |
| Ctrl+A      | Select all          |
| Z E         | Zoom extents        |
| Z W         | Zoom window         |

## Snap Indicator Colors
- endpoint   - yellow square
- midpoint   - yellow triangle
- center     - yellow circle with crosshair
- quadrant   - yellow diamond
- grid       - small green cross

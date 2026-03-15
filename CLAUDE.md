# XNH 2DCAD - Implementation Plan

## Overview
Browser-based AutoCAD-compatible 2D CAD editor. Pure JavaScript (ES Modules), SVG rendering, no framework, no build step required.
Target level: AutoCAD STEP0 (basic 2D drawing + essential edit operations).

## File Structure
```
index.html          - Main UI shell (Tailwind CSS via CDN)
js/
  core.js           - State, geometry utilities, snap system, undo/redo history
  render.js         - SVG rendering engine (entities, preview, snap indicator, selection box)
  tools.js          - All drawing and edit tool implementations
  ui.js             - Layer panel, properties panel, status bar, command line UI
  dxf.js            - DXF export (lines, circles, arcs, polylines, text, hatch)
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
hatch     - { id, type, layerId, ..., boundary:[{x,y}], pattern:'solid'|'lines'|'cross', angle:45, spacing:10 }
```
Properties color/lineType/lineWeight = null means "by layer".

## Current Implementation Status (as of 2026-03-15)

### Implemented ✅
- **Environment**: New / Open / Save (JSON), DXF Export, Undo/Redo (100 steps)
- **View**: Pan (middle mouse), Zoom (wheel, cursor-centered), Zoom Extents, Grid, Ortho (F8), Snap (F3)
- **Layers**: Create, delete, rename, color picker, visibility, lock
- **Drawing**: LINE, POLYLINE, RECT, CIRCLE, ARC (3-point), TEXT
- **Edit**: SELECT (click / window / crossing), MOVE, COPY, DELETE
- **Snap**: endpoint, midpoint, center, quadrant, grid
- **Properties panel**: editable coordinates, layer, line type
- **Command line**: coordinate input (x,y / @dx,dy), tool commands
- **DXF export**: LINE, CIRCLE, ARC, LWPOLYLINE (polyline+rect), TEXT

### Implemented in this release ✅ (2026-03-15 Phase 2–4)
- **OFFSET** (O): Parallel offset of lines, circles, arcs
- **TRIM** (TR): Trim entity at intersection with cutting edges
- **EXTEND** (EX): Extend line to nearest boundary
- **FILLET** (F): Round corner between two lines with arc
- **STRETCH** (S): Move endpoints inside a crossing window
- **ARRAY** (AR): Rectangular array (rows × cols)
- **HATCH** (H): Solid fill or line-pattern fill on closed boundaries
- Command aliases: O, TR, EX, F, S, AR, H

### Not Yet Implemented ❌
- Rotate (RO), Scale (SC), Mirror (MI)
- Chamfer (CHA)
- Polar array
- DXF import
- Dimension tools (DIM, DIMLIN, DIMRAD)
- Ellipse (EL), Spline (SPL)
- Block/Group (B/I)
- AI generation (requires API key setup)

## Gap Analysis vs STEP0 Target

| Category | Feature | Status |
|---|---|---|
| Environment | New/Open/Save | ✅ |
| Environment | Undo/Redo | ✅ |
| Environment | Coordinate input (abs/rel) | ✅ |
| Environment | Pan/Zoom/Extents | ✅ |
| Environment | Grid | ✅ |
| Environment | Object Snap | ✅ |
| Environment | Ortho | ✅ |
| Environment | Layers | ✅ |
| Drawing | LINE | ✅ |
| Drawing | RECT | ✅ |
| Drawing | CIRCLE | ✅ |
| Drawing | ARC | ✅ |
| Drawing | TEXT | ✅ |
| Edit | SELECT (single/window/crossing) | ✅ |
| Edit | MOVE | ✅ |
| Edit | COPY | ✅ |
| Edit | DELETE | ✅ |
| Edit | OFFSET | ✅ |
| Edit | TRIM | ✅ |
| Edit | EXTEND | ✅ |
| Edit | FILLET | ✅ |
| Edit | STRETCH | ✅ |
| Edit | ARRAY | ✅ (rectangular) |
| Representation | HATCH | ✅ (solid + lines) |
| Output | DXF export | ✅ |

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
| O           | Offset              |
| TR          | Trim                |
| EX          | Extend              |
| F           | Fillet              |
| S           | Stretch             |
| AR          | Array (rectangular) |
| H           | Hatch               |
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

## Command Usage Guide

### OFFSET (O)
1. Type O or click Offset button
2. Enter offset distance in command line (e.g., `20`)
3. Click the entity to offset (line, circle, arc)
4. Click on the side to offset toward
5. Press Esc to finish

### TRIM (TR)
1. Type TR or click Trim button
2. Click the portion of the entity to remove
   (automatically uses all visible entities as cutting edges)
3. Press Esc to finish

### EXTEND (EX)
1. Type EX or click Extend button
2. Click near the endpoint of the line to extend
3. The line extends to the nearest intersecting entity
4. Press Esc to finish

### FILLET (F)
1. Type F or click Fillet button
2. Enter fillet radius in command line (e.g., `10`), or press Enter for 0 (sharp)
3. Click first line
4. Click second line
5. Arc is created at the corner

### STRETCH (S)
1. Type S or click Stretch button
2. Drag a crossing window (right to left) around the endpoints to move
3. Click base point
4. Click destination point

### ARRAY (AR)
1. Select entities to array
2. Type AR or click Array button
3. Enter: rows,cols (e.g., `3,4`)
4. Enter row spacing (e.g., `50`)
5. Enter column spacing (e.g., `50`)

### HATCH (H)
1. Select a closed entity (rect, circle, closed polyline) OR draw a closed boundary
2. Type H or click Hatch button
3. Enter pattern: `solid`, `lines`, or `cross` (default: solid)
4. Hatch is created on the active layer

## Known Constraints / Simplified Implementations
- **TRIM**: Uses bounding-box intersection detection; complex curved trim may be approximate
- **EXTEND**: Works on lines only; arcs/circles not supported
- **FILLET**: Works on two straight lines only; does not handle line+arc
- **ARRAY**: Rectangular only; polar array not yet implemented
- **HATCH**: Boundary must be explicitly selected; auto pick-point detection not implemented
- **OFFSET**: Polylines/rects not supported (lines, circles, arcs only)
- **Snap**: Intersection snap not yet implemented
- **ARC**: 3-point method only; center+angle method not implemented

## Snap Indicator Colors
- endpoint   - yellow square
- midpoint   - yellow triangle
- center     - yellow circle with crosshair
- quadrant   - yellow diamond
- grid       - small green cross

## Edit History
| Date | Change |
|------|--------|
| 2026-03-15 | Initial rebuild from scratch (pure JS, no React/TS) |
| 2026-03-15 | Phase 2-4: OFFSET, TRIM, EXTEND, FILLET, STRETCH, ARRAY, HATCH added |

## Acceptance Criteria Checklist
- [x] 線を引く (LINE)
- [x] OFFSET で平行線を作る
- [x] CIRCLE で円を描く
- [x] COPY で複製する
- [x] TRIM で不要部を切る
- [x] FILLET で角を丸める
- [x] EXTEND で線を延長する
- [x] RECT を描く
- [x] MOVE で移動する
- [x] HATCH を入れる
- [x] TEXT を置く
- [x] STRETCH で一部を伸ばす
- [x] ARRAY で複製配置する
- [x] Save / Open / DXF export が壊れていない

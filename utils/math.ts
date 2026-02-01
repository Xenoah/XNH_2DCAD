import { Point } from '../types';

export const distance = (p1: Point, p2: Point): number => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
};

export const screenToWorld = (screenX: number, screenY: number, viewX: number, viewY: number, zoom: number): Point => {
  return {
    x: (screenX - viewX) / zoom,
    y: (screenY - viewY) / zoom
  };
};

export const worldToScreen = (worldX: number, worldY: number, viewX: number, viewY: number, zoom: number): Point => {
  return {
    x: worldX * zoom + viewX,
    y: worldY * zoom + viewY
  };
};

export const snapToGrid = (value: number, gridSize: number = 10): number => {
  return Math.round(value / gridSize) * gridSize;
};

export const generateId = (): string => {
  return Math.random().toString(36).substr(2, 9);
};

// Simple bounding box intersection for selection
export const isPointInRect = (p: Point, r: { x: number, y: number, w: number, h: number }): boolean => {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
};

export const createDXFContent = (entities: any[]): string => {
  let s = "0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
  
  entities.forEach(ent => {
    if (ent.type === 'line') {
      s += `0\nLINE\n8\n${ent.layerId}\n10\n${ent.start.x}\n20\n${-ent.start.y}\n11\n${ent.end.x}\n21\n${-ent.end.y}\n`;
    } else if (ent.type === 'circle') {
      s += `0\nCIRCLE\n8\n${ent.layerId}\n10\n${ent.cx}\n20\n${-ent.cy}\n40\n${ent.r}\n`;
    } else if (ent.type === 'rect') {
       // Convert rect to polyline for DXF
       const x = ent.x; const y = -ent.y; const w = ent.width; const h = -ent.height;
       s += `0\nLWPOLYLINE\n8\n${ent.layerId}\n90\n4\n70\n1\n`;
       s += `10\n${x}\n20\n${y}\n`;
       s += `10\n${x+w}\n20\n${y}\n`;
       s += `10\n${x+w}\n20\n${y+h}\n`;
       s += `10\n${x}\n20\n${y+h}\n`;
    }
  });

  s += "0\nENDSEC\n0\nEOF\n";
  return s;
}
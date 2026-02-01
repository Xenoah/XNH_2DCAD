export enum ToolType {
  SELECT = 'SELECT',
  LINE = 'LINE',
  RECTANGLE = 'RECTANGLE',
  CIRCLE = 'CIRCLE',
  ARC = 'ARC',
  TEXT = 'TEXT',
  PAN = 'PAN',
}

export interface Point {
  x: number;
  y: number;
}

export type EntityType = 'line' | 'circle' | 'rect' | 'text';

export interface BaseEntity {
  id: string;
  layerId: string;
  type: EntityType;
  color?: string; // Hex
  selected?: boolean;
}

export interface LineEntity extends BaseEntity {
  type: 'line';
  start: Point;
  end: Point;
}

export interface RectEntity extends BaseEntity {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CircleEntity extends BaseEntity {
  type: 'circle';
  cx: number;
  cy: number;
  r: number;
}

export interface TextEntity extends BaseEntity {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

export type Entity = LineEntity | RectEntity | CircleEntity | TextEntity;

export interface Layer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}

export interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

export interface HistoryStep {
  entities: Entity[];
}

export interface CadState {
  entities: Entity[];
  layers: Layer[];
  activeLayerId: string;
  view: ViewState;
  tool: ToolType;
  selectedIds: string[];
  history: HistoryStep[];
  historyIndex: number;
  previewEntity: Entity | null;
}
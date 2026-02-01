import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Entity, Layer } from "../types";
import { generateId } from "../utils/math";

// Define the schema for the model response
const entitySchema: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      type: { type: Type.STRING, enum: ['line', 'circle', 'rect', 'text'] },
      // Line props
      startX: { type: Type.NUMBER },
      startY: { type: Type.NUMBER },
      endX: { type: Type.NUMBER },
      endY: { type: Type.NUMBER },
      // Circle props
      cx: { type: Type.NUMBER },
      cy: { type: Type.NUMBER },
      r: { type: Type.NUMBER },
      // Rect props
      x: { type: Type.NUMBER },
      y: { type: Type.NUMBER },
      width: { type: Type.NUMBER },
      height: { type: Type.NUMBER },
      // Text props
      text: { type: Type.STRING },
      fontSize: { type: Type.NUMBER },
    },
    required: ['type'],
  },
};

export const generateCadEntities = async (
  prompt: string,
  activeLayerId: string
): Promise<Entity[]> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction = `
    You are a CAD engine. Convert the user's natural language request into a set of 2D geometric entities.
    Coordinate System: X increases to right, Y increases down (SVG standard).
    Assume a canvas size of roughly 1000x800, center is around 500,400 unless specified.
    Return strictly a JSON array of entities.
    For 'line': required startX, startY, endX, endY.
    For 'circle': required cx, cy, r.
    For 'rect': required x, y, width, height.
    For 'text': required x, y, text, fontSize.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: entitySchema,
        thinkingConfig: { thinkingBudget: 0 } 
      },
    });

    const jsonText = response.text;
    if (!jsonText) return [];

    const parsedData = JSON.parse(jsonText);
    
    // Transform API response to internal Entity type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entities: Entity[] = parsedData.map((item: any) => {
      const base = {
        id: generateId(),
        layerId: activeLayerId,
        selected: false,
      };

      switch (item.type) {
        case 'line':
          return { ...base, type: 'line', start: { x: item.startX, y: item.startY }, end: { x: item.endX, y: item.endY } };
        case 'circle':
          return { ...base, type: 'circle', cx: item.cx, cy: item.cy, r: item.r };
        case 'rect':
          return { ...base, type: 'rect', x: item.x, y: item.y, width: item.width, height: item.height };
        case 'text':
          return { ...base, type: 'text', x: item.x, y: item.y, text: item.text, fontSize: item.fontSize || 12 };
        default:
          return null;
      }
    }).filter(Boolean);

    return entities;

  } catch (error) {
    console.error("Gemini Generation Error:", error);
    throw error;
  }
};
import { createContext } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
export const CanvasReferences = createContext<ExcalidrawImperativeAPI | null>(null);

import { create } from 'zustand';

interface EditorState {
  activeTool: 'select' | 'hotspot' | 'marker';
  setActiveTool: (tool: 'select' | 'hotspot' | 'marker') => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool }),
}));

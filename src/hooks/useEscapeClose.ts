import React from 'react';

const escapeCloseStack: string[] = [];
let escapeCloseCounter = 0;

export function hasEscapeCloseLayer() {
  return escapeCloseStack.length > 0;
}

export function getEscapeCloseLayerCount() {
  return escapeCloseStack.length;
}

export function useEscapeClose(enabled: boolean, onClose: () => void) {
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!enabled) return;
    const id = `esc-close-${escapeCloseCounter += 1}`;
    escapeCloseStack.push(id);
    const removeFromStack = () => {
      const idx = escapeCloseStack.lastIndexOf(id);
      if (idx >= 0) escapeCloseStack.splice(idx, 1);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const top = escapeCloseStack[escapeCloseStack.length - 1];
      if (top !== id) return;
      e.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      removeFromStack();
    };
  }, [enabled]);
}

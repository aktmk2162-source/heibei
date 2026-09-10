export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PointerHandlers {
  onDown(x: number, y: number): void;
  onMove(x: number, y: number): void;
  onUp(x: number, y: number): void;
}

/**
 * ページ座標を、論理描画座標（computeLayout に渡す座標系）へ換算する。
 * 純関数。テストできるようにブラウザ API を触らない。
 */
export function toCanvasPoint(
  rect: RectLike,
  logicalWidth: number,
  logicalHeight: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: ((clientX - rect.left) * logicalWidth) / rect.width,
    y: ((clientY - rect.top) * logicalHeight) / rect.height,
  };
}

/**
 * Pointer Events だけを使う。touchstart 系は使わない（PC のマウスで反応しなくなる）。
 * 戻り値を呼ぶと解除する。
 */
export function attachPointer(
  canvas: HTMLCanvasElement,
  handlers: PointerHandlers,
): () => void {
  const point = (ev: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    // 論理座標系は CSS ピクセルです（computeLayout に渡すのと同じ単位）。
    // canvas.width はバッキングストアの大きさで、devicePixelRatio 倍されていることが
    // あります。ここで参照すると、canvas の寸法を決める側の書き方に依存してしまうため、
    // clientWidth / clientHeight を使います。
    return toCanvasPoint(rect, canvas.clientWidth, canvas.clientHeight, ev.clientX, ev.clientY);
  };

  const onDown = (ev: PointerEvent): void => {
    canvas.setPointerCapture(ev.pointerId);
    const p = point(ev);
    handlers.onDown(p.x, p.y);
  };
  const onMove = (ev: PointerEvent): void => {
    const p = point(ev);
    handlers.onMove(p.x, p.y);
  };
  const onUp = (ev: PointerEvent): void => {
    if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    const p = point(ev);
    handlers.onUp(p.x, p.y);
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
  };
}

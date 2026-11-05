export type MatrixTransform = { scale: number; x: number; y: number };
export const INITIAL_TRANSFORM: MatrixTransform = { scale: 1, x: 0, y: 0 };
export const MAX_MATRIX_ZOOM = 32;
export function clampTransform(transform: MatrixTransform, width: number, height: number): MatrixTransform {
  const scale = Math.max(1, Math.min(MAX_MATRIX_ZOOM, transform.scale));
  return { scale, x: Math.min(0, Math.max(width * (1 - scale), transform.x)), y: Math.min(0, Math.max(height * (1 - scale), transform.y)) };
}
export function zoomAt(current: MatrixTransform, nextScale: number, anchor: { x: number; y: number }, width: number, height: number) {
  const scale = Math.max(1, Math.min(MAX_MATRIX_ZOOM, nextScale));
  const ratio = scale / current.scale;
  return clampTransform({ scale, x: anchor.x - (anchor.x - current.x) * ratio, y: anchor.y - (anchor.y - current.y) * ratio }, width, height);
}
export function revealRectangle(current: MatrixTransform, rect: { x: number; y: number; width: number; height: number }, width: number, height: number) {
  const x = rect.x * current.scale + current.x, y = rect.y * current.scale + current.y;
  const w = rect.width * current.scale, h = rect.height * current.scale;
  return clampTransform({ ...current,
    x: current.x + (x < 0 ? -x : x + w > width ? width - x - w : 0),
    y: current.y + (y < 0 ? -y : y + h > height ? height - y - h : 0),
  }, width, height);
}

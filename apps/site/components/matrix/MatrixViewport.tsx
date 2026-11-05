'use client';
import React, { useEffect, useId, useRef, useState } from 'react';
import { clampTransform, INITIAL_TRANSFORM, MAX_MATRIX_ZOOM, revealRectangle, zoomAt, type MatrixTransform } from '@/lib/matrix/viewport';
import s from './matrix.module.css';

type Rectangle = { x: number; y: number; width: number; height: number };
type Props = { width: number; height: number; title: string; children: (view: { scale: number; reveal: (rect: Rectangle) => void }) => React.ReactNode };

/** Local interaction only: wheel capture is opt-in; Escape always returns page scrolling. */
export default function MatrixViewport({ width, height, title, children }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const hint = useId();
  const [active, setActive] = useState(false);
  const [transform, setTransform] = useState<MatrixTransform>(INITIAL_TRANSFORM);
  const current = useRef(transform);
  useEffect(() => { current.current = transform; }, [transform]);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ transform: MatrixTransform; center: { x: number; y: number }; distance: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => { if (!active) { pointers.current.clear(); gesture.current = null; suppressClick.current = false; } }, [active]);
  const commit = (next: MatrixTransform) => { current.current = next; setTransform(next); };
  const local = (clientX: number, clientY: number) => {
    const bounds = viewport.current?.getBoundingClientRect();
    return { x: (clientX - (bounds?.left ?? 0)) * width / (bounds?.width || width), y: (clientY - (bounds?.top ?? 0)) * height / (bounds?.height || height) };
  };
  const zoom = (factor: number) => {
    setActive(true);
    commit(zoomAt(current.current, current.current.scale * factor, { x: width / 2, y: height / 2 }, width, height));
  };
  useEffect(() => {
    const element = viewport.current;
    if (!element || !active) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || !event.deltaY) return;
      const bounds = element.getBoundingClientRect();
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
      const factor = Math.exp(-Math.max(-500, Math.min(500, event.deltaY * multiplier)) * .002);
      const next = zoomAt(current.current, current.current.scale * factor, { x: (event.clientX - bounds.left) * width / (bounds.width || width), y: (event.clientY - bounds.top) * height / (bounds.height || height) }, width, height);
      // At either limit let the page scroll rather than creating a scroll trap.
      if (next.scale === current.current.scale) return;
      event.preventDefault(); current.current = next; setTransform(next);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setActive(false); };
    element.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('keydown', escape);
    return () => { element.removeEventListener('wheel', wheel); document.removeEventListener('keydown', escape); };
  }, [active, width, height]);
  const reveal = (rect: Rectangle) => setTransform(previous => revealRectangle(previous, rect, width, height));
  const startGesture = () => {
    const points = [...pointers.current.values()];
    if (!points.length) { gesture.current = null; return; }
    const center = points.length > 1 ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } : points[0];
    gesture.current = { transform: current.current, center, distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0, moved: false };
  };
  return <div className={s.viewportRoot}>
    <div className={s.zoomToolbar} role="group" aria-label="矩阵缩放控制">
      <button type="button" aria-pressed={active} onClick={() => setActive(value => !value)}>{active ? '关闭滚轮缩放' : '开启滚轮缩放'}</button>
      <button type="button" aria-label="放大矩阵" disabled={transform.scale >= MAX_MATRIX_ZOOM} onClick={() => zoom(1.5)}>＋</button>
      <button type="button" aria-label="缩小矩阵" disabled={transform.scale <= 1} onClick={() => zoom(1 / 1.5)}>−</button>
      <output aria-label="矩阵缩放比例">{Math.round(transform.scale * 100)}%</output>
      <button type="button" onClick={() => { commit(INITIAL_TRANSFORM); setActive(false); }}>重置视图</button>
    </div>
    <p id={hint} className={s.zoomHint}>{active ? '滚轮缩放 · 拖动平移 · 双指缩放 · Esc 退出；到缩放边界恢复页面滚动。' : '开启后可用鼠标滚轮缩放、拖动平移；也可用 ＋ / −。默认滚动页面，手机保留页面手势。'}键盘：聚焦画布后 ＋ / − 缩放、方向键平移、Home 重置。</p>
    <div ref={viewport} className={s.zoomViewport} style={{ aspectRatio: `${width} / ${height}`, touchAction: active ? 'none' : 'pan-y pinch-zoom' }} tabIndex={0} role="group" aria-label={`${title}可缩放画布`} aria-describedby={hint} data-zoom={transform.scale} data-interactive={active}
      onKeyDown={event => {
        if (event.key === 'Escape') { setActive(false); pointers.current.clear(); gesture.current = null; return; }
        // Leave tile Enter/Space selection and browser shortcuts untouched.
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.5); }
        else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.5); }
        else if (event.key === 'Home') { event.preventDefault(); commit(INITIAL_TRANSFORM); setActive(false); }
        else if (transform.scale > 1 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault(); commit(clampTransform({ ...current.current, x: current.current.x + (event.key === 'ArrowLeft' ? 60 : event.key === 'ArrowRight' ? -60 : 0), y: current.current.y + (event.key === 'ArrowUp' ? 60 : event.key === 'ArrowDown' ? -60 : 0) }, width, height));
        }
      }}
      onPointerDown={event => {
        if (!active || (event.pointerType === 'mouse' && event.button !== 0)) return;
        suppressClick.current = false;
        pointers.current.set(event.pointerId, local(event.clientX, event.clientY)); startGesture();
      }}
      onPointerMove={event => {
        if (!active || !pointers.current.has(event.pointerId) || !gesture.current) return;
        pointers.current.set(event.pointerId, local(event.clientX, event.clientY));
        const points = [...pointers.current.values()], start = gesture.current;
        const center = points.length > 1 ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } : points[0];
        const distance = points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
        if (Math.hypot(center.x - start.center.x, center.y - start.center.y) < 4 && Math.abs(distance - start.distance) < 4 && !start.moved) return;
        start.moved = true; suppressClick.current = true;
        viewport.current?.setPointerCapture?.(event.pointerId);
        const scaled = zoomAt(start.transform, start.distance > 0 && distance > 0 ? start.transform.scale * distance / start.distance : start.transform.scale, start.center, width, height);
        commit(clampTransform({ ...scaled, x: scaled.x + center.x - start.center.x, y: scaled.y + center.y - start.center.y }, width, height));
      }}
      onPointerUp={event => { pointers.current.delete(event.pointerId); if (viewport.current?.hasPointerCapture?.(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId); startGesture(); }}
      onPointerCancel={event => { pointers.current.delete(event.pointerId); startGesture(); }}
      onPointerLeave={event => { if (!viewport.current?.hasPointerCapture?.(event.pointerId)) { pointers.current.delete(event.pointerId); startGesture(); } }}
      onLostPointerCapture={event => { pointers.current.delete(event.pointerId); startGesture(); }}
      onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${title}区块`}>
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
          {children({ scale: transform.scale, reveal })}
        </g>
      </svg>
    </div>
  </div>;
}

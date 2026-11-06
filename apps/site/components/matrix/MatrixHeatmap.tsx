'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { matrixColorMaximum, matrixColor, describeMatrixItem, readableGridColumns, type MatrixItem, type MatrixGroup, type MatrixColorMode, type MatrixEntry } from '@/lib/matrix/model';
import { amountStatus, matrixAreaModel, monetaryTreemap, type MatrixRectangle } from '@/lib/matrix/layout';
import MatrixViewport from './MatrixViewport';
import s from './matrix.module.css';

export type { MatrixItem, MatrixGroup } from '@/lib/matrix/model';
export { readableGridColumns } from '@/lib/matrix/model';
export type MatrixHeatmapProps = {
  groups: MatrixGroup[]; title: string; description?: string; colorMeaning: string; areaMeaning: string;
  colorMode?: MatrixColorMode; colorPalette?: 'china' | 'global'; colorMaxAbs?: number;
  /** Source amount metadata determines the layout; retained for caller compatibility. */
  layout?: 'treemap' | 'readable-grid'; stretchSmallGroups?: boolean;
  scopeKey?: string; selectedItemId?: string; showDetails?: boolean;
  emptyTitle?: string; emptyMessage?: string; emptyNote?: string;
  onSelect?: (item: MatrixItem, group: MatrixGroup) => void;
};
const shareText = (share: number | null) => share === null ? '不占金额面积' : `当前金额面积占比 ${(share * 100).toLocaleString('zh-CN', { maximumFractionDigits: 4 })}%`;
function TileText({ rectangle, scale }: { rectangle: MatrixRectangle; scale: number }) {
  const { entry: { item }, x, y, width, height } = rectangle;
  const w = width * scale, h = height * scale, cx = x + width / 2, cy = y + height / 2;
  const font = Math.min(w > 180 && h > 110 ? 25 : 17, (w - 16) / Math.max(item.label.length, 1));
  const valueFont = Math.min(w > 180 && h > 110 ? 23 : 15, (w - 16) / Math.max(item.displayValue.length * .65, 1));
  return <>
    {w > 40 && h > 35 && font >= 10 && <text className={s.name} textAnchor="middle" x={cx} y={cy - (h >= 65 ? 8 : -4) / scale} fontSize={font / scale}>{item.label}</text>}
    {w > 55 && h >= 65 && valueFont >= 10 && <text className={s.value} textAnchor="middle" x={cx} y={cy + 20 / scale} fontSize={valueFont / scale}>{item.displayValue}</text>}
    {w >= 180 && h >= 110 && <text className={s.detail} textAnchor="middle" x={cx} y={cy + 45 / scale} fontSize={11 / scale}>{shareText(rectangle.share)}</text>}
  </>;
}

/** Pure presentation. Adapters declare financial comparability; the renderer never infers it. */
export default function MatrixHeatmap({ groups, title, description, colorMeaning, areaMeaning, colorMode = 'signed', colorPalette = 'china', colorMaxAbs, stretchSmallGroups = false, scopeKey, selectedItemId, showDetails = true, emptyTitle = '矩阵暂无可核验数据', emptyNote = '不以价格、持仓或模拟数值填充资金流。', emptyMessage = '尚无通过核验的数据。缺失不是零，矩阵不会用示例数值填满。', onSelect }: MatrixHeatmapProps) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  const [hovered, setHovered] = useState<{id:string;geometry:boolean} | null>(null), [focused, setFocused] = useState<{id:string;geometry:boolean} | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const measure = () => { const next = host.current?.clientWidth; if (next && next > 0) setWidth(Math.round(next)); };
    measure(); if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(host.current); return () => observer.disconnect();
  }, []);
  const populated = useMemo(() => groups.filter(group => group.items.length), [groups]);
  const area = useMemo(() => matrixAreaModel(populated), [populated]);
  const height = width < 600 ? 440 : 520;
  const rectangles = useMemo(() => monetaryTreemap(populated, width, height), [populated, width, height]);
  const maximum = matrixColorMaximum(area.entries, colorMaxAbs);
  const entryMap = useMemo(() => new Map(area.entries.map(entry => [entry.id, entry])), [area.entries]);
  const currentEntry = (target: typeof hovered) => {
    const entry = target && entryMap.get(target.id);
    return entry && (!target.geometry || amountStatus(entry) === 'amount') ? entry : null;
  };
  const inspected = currentEntry(hovered) || currentEntry(focused) || area.entries.find(entry => entry.item.id === selectedItemId);
  const layoutMode = area.compatible ? 'treemap' : 'readable-grid';
  useEffect(() => { if (host.current) host.current.scrollTop = 0; }, [title, scopeKey, layoutMode]);
  const events = (entry: MatrixEntry, geometry = false) => ({
    onMouseEnter: () => setHovered({id:entry.id,geometry}), onMouseLeave: () => setHovered(null),
    onFocus: () => { setHovered(null); setFocused({id:entry.id,geometry}); }, onBlur: () => setFocused(null),
  });
  const color = (item: MatrixItem) => matrixColor(item, colorMode, maximum);
  const describe = (entry: MatrixEntry) => `${describeMatrixItem(entry.item, entry.group)}${area.compatible ? ` · ${shareText(area.share(entry))}` : ''}`;
  const renderCard = (entry: MatrixEntry, detail = false) => {
    const { item, group } = entry;
    const status = amountStatus(entry);
    const content = <><span data-matrix-label className={s.gridName}>{item.label}</span><span className={s.gridValue}>{item.displayValue}</span>{item.detail && <span className={s.gridDetail}>{item.detail}</span>}{detail && <span className={s.gridDetail}>{status === 'zero' ? '实测零值 · 不占金额面积' : status === 'missing' ? '金额缺失 · 不占面积' : shareText(area.share(entry))}</span>}</>;
    const shared = { className: detail ? s.detailRow : s.gridTile, 'data-id': item.id, 'data-color': color(item), 'data-selected': item.id === selectedItemId || undefined, 'aria-label': describe(entry), title: describe(entry), ...events(entry) };
    return onSelect ? <button key={entry.id} type="button" {...shared} onClick={() => onSelect(item, group)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item, group); } }}>{content}</button>
      : <div key={entry.id} {...shared} tabIndex={0} role="img">{content}</div>;
  };
  return <section className={s.root} aria-label={title} data-palette={colorPalette}>
    <header className={s.heading}><div><p className={s.eyebrow}>MATRIX VIEW</p><h2>{title}</h2>{description && <p>{description}</p>}</div><span className={s.viewLabel}>{area.compatible ? '金额面积矩阵' : '信息矩阵'}</span></header>
    <div className={s.meanings}><span>面积：{areaMeaning}</span><span>颜色：{colorMeaning}</span></div>
    {area.entries.length > 0 && <p className={s.gridHint}>{area.compatible ? `区块面积严格按当前范围内金额绝对值分配（${area.currency}）；${colorMode==='signed'?'正负方向由颜色区分。':''}零值与缺失不分配面积。` : area.reason === 'incomparable' ? '币种、指标或统计口径不可直接比较：使用等宽信息卡，面积不代表金额，不合计。' : '没有可比较的金额指标：使用等宽信息卡，面积不代表金额。'}</p>}
    {!area.compatible && area.entries.length > 0 && <p className={s.gridHint}>全部 {area.entries.length} 个区块 · 在矩阵内滚动查看，或按 Tab 逐项选择</p>}
    <div ref={host} className={s.canvas} data-layout={layoutMode} data-matrix-empty={!area.entries.length ? 'true' : undefined}>
      {!area.entries.length ? <div className={s.empty} role="status"><span className={s.emptyIcon} aria-hidden="true">▦</span><h3>{emptyTitle}</h3><p>{emptyMessage}</p>{emptyNote && <small>{emptyNote}</small>}</div>
        : !area.compatible ? <div role="group" aria-label={`${title}区块`} className={s.readableGroups}>
          {populated.map(group => <section key={group.id} className={s.gridGroup} aria-label={group.label}><h3>{group.label}</h3><div className={s.readableGrid} style={{ gridTemplateColumns: `repeat(${stretchSmallGroups ? Math.min(group.items.length, readableGridColumns(width)) : readableGridColumns(width)}, minmax(0, 1fr))` }}>{area.entries.filter(entry => entry.group === group).map(entry => renderCard(entry))}</div></section>)}
        </div>
          : !rectangles.leaves.length ? <div className={s.noArea} role="status">当前只有零值或缺失金额，没有可分配的金额面积。请查看数值明细。</div>
            : <MatrixViewport key={`${scopeKey ?? `${title}/${area.currency}/${area.entries[0]?.item.amount?.comparisonKey}`}/${width}/${height}`} width={width} height={height} title={title}>
              {({ scale, reveal }) => <>
                {rectangles.leaves.map(rectangle => {
                  const { entry, x, y, width: w, height: h } = rectangle;
                  // Pointer focus must not move a tile underneath a click or drag.
                  return <g key={rectangle.id} className={s.tile} data-color={color(entry.item)} data-id={entry.item.id} data-share={rectangle.share} data-selected={entry.item.id === selectedItemId || undefined} tabIndex={0} role={onSelect ? 'button' : 'img'} aria-label={describe(entry)} {...events(entry, true)} onFocus={event => { setHovered(null); setFocused({id:entry.id,geometry:true}); if (event.currentTarget.matches(':focus-visible')) reveal(rectangle); }} onClick={onSelect ? () => onSelect(entry.item, entry.group) : undefined} onKeyDown={onSelect ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(entry.item, entry.group); } } : undefined}>
                    <title>{describe(entry)}</title><rect x={x} y={y} width={w} height={h} vectorEffect="non-scaling-stroke" />
                    <TileText rectangle={rectangle} scale={scale} />
                  </g>;
                })}
                {rectangles.groups.length > 1 && rectangles.groups.map(group => <g key={group.id} className={s.groupOverlay} pointerEvents="none"><rect x={group.x} y={group.y} width={group.width} height={group.height} fill="none" vectorEffect="non-scaling-stroke" />{group.width * scale >= 120 && group.height * scale >= 60 && <text x={group.x + 6 / scale} y={group.y + 15 / scale} fontSize={11 / scale}>{group.label.slice(0, Math.floor(group.width * scale / 12))}</text>}</g>)}
              </>}
            </MatrixViewport>}
    </div>
    <div className={s.inspector} role="region" aria-label="区块数值预览" aria-live="polite">{inspected ? <><strong>{inspected.group.label} › {inspected.item.label}</strong><span>{inspected.item.displayValue}</span>{inspected.item.detail && <span>{inspected.item.detail}</span>}{area.compatible && <span>{shareText(area.share(inspected))}</span>}</> : <p>{area.entries.length ? `指向区块或按 Tab 查看完整数值。${onSelect ? '点击区块下钻。' : ''}` : '数据缺失时保留矩阵画布，不画虚构热力块。'}</p>}</div>
    {area.compatible && showDetails && <details className={s.amountDetails}><summary>数值明细 · 全部 {area.entries.length} 项（含 {area.entries.filter(entry => amountStatus(entry) === 'zero').length} 个零值、{area.entries.filter(entry => amountStatus(entry) === 'missing').length} 个缺失）</summary><div>{area.entries.map(entry => renderCard(entry, true))}</div></details>}
  </section>;
}

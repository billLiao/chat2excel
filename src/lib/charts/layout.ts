/**
 * Pure 12-column dashboard layout helpers shared by the renderer and the
 * main-process chart store. No DOM access so both sides can import it.
 */

export const GRID_COLUMNS = 12;
export const MIN_ITEM_WIDTH = 3;
export const MIN_ITEM_HEIGHT = 2;
export const DEFAULT_ITEM_WIDTH = 6;
export const DEFAULT_ITEM_HEIGHT = 4;

export interface LayoutRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.floor(value)));
}

export function normalizeRect(rect: LayoutRect): LayoutRect {
    const w = clamp(rect.w, MIN_ITEM_WIDTH, GRID_COLUMNS);
    return {
        x: clamp(rect.x, 0, GRID_COLUMNS - w),
        y: Math.max(0, Math.floor(Number.isFinite(rect.y) ? rect.y : 0)),
        w,
        h: clamp(rect.h, MIN_ITEM_HEIGHT, 40),
    };
}

export function overlaps(a: LayoutRect, b: LayoutRect): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function findFreeSlot(
    items: LayoutRect[],
    w = DEFAULT_ITEM_WIDTH,
    h = DEFAULT_ITEM_HEIGHT
): LayoutRect {
    const width = clamp(w, MIN_ITEM_WIDTH, GRID_COLUMNS);
    const height = clamp(h, MIN_ITEM_HEIGHT, 40);
    for (let y = 0; y < 500; y++) {
        for (let x = 0; x <= GRID_COLUMNS - width; x++) {
            const candidate = { x, y, w: width, h: height };
            if (!items.some((item) => overlaps(candidate, item))) {
                return candidate;
            }
        }
    }
    return { x: 0, y: 0, w: width, h: height };
}

/**
 * Push overlapping cards down while preserving reading order. Called after a
 * drag/resize so the final layout never draws two charts on top of each other.
 */
export function compactLayout<T extends LayoutRect>(items: T[]): T[] {
    const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    const placed: T[] = [];
    for (const item of ordered) {
        // Preserve item identity fields (id, chartId, titleOverride) while
        // normalizing only the geometry.
        const normalized = { ...item, ...normalizeRect(item) };
        let y = normalized.y;
        let candidate = { ...normalized, y };
        let guard = 0;
        while (
            placed.some((other) => overlaps(candidate, other)) &&
            guard < 500
        ) {
            y += 1;
            candidate = { ...normalized, y };
            guard += 1;
        }
        placed.push(candidate as T);
    }
    return placed;
}

export function gridRowCount(items: LayoutRect[]): number {
    return items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

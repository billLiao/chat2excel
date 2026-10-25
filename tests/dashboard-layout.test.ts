import { describe, expect, it } from 'vitest';
import {
    GRID_COLUMNS,
    compactLayout,
    findFreeSlot,
    gridRowCount,
    normalizeRect,
    overlaps,
} from '../src/lib/charts/layout';

describe('dashboard grid layout', () => {
    it('clamps rectangles inside the 12 column grid', () => {
        expect(normalizeRect({ x: 11, y: 2, w: 6, h: 4 })).toEqual({
            x: 6,
            y: 2,
            w: 6,
            h: 4,
        });
        expect(normalizeRect({ x: -5, y: -3, w: 1, h: 1 })).toEqual({
            x: 0,
            y: 0,
            w: 3,
            h: 2,
        });
        expect(normalizeRect({ x: 0, y: 0, w: 99, h: 99 })).toMatchObject({
            w: GRID_COLUMNS,
            h: 40,
        });
    });

    it('finds the first free slot for a new card', () => {
        const slot = findFreeSlot([
            { x: 0, y: 0, w: 6, h: 4 },
            { x: 6, y: 0, w: 6, h: 4 },
        ]);
        expect(slot).toEqual({ x: 0, y: 4, w: 6, h: 4 });

        const narrow = findFreeSlot([{ x: 0, y: 0, w: 9, h: 4 }], 3, 2);
        expect(narrow).toEqual({ x: 9, y: 0, w: 3, h: 2 });
    });

    it('pushes overlaps down and leaves reading order intact', () => {
        const compacted = compactLayout([
            { id: 'a', x: 0, y: 0, w: 6, h: 4 },
            { id: 'b', x: 3, y: 0, w: 6, h: 4 },
            { id: 'c', x: 6, y: 2, w: 6, h: 3 },
        ]);
        const [a, b, c] = compacted;
        expect(a).toMatchObject({ id: 'a', x: 0, y: 0 });
        expect(overlaps(a, b)).toBe(false);
        expect(overlaps(b, c)).toBe(false);
        expect(gridRowCount(compacted)).toBeGreaterThanOrEqual(8);
    });
});

import {TerrainField} from './terrain';
import type {Point} from './track';

/**
 * Creates authored, fictional elevation for the built-in fantasy circuits.
 * These profiles are design terrain, not surveyed or measured track data.
 */
export function fantasyTerrain(id: string, points: Point[]): TerrainField {
  const field = TerrainField.around(points);
  const preset = id === 'club'
    ? { relief: 4, seed: 0.73 }
    : id === 'flow'
      ? { relief: 8, seed: 1.91 }
      : id === 'technical'
        ? { relief: 6, seed: 2.67 }
        : null;

  if (!preset) return field;

  const { resolution, size, originX, originZ, cellSize, heights } = field;
  const extent = Math.max(size, cellSize * (resolution - 1), 1);
  let min = Infinity;
  let max = -Infinity;
  const raw = new Float32Array(resolution * resolution);

  for (let row = 0; row < resolution; row++) {
    const z = originZ + row * cellSize;
    const nz = (z - (originZ + extent * 0.5)) / extent;
    for (let col = 0; col < resolution; col++) {
      const x = originX + col * cellSize;
      const nx = (x - (originX + extent * 0.5)) / extent;
      const edge = Math.min(1, Math.max(0, Math.min(0.5 - Math.abs(nx), 0.5 - Math.abs(nz)) * 8));
      const ridge = Math.sin((nx * 2.15 + nz * 0.72 + preset.seed) * Math.PI);
      const broadSlope = Math.sin((nz * 1.25 - nx * 0.44 + preset.seed * 0.37) * Math.PI * 2) * 0.48;
      const rolling = Math.cos((nx * 0.86 + nz * 1.14 - preset.seed * 0.21) * Math.PI * 2) * 0.3;
      const value = (ridge * 0.58 + broadSlope + rolling) * edge;
      const index = row * resolution + col;
      raw[index] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  const span = Math.max(max - min, 1e-6);
  const scale = preset.relief / span;
  const offset = (max + min) * 0.5;
  for (let i = 0; i < heights.length; i++) {
    const x=i%resolution,z=Math.floor(i/resolution),edge=Math.min(1,Math.min(x,z,resolution-1-x,resolution-1-z)/12);
    heights[i] = (raw[i] - offset) * scale * edge*edge*(3-2*edge);
  }

  return field;
}

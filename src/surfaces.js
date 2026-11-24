import * as T from 'three';

export function random(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Interpolate a periodic noise grid so the map can repeat without a seam.
function noiseGrid(rng, cells) {
  const samples = Array.from({length: cells * cells}, () => rng() - .5);
  const sample = (x, y) => samples[(y % cells) * cells + x % cells];
  return (u, v) => {
    const x = u * cells, y = v * cells;
    const ix = Math.floor(x), iy = Math.floor(y);
    const a = x - ix, b = y - iy;
    const sx = a * a * (3 - 2 * a), sy = b * b * (3 - 2 * b);
    return T.MathUtils.lerp(
      T.MathUtils.lerp(sample(ix, iy), sample(ix + 1, iy), sx),
      T.MathUtils.lerp(sample(ix, iy + 1), sample(ix + 1, iy + 1), sx),
      sy
    );
  };
}

export function surfacePixels(base, seed, contrast, size = 256) {
  const rng = random(seed);
  const stain = noiseGrid(rng, 7);
  const aggregate = noiseGrid(rng, 79);
  const color = new Uint8ClampedArray(size * size * 4);
  const height = new Uint8ClampedArray(color.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const pebble = aggregate(u, v), grain = rng() - .5;
    const shade = contrast * (stain(u, v) * .48 + pebble * .62 + grain * .52);
    const level = 128 + pebble * 118 + grain * 62;
    const i = (y * size + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      color[i + channel] = base[channel] + shade;
      height[i + channel] = level;
    }
    color[i + 3] = height[i + 3] = 255;
  }
  return {color, height};
}

export function surfaceMaps(base, seed, contrast, anisotropy) {
  const size = 256;
  const {color, height} = surfacePixels(base, seed, contrast, size);
  function texture(data, colorSpace) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    canvas.getContext('2d').putImageData(new ImageData(data, size, size), 0, 0);
    const map = new T.CanvasTexture(canvas);
    map.colorSpace = colorSpace;
    map.wrapS = map.wrapT = T.RepeatWrapping;
    map.anisotropy = anisotropy;
    return map;
  }
  return {
    map: texture(color, T.SRGBColorSpace),
    bumpMap: texture(height, T.NoColorSpace),
  };
}

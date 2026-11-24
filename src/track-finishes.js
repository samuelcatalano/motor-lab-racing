import * as T from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export async function loadTrackFinishes() {
  const directory = import.meta.env.BASE_URL + 'assets/vale-do-cedro/';
  const loader = new T.TextureLoader();
  const asphalt = Promise.all(['color', 'normal', 'rough'].map(channel =>
    loader.loadAsync(directory + 'asphalt-' + channel + '.webp')
  )).then(([map, normalMap, roughnessMap]) => {
    map.colorSpace = T.SRGBColorSpace;
    return { map, normalMap, roughnessMap };
  }).catch(error => {
    console.warn('Texturas do asfalto indisponíveis', error);
    return null;
  });
  const hdrLoader = new HDRLoader();
  const environment = name => hdrLoader.loadAsync(directory + name).then(texture => {
    texture.mapping = T.EquirectangularReflectionMapping;
    return texture;
  });
  const panorama = Promise.allSettled([
    loader.loadAsync(directory + 'valley-panorama.webp'),
    environment('valley-light.hdr'),
  ]).then(async ([photo, light]) => {
    if (photo.status === 'fulfilled') {
      photo.value.colorSpace = T.SRGBColorSpace;
      photo.value.mapping = T.EquirectangularReflectionMapping;
    }
    const lighting = light.status === 'fulfilled' ? light.value : await environment('kloofendal.hdr');
    return {photo:photo.status === 'fulfilled' ? photo.value : null,
      lighting, sameExposure:light.status === 'fulfilled'};
  }).catch(error => {
    console.warn('Panorama indisponível', error);
    return null;
  });
  const asphaltDetail = Promise.all(['wear', 'aggregate'].map(name =>
    loader.loadAsync(directory + 'asphalt-' + name + '.webp')
  )).then(([wear, aggregate]) => {
    wear.colorSpace = aggregate.colorSpace = T.SRGBColorSpace;
    return {wear, aggregate};
  }).catch(error => {
    console.warn('Detalhes do asfalto indisponíveis', error);
    return null;
  });
  const woodland = Promise.all(['leaves','bark'].map(name =>
    loader.loadAsync(directory + 'tree-' + name + '.webp')
  )).then(([leaves, bark]) => {
    leaves.colorSpace = bark.colorSpace = T.SRGBColorSpace;
    return {leaves, bark};
  }).catch(error => {
    console.warn('Texturas das árvores indisponíveis', error);
    return null;
  });
  const meadow = Promise.all(['color', 'normal'].map(name =>
    loader.loadAsync(directory + 'grass-' + name + '.webp')
  )).then(([map, normalMap]) => {
    map.colorSpace = T.SRGBColorSpace;
    return {map, normalMap};
  }).catch(error => {
    console.warn('Texturas do gramado indisponíveis', error);
    return null;
  });
  const [road, sky, forest, grass, roadDetail] = await Promise.all([asphalt, panorama, woodland, meadow, asphaltDetail]);
  return {road, sky, forest, grass, roadDetail};
}

// The grid belongs to the paddock straight and wraps through the start of the spline.
export function gridMarkings(length) {
  return Array.from({ length: 7 }, (_, index) => {
    const center = (index % 2 ? -.22 : .22);
    const front = (-3.5 - index * 3.5) / length;
    return { offsetFraction: center, front, back: front - 1.45 / length };
  });
}

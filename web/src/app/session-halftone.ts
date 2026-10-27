type Contour = 'stepped' | 'flat';
const screenState: { pitch: number; contour: Contour; inverted: boolean } = {
  pitch: 7,
  contour: 'stepped',
  inverted: false,
};
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
// A single continuous ink screen, not two opposing dot overlays. Its cosine
// field changes topology naturally: black dots in red become red dots in
// black. This avoids a visible polarity seam halfway through the fade.
// Only a pixel-wide threshold blend is used for antialiasing, never a wash
// of translucent dots. All rendering is static and runs only on resize/input.
export function paintScreen(canvas: HTMLCanvasElement): void {
  const box = canvas.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(box.width * dpr),
    height = Math.round(box.height * dpr);
  const drawKey = [
    width,
    height,
    heroKey(canvas),
    screenState.pitch,
    screenState.contour,
    screenState.inverted,
  ].join(':');
  if (canvas.dataset.drawKey === drawKey) return;
  canvas.dataset.drawKey = drawKey;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false })!;
  const pixels = context.createImageData(width, height);
  const hero = canvas.dataset.screen === 'hero';
  const pitch = (hero ? 7 : screenState.pitch) * dpr;
  const red: number[] = [225, 6, 0],
    black: number[] = [3, 3, 3];
  const inverted = !hero && screenState.inverted;
  const cosX = Float32Array.from({ length: width }, (_, x) => Math.cos(((x + 0.5) * Math.PI * 2) / pitch));
  const cosY = Float32Array.from({ length: height }, (_, y) => Math.cos(((y + 0.5) * Math.PI * 2) / pitch));
  const antialias = 0.95 / dpr / (pitch / dpr);
  const steps = hero
    ? [0.2, 0.12, 0.04, 0.12, 0.2]
    : [0.13, 0.06, 0, 0.06, 0.13, 0.2, 0.13, 0.06, 0, 0.06, 0.13];
  for (let y = 0; y < height; y++) {
    const yn = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const xn = (x + 0.5) / width;
      const step =
        hero || screenState.contour === 'stepped'
          ? steps[Math.min(steps.length - 1, Math.floor(xn * steps.length))]
          : 0.08;
      // The narrow hero carries a vertical stepped dissolve. The wide study
      // uses a diagonal dissolve so its typography has a quiet black field.
      const progression = hero
        ? (yn - (0.05 + step)) / 0.66
        : (xn * 0.68 + (1 - yn) * 0.32 - (0.22 + step * 0.5)) / 0.53;
      const threshold = clamp(progression, 0, 1) * 2.22 - 1.11;
      const field = (cosX[x] + cosY[y]) * 0.5;
      let coverage = clamp(((field - threshold) / antialias) * 0.5 + 0.5, 0, 1);
      coverage = coverage * coverage * (3 - 2 * coverage);
      if (!hero) coverage = 1 - coverage;
      if (inverted) coverage = 1 - coverage;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.round(black[c] + (red[c] - black[c]) * coverage);
      pixels.data[i + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
}
function heroKey(canvas: HTMLCanvasElement): string {
  return canvas.dataset.screen === 'hero' ? 'hero' : 'study';
}

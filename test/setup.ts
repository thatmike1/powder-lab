// the Simulation constructor builds offscreen canvases + ImageData buffers for
// its renderer. the unit tests only drive the engine (paint/step) and read the
// raw fields, never render(), so we provide the thinnest possible DOM stubs
// instead of pulling in a full jsdom + native `canvas` dependency.

class FakeCtx {
  clearRect(): void {}
  drawImage(): void {}
  putImageData(): void {}
  fillRect(): void {}
  save(): void {}
  restore(): void {}
  set filter(_: string) {}
  set globalAlpha(_: number) {}
  set globalCompositeOperation(_: string) {}
  set imageSmoothingEnabled(_: boolean) {}
  set fillStyle(_: string) {}
}

// biome-ignore lint/suspicious/noExplicitAny: minimal test-only global shims
const g = globalThis as any

g.document = {
  createElement() {
    return { width: 0, height: 0, getContext: () => new FakeCtx() }
  },
}

g.ImageData = class {
  width: number
  height: number
  data: Uint8ClampedArray
  constructor(w: number, h: number) {
    this.width = w
    this.height = h
    this.data = new Uint8ClampedArray(w * h * 4)
  }
}

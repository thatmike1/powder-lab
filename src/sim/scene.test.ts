import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  base64UrlToBytes,
  bytesToBase64Url,
  decodeRLE,
  encodeRLE,
  readSceneFromHash,
  SceneFormatError,
  sceneToHash,
} from './scene'

// The published v1 scene header: PL, version, little-endian width/height.
const header = (width: number, height: number) => [
  0x50,
  0x4c,
  1,
  width & 255,
  width >> 8,
  height & 255,
  height >> 8,
]

afterEach(() => vi.unstubAllGlobals())

describe('saved scene parser and share links', () => {
  it('round-trips long runs and dimensions beyond a single header byte', () => {
    const cells = new Uint8Array(257 * 3)
    cells.fill(4, 0, 300)
    cells.fill(5, 300)
    const decoded = decodeRLE(encodeRLE(cells, 257, 3))
    expect(decoded.W).toBe(257)
    expect(decoded.H).toBe(3)
    expect(decoded.cells).toEqual(cells)
  })

  it('rejects short headers and either incorrect magic byte as scene format errors', () => {
    for (const bytes of [
      new Uint8Array(6),
      Uint8Array.from([0, 0x4c, 1, 0, 0, 0, 0]),
      Uint8Array.from([0x50, 0, 1, 0, 0, 0, 0]),
    ]) {
      expect(() => decodeRLE(bytes)).toThrow(SceneFormatError)
      expect(() => decodeRLE(bytes)).toThrow('bad magic')
    }
  })

  it('rejects a future scene format instead of interpreting it as the current one', () => {
    const bytes = Uint8Array.from(header(0, 0))
    bytes[2] = 2
    expect(() => decodeRLE(bytes)).toThrow('unsupported scene version 2')
  })

  it('rejects a material byte that has no following run length', () => {
    const bytes = Uint8Array.from([...header(1, 1), 3])
    expect(() => decodeRLE(bytes)).toThrow('truncated run length')
  })

  it('rejects an unfinished multi-byte run length', () => {
    const bytes = Uint8Array.from([...header(1, 1), 3, 0x80])
    expect(() => decodeRLE(bytes)).toThrow('truncated run length')
  })

  it('rejects a run that would paint beyond the declared grid', () => {
    const bytes = Uint8Array.from([...header(1, 1), 3, 2])
    expect(() => decodeRLE(bytes)).toThrow('run overflows grid')
  })

  it('rejects scenes whose runs leave cells missing', () => {
    const bytes = Uint8Array.from([...header(2, 1), 3, 1])
    expect(() => decodeRLE(bytes)).toThrow('scene shorter than its declared size')
  })

  it('encodes arbitrary bytes as unpadded URL-safe text and decodes them losslessly', () => {
    const bytes = Uint8Array.from([251, 255, 255, 0])
    const encoded = bytesToBase64Url(bytes)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(base64UrlToBytes(encoded)).toEqual(bytes)
  })

  it('loads a shared scene from the scene parameter alongside unrelated hash parameters', () => {
    const bytes = encodeRLE(Uint8Array.from([3, 4]), 2, 1)
    const hash = sceneToHash(bytes)
    expect(hash.startsWith('#s=')).toBe(true)
    vi.stubGlobal('location', { hash: `${hash}&panel=tools` })
    expect(readSceneFromHash()).toEqual(bytes)
  })

  it('ignores malformed scene links so opening a junk URL can start empty', () => {
    vi.stubGlobal('location', { hash: '#s=%25%25%25' })
    expect(readSceneFromHash()).toBeNull()
    expect(() => base64UrlToBytes('%%%')).toThrow(SceneFormatError)
  })

  it('finds no shared scene in empty hashes, unrelated fragments or an empty scene parameter', () => {
    for (const hash of ['', '#panel=tools', '#s=']) {
      vi.stubGlobal('location', { hash })
      expect(readSceneFromHash()).toBeNull()
    }
  })
})

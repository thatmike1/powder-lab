// hand-pixeled inline-SVG icons on an 8x8 grid, shape-rendering: crispEdges so
// they stay sharp at any size. they fill with currentColor, so each icon
// re-tints with the accent (the selected material) wherever it is used. no icon
// library, no emoji — every glyph is hand-placed <rect> blocks.

type Rect = [x: number, y: number, w: number, h: number]

function PixelIcon({ rects, size = 16 }: { rects: Rect[]; size?: number }) {
  return (
    <svg
      viewBox="0 0 8 8"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
    >
      {rects.map(([x, y, w, h]) => (
        <rect key={`${x}-${y}-${w}-${h}`} x={x} y={y} width={w} height={h} />
      ))}
    </svg>
  )
}

type IconProps = { size?: number }

export const PlayIcon = ({ size }: IconProps) => (
  <PixelIcon
    size={size}
    rects={[
      [2, 1, 1, 6],
      [3, 2, 1, 4],
      [4, 3, 1, 2],
    ]}
  />
)

export const PauseIcon = ({ size }: IconProps) => (
  <PixelIcon
    size={size}
    rects={[
      [1, 1, 2, 6],
      [5, 1, 2, 6],
    ]}
  />
)

export const StepIcon = ({ size }: IconProps) => (
  <PixelIcon
    size={size}
    rects={[
      [1, 1, 1, 6],
      [2, 2, 1, 4],
      [3, 3, 1, 2],
      [5, 1, 2, 6],
    ]}
  />
)

export const ClearIcon = ({ size }: IconProps) => (
  <PixelIcon
    size={size}
    rects={[
      [1, 2, 6, 1],
      [2, 2, 1, 5],
      [5, 2, 1, 5],
      [2, 6, 4, 1],
      [3, 1, 2, 1],
    ]}
  />
)

export const BrushIcon = ({ size }: IconProps) => (
  <PixelIcon
    size={size}
    rects={[
      [5, 1, 2, 2],
      [3, 3, 2, 2],
      [2, 4, 2, 2],
      [1, 5, 2, 2],
    ]}
  />
)

// upload: an arrow rising out of a tray.
export const ShareIcon = ({ size }: IconProps) => (
  <PixelIcon
    size={size}
    rects={[
      [3, 1, 2, 1],
      [2, 2, 1, 1],
      [5, 2, 1, 1],
      [3, 2, 2, 3],
      [1, 5, 1, 2],
      [6, 5, 1, 2],
      [1, 6, 6, 1],
    ]}
  />
)

// floppy disk.
export const SaveIcon = ({ size }: IconProps) => (
  <PixelIcon
    size={size}
    rects={[
      [1, 1, 5, 1],
      [1, 1, 1, 6],
      [6, 2, 1, 5],
      [1, 6, 6, 1],
      [4, 1, 1, 2],
      [3, 4, 2, 2],
    ]}
  />
)

// open folder.
export const LoadIcon = ({ size }: IconProps) => (
  <PixelIcon
    size={size}
    rects={[
      [1, 2, 3, 1],
      [1, 3, 6, 4],
    ]}
  />
)

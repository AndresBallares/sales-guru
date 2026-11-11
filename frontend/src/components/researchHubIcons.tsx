import type { ReactNode } from 'react'

// Inline glyphs for the research progress card (Lucide-style strokes, no dependency).
// All decorative: the text beside each one says what it means.
function Glyph({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const CheckIcon = () => (
  <Glyph>
    <path d="M20 6 9 17l-5-5" />
  </Glyph>
)

export const BarsIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M3 3v18h18" />
    <path d="M7 16v-5" />
    <path d="M12 16V7" />
    <path d="M17 16v-3" />
  </Glyph>
)

export const DiamondIcon = () => (
  <Glyph>
    <path d="M6 3h12l4 6-10 12L2 9z" />
    <path d="M11 3 8 9l4 12 4-12-3-6" />
    <path d="M2 9h20" />
  </Glyph>
)

export const ClockIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Glyph>
)

export const SearchIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Glyph>
)

export const PagesIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6" />
    <path d="M9 17h4" />
  </Glyph>
)

export const DollarIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M14.5 9.2c-.4-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.7-2.5 1.8s1 1.6 2.5 2c1.5.4 2.5.9 2.5 2s-1.1 1.8-2.5 1.8c-1.2 0-2.2-.5-2.6-1.3" />
    <path d="M12 6.5V8m0 8v1.5" />
  </Glyph>
)

export const ArrowRightIcon = () => (
  <Glyph size={18}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Glyph>
)

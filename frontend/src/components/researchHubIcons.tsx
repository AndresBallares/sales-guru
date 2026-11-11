import type { ReactNode } from 'react'

// Inline glyphs for the research progress card (Lucide-style strokes, no dependency).
// All decorative: the text beside each one says what it means.
export function Glyph({ children, size = 24 }: { children: ReactNode; size?: number }) {
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

// More glyphs for the research results dashboard (same Lucide-style strokes).
type IconProps = { size?: number }

export const FileCheckIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="m9 14 2 2 4-4" />
  </Glyph>
)

export const TriangleAlertIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Glyph>
)

export const LightbulbIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
    <path d="M9 18h6" />
    <path d="M10 22h4" />
  </Glyph>
)

export const TargetIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </Glyph>
)

export const BuildingIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
    <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
    <path d="M10 6h4" />
    <path d="M10 10h4" />
    <path d="M10 14h4" />
    <path d="M10 18h4" />
  </Glyph>
)

export const UsersIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
    <path d="M16 3.1a4 4 0 0 1 0 7.8" />
  </Glyph>
)

export const GlobeIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20" />
  </Glyph>
)

export const BookmarkCheckIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    <path d="m9 10 2 2 4-4" />
  </Glyph>
)

export const CircleCheckIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </Glyph>
)

export const SaveIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M17 21v-8H7v8" />
    <path d="M7 3v5h8" />
  </Glyph>
)

export const ArrowLeftIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M19 12H5" />
    <path d="m11 18-6-6 6-6" />
  </Glyph>
)

export const ChevronDownIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="m6 9 6 6 6-6" />
  </Glyph>
)

export const CloseIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Glyph>
)

export const PlusIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Glyph>
)

export const LinkIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Glyph>
)

import type { ReactNode } from 'react'

// Small stroke icons for the campaign card. Always decorative (aria-hidden):
// whatever they sit next to carries the accessible name.
function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function TrashIcon() {
  return (
    <Icon>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </Icon>
  )
}

export function ArchiveIcon() {
  return (
    <Icon>
      <path d="M3 5h18v4H3zM5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
    </Icon>
  )
}

export function ImageIcon() {
  return (
    <Icon>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 18 5-5 4 4 3-3 4 4" />
    </Icon>
  )
}

export function VideoIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m10 9.5 5 2.5-5 2.5z" />
    </Icon>
  )
}

export function StoryIcon() {
  return (
    <Icon>
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v4h4M9 12h6M9 16h6" />
    </Icon>
  )
}

export function SquareIcon() {
  return (
    <Icon>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Icon>
  )
}

export function ChevronRightIcon() {
  return (
    <span className="action-row-chevron">
      <Icon size={18}>
        <path d="m9 6 6 6-6 6" />
      </Icon>
    </span>
  )
}

// The status chip's leading glyph: pause bars, a filled dot for live, an
// outline ring for everything else.
export function StatusIcon({ status }: { status: string }) {
  if (status === 'PAUSED') {
    return (
      <Icon size={14}>
        <circle cx="12" cy="12" r="9" />
        <path d="M10 9v6M14 9v6" />
      </Icon>
    )
  }
  if (status === 'LIVE') {
    return (
      <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="6" fill="currentColor" />
      </svg>
    )
  }
  return (
    <Icon size={14}>
      <circle cx="12" cy="12" r="8" />
    </Icon>
  )
}

export function PackageIcon() {
  return (
    <Icon>
      <path d="m12 3 8 4v10l-8 4-8-4V7zM4 7l8 4 8-4M12 11v10" />
    </Icon>
  )
}

export function RefreshIcon() {
  return (
    <Icon>
      <path d="M20 11a8 8 0 0 0-14.5-4.2M4 4v4h4M4 13a8 8 0 0 0 14.5 4.2M20 20v-4h-4" />
    </Icon>
  )
}

export function StrategyIcon() {
  return (
    <Icon>
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
    </Icon>
  )
}

export function VoiceIcon() {
  return (
    <Icon>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </Icon>
  )
}

export function SpinnerIcon() {
  return (
    <span className="icon-spin">
      <Icon>
        <path d="M12 3a9 9 0 1 0 9 9" />
      </Icon>
    </span>
  )
}

export function GripIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  )
}

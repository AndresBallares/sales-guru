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

export function TrashIcon({ size }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </Icon>
  )
}

export function ArchiveIcon({ size }: { size?: number } = {}) {
  return (
    <Icon size={size}>
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

export function RefreshIcon({ size }: { size?: number } = {}) {
  return (
    <Icon size={size}>
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

export function PlusIcon() {
  return (
    <Icon size={18}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function PencilIcon() {
  return (
    <Icon size={18}>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16zM13.5 6.5l4 4" />
    </Icon>
  )
}

export function SaveIcon() {
  return (
    <Icon size={18}>
      <path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM8 4v5h7V4M8 20v-6h8v6" />
    </Icon>
  )
}

export function PauseIcon() {
  return (
    <Icon size={18}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </Icon>
  )
}

export function PlayIcon() {
  return (
    <Icon size={18}>
      <path d="M7 5v14l12-7z" />
    </Icon>
  )
}

export function UploadIcon() {
  return (
    <Icon size={18}>
      <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
    </Icon>
  )
}

export function UndoIcon() {
  return (
    <Icon size={18}>
      <path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12" />
    </Icon>
  )
}

export function CheckIcon() {
  return (
    <Icon size={18}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  )
}

export function CloseIcon({ size = 18 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  )
}

export function ArrowRightIcon() {
  return (
    <Icon size={18}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  )
}

export function GripVerticalIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="9" cy="6" r="1.7" />
      <circle cx="15" cy="6" r="1.7" />
      <circle cx="9" cy="12" r="1.7" />
      <circle cx="15" cy="12" r="1.7" />
      <circle cx="9" cy="18" r="1.7" />
      <circle cx="15" cy="18" r="1.7" />
    </svg>
  )
}

export function MoreIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}

export function StarIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
    </svg>
  )
}

export function ArrowUpIcon() {
  return (
    <Icon size={18}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Icon>
  )
}

export function ArrowDownIcon() {
  return (
    <Icon size={18}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Icon>
  )
}

export function InfoIcon() {
  return (
    <Icon size={20}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </Icon>
  )
}

export function ChevronDownIcon() {
  return (
    <Icon size={18}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  )
}

export function UsersIcon() {
  return (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  )
}

export function TargetIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </Icon>
  )
}

export function ExclamationIcon() {
  return (
    <Icon>
      <path d="M12 6.5v7M12 17.5h.01" />
    </Icon>
  )
}

export function ChevronLeftIcon() {
  return (
    <Icon size={24}>
      <path d="m15 5-7 7 7 7" />
    </Icon>
  )
}

export function FlaskIcon() {
  return (
    <Icon>
      <path d="M10 2v7.5a2 2 0 0 1-.2.9L4.7 20.5a1 1 0 0 0 .9 1.5h12.8a1 1 0 0 0 .9-1.5l-5.1-10.1a2 2 0 0 1-.2-.9V2M8.5 2h7M7 16h10" />
    </Icon>
  )
}

export function LightbulbIcon() {
  return (
    <Icon>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4" />
    </Icon>
  )
}

export function TextIcon() {
  return (
    <Icon>
      <path d="M4 7V4h16v3M9 20h6M12 4v16" />
    </Icon>
  )
}

export function FacebookIcon() {
  return (
    <Icon>
      <path d="M14 8h2.5V4.5H14C11.8 4.5 10.5 5.9 10.5 8v2H8v3.5h2.5V20H14v-6.5h2.4l.6-3.5H14V8.6c0-.4.2-.6.6-.6" />
    </Icon>
  )
}

export function InstagramIcon() {
  return (
    <Icon>
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M16.9 7.1h.01" />
    </Icon>
  )
}

export function ChevronLeftSmallIcon() {
  return (
    <Icon size={18}>
      <path d="m15 5-7 7 7 7" />
    </Icon>
  )
}

export function ChevronRightSmallIcon() {
  return (
    <Icon size={18}>
      <path d="m9 5 7 7-7 7" />
    </Icon>
  )
}

export function CopyIcon() {
  return (
    <Icon size={18}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </Icon>
  )
}

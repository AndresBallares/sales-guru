import type { ReactNode } from 'react'
import { UploadIcon } from './icons'

// The campaign card's publishing footer: what approving does on the left, the
// primary Approve & Publish button on the right. Stacks on narrow screens.
export function PublishFooter({
  ariaLabel,
  heading,
  description,
  pausedId,
  paused,
  onPausedChange,
  buttonLabel,
  buttonDisabled,
  onPublish,
  error,
  children,
}: {
  ariaLabel: string
  heading: string
  description: string
  pausedId: string
  paused: boolean
  onPausedChange: (paused: boolean) => void
  buttonLabel: string
  buttonDisabled: boolean
  onPublish: () => void
  error?: string
  children?: ReactNode
}) {
  return (
    <div className="publish-footer" aria-label={ariaLabel}>
      <div className="publish-footer-text">
        <h4 className="publish-footer-heading">{heading}</h4>
        <p className="publish-footer-description">{description}</p>
        <label htmlFor={pausedId} className="publish-footer-paused">
          <input
            id={pausedId}
            type="checkbox"
            checked={paused}
            onChange={(event) => onPausedChange(event.target.checked)}
          />
          Publish paused
        </label>
        {children}
      </div>
      <button
        type="button"
        className="publish-footer-button btn-outline btn-gold"
        onClick={onPublish}
        disabled={buttonDisabled}
      >
        <UploadIcon />
        {buttonLabel}
      </button>
      {error && (
        <p className="form-error publish-footer-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

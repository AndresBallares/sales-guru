import type { ReactNode } from 'react'
import { CheckIcon, InfoIcon } from './icons'

export interface SetupStep {
  key: string
  label: string
  done: boolean
  // Supporting text: what was chosen once done, what is missing otherwise.
  doneText: string
  missingText: string
  actionLabel: string
  onAction: () => void
  // Hides the inline action while its form is already open below the step.
  actionHidden?: boolean
  // The step's own form/picker, shown under its row.
  children?: ReactNode
}

function setupProgress(steps: readonly { done: boolean }[]) {
  const done = steps.filter((step) => step.done).length
  const total = steps.length
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}

export function CampaignSetup({
  ariaLabel,
  steps,
}: {
  ariaLabel: string
  steps: readonly SetupStep[]
}) {
  const { done, total, percent } = setupProgress(steps)
  return (
    <section className="setup" aria-label={ariaLabel}>
      <div className="setup-summary">
        <p>
          {done} of {total} setup steps complete
        </p>
        <span>{percent}%</span>
      </div>
      <progress
        className="setup-track"
        value={done}
        max={total}
        aria-label={`${ariaLabel}: ${percent}% complete`}
      />
      <ul className="setup-steps">
        {steps.map((step) => (
          <li key={step.key} className="setup-step" data-done={step.done}>
            <div className="setup-step-row">
              <span className="setup-step-icon" aria-hidden="true">
                {step.done ? <CheckIcon /> : <InfoIcon />}
              </span>
              <div className="setup-step-text">
                <strong>{step.label}</strong>
                <span>{step.done ? step.doneText : step.missingText}</span>
              </div>
              {step.done ? (
                <span className="visually-hidden">Complete</span>
              ) : (
                !step.actionHidden && (
                  <button type="button" className="setup-step-action" onClick={step.onAction}>
                    {step.actionLabel}
                  </button>
                )
              )}
            </div>
            {step.children}
          </li>
        ))}
      </ul>
    </section>
  )
}

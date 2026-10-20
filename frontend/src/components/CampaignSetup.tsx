import type { ReactNode } from 'react'
import { CheckIcon, ExclamationIcon } from './icons'

export interface SetupStep {
  key: string
  // What the step is called, and an icon that says what kind of step it is.
  label: string
  icon: ReactNode
  done: boolean
  // Supporting text: what was chosen once done, what is missing otherwise.
  doneText: string
  missingText: string
  // Opens this step's form; the card's Continue setup button calls it for the first missing step.
  onAction: () => void
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
      <h4 className="setup-heading">Campaign setup</h4>
      <div className="setup-summary">
        <p>
          {done} of {total} setup steps complete
        </p>
        <progress
          className="setup-track"
          value={done}
          max={total}
          aria-label={`Setup progress: ${percent}% complete`}
        />
        <span className="setup-percent">{percent}%</span>
      </div>
      <ul className="setup-steps">
        {steps.map((step) => (
          <li key={step.key} className="setup-step" data-done={step.done}>
            <div className="setup-step-row">
              <span className="setup-step-status" aria-hidden="true">
                {step.done ? <CheckIcon /> : <ExclamationIcon />}
              </span>
              <span className="setup-step-kind" aria-hidden="true">
                {step.icon}
              </span>
              <div className="setup-step-text">
                <strong>{step.label}</strong>
                <span>{step.done ? step.doneText : step.missingText}</span>
              </div>
              {step.done && (
                <span className="setup-step-done">
                  <CheckIcon />
                  <span className="visually-hidden">Complete</span>
                </span>
              )}
            </div>
            {step.children}
          </li>
        ))}
      </ul>
    </section>
  )
}

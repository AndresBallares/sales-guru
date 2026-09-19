import { Link } from 'react-router-dom'

interface TermsAcceptanceCheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
}

// Shared between SignupPage and TermsAcceptancePrompt (the one-time
// full-page re-acceptance gate for existing accounts) so the label text
// and links can't drift between the two places a user is asked this.
export function TermsAcceptanceCheckbox({ checked, onChange }: TermsAcceptanceCheckboxProps) {
  return (
    <div className="field">
      <label className="checkbox-option">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          I have read and agree to the{' '}
          <Link to="/terms" target="_blank" rel="noopener noreferrer">
            Terms of Service
          </Link>
          ,{' '}
          <Link to="/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </Link>
          , and{' '}
          <Link to="/data-deletion" target="_blank" rel="noopener noreferrer">
            Data Deletion Policy
          </Link>
          .
        </span>
      </label>
    </div>
  )
}

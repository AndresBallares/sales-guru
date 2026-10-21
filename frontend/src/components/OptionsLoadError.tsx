// Shown under a dropdown whose list failed to load, instead of leaving it silently empty.
export function OptionsLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p className="form-error" role="alert">
      {message}{' '}
      <button type="button" className="link-button" onClick={onRetry}>
        Try again
      </button>
    </p>
  )
}

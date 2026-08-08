import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { ApiError, createBusiness, listBusinesses, type Business } from '../lib/api'

export function DashboardPage() {
  const { user, logout } = useAuth()

  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loadingBusinesses, setLoadingBusinesses] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [industry, setIndustry] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function refreshBusinesses() {
    setLoadingBusinesses(true)
    try {
      setBusinesses(await listBusinesses())
      setListError(null)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not load businesses.')
    } finally {
      setLoadingBusinesses(false)
    }
  }

  useEffect(() => {
    void refreshBusinesses()
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      await createBusiness({
        name,
        website: website || undefined,
        industry: industry || undefined,
        location: location || undefined,
        description: description || undefined,
      })
      setName('')
      setWebsite('')
      setIndustry('')
      setLocation('')
      setDescription('')
      await refreshBusinesses()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create business.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <h1>Sales Guru</h1>
        <p>Signed in as {user?.email}</p>
        <button type="button" onClick={() => void logout()}>
          Log out
        </button>
      </header>

      <section>
        <h2>Your businesses</h2>
        {loadingBusinesses && <p>Loading…</p>}
        {listError && (
          <p className="form-error" role="alert">
            {listError}
          </p>
        )}
        {!loadingBusinesses && !listError && businesses.length === 0 && (
          <p>No businesses yet — create your first one below.</p>
        )}
        <ul>
          {businesses.map((business) => (
            <li key={business.id}>
              <strong>{business.name}</strong>
              {business.industry && <span> — {business.industry}</span>}
              {business.location && <span> · {business.location}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Create a business</h2>
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="name">Nombre</label>
            <input
              id="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              type="url"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="industry">Industria</label>
            <input
              id="industry"
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="location">Ubicación</label>
            <input
              id="location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="description">Descripción</label>
            <textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create business'}
          </button>
        </form>
      </section>
    </main>
  )
}

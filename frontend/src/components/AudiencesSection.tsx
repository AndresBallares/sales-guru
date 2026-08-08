import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, createAudience, listAudiences, type Audience } from '../lib/api'

export function AudiencesSection({ businessId }: { businessId: string }) {
  const [audiences, setAudiences] = useState<Audience[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [description, setDescription] = useState('')
  const [ageMin, setAgeMin] = useState('')
  const [ageMax, setAgeMax] = useState('')
  const [location, setLocation] = useState('')
  const [interests, setInterests] = useState('')
  const [problem, setProblem] = useState('')
  const [desire, setDesire] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setAudiences(await listAudiences(businessId))
      setListError(null)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not load audiences.')
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      await createAudience(businessId, {
        description,
        ageMin: ageMin ? Number(ageMin) : undefined,
        ageMax: ageMax ? Number(ageMax) : undefined,
        location: location || undefined,
        interests: interests || undefined,
        problem: problem || undefined,
        desire: desire || undefined,
      })
      setDescription('')
      setAgeMin('')
      setAgeMax('')
      setLocation('')
      setInterests('')
      setProblem('')
      setDesire('')
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create audience.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <section>
        <h2>Audiences</h2>
        {loading && <p>Loading…</p>}
        {listError && (
          <p className="form-error" role="alert">
            {listError}
          </p>
        )}
        {!loading && !listError && audiences.length === 0 && (
          <p>No audiences yet — add your first one below.</p>
        )}
        <ul>
          {audiences.map((audience) => (
            <li key={audience.id}>{audience.description}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Add an audience</h2>
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="audience-description">Who buys?</label>
            <textarea
              id="audience-description"
              required
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="age-min">Age min</label>
            <input
              id="age-min"
              type="number"
              value={ageMin}
              onChange={(event) => setAgeMin(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="age-max">Age max</label>
            <input
              id="age-max"
              type="number"
              value={ageMax}
              onChange={(event) => setAgeMax(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="location">Location</label>
            <input
              id="location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="interests">Interests</label>
            <input
              id="interests"
              value={interests}
              onChange={(event) => setInterests(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="problem">Problem</label>
            <textarea
              id="problem"
              value={problem}
              onChange={(event) => setProblem(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="desire">Desire</label>
            <textarea
              id="desire"
              value={desire}
              onChange={(event) => setDesire(event.target.value)}
            />
          </div>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add audience'}
          </button>
        </form>
      </section>
    </>
  )
}

import { useState } from 'react'
import { filterByQuery } from '../lib/researchDashboard'
import { Empty, SearchField, SectionHead } from './ResearchDashParts'
import { BuildingIcon, CloseIcon, PlusIcon } from './researchHubIcons'

// The brands and product names the research found, as chips. Removing or adding one only
// changes the flags on this screen (the parent keeps the list), as before.
export function ResearchDashCompetitors({
  terms,
  ignored,
  onRemove,
  onAdd,
}: {
  terms: string[]
  ignored: string[]
  onRemove: (term: string) => void
  onAdd: (term: string) => void
}) {
  const [newTerm, setNewTerm] = useState('')
  const [query, setQuery] = useState('')
  const shown = filterByQuery(terms, query, (t) => t)

  function add() {
    onAdd(newTerm)
    setNewTerm('')
  }

  return (
    <section
      id="research-competitors"
      className="dash-section research-terms"
      aria-labelledby="research-terms-heading"
    >
      <SectionHead
        id="research-terms-heading"
        icon={<BuildingIcon size={24} />}
        title="Competitor Intelligence"
        description="Brands and competitors identified during market research."
      />
      <p className="field-hint">
        Competitor terms help refine the market research. Remove irrelevant names or add missing
        competitors. Hooks, angles and concepts that contain one of these are flagged below. This
        only changes the flags on this screen.
      </p>
      {terms.length > 8 && (
        <SearchField
          id="terms-search"
          label="Search competitors"
          value={query}
          onChange={setQuery}
          shown={shown.length}
          total={terms.length}
        />
      )}
      {terms.length === 0 ? (
        <Empty>No competitor terms yet. Add one below.</Empty>
      ) : shown.length === 0 ? (
        <Empty>No competitor matches that search.</Empty>
      ) : (
        <ul aria-label="Competitor terms" className="dash-chips">
          {shown.map((term) => (
            <li key={term} className="dash-chip">
              <span>{term}</span>
              <button
                type="button"
                aria-label={`Remove term ${term}`}
                onClick={() => onRemove(term)}
              >
                <CloseIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {ignored.length > 0 && (
        <p className="field-hint">
          Ignored as common words: {ignored.join(', ')}. If one is really a competitor's name, add
          it below to filter on it anyway.
        </p>
      )}
      <div className="dash-add">
        <label htmlFor="research-new-term" className="visually-hidden">
          Add a competitor term
        </label>
        <input
          id="research-new-term"
          value={newTerm}
          placeholder="Add competitor"
          onChange={(event) => setNewTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="dash-btn dash-btn-ghost" aria-label="Add term" onClick={add}>
          <PlusIcon size={16} />
          Add
        </button>
      </div>
    </section>
  )
}

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import {
  ApiError,
  bulkCreateAvatars,
  deleteAvatar,
  listAvatars,
  reorderAvatars,
  updateAvatar,
  type BuyerAvatar,
  type BuyerAvatarDraft,
} from '../lib/api'
import { MAX_BUYER_AVATARS } from '../lib/avatarFields'
import { moveItem } from '../lib/avatarOrder'
import { avatarToForm, emptyAvatarForm } from '../lib/avatarFormValues'
import { AvatarForm } from './AvatarForm'
import { AvatarImportSection } from './AvatarImportSection'
import { BuyerAvatarCard } from './BuyerAvatarCard'
import { PlusIcon, ReorderIcon } from './icons'

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback
}

// The business's buyer avatar library: every avatar that has not been deleted, active or
// inactive, as cards in the order the Strategist sees them (the order is a priority). Drag a
// card by its handle, or use its menu or the arrow keys, to change the order; edit any
// field, switch an avatar off and on, or delete it (a soft delete: ads and results that
// used it keep its name, marked archived). New avatars are created here or imported from a
// document. The order, the edit, the activation and the delete all go through the same
// calls as before the cards: only how they are shown and reached changed.
export function AvatarsSection({
  businessId,
  focusAvatarId,
}: {
  businessId: string
  // An avatar to scroll to and focus once the list is shown (a link from a research run).
  focusAvatarId?: string | null
}) {
  const [avatars, setAvatars] = useState<BuyerAvatar[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  // After a move, focus goes to the moved avatar's handle, wherever it ended up.
  const [focusHandleId, setFocusHandleId] = useState<string | null>(null)
  // Drag state: the card being dragged, the card it is over, and the card whose handle was
  // pressed (only that one is draggable).
  const [armedId, setArmedId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  // True while an order is being saved; a second drag or key press waits for it, so a rapid
  // series can never send two overlapping requests.
  const saving = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const createRef = useRef<HTMLDivElement>(null)
  const importRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  const limitId = useId()

  const load = useCallback(async () => {
    try {
      setAvatars(await listAvatars(businessId))
      setLoadError(null)
    } catch (e) {
      setLoadError(message(e, 'Could not load the buyer avatars'))
    }
  }, [businessId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!focusHandleId || !listRef.current) return
    listRef.current.querySelector<HTMLButtonElement>(`[data-handle="${focusHandleId}"]`)?.focus()
    // Applied once: a later change to the list must not pull focus back to this handle.
    setFocusHandleId(null)
  }, [focusHandleId])

  useEffect(() => {
    if (!focusAvatarId || avatars === null) return
    const target = listRef.current?.querySelector<HTMLElement>(
      `[data-avatar-item="${focusAvatarId}"]`,
    )
    target?.scrollIntoView({ block: 'center' })
    target?.focus()
    // Only when the list first appears for this avatar, not on every later edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAvatarId, avatars === null])

  useEffect(() => {
    if (confirmingId) cancelRef.current?.focus()
  }, [confirmingId])

  useEffect(() => {
    if (creating) createRef.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [creating])

  useEffect(() => {
    if (importOpen) importRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [importOpen])

  const atLimit = avatars !== null && avatars.length >= MAX_BUYER_AVATARS

  function replace(updated: BuyerAvatar) {
    setAvatars((current) => current?.map((a) => (a.id === updated.id ? updated : a)) ?? null)
  }

  async function save(avatar: BuyerAvatar, changes: BuyerAvatarDraft) {
    const updated = await updateAvatar(businessId, avatar.id, changes)
    replace(updated)
    setEditingId(null)
  }

  async function create(draft: BuyerAvatarDraft) {
    const created = await bulkCreateAvatars(businessId, [draft])
    setAvatars((current) => [...(current ?? []), ...created])
    setCreating(false)
  }

  async function toggleActive(avatar: BuyerAvatar) {
    setBusy(true)
    setError(null)
    try {
      replace(await updateAvatar(businessId, avatar.id, { isActive: !avatar.isActive }))
    } catch (e) {
      setError(message(e, 'Could not change the avatar'))
    } finally {
      setBusy(false)
    }
  }

  // Put an avatar at a new place in the order. The cards move and renumber at once; the
  // existing reorder call saves the whole order, and if it fails the old order comes back.
  async function reorder(avatarId: string, to: number, focusHandle: boolean) {
    if (!avatars || saving.current) return
    const from = avatars.findIndex((a) => a.id === avatarId)
    if (from < 0 || to < 0 || to >= avatars.length || to === from) return
    const ids = moveItem(
      avatars.map((a) => a.id),
      from,
      to,
    )
    const byId = new Map(avatars.map((a) => [a.id, a]))
    const previous = avatars
    saving.current = true
    setBusy(true)
    setError(null)
    setAvatars(ids.map((id) => byId.get(id) as BuyerAvatar))
    if (focusHandle) setFocusHandleId(avatarId)
    try {
      setAvatars(await reorderAvatars(businessId, ids))
      setAnnouncement(`${previous[from].name} moved to position ${to + 1} of ${ids.length}.`)
    } catch (e) {
      setAvatars(previous)
      setError(message(e, 'Could not reorder the avatars'))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  async function remove(avatar: BuyerAvatar) {
    setBusy(true)
    setError(null)
    try {
      await deleteAvatar(businessId, avatar.id)
      setAvatars((current) => current?.filter((a) => a.id !== avatar.id) ?? null)
      setConfirmingId(null)
      headingRef.current?.focus()
    } catch (e) {
      setError(message(e, 'Could not delete the avatar'))
    } finally {
      setBusy(false)
    }
  }

  function indexOf(id: string): number {
    return avatars?.findIndex((a) => a.id === id) ?? -1
  }

  function clearDrag() {
    setDragId(null)
    setOverId(null)
    setArmedId(null)
  }

  function onDragStart(id: string, event: DragEvent<HTMLLIElement>) {
    // Only a card whose handle was pressed can be dragged.
    if (armedId !== id) {
      event.preventDefault()
      return
    }
    event.dataTransfer.setData('text/plain', id)
    event.dataTransfer.effectAllowed = 'move'
    setDragId(id)
  }

  function onDragOver(id: string, event: DragEvent<HTMLLIElement>) {
    if (dragId === null) return
    event.preventDefault()
    setOverId(id)
  }

  function onDrop(id: string, event: DragEvent<HTMLLIElement>) {
    event.preventDefault()
    const source = dragId
    clearDrag()
    if (source === null || source === id) return
    void reorder(source, indexOf(id), false)
  }

  function onHandleKey(id: string, event: KeyboardEvent<HTMLButtonElement>) {
    const from = indexOf(id)
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      void reorder(id, from - 1, true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      void reorder(id, from + 1, true)
    }
  }

  const count = avatars?.length ?? 0

  return (
    <section className="avatars-section" aria-labelledby="avatars-heading">
      <header className="avatars-header">
        <div className="avatars-header-text">
          <div className="avatars-title-row">
            <h2 id="avatars-heading" ref={headingRef} tabIndex={-1}>
              Buyer avatars
            </h2>
            {avatars !== null && (
              <span className="avatars-count">{`${count} of ${MAX_BUYER_AVATARS} avatars`}</span>
            )}
          </div>
          <p className="avatars-subtitle">
            Define and prioritize the customer segments Sales Guru uses to develop your marketing
            campaigns.
          </p>
        </div>
        <div className="avatars-header-actions">
          <button
            type="button"
            className="btn-outline btn-gold avatars-create"
            disabled={atLimit}
            aria-describedby={atLimit ? limitId : undefined}
            onClick={() => {
              setEditingId(null)
              setCreating(true)
            }}
          >
            <PlusIcon />
            Create avatar
          </button>
          <button type="button" className="btn-outline" onClick={() => setImportOpen(true)}>
            Import from document
          </button>
        </div>
      </header>
      {atLimit && (
        <p id={limitId} className="field-hint avatars-limit">
          {`You've reached the limit of ${MAX_BUYER_AVATARS} buyer avatars. Delete one to add another.`}
        </p>
      )}

      {loadError && (
        <div>
          <p className="form-error" role="alert">
            {loadError}
          </p>
          <button type="button" className="btn-outline" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {avatars === null && !loadError && <p>Loading…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {avatars !== null && avatars.length > 0 && (
        <section className="avatars-priority" aria-labelledby="avatars-priority-heading">
          <span className="avatars-priority-icon" aria-hidden="true">
            <ReorderIcon />
          </span>
          <div>
            <h3 id="avatars-priority-heading">Prioritize your audiences</h3>
            <p>
              Drag and drop your buyer avatars to change the order in which Sales Guru considers
              them when developing campaign strategies and creatives.
            </p>
            <p>
              Your active avatars are shown to the strategist in this order, and when a
              campaign&apos;s first ads have more avatars to choose from than angles, it prefers
              the ones higher up. Inactive avatars are skipped.
            </p>
          </div>
        </section>
      )}

      {creating && (
        <div className="avatars-create-panel" ref={createRef}>
          <AvatarForm
            initial={emptyAvatarForm()}
            ariaLabel="New buyer avatar"
            idBase="avatar-new"
            submitLabel="Save avatar"
            onSave={create}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      <div ref={importRef}>
        <AvatarImportSection
          businessId={businessId}
          open={importOpen}
          onOpenChange={setImportOpen}
          onSaved={() => void load()}
        />
      </div>

      {avatars !== null && avatars.length === 0 && (
        <section className="avatars-empty" aria-labelledby="avatars-empty-heading">
          <h3 id="avatars-empty-heading">No buyer avatars yet</h3>
          <p>
            Create your first buyer avatar or import audiences from your existing research to get
            started.
          </p>
          <div className="avatars-header-actions">
            <button
              type="button"
              className="btn-outline btn-gold avatars-create"
              onClick={() => setCreating(true)}
            >
              <PlusIcon />
              Create avatar
            </button>
            <button type="button" className="btn-outline" onClick={() => setImportOpen(true)}>
              Import from document
            </button>
          </div>
        </section>
      )}

      {avatars !== null && avatars.length > 0 && (
        <>
          <p id={hintId} className="visually-hidden">
            To reorder, drag a handle, or focus it and press the up or down arrow key.
          </p>
          <output className="visually-hidden" aria-live="polite" aria-atomic="true">
            {announcement}
          </output>
          <ul className="avatar-grid" aria-label="Buyer avatars" ref={listRef}>
            {avatars.map((avatar, index) => (
              <BuyerAvatarCard
                key={avatar.id}
                avatar={avatar}
                index={index}
                total={avatars.length}
                busy={busy}
                editing={editingId === avatar.id}
                dragging={dragId === avatar.id}
                over={overId === avatar.id && dragId !== avatar.id}
                armed={armedId === avatar.id}
                hintId={hintId}
                onArm={() => setArmedId(avatar.id)}
                onDragStart={(event) => onDragStart(avatar.id, event)}
                onDragOver={(event) => onDragOver(avatar.id, event)}
                onDrop={(event) => onDrop(avatar.id, event)}
                onDragEnd={clearDrag}
                onHandleKey={(event) => onHandleKey(avatar.id, event)}
                actions={{
                  onEdit: () => {
                    setConfirmingId(null)
                    setEditingId(avatar.id)
                  },
                  onToggleActive: () => void toggleActive(avatar),
                  onMoveToTop: () => void reorder(avatar.id, 0, true),
                  onMoveUp: () => void reorder(avatar.id, index - 1, true),
                  onMoveDown: () => void reorder(avatar.id, index + 1, true),
                  onAskDelete: () => {
                    setEditingId(null)
                    setConfirmingId(avatar.id)
                  },
                }}
              >
                {editingId === avatar.id && (
                  <AvatarForm
                    initial={avatarToForm(avatar)}
                    ariaLabel={`Edit ${avatar.name}`}
                    idBase={`avatar-edit-${avatar.id}`}
                    submitLabel="Save changes"
                    onSave={(changes) => save(avatar, changes)}
                    onCancel={() => setEditingId(null)}
                  />
                )}
                {confirmingId === avatar.id && (
                  <fieldset className="avatar-confirm">
                    <legend className="visually-hidden">Confirm deleting {avatar.name}</legend>
                    <p>
                      Delete {avatar.name}? It will no longer be used for new ads. Ads and results
                      that used it keep its name, marked archived.
                    </p>
                    <div className="avatar-actions">
                      <button
                        type="button"
                        className="btn-outline btn-danger"
                        disabled={busy}
                        onClick={() => void remove(avatar)}
                      >
                        Delete avatar
                      </button>
                      <button
                        type="button"
                        className="btn-outline"
                        ref={cancelRef}
                        disabled={busy}
                        onClick={() => setConfirmingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </fieldset>
                )}
              </BuyerAvatarCard>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

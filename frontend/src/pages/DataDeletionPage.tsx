// DRAFT — pending legal review. Content is grounded in what the app
// actually does as of 2026-09-19 — notably, that "deleting" a business is
// currently a soft delete (app/api/business.py sets deletedAt, doesn't
// purge child data) rather than self-serve hard erasure. The response-time
// SLA and contact address below are placeholders pending legal review.
export function DataDeletionPage() {
  return (
    <main className="legal-page">
      <h1>Data Deletion Instructions</h1>
      <p>Last updated: September 19, 2026</p>

      <p>
        This page explains what you can delete yourself today, and how to
        request deletion of everything else.
      </p>

      <h2>What you can delete yourself, right now</h2>
      <ul>
        <li>
          <strong>Disconnect Meta Ads</strong> (from a business's Meta Ads
          Connection section) — this immediately and permanently deletes your
          stored, encrypted Meta access token. It doesn't delete anything on
          Meta's own side (see below).
        </li>
        <li>
          <strong>Remove a product photo</strong> (from a product's photo
          manager) — this immediately and permanently deletes that photo from
          our database.
        </li>
        <li>
          <strong>Delete a campaign</strong> that hasn't been published yet —
          removes it from your dashboard.
        </li>
        <li>
          <strong>"Delete" a business</strong> — this hides the business from
          your dashboard immediately.{' '}
          <strong>
            It does not yet immediately erase the underlying data
          </strong>{' '}
          (products, photos, campaign history) from our systems — full
          erasure on business deletion is a known gap we haven't built yet.
          If you need that data actually erased now, use the request below.
        </li>
      </ul>

      <h2>Requesting full account deletion</h2>
      <p>
        There's currently no self-serve "delete my account" button. To
        request permanent deletion of your account and everything associated
        with it — business records, product data, uploaded photos, campaign
        history, and any stored Meta connection data — email us at{' '}
        <strong>[privacy@salesguru.app]</strong> with the subject "Data
        deletion request," from the email address on your account.
      </p>
      <p>
        We'll verify it's really you, delete your data within{' '}
        <strong>[30 days]</strong>, and confirm by email once it's done.
      </p>

      <h2>Meta account data specifically</h2>
      <p>
        We currently don't implement Meta's automated "Data Deletion Request
        Callback" — the process where removing this app from your Meta
        account settings automatically triggers deletion on our end. Right
        now, removing Sales Guru's access from your Meta account settings
        stops us from making further API calls on your behalf, but doesn't
        by itself delete anything already stored in Sales Guru — you still
        need to use the request process above (or disconnect from inside
        Sales Guru, described above) to have that data removed. If we build
        that callback in the future, we'll update this page to say so, and it
        will trigger the same deletion process described above automatically.
      </p>

      <h2>What this doesn't delete</h2>
      <p>
        Deleting your Sales Guru account doesn't delete anything already on
        Meta's own platform — any ad accounts, campaigns, or ads you've run
        stay exactly where they are on Meta and are governed by Meta's own
        data policies; manage or delete those directly in Meta Ads Manager.
        Likewise, a generation request already sent to Anthropic's API before
        your deletion request is handled under Anthropic's own data retention
        policy, not ours.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about deleting your data: <strong>[privacy@salesguru.app]</strong>
      </p>
    </main>
  )
}

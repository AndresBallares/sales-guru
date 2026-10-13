import { Link } from 'react-router-dom'
import { ArrowRightIcon } from './icons'

// The hard gate on a business's page: until its brand profile is saved, nothing
// on this page can start a campaign. Explains why and sends the user to that
// business's Brand form on the dashboard.
export function BrandRequiredNotice({
  businessId,
  businessName,
}: {
  businessId: string
  businessName?: string
}) {
  return (
    <section className="flow-gate" aria-labelledby="brand-required-heading">
      <h2 id="brand-required-heading">Complete the Brand profile first</h2>
      <p>
        {businessName ? `${businessName} doesn't` : "This business doesn't"} have a brand profile
        yet. Campaigns can't be created until it does: Sales Guru uses the brand profile to write
        every campaign's strategy and ads in the same voice, so they stay on brand across campaigns.
      </p>
      <p>It takes a couple of minutes. Come back here when it is saved.</p>
      <Link className="btn-outline btn-gold" to={`/?brand=${businessId}`}>
        Complete the Brand profile
        <ArrowRightIcon />
      </Link>
    </section>
  )
}

import { Link } from 'react-router-dom'

// DRAFT — pending legal review. Content is grounded in what the app
// actually does as of 2026-09-19 (see the render.yaml/CLAUDE.md work this
// shipped alongside), but the legal language itself (liability, retention
// windows, governing law, the bracketed placeholders below) has not been
// reviewed by counsel and should not be treated as final until it is.
export function PrivacyPolicyPage() {
  return (
    <main className="legal-page">
      <h1>Privacy Policy</h1>
      <p>Last updated: September 19, 2026</p>

      <p>
        Sales Guru is an AI-powered advertising platform: you describe your
        business and what you sell, Sales Guru generates ad strategy, ad copy,
        and ad creative, and — only after you explicitly approve — publishes
        real campaigns to Meta Ads on your behalf. This page explains what
        information we collect to do that, and how it's used.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information</strong> — the email address you sign up
          with, and your password (stored as a one-way hash; we never store
          or can retrieve your actual password).
        </li>
        <li>
          <strong>Business and product information you provide</strong> —
          business name, description, and website; product listings and
          descriptions; audience descriptions; and the campaign objectives you
          choose.
        </li>
        <li>
          <strong>Brand information</strong> — if you fill out a brand
          profile, that includes your brand's description, ideal customer,
          voice traits, price positioning, tagline, proof points, and example
          copy — used to keep AI-generated ads consistent with your brand.
        </li>
        <li>
          <strong>Photos you upload</strong> — product photos and your
          business logo, stored directly in our database.
        </li>
        <li>
          <strong>Meta connection data</strong> — your Meta ad account ID,
          Facebook Page ID, and an access token obtained when you connect your
          Meta Ads account. The access token is encrypted at rest and used
          only to publish and manage ads on your behalf.
        </li>
        <li>
          <strong>Campaign and ad performance data from Meta</strong> —
          impressions, clicks, spend, conversions, and related metrics,
          pulled from Meta's own Ads Insights API for campaigns you publish
          through Sales Guru.
        </li>
      </ul>

      <h2>How we use this information</h2>
      <ul>
        <li>
          To generate ad strategy, audience recommendations, ad copy, and ad
          creative on your behalf.
        </li>
        <li>
          To publish and manage real advertising campaigns on Meta, only after
          you explicitly approve a specific campaign ("Approve &amp;
          Publish").
        </li>
        <li>To show you performance dashboards for your own campaigns.</li>
        <li>To operate, maintain, and improve Sales Guru.</li>
      </ul>

      <h2>How we use data obtained through Meta</h2>
      <p>
        Any data we access through your connected Meta ad account or Page —
        your ad account/Page identifiers, the access token, and the campaign
        and performance data described above — is used <strong>only</strong>{' '}
        to create, manage, and report on advertising campaigns for{' '}
        <strong>your own business</strong>, at your direction. We do not sell
        this data, use it to build profiles of or target anyone other than
        the audiences you configure for your own campaigns, or share it with
        any third party except the service providers named on this page.
      </p>

      <h2>Who we share information with</h2>
      <ul>
        <li>
          <strong>Anthropic</strong> — the business, product, and brand
          information you provide, and photos you upload, are sent to
          Anthropic's Claude API to generate ad strategy, ad copy, and ad
          creative. Anthropic's own privacy policy governs how they handle
          data sent to their API.
        </li>
        <li>
          <strong>Meta Platforms, Inc.</strong> — once you approve a campaign,
          its audience, budget, and creative content (including product
          photos) are sent to Meta to create and run a real ad campaign. Data
          that reaches Meta is also subject to Meta's own terms and policies.
        </li>
        <li>
          <strong>Render</strong> — our hosting provider; the application and
          its database run on Render's infrastructure.
        </li>
        <li>
          <strong>[Email delivery provider]</strong> — if you use a
          password-reset link, your email address is used to send that
          transactional email through our email delivery provider.
        </li>
      </ul>
      <p>We do not sell your personal information.</p>

      <h2>How we protect your information</h2>
      <ul>
        <li>Passwords are hashed and never stored in plain text.</li>
        <li>
          Meta access tokens are encrypted at rest and only decrypted in
          memory when a request to Meta's API actually needs them.
        </li>
        <li>Login sessions use secure, server-verified session cookies.</li>
      </ul>

      <h2>How long we keep information</h2>
      <p>
        We keep your business, product, and campaign data for as long as your
        account and connected businesses are active. Your Meta access token
        is kept only until you disconnect Meta (which deletes it immediately)
        or your account is deleted. Campaign performance metrics pulled from
        Meta are kept as your campaign's historical record and are not
        automatically purged. See{' '}
        <Link to="/data-deletion">Data Deletion Policy</Link> for how to
        request removal, and what is and isn't deleted automatically today.
      </p>

      <h2>Children's privacy</h2>
      <p>
        Sales Guru is a business tool and is not directed at, or knowingly
        used to collect information from, children.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We may update this policy as Sales Guru changes. We'll update the
        "Last updated" date above when we do.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy: <strong>[privacy@salesguru.app]</strong>
      </p>
    </main>
  )
}

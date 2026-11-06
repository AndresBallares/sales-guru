import type { ReactNode } from 'react'
import type { Product } from '../lib/api'
import type { RESEARCH_DEPTHS, RESEARCH_MODELS } from '../lib/research'
import { productLabel } from '../lib/productLabel'
import { ResearchProductThumb } from './ResearchProductCard'

// The panel beside the choices: what the research will use right now, derived from the same
// state as the cards, plus the cost, any message and the actions (passed in as children).
export function ResearchConfigurationSummary({
  depth,
  model,
  products,
  children,
}: {
  depth: (typeof RESEARCH_DEPTHS)[number]
  model: (typeof RESEARCH_MODELS)[number]
  products: Product[]
  children: ReactNode
}) {
  return (
    <section
      className="research-summary-panel"
      aria-labelledby="research-summary-panel-heading"
    >
      <h3 id="research-summary-panel-heading">Your research configuration</h3>
      <p className="field-hint">Review your selections before starting research.</p>
      <dl className="research-summary-list">
        <div>
          <dt>Research depth</dt>
          <dd>
            <strong>{depth.label}</strong>
            <span className="field-hint">{depth.summary}</span>
          </dd>
        </div>
        <div>
          <dt>AI model</dt>
          <dd>
            <strong>{model.label}</strong>
            <span className="field-hint">{model.status}</span>
          </dd>
        </div>
        <div>
          <dt>Products</dt>
          <dd>
            <strong>{products.length === 0 ? 'None selected' : `${products.length} selected`}</strong>
            {products.length === 0 ? (
              <span className="field-hint">
                The research uses the products of your most recent campaigns.
              </span>
            ) : (
              <ul aria-label="Selected products" className="research-summary-products">
                {products.map((product) => (
                  <li key={product.id} title={productLabel(product)}>
                    <span className="research-summary-thumb">
                      <ResearchProductThumb product={product} decorative />
                    </span>
                    {product.name?.trim() || 'Untitled Product'}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      {children}
    </section>
  )
}

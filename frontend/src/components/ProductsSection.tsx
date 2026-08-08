import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, createProduct, listProducts, type Product } from '../lib/api'

export function ProductsSection({ businessId }: { businessId: string }) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [margin, setMargin] = useState('')
  const [features, setFeatures] = useState('')
  const [benefits, setBenefits] = useState('')
  const [url, setUrl] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setProducts(await listProducts(businessId))
      setListError(null)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not load products.')
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
      await createProduct(businessId, {
        description,
        price: price ? Number(price) : undefined,
        margin: margin ? Number(margin) : undefined,
        features: features || undefined,
        benefits: benefits || undefined,
        url: url || undefined,
      })
      setDescription('')
      setPrice('')
      setMargin('')
      setFeatures('')
      setBenefits('')
      setUrl('')
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create product.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <section>
        <h2>Products</h2>
        {loading && <p>Loading…</p>}
        {listError && (
          <p className="form-error" role="alert">
            {listError}
          </p>
        )}
        {!loading && !listError && products.length === 0 && (
          <p>No products yet — add your first one below.</p>
        )}
        <ul>
          {products.map((product) => (
            <li key={product.id}>{product.description}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Add a product</h2>
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="product-description">What do you sell?</label>
            <textarea
              id="product-description"
              required
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="price">Price</label>
            <input
              id="price"
              type="number"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="margin">Margin</label>
            <input
              id="margin"
              type="number"
              step="0.01"
              value={margin}
              onChange={(event) => setMargin(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="features">Features</label>
            <textarea
              id="features"
              value={features}
              onChange={(event) => setFeatures(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="benefits">Benefits</label>
            <textarea
              id="benefits"
              value={benefits}
              onChange={(event) => setBenefits(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="url">URL</label>
            <input
              id="url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add product'}
          </button>
        </form>
      </section>
    </>
  )
}

// How a product is shown on screen: the name the owner typed, or its description
// while it has no name. A name is never derived from the description.
export function productLabel(product: { name?: string | null; description: string }): string {
  const name = product.name?.trim()
  return name ? name : product.description
}

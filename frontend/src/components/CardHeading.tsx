// A card's heading: the label in plain words, with the technical term in small
// text underneath for anyone who wants to look it up.
export function CardHeading({ id, label, term }: { id: string; label: string; term?: string }) {
  return (
    <>
      <h3 id={id}>{label}</h3>
      {term && <p className="dash-term">{term}</p>}
    </>
  )
}

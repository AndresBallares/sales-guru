// Plain-English definitions for every number on the Advertising Performance
// dashboard. `plain` is the one-line note on a card; the tooltip adds what the
// metric is, why it matters and how to read it. Written for business owners, not
// marketers: no jargon without an explanation.

export type MetricKey =
  | 'spend'
  | 'purchases'
  | 'cac'
  | 'roas'
  | 'impressions'
  | 'reach'
  | 'frequency'
  | 'cpm'
  | 'clicks'
  | 'linkClicks'
  | 'ctr'
  | 'cpc'
  | 'landingPageViews'
  | 'addToCart'
  | 'initiatedCheckout'
  | 'purchaseRevenue'
  | 'costPerAddToCart'
  | 'addToCartRate'

export interface MetricCopy {
  name: string
  // The one-line explanation shown on the card.
  plain: string
  // What the term stands for or measures.
  what: string
  why: string
  how: string
}

export const METRIC_COPY: Record<MetricKey, MetricCopy> = {
  spend: {
    name: 'Advertising Spend',
    plain: 'How much money you’ve spent on advertising during the selected period.',
    what: 'The amount Meta has recorded as spent on your ads.',
    why: 'It is the cost side of every other number on this page.',
    how: 'Spend alone is neither good nor bad. Compare it with what your ads brought in.',
  },
  purchases: {
    name: 'Purchases',
    plain: 'How many purchases your advertisements generated, according to Meta.',
    what: 'Sales that Meta attributes to your ads, counted by your Pixel.',
    why: 'It is the result your advertising exists to produce.',
    how: 'Meta’s count can differ a little from your store’s own orders, and recent days can still change while Meta finishes attributing sales.',
  },
  cac: {
    name: 'Cost Per Sale (CAC)',
    plain: 'How much you spend on advertising to acquire one paying customer.',
    what: 'Customer Acquisition Cost.',
    why: 'It helps you understand how expensive it is to turn advertising into customers.',
    how: 'Lower is better. Compare it with the profit you make on one sale: if winning a customer costs more than the sale earns, the ads are losing money.',
  },
  roas: {
    name: 'Return on Ad Spend (ROAS)',
    plain: 'For every $1 you spend on advertising, how much revenue do you generate?',
    what: 'Return on Ad Spend.',
    why: 'It helps you understand whether your advertising is generating revenue relative to its cost.',
    how: 'A ROAS of 4x means $4 of attributed revenue for every $1 spent. It is revenue, not profit: your product costs, shipping and fees still come out of it.',
  },
  impressions: {
    name: 'Impressions',
    plain: 'How many times your advertisements were displayed on Facebook and Instagram.',
    what: 'Each time one of your ads appears on someone’s screen.',
    why: 'It shows how much exposure your ads are getting.',
    how: 'One person can see an ad several times, so impressions are higher than the number of people reached.',
  },
  reach: {
    name: 'Reach',
    plain: 'How many unique people saw your advertisements.',
    what: 'The number of different people who saw your ads at least once.',
    why: 'It shows how big the audience you are actually reaching is.',
    how: 'Meta counts each person once per campaign, so reach can’t be added across campaigns or split by date. That is why it only shows for all time with one campaign.',
  },
  frequency: {
    name: 'Frequency',
    plain: 'On average, how many times each person saw your advertisement.',
    what: 'Impressions divided by reach.',
    why: 'It warns you when people may be seeing the same ad too often.',
    how: 'Around 1 to 2 is normal. A number climbing well above that can mean people are getting tired of the ad.',
  },
  cpm: {
    name: 'CPM – Cost Per 1,000 Impressions',
    plain: 'How much it costs to display your advertisements 1,000 times.',
    what: 'Cost Per 1,000 Impressions.',
    why: 'It helps you understand how much you’re paying for advertising exposure.',
    how: 'CPM measures impressions, not unique people; reach is a separate number. Lower means cheaper exposure, which only pays off if people respond.',
  },
  clicks: {
    name: 'Clicks',
    plain: 'Every tap or click on your ad, including likes, shares and profile visits.',
    what: 'All clicks Meta recorded on your ads, wherever they went.',
    why: 'It shows how much people interacted with your ads.',
    how: 'This is wider than link clicks: many of these clicks never reach your website.',
  },
  linkClicks: {
    name: 'Link Clicks',
    plain: 'How many people clicked a link in your advertisement to visit your website.',
    what: 'Clicks that took someone from the ad to your link.',
    why: 'These are the clicks that can turn into customers.',
    how: 'Compare it with landing page views: a big gap means people clicked but left before your page loaded.',
  },
  ctr: {
    name: 'CTR – Click-Through Rate',
    plain: 'The percentage of ad impressions that resulted in clicks.',
    what: 'Clicks divided by impressions.',
    why: 'It shows whether your ad is interesting enough to act on.',
    how: 'Higher means more people respond to the ad. It counts every click, not only link clicks.',
  },
  cpc: {
    name: 'CPC – Cost Per Click',
    plain: 'On average, how much you paid for each recorded click.',
    what: 'Spend divided by clicks.',
    why: 'It shows what it costs to get someone to interact with an ad.',
    how: 'Lower is better, as long as those clicks turn into visitors and sales.',
  },
  landingPageViews: {
    name: 'Landing Page Views',
    plain: 'People who clicked your ad and whose visit to your page finished loading.',
    what: 'Visits where your page actually loaded after the click.',
    why: 'It is the first sign the ad is bringing real visitors to your website.',
    how: 'It is usually a bit lower than link clicks, because some people click and leave before the page loads.',
  },
  addToCart: {
    name: 'Added to Cart',
    plain: 'People who added a product to their shopping cart after seeing your ad.',
    what: 'Add-to-cart events your Pixel recorded.',
    why: 'It shows that visitors are interested enough to consider buying.',
    how: 'A big drop between visitors and carts points to the product page or offer, not the ad.',
  },
  initiatedCheckout: {
    name: 'Started Checkout',
    plain: 'People who began the checkout process.',
    what: 'Checkout-start events your Pixel recorded.',
    why: 'It shows who is close to buying.',
    how: 'A big drop between carts and checkouts can mean surprise costs, such as shipping.',
  },
  purchaseRevenue: {
    name: 'Purchase Revenue',
    plain: 'The money your attributed purchases brought in, according to Meta.',
    what: 'The total value of purchases Meta attributes to your ads.',
    why: 'It is the income side to weigh against your advertising spend.',
    how: 'This is revenue, not profit: your product costs, shipping and fees are not taken out.',
  },
  costPerAddToCart: {
    name: 'Cost Per Add-to-Cart',
    plain: 'How much you spend on advertising to get someone to add a product to their shopping cart.',
    what: 'Advertising spend divided by add-to-cart events.',
    why: 'It is an early signal of whether the ads attract buyers, before many sales exist.',
    how: 'Lower is better. Watch it alongside cost per sale.',
  },
  addToCartRate: {
    name: 'Add-to-Cart Rate',
    plain: 'The percentage of landing page visitors who added a product to their shopping cart.',
    what: 'Add-to-cart events divided by landing page views.',
    why: 'It shows how well your page turns visitors into shoppers.',
    how: 'If this is low while clicks are healthy, look at the page, the product or the price.',
  },
}

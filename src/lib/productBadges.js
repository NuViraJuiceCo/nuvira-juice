// Dietary certifications must not be inferred from a product category.
export function productBadges(product, isMerch = false) {
  if (isMerch) return ['Reusable', 'Insulated', 'Large Capacity'];
  const badges = ['juice', 'bundle'].includes(product?.category) ? ['Cold-Pressed'] : [];
  if (/\bhoney\b/i.test(String(product?.ingredients || ''))) badges.push('Contains Honey');
  return [...badges, 'Keep Chilled', 'Local Delivery'];
}

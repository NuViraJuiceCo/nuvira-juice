function text(value, maxLength = 160) {
  return (value ?? '').toString().trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

export function normalizeShopifyLocationId(value) {
  const raw = text(value);
  if (!raw) return null;
  const gidMatch = raw.match(/^gid:\/\/shopify\/Location\/(\d+)$/i);
  const numericMatch = raw.match(/^(\d+)$/);
  const numeric = gidMatch?.[1] || numericMatch?.[1] || '';
  if (!numeric) return null;
  return {
    gid: `gid://shopify/Location/${numeric}`,
    numeric,
  };
}

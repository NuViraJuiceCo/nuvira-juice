/**
 * Parse structured address fields from a full delivery address string.
 * Input: "206 West Pine Creek Ct, Wentzville, MO, 63385"
 * Output: { address_line1, address_city, address_state, address_postal_code }
 */

export function parseAddressString(fullAddress) {
  if (!fullAddress) {
    return {
      address_line1: null,
      address_city: null,
      address_state: null,
      address_postal_code: null,
    };
  }

  const parts = fullAddress.split(',').map(p => p.trim());

  let address_line1 = null;
  let address_city = null;
  let address_state = null;
  let address_postal_code = null;

  // Pattern: "Street, City, State ZipCode"
  if (parts.length >= 1) {
    address_line1 = parts[0] || null;
  }
  if (parts.length >= 2) {
    address_city = parts[1] || null;
  }
  if (parts.length >= 3) {
    // Last part may be "State ZipCode" or just "State"
    const stateZip = parts[2].split(/\s+/);
    if (stateZip.length >= 2) {
      address_state = stateZip[0] || null;
      address_postal_code = stateZip[stateZip.length - 1] || null; // Last segment is typically zip
    } else {
      address_state = stateZip[0] || null;
    }
  }

  return {
    address_line1,
    address_city,
    address_state,
    address_postal_code,
  };
}
export function normalizeNamePart(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function buildCustomerName(firstName, lastName) {
  return [normalizeNamePart(firstName), normalizeNamePart(lastName)]
    .filter(Boolean)
    .join(' ');
}

export function splitHumanFullName(value) {
  const normalized = normalizeNamePart(value);
  if (!normalized || normalized.includes('@')) {
    return { firstName: '', lastName: '' };
  }

  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length < 2) {
    return { firstName: '', lastName: '' };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export function resolveCustomerIdentity({ profile, user } = {}) {
  const profileFirstName = normalizeNamePart(profile?.first_name);
  const profileLastName = normalizeNamePart(profile?.last_name);
  if (profileFirstName && profileLastName) {
    return { firstName: profileFirstName, lastName: profileLastName, source: 'profile' };
  }

  const userFirstName = normalizeNamePart(user?.first_name);
  const userLastName = normalizeNamePart(user?.last_name);
  if (userFirstName && userLastName) {
    return { firstName: userFirstName, lastName: userLastName, source: 'auth_structured' };
  }

  const split = splitHumanFullName(user?.full_name);
  if (split.firstName && split.lastName) {
    return { ...split, source: 'auth_full_name' };
  }

  return { firstName: '', lastName: '', source: 'missing' };
}

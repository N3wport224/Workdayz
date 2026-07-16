/**
 * Centralized field synonym database for Workday tenant variants.
 * Different Workday tenants use different labels for the same fields.
 * This module maps known tenant-specific labels to canonical field names.
 * Add new tenant mappings here as they're discovered.
 */

export interface TenantFieldMap {
  hostnamePattern: RegExp;
  overrides: Record<string, string[]>;
}

// Known tenant-specific field label overrides
export const TENANT_FIELD_MAPS: TenantFieldMap[] = [
  // Xcel Energy
  {
    hostnamePattern: /xcel/i,
    overrides: {
      "job title": ["position title", "job title"],
      "start date": ["from date", "from"],
      "end date": ["to date", "to"],
      "school": ["school or university", "institution name"],
      "degree": ["degree/diploma", "degree"],
      "certification": ["certification/license", "credential"],
    },
  },
  // Amazon
  {
    hostnamePattern: /amazon/i,
    overrides: {
      "job title": ["job title", "title"],
      "company": ["employer", "company name"],
      "phone": ["phone number", "mobile number", "contact number"],
    },
  },
  // Target
  {
    hostnamePattern: /target/i,
    overrides: {
      "start date": ["start date", "begin date"],
      "end date": ["end date", "completion date"],
    },
  },
];

/** Common international label variants */
export const INTERNATIONAL_SYNONYMS: Record<string, string[]> = {
  "first name": ["first name", "given name", "prénom", "nombre", "vorname"],
  "last name": ["last name", "family name", "surname", "nom", "apellido", "nachname"],
  "email": ["email", "e-mail", "correo electrónico", "courriel"],
  "phone": ["phone", "telephone", "teléfono", "téléphone", "telefon"],
  "city": ["city", "town", "ville", "ciudad", "stadt"],
  "state": ["state", "province", "region", "état", "estado", "bundesland"],
  "postal code": ["postal code", "zip code", "code postal", "código postal", "plz"],
  "country": ["country", "pays", "país", "land"],
};

/** Returns tenant-specific field synonyms for the current hostname */
export function getTenantSynonyms(hostname: string): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const map of TENANT_FIELD_MAPS) {
    if (map.hostnamePattern.test(hostname)) {
      Object.assign(merged, map.overrides);
    }
  }
  return merged;
}

/** Returns international synonyms for a given field */
export function getInternationalSynonyms(field: string): string[] {
  return INTERNATIONAL_SYNONYMS[field] ?? [];
}
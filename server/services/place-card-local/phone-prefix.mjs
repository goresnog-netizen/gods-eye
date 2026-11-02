/**
 * What an Indonesian mobile number actually tells you: the operator.
 *
 * A number is a subscription identifier. It carries no position — not a city,
 * not a cell, not a hint. Pretending otherwise is how "phone tracking" products
 * are sold, and every one of them is really doing one of three things: reading
 * the cell id the handset reports, buying an operator feed, or lying.
 *
 * What the number *does* carry is the allocation block. Indonesia has no mobile
 * number portability, so the prefix still decides the operator deterministically
 * — 0812 is Telkomsel, 0817 is XL, 0895 is Tri. That is a real, checkable fact
 * and it costs no API key, so the console states it and stops there.
 *
 * Prefix table: Kemenkominfo national numbering plan, per-operator mobile
 * blocks (08xx). When portability arrives this table becomes wrong, and the
 * `source` field says so rather than pretending to be timeless.
 */

/** Operator per national mobile prefix. Longest match wins. */
const PREFIX_OPERATORS = new Map([
  ['0811', 'Telkomsel'],
  ['0812', 'Telkomsel'],
  ['0813', 'Telkomsel'],
  ['0821', 'Telkomsel'],
  ['0822', 'Telkomsel'],
  ['0823', 'Telkomsel'],
  ['0851', 'Telkomsel'],
  ['0852', 'Telkomsel'],
  ['0853', 'Telkomsel'],
  ['0814', 'Indosat Ooredoo Hutchison'],
  ['0815', 'Indosat Ooredoo Hutchison'],
  ['0816', 'Indosat Ooredoo Hutchison'],
  ['0855', 'Indosat Ooredoo Hutchison'],
  ['0856', 'Indosat Ooredoo Hutchison'],
  ['0857', 'Indosat Ooredoo Hutchison'],
  ['0858', 'Indosat Ooredoo Hutchison'],
  ['0817', 'XL Axiata'],
  ['0818', 'XL Axiata'],
  ['0819', 'XL Axiata'],
  ['0859', 'XL Axiata'],
  ['0877', 'XL Axiata'],
  ['0878', 'XL Axiata'],
  ['0831', 'AXIS'],
  ['0832', 'AXIS'],
  ['0833', 'AXIS'],
  ['0838', 'AXIS'],
  ['0895', 'Tri'],
  ['0896', 'Tri'],
  ['0897', 'Tri'],
  ['0898', 'Tri'],
  ['0899', 'Tri'],
  ['0881', 'Smartfren'],
  ['0882', 'Smartfren'],
  ['0883', 'Smartfren'],
  ['0884', 'Smartfren'],
  ['0885', 'Smartfren'],
  ['0886', 'Smartfren'],
  ['0887', 'Smartfren'],
  ['0888', 'Smartfren'],
  ['0889', 'Smartfren'],
]);

export const PHONE_PREFIX_SOURCE =
  'Kemenkominfo national numbering plan (08xx mobile blocks), no MNP in Indonesia';

/**
 * Normalise a typed number to national (`08…`) and E.164 (`+628…`) forms.
 *
 * Accepts `+62 812-3456-7890`, `0812 3456 7890`, `62812…`, and `812…`. Returns
 * null when the digits cannot be an Indonesian mobile number, so the caller
 * can say "not a mobile number" instead of inventing an operator.
 *
 * @param {string} input
 * @returns {{national:string, e164:string, subscriber:string}|null}
 */
export function normalizePhone(input) {
  const digits = String(input || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  let national = null;
  if (digits.startsWith('62')) national = `0${digits.slice(2)}`;
  else if (digits.startsWith('0')) national = digits;
  else if (digits.startsWith('8')) national = `0${digits}`;
  if (!national) return null;
  if (!/^08[1-9]\d{6,10}$/.test(national)) return null;
  return {
    national,
    e164: `+62${national.slice(1)}`,
    subscriber: national.slice(4),
  };
}

/**
 * The operator behind a number, or null when the block is not a mobile one.
 *
 * @param {string} input
 * @returns {{operator:string, prefix:string, national:string, e164:string}|null}
 */
export function operatorFor(input) {
  const phone = normalizePhone(input);
  if (!phone) return null;
  const prefix = phone.national.slice(0, 4);
  const operator = PREFIX_OPERATORS.get(prefix);
  if (!operator) return null;
  return { operator, prefix, national: phone.national, e164: phone.e164 };
}

/**
 * The honest description of a number for a locate response.
 *
 * `position` is always null here: there is nothing in a number to turn into
 * coordinates. Callers must not fill that gap with a catalogue sample and call
 * it a location.
 *
 * @param {string} input
 * @returns {object}
 */
export function describePhone(input) {
  const phone = normalizePhone(input);
  if (!phone) {
    return {
      kind: 'not-a-mobile-number',
      input: String(input || ''),
      position: null,
      reason:
        'Not an Indonesian mobile number. Nothing here can be geolocated.',
    };
  }
  const found = operatorFor(phone.national);
  return {
    kind: 'mobile-number',
    input: String(input || ''),
    national: phone.national,
    e164: phone.e164,
    operator: found ? found.operator : null,
    prefix: found ? found.prefix : null,
    source: PHONE_PREFIX_SOURCE,
    position: null,
    reason:
      'A number identifies a subscription, not a place. Ask the handset for the ' +
      'cell id it is attached to (mcc-mnc-lac-cellid); that resolves to a tower ' +
      'in the registry. Metre accuracy needs an operator feed.',
  };
}

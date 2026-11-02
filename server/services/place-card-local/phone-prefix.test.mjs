import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PHONE_PREFIX_SOURCE,
  describePhone,
  normalizePhone,
  operatorFor,
} from './phone-prefix.mjs';

test('a number normalises however it was typed', () => {
  for (const input of [
    '+62 812-3456-7890',
    '0812-3456-7890',
    '6281234567890',
    '81234567890',
    '(0812) 3456 7890',
  ]) {
    const phone = normalizePhone(input);
    assert.ok(phone, input);
    assert.equal(phone.national, '081234567890', input);
    assert.equal(phone.e164, '+6281234567890', input);
  }
});

test('anything that is not an Indonesian mobile is refused', () => {
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('hello'), null);
  assert.equal(normalizePhone('+1 415 555 0100'), null);
  assert.equal(
    normalizePhone('021-555-1234'),
    null,
    'a landline is not mobile',
  );
  assert.equal(normalizePhone('0800-1234'), null);
});

test('the prefix names the operator, deterministically', () => {
  assert.equal(operatorFor('081234567890').operator, 'Telkomsel');
  assert.equal(operatorFor('081734567890').operator, 'XL Axiata');
  assert.equal(operatorFor('089534567890').operator, 'Tri');
  assert.equal(operatorFor('088134567890').operator, 'Smartfren');
  assert.equal(
    operatorFor('081534567890').operator,
    'Indosat Ooredoo Hutchison',
  );
  assert.equal(operatorFor('083134567890').operator, 'AXIS');
  assert.equal(operatorFor('081234567890').prefix, '0812');
});

test('an unallocated block names no operator instead of guessing', () => {
  assert.equal(operatorFor('084234567890'), null);
});

test('the description carries the operator and never a position', () => {
  const described = describePhone('+62-812-3456-7890');
  assert.equal(described.kind, 'mobile-number');
  assert.equal(described.operator, 'Telkomsel');
  assert.equal(described.position, null, 'a number is not a place');
  assert.equal(described.source, PHONE_PREFIX_SOURCE);
  assert.match(described.reason, /cell id/);

  const junk = describePhone('not a number');
  assert.equal(junk.kind, 'not-a-mobile-number');
  assert.equal(junk.position, null);
});

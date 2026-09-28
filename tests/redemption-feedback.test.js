import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const panel = source.slice(source.indexOf('function wireGiftShopRedeemPanel('), source.indexOf('\nfunction giftShopItemRowHTML('));
function setup() {
  const elements = Object.fromEntries(['giftshop-code-input', 'giftshop-redeem-btn', 'giftshop-redeem-result'].map(id => [id, {
    value: 'ABCDE', handlers: {}, setAttribute() {}, focus() {},
    addEventListener(event, handler) { this.handlers[event] = handler; },
  }]));
  let resolve, reject, requests = 0;
  const toasts = [];
  const context = vm.createContext({
    document: { getElementById: id => elements[id] },
    Store: { completeRedemption() { requests++; return new Promise((yes, no) => { resolve = yes; reject = no; }); } },
    icon: () => '', escapeHTML: value => String(value),
    redemptionErrorMessage: error => error.message,
    showToast: (...args) => toasts.push(args),
  });
  vm.runInContext(panel + '\nwireGiftShopRedeemPanel("venue");', context);
  return { elements, toasts, resolve: value => resolve(value), reject: error => reject(error), requests: () => requests };
}
test('slow redemption shows progress, blocks duplicate submission, then confirms success', async () => {
  const s = setup();
  const button = s.elements['giftshop-redeem-btn'];
  const input = s.elements['giftshop-code-input'];
  const result = s.elements['giftshop-redeem-result'];
  const pending = button.handlers.click();
  assert.equal(button.disabled, true);
  assert.match(result.textContent, /Processing redemption/);
  input.handlers.keydown({ key: 'Enter' });
  assert.equal(s.requests(), 1);
  s.resolve({ item: { name: 'Museum mug' }, remainingBalance: 8 });
  await pending;
  assert.match(result.innerHTML, /Redeemed/);
  assert.match(result.innerHTML, /Remaining balance: 8/);
  assert.equal(s.toasts.length, 1);
  assert.equal(button.disabled, false);
  assert.equal(input.value, '');
});
test('failed request displays the error and permits retry without a false success', async () => {
  const s = setup();
  const button = s.elements['giftshop-redeem-btn'];
  const pending = button.handlers.click();
  s.reject(new Error('Redemption could not be confirmed'));
  await pending;
  assert.match(s.elements['giftshop-redeem-result'].innerHTML, /could not be confirmed/);
  assert.equal(s.toasts.length, 0);
  assert.equal(button.disabled, false);
  assert.equal(s.elements['giftshop-code-input'].value, 'ABCDE');
});

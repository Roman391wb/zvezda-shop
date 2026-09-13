import assert from "node:assert/strict";
import test from "node:test";
import {
  actionLabel,
  changedProductPayload,
  formatMoney,
  kopecksToRublesInput,
  mergeVariant,
  parseRubles,
  roleLabel,
  sectionLabel,
  statusLabel,
  usageLabels
} from "../public/admin-domain.mjs";

test("prices convert strictly between UI rubles and API kopecks", () => {
  assert.equal(parseRubles("3500"), 350000);
  assert.equal(parseRubles("3500,50"), 350050);
  assert.equal(parseRubles("3500.50"), 350050);
  assert.equal(parseRubles("3 500,50"), 350050);
  assert.equal(parseRubles("3\u00a0500"), 350000);
  assert.equal(parseRubles("3\u202f500"), 350000);
  assert.equal(kopecksToRublesInput(2199000), "21990");
  assert.equal(kopecksToRublesInput(350050), "3500,50");
  assert.equal(formatMoney(350000), "3 500 ₽");
});

test("invalid or unsafe price input is rejected instead of coerced", () => {
  for (const value of ["", "-1", "NaN", "Infinity", "1e3", "12,345", "35 руб", "3 50", "0"]) {
    assert.throws(() => parseRubles(value));
  }
  assert.throws(() => parseRubles("10000000,01"));
});

test("product patches include only genuinely changed fields", () => {
  const original = { name: "Костюм", price: 3500, variants: [{ id: "v1", stock_quantity: 4 }] };
  assert.deepEqual(changedProductPayload(original, { ...original }), {});
  assert.deepEqual(changedProductPayload(original, { ...original, price: 350000 }), { price: 350000 });
});

test("variant editing preserves ids, stock links, extra options and media", () => {
  const original = { id: "v1", sku: "OLD", options: { size: "42", color: "Чёрный", cut: "regular" }, stock_quantity: 7, is_active: true, media: ["m1"], custom: true };
  assert.deepEqual(mergeVariant(original, { id: "v1", sku: "NEW", size: "44", color: "Синий", stock_quantity: 7, is_active: false }), {
    id: "v1", sku: "NEW", options: { size: "44", color: "Синий", cut: "regular" }, stock_quantity: 7, is_active: false, media: ["m1"], custom: true
  });
});

test("labels are explicit and leave API values separate", () => {
  assert.equal(statusLabel("published"), "Опубликован");
  assert.equal(sectionLabel("featured"), "Популярные товары");
  assert.equal(roleLabel("ADMIN"), "Администратор");
  assert.equal(actionLabel("products.updated"), "Товар изменён");
  assert.deepEqual(usageLabels(["products.products[0].media[0].url", "homepage.sections[0].content.media_url", "products.products[1].cardImage"]), ["Товары", "Главная страница"]);
});

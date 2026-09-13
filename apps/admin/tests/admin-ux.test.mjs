import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async name => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");

test("ordinary Admin editors contain fields instead of raw JSON textareas", async () => {
  const files = [await source("app.js"), await source("product-editor.mjs"), await source("homepage-editor.mjs")].join("\n");
  for (const label of ["Варианты JSON", "Медиа JSON", "Характеристики JSON", "Content JSON", "Save / Publish", ">Preview<"]) assert.equal(files.includes(label), false);
  assert.match(files, /Артикул варианта/); assert.match(files, /Добавить вариант/); assert.match(files, /Добавить характеристику/); assert.match(files, /Название характеристики/);
  assert.doesNotMatch(files, /<pre>\$\{.*JSON\.stringify/su);
});

test("status selects keep technical values and render Russian labels", async () => {
  const files = [await source("app.js"), await source("product-editor.mjs"), await source("homepage-editor.mjs")].join("\n");
  assert.match(files, /value=["']published["'][^>]*>Опубликован/); assert.match(files, /value=["']draft["'][^>]*>Черновик/);
});

test("Admin uses explicit labels and no DOM-wide localization walker", async () => {
  const app = await source("app.js");
  assert.doesNotMatch(app, /localizeUi|MutationObserver|createTreeWalker/);
  assert.match(app, /sectionLabel/); assert.match(app, /statusLabel/); assert.match(app, /roleLabel/); assert.match(app, /actionLabel/);
});

test("all new modules are versioned by the entry asset", async () => {
  const index = await source("index.html"), app = await source("app.js");
  assert.match(index, /app\.js\?v=admin-ux-1/); assert.match(index, /styles\.css\?v=admin-ux-1/); assert.match(app, /product-editor\.mjs\?v=admin-ux-1/);
});

test("product and media editors load one coherent workspace instead of duplicate document reads", async () => {
  const editor = await source("product-editor.mjs"), media = await source("media-manager.mjs");
  assert.match(editor, /api\(`\/workspace/); assert.match(media, /api\("\/workspace"\)/);
  assert.match(editor, /"If-Match": rev\("\/products"\)/); assert.doesNotMatch(editor, /rev\(`\/products\/\$\{id\}`\)/);
  assert.doesNotMatch(`${editor}\n${media}`, /Promise\.all\(\[\s*api\("\/(?:categories|media)"\)/u);
});

#!/usr/bin/env node
// Sync Paseo's in-app settings (appearance, fonts, diff view, agent defaults).
//
// Why this exists: Paseo keeps these in the Electron renderer's localStorage,
// not in a config file. On disk that is a Chromium LevelDB at
//   ~/Library/Application Support/Paseo/Local Storage/leveldb
// so the only way to sync it across machines is to read and write that store.
//
//   node paseo/app-settings.mjs export   live store -> app-settings.template.json
//   node paseo/app-settings.mjs apply    app-settings.template.json -> live store
//
// Paseo must be quit. Chromium holds an exclusive lock on the store while it
// runs, and it flushes its own in-memory copy over ours on quit.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, "app-settings.template.json");
const DB = join(homedir(), "Library", "Application Support", "Paseo", "Local Storage", "leveldb");
const CACHE = join(homedir(), ".cache", "dotfiles-paseo-localstorage");

// Chromium namespaces every localStorage key by origin. Paseo's renderer is
// served from the custom paseo:// scheme, so every key is prefixed with
// "_paseo://app\0\1" and every value with \1 for UTF-8 or \0 for UTF-16.
const ORIGIN = Buffer.from("_paseo://app\u0000\u0001", "latin1");
const UTF8 = 0x01;

// Only keys that mean the same thing on any machine. Left out on purpose:
//   @paseo:settings-migrations   per-device bookkeeping
//   @paseo:client-id-v1          device identity
//   @paseo:daemon-registry       hosts paired with this device
//   @paseo/provider-snapshot/*   rebuildable cache, full of absolute paths
//   workspace-layout-state, panel-state, sidebar-*  per-workspace layout
const KEYS = [
  "@paseo:app-settings",
  "@paseo:changes-preferences",
  "@paseo:create-agent-preferences",
  "@paseo:preferred-editor",
];

function die(msg) {
  console.error(`paseo/app-settings: ${msg}`);
  process.exit(1);
}

// pgrep does not see the Electron main process by name on macOS, so match the
// executable path in the full process list instead.
function paseoIsRunning() {
  const main = "/Applications/Paseo.app/Contents/MacOS/Paseo";
  const procs = execFileSync("ps", ["-Axo", "comm="], { encoding: "utf8" });
  return procs.split("\n").some((line) => line === main);
}

// classic-level is a native module and the only dependency. Keep it out of the
// dotfiles repo: install it once into ~/.cache and reuse it after that.
async function loadLevel() {
  const entry = join(CACHE, "node_modules", "classic-level", "index.js");
  if (!existsSync(entry)) {
    console.log("    installing classic-level into ~/.cache (one time)");
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(join(CACHE, "package.json"), '{"name":"paseo-localstorage","private":true}\n');
    execFileSync("npm", ["install", "--silent", "--no-audit", "--no-fund", "classic-level"], {
      cwd: CACHE,
      stdio: "inherit",
    });
  }
  const { ClassicLevel } = await import(`file://${entry}`);
  return ClassicLevel;
}

async function openDb(ClassicLevel) {
  const db = new ClassicLevel(DB, { keyEncoding: "buffer", valueEncoding: "buffer" });
  await db.open();
  return db;
}

const encodeKey = (key) => Buffer.concat([ORIGIN, Buffer.from(key, "latin1")]);
const encodeValue = (text) => Buffer.concat([Buffer.from([UTF8]), Buffer.from(text, "utf8")]);

function decodeValue(buf) {
  if (buf[0] === UTF8) return buf.subarray(1).toString("utf8");
  return buf.subarray(1).toString("utf16le"); // Chromium's other encoding
}

// Values are stored as strings. Objects are JSON, but some keys hold a bare
// string such as "vscode", so keep the two apart in both directions.
const parseValue = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
const serializeValue = (value) => (typeof value === "string" ? value : JSON.stringify(value));

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// The template wins on the keys it names. Anything the local app added, such as
// a setting from a newer Paseo than the one that wrote the template, survives.
function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) out[k] = deepMerge(base[k], v);
  return out;
}

async function exportSettings() {
  const ClassicLevel = await loadLevel();
  const db = await openDb(ClassicLevel);
  const out = {};
  try {
    for (const key of KEYS) {
      const raw = await db.get(encodeKey(key)).catch(() => null);
      if (raw) out[key] = parseValue(decodeValue(raw));
      else console.log(`    ${key} not set, skipped`);
    }
  } finally {
    await db.close();
  }
  writeFileSync(TEMPLATE, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`    wrote ${Object.keys(out).length} keys to ${TEMPLATE}`);
}

async function applySettings() {
  if (!existsSync(TEMPLATE)) die(`no template at ${TEMPLATE}`);
  const template = JSON.parse(readFileSync(TEMPLATE, "utf8"));
  if (!existsSync(DB)) die(`no Paseo local storage at ${DB}. Launch Paseo once first.`);

  // A native LevelDB write can corrupt the store if it dies halfway. It holds
  // drafts and layout as well as settings, so copy it aside before touching it.
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const backup = `${DB}.backup-${stamp}`;
  cpSync(DB, backup, { recursive: true });
  rmSync(join(backup, "LOCK"), { force: true });

  const ClassicLevel = await loadLevel();
  let db;
  try {
    db = await openDb(ClassicLevel);
  } catch (err) {
    rmSync(backup, { recursive: true, force: true });
    die(`could not open ${DB}. Is Paseo still running? ${err.message}`);
  }

  try {
    for (const [key, value] of Object.entries(template)) {
      const raw = await db.get(encodeKey(key)).catch(() => null);
      const merged = raw ? deepMerge(parseValue(decodeValue(raw)), value) : value;
      await db.put(encodeKey(key), encodeValue(serializeValue(merged)));
      console.log(`    ${raw ? "merged" : "seeded"} ${key}`);
    }
  } catch (err) {
    await db.close().catch(() => {});
    rmSync(DB, { recursive: true, force: true });
    cpSync(backup, DB, { recursive: true });
    die(`write failed, restored from ${backup}: ${err.message}`);
  }
  await db.close();
  rmSync(backup, { recursive: true, force: true });
}

const command = process.argv[2];
if (command !== "export" && command !== "apply") {
  die("usage: node paseo/app-settings.mjs <export|apply>");
}
if (paseoIsRunning()) {
  console.log("    Paseo is running. Quit it and run this again.");
  process.exit(0);
}
await (command === "export" ? exportSettings() : applySettings());

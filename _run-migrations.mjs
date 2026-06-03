import pg from "pg";
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const { Client } = pg;
const HERE = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(HERE, "supabase", "migrations");
const REF = "hpmokmkcstjfwhmstjxd";
const PASSWORD = process.env.DBPASS;
const START_FROM = parseInt(process.env.START_FROM || "6", 10); // 1-5 already applied

if (!PASSWORD) { console.error("DBPASS env var not set"); process.exit(1); }

// Known-good connection found by the earlier auto-detect.
const CONN = {
  host: "aws-1-eu-west-2.pooler.supabase.com",
  user: `postgres.${REF}`,
  port: 5432,
};

// Postgres errors that mean "this file can't run as one transaction" — retry split.
const TXN_ERR = /unsafe use of new value|cannot run inside a transaction block/i;

// Dollar-quote / comment / string-aware statement splitter (top-level ; only).
function splitStatements(sql) {
  const stmts = [];
  let cur = "", i = 0, state = null, dollarTag = "", blockDepth = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i], next = i + 1 < n ? sql[i + 1] : "";
    if (state === "line") { cur += ch; if (ch === "\n") state = null; i++; continue; }
    if (state === "block") {
      if (ch === "/" && next === "*") { blockDepth++; cur += ch + next; i += 2; continue; }
      if (ch === "*" && next === "/") { blockDepth--; cur += ch + next; i += 2; if (blockDepth === 0) state = null; continue; }
      cur += ch; i++; continue;
    }
    if (state === "squote") { cur += ch; if (ch === "'") { if (next === "'") { cur += next; i += 2; continue; } state = null; } i++; continue; }
    if (state === "dquote") { cur += ch; if (ch === '"') { if (next === '"') { cur += next; i += 2; continue; } state = null; } i++; continue; }
    if (state === "dollar") {
      if (ch === "$" && sql.startsWith(dollarTag, i)) { cur += dollarTag; i += dollarTag.length; state = null; continue; }
      cur += ch; i++; continue;
    }
    if (ch === "-" && next === "-") { state = "line"; cur += ch + next; i += 2; continue; }
    if (ch === "/" && next === "*") { state = "block"; blockDepth = 1; cur += ch + next; i += 2; continue; }
    if (ch === "'") { state = "squote"; cur += ch; i++; continue; }
    if (ch === '"') { state = "dquote"; cur += ch; i++; continue; }
    if (ch === "$") {
      const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (m) { dollarTag = m[0]; cur += dollarTag; i += dollarTag.length; state = "dollar"; continue; }
    }
    if (ch === ";") { const t = cur.trim(); if (t) stmts.push(t); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  const t = cur.trim(); if (t) stmts.push(t);
  return stmts;
}

const client = new Client({
  ...CONN, password: PASSWORD, database: "postgres",
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});
await client.connect();
await client.query("SET statement_timeout = 0");
console.log(`Connected to ${CONN.host}\n`);

const all = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const files = all.filter((f) => {
  const m = f.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) >= START_FROM : true;
});
console.log(`${all.length} total migrations, applying ${files.length} (from #${START_FROM})\n`);

let n = 0;
for (const f of files) {
  n++;
  const sql = readFileSync(join(MIG_DIR, f), "utf8");
  process.stdout.write(`  [${String(n).padStart(2, "0")}/${files.length}] ${f} ... `);
  try {
    await client.query(sql);
    console.log("done");
  } catch (e) {
    if (TXN_ERR.test(e.message)) {
      try {
        const stmts = splitStatements(sql);
        for (const s of stmts) await client.query(s);
        console.log(`done (split ${stmts.length})`);
      } catch (e2) {
        console.log("ERROR (split)");
        console.error(`\n--- FAILED on ${f} (split) ---\n${e2.message}\n`);
        await client.end(); process.exit(3);
      }
    } else {
      console.log("ERROR");
      console.error(`\n--- FAILED on ${f} ---\n${e.message}\n`);
      await client.end(); process.exit(3);
    }
  }
}

await client.end();
console.log(`\nDone. Applied ${files.length} migrations (1-${START_FROM - 1} were already in place).`);

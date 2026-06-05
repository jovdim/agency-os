// Temp scan: collect every distinct icon imported from "lucide-react" across src/.
const fs = require("fs");
const path = require("path");
const root = path.join(process.cwd(), "src");
const names = {};
let fileCount = 0;

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      walk(p);
    } else if (/\.(tsx|ts|jsx|js)$/.test(e.name)) {
      const c = fs.readFileSync(p, "utf8");
      const re =
        /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']lucide-react["']/g;
      let m;
      let hit = false;
      while ((m = re.exec(c))) {
        hit = true;
        m[1].split(",").forEach((s) => {
          s = s.trim();
          if (!s) return;
          // strip "X as Y" -> X, and any leading "type "
          const nm = s.split(/\s+as\s+/)[0].trim().replace(/^type\s+/, "");
          if (nm) names[nm] = (names[nm] || 0) + 1;
        });
      }
      if (hit) fileCount++;
    }
  }
}

walk(root);
const ks = Object.keys(names).sort();
console.log("FILES_WITH_LUCIDE:" + fileCount);
console.log("DISTINCT_ICONS:" + ks.length);
console.log(ks.map((k) => `${k}\t${names[k]}`).join("\n"));

/**
 * Direct probe of bsqr.co — bypasses the swallow-on-error path so we
 * see the actual reason a QR fails to generate.
 *
 * Usage: npx tsx scripts/test-bysquare-direct.ts [amount] [vs]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { generateBySquareQrImage } from "../src/lib/payments/bysquare";

async function main() {
  const amount = Number(process.argv[2] ?? 199);
  const vs = process.argv[3] ?? "666212922";
  console.log("calling bsqr.co with", { amount, vs });
  try {
    const dataUrl = await generateBySquareQrImage({
      amount,
      variableSymbol: vs,
      note: "Test probe",
    });
    console.log("✓ ok, len:", dataUrl.length, "head:", dataUrl.slice(0, 60));
  } catch (err) {
    console.error("✗ FAILED:", (err as Error).message);
    if ((err as Error).stack) console.error((err as Error).stack);
  }
}
main();

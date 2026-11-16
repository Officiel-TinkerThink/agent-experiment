// Offline check of the context engine functions (no model calls).
import { Context } from "./context.mjs";

const ctx = new Context("thrombosis_prediction", "learn");
const hits = ctx.search("patients with abnormal creatinine", { kind: "column", k: 3 });
console.log("search:", JSON.stringify(hits));
console.log("neighbors:", JSON.stringify(ctx.neighbors(hits[0].id, { k: 3 })));
console.log("expand:", JSON.stringify(ctx.expand([hits[0].id, "c:Patient.SEX"])).slice(0, 900));
console.log("values:", JSON.stringify(ctx.values("female patients with SLE diagnosis", { k: 4 })));
const t0 = performance.now();
const big = new Context("card_games", "learn");
console.log("card_games load ms:", Math.round(performance.now() - t0), "values:", JSON.stringify(big.values("Ancestor's Chosen", { k: 2 })));

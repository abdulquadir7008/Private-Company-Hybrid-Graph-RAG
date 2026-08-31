import { config } from "../dist/config.js";
import { detectEntities, buildPlan, extractSearchTerms } from "../dist/retrieval/queryPlanner.js";

const q = "Who is John Smith and what does Project Atlas depend on?";
const principal = { userId: "u1", companyId: "cmtfzoi6g0000psx4vjghjmss", role: "ROLE_ADMIN_R", authorized: true };
console.time("detect");
const det = await detectEntities(principal, q);
console.timeEnd("detect");
console.log("detection:", JSON.stringify(det));
console.log("plan:", JSON.stringify(buildPlan(q, det)));
console.log("terms:", JSON.stringify(extractSearchTerms(q)));
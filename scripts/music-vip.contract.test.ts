import assert from "node:assert/strict";
import { runDailyVipFlow } from "../src/utils/music-api.ts";

const ok = { status: 1, data: {} };
const alreadyClaimed = { status: 0, error_code: 131001, data: null };
const riskControlled = { status: 0, error_code: 20028, data: null };
const temporaryFailure = { status: 0, error_code: 50001, data: null };

const complete = await runDailyVipFlow({
	dateKey: "2026-08-10",
	claim: async () => ok,
	upgrade: async () => ok,
});
assert.equal(complete.status, "completed");
assert.equal(complete.shouldMarkComplete, true);

let upgradedAfterAlreadyClaimed = 0;
const recovered = await runDailyVipFlow({
	dateKey: "2026-08-10",
	claim: async () => alreadyClaimed,
	upgrade: async () => {
		upgradedAfterAlreadyClaimed += 1;
		return ok;
	},
});
assert.equal(recovered.status, "completed");
assert.equal(recovered.shouldMarkComplete, true);
assert.equal(upgradedAfterAlreadyClaimed, 1);

const retry = await runDailyVipFlow({
	dateKey: "2026-08-10",
	claim: async () => ok,
	upgrade: async () => temporaryFailure,
});
assert.equal(retry.status, "retry");
assert.equal(retry.shouldMarkComplete, false);

const risk = await runDailyVipFlow({
	dateKey: "2026-08-10",
	claim: async () => riskControlled,
	upgrade: async () => ok,
});
assert.equal(risk.status, "risk");
assert.equal(risk.shouldMarkComplete, false);

console.log("music-vip contract tests: PASS");

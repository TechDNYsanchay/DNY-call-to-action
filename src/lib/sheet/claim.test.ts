import { describe, expect, it } from "vitest";
import { CLAIM_GONE, checkCallClaim, presentedClaim } from "./claim";

const token = "4f3e2d1c-0b9a-4876-9543-210fedcba987";
const call = { kind: "call", process_status: "processing" as const, claim_token: token };
const meeting = { kind: "meeting", process_status: "processing" as const, claim_token: token };

describe("checkCallClaim", () => {
  it("lets a call through only under the claim that is current", () => {
    expect(checkCallClaim(call, token)).toBeNull();
    expect(checkCallClaim(call, ` ${token.toUpperCase()} `)).toBeNull();
  });
  it("answers 409 when the claim is missing or was replaced", () => {
    expect(checkCallClaim(call, null)).toEqual({ httpStatus: 409, error: CLAIM_GONE });
    expect(checkCallClaim(call, "")).toEqual({ httpStatus: 409, error: CLAIM_GONE });
    expect(checkCallClaim(call, "0b8f6a52-2f0e-4c38-9a3d-6f5e4d3c2b1a")).toEqual({ httpStatus: 409, error: CLAIM_GONE });
    expect(checkCallClaim({ ...call, claim_token: null }, token)).toEqual({ httpStatus: 409, error: CLAIM_GONE });
  });
  it("answers 422 when the call is not processing, even with the right claim", () => {
    expect(checkCallClaim({ ...call, process_status: "ready" }, token)).toEqual({ httpStatus: 422, error: "Call is ready, not processing; call next to claim it" });
    expect(checkCallClaim({ ...call, process_status: "done", claim_token: null }, token)?.httpStatus).toBe(422);
  });
  it("lets a dry run through without a claim: it writes nothing", () => {
    expect(checkCallClaim(call, null, { dryRun: true })).toBeNull();
    expect(checkCallClaim({ ...call, process_status: "done" }, null, { dryRun: true })).toBeNull();
  });
  it("never checks a meeting: any claim or none, in any status", () => {
    expect(checkCallClaim(meeting, null)).toBeNull();
    expect(checkCallClaim(meeting, "something else")).toBeNull();
    expect(checkCallClaim({ ...meeting, process_status: "ready", claim_token: null }, null)).toBeNull();
  });
});

describe("presentedClaim", () => {
  it("trims and lower-cases, and reads nothing as null", () => {
    expect(presentedClaim(" ABC ")).toBe("abc");
    expect(presentedClaim("   ")).toBeNull();
    expect(presentedClaim(null)).toBeNull();
    expect(presentedClaim(undefined)).toBeNull();
  });
});

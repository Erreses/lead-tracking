import { describe, expect, it } from "vitest";

import { isSellableFinding, judgeStatus } from "./website-status";

/**
 * This rule decides whether you tell a business owner their website is broken.
 * Getting it wrong in the generous direction wastes a probe; getting it wrong
 * in the other direction means pitching someone whose site works perfectly.
 */

describe("judgeStatus", () => {
  it("treats a normal response as working", () => {
    for (const code of [200, 201, 204, 301, 302, 307, 399]) {
      expect(judgeStatus(code)).toBe("ok");
    }
  });

  it("treats a missing page as genuinely dead", () => {
    expect(judgeStatus(404)).toBe("dead");
    expect(judgeStatus(410)).toBe("dead");
  });

  it("treats a lapsed hosted shop as dead", () => {
    // Shopify and friends answer 402 once the account stops being paid for.
    expect(judgeStatus(402)).toBe("dead");
  });

  it("does not call a site dead just because it refused us", () => {
    // The regression: a working site behind bot protection answered 403 and
    // was promoted to a lead, ready to be told its website was broken.
    for (const code of [401, 403, 405, 429]) {
      expect(judgeStatus(code)).toBe("blocked");
      expect(isSellableFinding(judgeStatus(code))).toBe(false);
    }
  });

  it("does not call a site dead on a server error", () => {
    // A deploy or a blip. One probe is not proof, and an owner mid-outage does
    // not need to hear their site is gone.
    for (const code of [500, 502, 503, 504]) {
      expect(judgeStatus(code)).toBe("error");
      expect(isSellableFinding(judgeStatus(code))).toBe(false);
    }
  });

  it("only ever sells a dead site", () => {
    const everyCode = Array.from({ length: 400 }, (_, i) => i + 200);
    const sellable = everyCode.filter((code) => isSellableFinding(judgeStatus(code)));

    expect(sellable.sort((a, b) => a - b)).toEqual([402, 404, 410]);
  });

  it("defaults an unknown 4xx to blocked rather than dead", () => {
    // Benefit of the doubt goes to the site: the server answered.
    for (const code of [418, 423, 451]) {
      expect(judgeStatus(code)).toBe("blocked");
    }
  });
});

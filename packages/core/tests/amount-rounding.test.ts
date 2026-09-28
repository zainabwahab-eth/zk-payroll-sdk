import {
  roundAmount,
  roundToAssetPrecision,
  convertAmountPrecision,
  roundToIncrement,
  canRepresentExactly,
  getMinimumRepresentableAmount,
  formatRoundedAmount,
  tryRoundAmount,
  RoundingMode,
  RoundedAmount,
} from "../src/assets/amountRounding";
import { AssetMetadata } from "../src/assets/types";

// Test asset metadata
const XLM: AssetMetadata = {
  id: "native",
  symbol: "XLM",
  label: "Stellar Lumens",
  decimals: 7,
};

const USDC: AssetMetadata = {
  id: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  symbol: "USDC",
  label: "USD Coin",
  decimals: 7,
};

const TOKEN_6DP: AssetMetadata = {
  id: "TOKEN6:GABC123456789012345678901234567890123456789012345678901234",
  symbol: "TOKEN6",
  label: "6 Decimal Token",
  decimals: 6,
};

const TOKEN_18DP: AssetMetadata = {
  id: "TOKEN18:GABC123456789012345678901234567890123456789012345678901234",
  symbol: "TOKEN18",
  label: "18 Decimal Token",
  decimals: 18,
};

describe("roundAmount", () => {
  describe("same precision (no-op)", () => {
    it("should return amount unchanged when sourceDecimals === targetDecimals", () => {
      const result = roundAmount(1_000_000_000n, 7, 7);
      expect(result.amount).toBe(1_000_000_000n);
      expect(result.wasRounded).toBe(false);
      expect(result.sourceDecimals).toBe(7);
      expect(result.targetDecimals).toBe(7);
    });
  });

  describe("increasing precision (adding trailing zeros)", () => {
    it("should multiply by 10^diff when targetDecimals > sourceDecimals", () => {
      // 1.50 XLM (7dp) = 15_000_000 stroops -> 6dp = 1_500_000
      const result = roundAmount(15_000_000n, 7, 6);
      expect(result.amount).toBe(1_500_000n);
      expect(result.wasRounded).toBe(false);
    });

    it("should handle 7dp to 18dp", () => {
      const result = roundAmount(1_000_000_000n, 7, 18);
      expect(result.amount).toBe(100_000_000_000_000_000_000n); // 10^11 multiplier
      expect(result.wasRounded).toBe(false);
    });
  });

  describe("decreasing precision (rounding)", () => {
    describe("HALF_UP (default)", () => {
      it("should round down when remainder < half divisor", () => {
        // 1.494 XLM (7dp) = 14_940_000 -> 2dp: 14_940_000 / 100_000 = 149 remainder 40_000 < 50_000 -> 149
        const result = roundAmount(14_940_000n, 7, 2, { rounding: RoundingMode.HALF_UP });
        expect(result.amount).toBe(149n);
        expect(result.wasRounded).toBe(true);
      });

      it("should round up when remainder >= half divisor", () => {
        // 1.500 XLM -> 2dp: 15_000_000 / 100_000 = 150 remainder 0 -> 150
        const result = roundAmount(15_000_000n, 7, 2, { rounding: RoundingMode.HALF_UP });
        expect(result.amount).toBe(150n);
        expect(result.wasRounded).toBe(false);
      });

      it("should round correctly at exactly half", () => {
        // 1.505 XLM (7dp) = 15_050_000 -> 2dp: 15_050_000 / 100_000 = 150 remainder 50_000
        // half of 100_000 = 50_000, so remainder >= half -> rounds up to 151
        const result = roundAmount(15_050_000n, 7, 2, { rounding: RoundingMode.HALF_UP });
        expect(result.amount).toBe(151n);
      });
    });

    describe("TRUNCATE", () => {
      it("should truncate (floor for positive)", () => {
        // 1.999 XLM -> 2dp: just drop last 5 digits
        const result = roundAmount(19_990_000n, 7, 2, { rounding: RoundingMode.TRUNCATE });
        expect(result.amount).toBe(199n);
        expect(result.wasRounded).toBe(true);
      });

      it("should not round exact values", () => {
        const result = roundAmount(20_000_000n, 7, 2, { rounding: RoundingMode.TRUNCATE });
        expect(result.amount).toBe(200n);
        expect(result.wasRounded).toBe(false);
      });
    });

    describe("CEIL", () => {
      it("should round up when any remainder exists", () => {
        // 1.001 XLM -> 2dp: any remainder -> round up
        const result = roundAmount(10_010_000n, 7, 2, { rounding: RoundingMode.CEIL });
        expect(result.amount).toBe(101n);
        expect(result.wasRounded).toBe(true);
      });

      it("should not change exact values", () => {
        const result = roundAmount(10_000_000n, 7, 2, { rounding: RoundingMode.CEIL });
        expect(result.amount).toBe(100n);
        expect(result.wasRounded).toBe(false);
      });
    });

    describe("FLOOR", () => {
      it("should floor (same as truncate for positive)", () => {
        const result = roundAmount(19_990_000n, 7, 2, { rounding: RoundingMode.FLOOR });
        expect(result.amount).toBe(199n);
        expect(result.wasRounded).toBe(true);
      });
    });
  });

  describe("validation", () => {
    it("should throw for invalid sourceDecimals", () => {
      expect(() => roundAmount(100n, -1, 2)).toThrow();
      expect(() => roundAmount(100n, 19, 2)).toThrow();
    });

    it("should throw for invalid targetDecimals", () => {
      expect(() => roundAmount(100n, 2, -1)).toThrow();
      expect(() => roundAmount(100n, 2, 19)).toThrow();
    });
  });

  describe("metadata preservation", () => {
    it("should preserve originalAmount", () => {
      const result = roundAmount(123456789n, 7, 2);
      expect(result.originalAmount).toBe(123456789n);
    });

    it("should report wasRounded correctly", () => {
      const exact = roundAmount(10_000_000n, 7, 2);
      expect(exact.wasRounded).toBe(false);

      const rounded = roundAmount(10_000_001n, 7, 2);
      expect(rounded.wasRounded).toBe(true);
    });
  });
});

describe("roundToAssetPrecision", () => {
  it("should return amount unchanged for same precision", () => {
    const result = roundToAssetPrecision(1_000_000_000n, XLM);
    expect(result.amount).toBe(1_000_000_000n);
    expect(result.wasRounded).toBe(false);
  });
});

describe("convertAmountPrecision", () => {
  it("should convert between same precision assets (no-op)", () => {
    const result = convertAmountPrecision(1_000_000_000n, XLM, USDC);
    expect(result.amount).toBe(1_000_000_000n);
    expect(result.wasRounded).toBe(false);
  });

  it("should convert from 7dp to 6dp with rounding", () => {
    // 1.500 XLM (7dp) = 15_000_000 -> 6dp = 1_500_000 (exact)
    const result = convertAmountPrecision(15_000_000n, XLM, TOKEN_6DP);
    expect(result.amount).toBe(1_500_000n);
    expect(result.wasRounded).toBe(false);
  });

  it("should convert from 7dp to 6dp with HALF_UP rounding", () => {
    // 7dp to 6dp is divide by 10
    // 15_050_001 / 10 = 1_505_000 remainder 1 -> HALF_UP: 1 < 5 -> 1_505_000
    const result = convertAmountPrecision(15_050_001n, XLM, TOKEN_6DP, {
      rounding: RoundingMode.HALF_UP,
    });
    expect(result.amount).toBe(1_505_000n);
    expect(result.wasRounded).toBe(true);
  });

  it("should convert from 6dp to 18dp (multiply)", () => {
    // 1.50 TOKEN6 (6dp) = 1_500_000 -> 18dp = 1_500_000 * 10^12
    const result = convertAmountPrecision(1_500_000n, TOKEN_6DP, TOKEN_18DP);
    expect(result.amount).toBe(1_500_000_000_000_000_000n);
    expect(result.wasRounded).toBe(false);
  });

  it("should convert from 18dp to 6dp with rounding", () => {
    // 1.500000000000000500 TOKEN18 (18dp) -> 6dp
    // 1_500_000_000_000_000_500 / 10^12 = 1_500_000 remainder 500_000_000_000
    // half of 10^12 = 500_000_000_000 -> HALF_UP rounds up
    const result = convertAmountPrecision(1_500_000_500_000_000_000n, TOKEN_18DP, TOKEN_6DP, {
      rounding: RoundingMode.HALF_UP,
    });
    expect(result.amount).toBe(1_500_001n);
    expect(result.wasRounded).toBe(true);
  });
});

describe("roundToIncrement", () => {
  it("should round down to nearest increment", () => {
    // Round 1.5 XLM to nearest 0.01 (1_000_000 stroops)
    const result = roundToIncrement(15_000_000n, 1_000_000n, XLM);
    expect(result.amount).toBe(15_000_000n); // exact multiple
    expect(result.wasRounded).toBe(false);
  });

  it("should round down when not exact multiple", () => {
    const result = roundToIncrement(15_051_234n, 1_000_000n, XLM);
    expect(result.amount).toBe(15_000_000n);
    expect(result.wasRounded).toBe(true);
  });

  it("should throw for non-positive increment", () => {
    expect(() => roundToIncrement(100n, 0n, XLM)).toThrow();
    expect(() => roundToIncrement(100n, -1n, XLM)).toThrow();
  });
});

describe("canRepresentExactly", () => {
  it("should return true when target >= source", () => {
    expect(canRepresentExactly(100n, 2, 5)).toBe(true);
    expect(canRepresentExactly(100n, 7, 7)).toBe(true);
  });

  it("should return true when amount is exact multiple", () => {
    // 15_000_000 (7dp) -> 2dp: divisor = 100_000, 15_000_000 % 100_000 = 0
    expect(canRepresentExactly(15_000_000n, 7, 2)).toBe(true);
  });

  it("should return false when amount has excess precision", () => {
    // 15_000_001 (7dp) -> 2dp: divisor = 100_000, remainder = 1
    expect(canRepresentExactly(15_000_001n, 7, 2)).toBe(false);
  });
});

describe("getMinimumRepresentableAmount", () => {
  it("should return 1 for any valid decimals", () => {
    expect(getMinimumRepresentableAmount(0)).toBe(1n);
    expect(getMinimumRepresentableAmount(7)).toBe(1n);
    expect(getMinimumRepresentableAmount(18)).toBe(1n);
  });

  it("should throw for invalid decimals", () => {
    expect(() => getMinimumRepresentableAmount(-1)).toThrow();
    expect(() => getMinimumRepresentableAmount(19)).toThrow();
  });
});

describe("formatRoundedAmount", () => {
  it("should format whole amounts without decimals", () => {
    // 100 XLM = 100 * 10^7 = 1_000_000_000 stroops
    const rounded: RoundedAmount = {
      amount: 1_000_000_000n,
      targetDecimals: 7,
      wasRounded: false,
      originalAmount: 1_000_000_000n,
      sourceDecimals: 7,
    };
    expect(formatRoundedAmount(rounded, XLM)).toBe("100 XLM");
  });

  it("should format amounts with fractional part", () => {
    // 100.5 XLM = 100.5 * 10^7 = 1_005_000_000 stroops
    const rounded: RoundedAmount = {
      amount: 1_005_000_000n,
      targetDecimals: 7,
      wasRounded: false,
      originalAmount: 1_005_000_000n,
      sourceDecimals: 7,
    };
    expect(formatRoundedAmount(rounded, XLM)).toBe("100.5 XLM");
  });

  it("should trim trailing zeros from fractional part", () => {
    // 1.005 XLM = 10_050_000 stroops
    const rounded: RoundedAmount = {
      amount: 10_050_000n,
      targetDecimals: 7,
      wasRounded: false,
      originalAmount: 10_050_000n,
      sourceDecimals: 7,
    };
    expect(formatRoundedAmount(rounded, XLM)).toBe("1.005 XLM");
  });
});

describe("tryRoundAmount", () => {
  it("should return ok: true for valid inputs", () => {
    const result = tryRoundAmount(100n, 7, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.amount).toBe(0n); // 100 / 100_000 = 0
    }
  });

  it("should return ok: false for invalid decimals", () => {
    const result = tryRoundAmount(100n, -1, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
    }
  });
});

describe("Multi-asset scenarios", () => {
  it("should handle XLM (7dp) to USDC (7dp) conversion", () => {
    const result = convertAmountPrecision(1_000_000_000n, XLM, USDC);
    expect(result.amount).toBe(1_000_000_000n);
  });

  it("should handle XLM (7dp) to 6dp token", () => {
    // 100 XLM = 1_000_000_000 stroops -> 6dp = 100_000_000
    const result = convertAmountPrecision(1_000_000_000n, XLM, TOKEN_6DP);
    expect(result.amount).toBe(100_000_000n);
  });

  it("should handle 18dp token to XLM (7dp)", () => {
    // 1 TOKEN18 = 1_000_000_000_000_000_000 -> 7dp = 1_000_000_000_000_000 / 10^11 = 10_000_000
    const result = convertAmountPrecision(1_000_000_000_000_000_000n, TOKEN_18DP, XLM);
    expect(result.amount).toBe(10_000_000n);
  });

  it("should handle proportional allocation across assets", () => {
    // Total 1000 XLM to split 60/40 between XLM and USDC
    const total = 10_000_000_000n; // 1000 XLM
    const xlmShare = (total * 60n) / 100n; // 6_000_000_000
    const usdcShare = (total * 40n) / 100n; // 4_000_000_000

    const xlmRounded = roundToAssetPrecision(xlmShare, XLM);
    const usdcRounded = roundToAssetPrecision(usdcShare, USDC);

    expect(xlmRounded.amount).toBe(6_000_000_000n);
    expect(usdcRounded.amount).toBe(4_000_000_000n);
    // Sum should equal total (no rounding loss in this case)
    expect(xlmRounded.amount + usdcRounded.amount).toBe(total);
  });
});

describe("Boundary and edge cases", () => {
  it("should handle zero decimals (integer assets)", () => {
    const intAsset: AssetMetadata = { ...XLM, decimals: 0, symbol: "INT" };
    const result = roundAmount(1500n, 0, 2);
    expect(result.amount).toBe(150_000n); // 1500 * 100
  });

  it("should handle conversion to zero decimals", () => {
    const result = roundAmount(150_000n, 2, 0);
    expect(result.amount).toBe(1500n); // 150_000 / 100
  });

  it("should handle very large amounts", () => {
    const largeAmount = 9_999_999_999_999_999_999n; // near 2^63
    const result = roundAmount(largeAmount, 18, 7);
    expect(result.amount).toBeGreaterThan(0n);
  });

  it("should handle amount = 1 (minimum)", () => {
    const result = roundAmount(1n, 18, 7);
    expect(result.amount).toBe(0n); // 1 / 10^11 = 0
    expect(result.wasRounded).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { formatBytesPerSec, formatDuration, formatMB } from "./format";

describe("formatting", () => {
  it("scales byte rates", () => {
    expect(formatBytesPerSec(0)).toBe("0 B/s");
    expect(formatBytesPerSec(1536)).toBe("1.50 KB/s");
    expect(formatBytesPerSec(25 * 1024 * 1024)).toBe("25.0 MB/s");
    expect(formatBytesPerSec(300 * 1024 * 1024)).toBe("300 MB/s");
    expect(formatBytesPerSec(-1)).toBe("—");
    expect(formatBytesPerSec(NaN)).toBe("—");
  });
  it("formats durations", () => {
    expect(formatDuration(75)).toBe("1:15");
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe("3h 05m");
    expect(formatDuration(2 * 86400 + 3 * 3600)).toBe("2d 3h");
    expect(formatDuration(-3)).toBe("—");
  });
  it("formats memory sizes", () => {
    expect(formatMB(512)).toBe("512 MB");
    expect(formatMB(2048)).toBe("2.0 GB");
  });
});

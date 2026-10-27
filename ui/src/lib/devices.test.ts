import { describe, expect, it } from "vitest";
import { isBluetoothService, matchesQuery, otherDevices } from "./devices";

const bt = (name: string) => ({ name, kind: "Bluetooth", status: "OK" });

describe("device list tidying", () => {
  it("hides Bluetooth profiles and services but keeps real devices", () => {
    for (const n of ["Generic Access Profile", "Service Discovery Service", "Generic Attribute Profile", "JBL TUNE770NC Avrcp Transport", "Bluetooth LE Generic Attribute Service", "Microsoft Bluetooth LE Enumerator"]) expect(isBluetoothService(bt(n))).toBe(true);
    for (const n of ["ABIKM05 5.0 KB", "SoundPot", "User's iPhone"]) expect(isBluetoothService(bt(n))).toBe(false);
  });
  it("only hides profile-like names on Bluetooth entries", () => {
    expect(isBluetoothService({ name: "Speakers (Realtek Audio Profile)", kind: "AudioEndpoint", status: "OK" })).toBe(false);
  });
  it("drops Bluetooth entries already shown as paired devices, keeps everything else", () => {
    const present = [bt("SoundPot"), bt("Generic Access Profile"), { name: "Speakers (Realtek(R) Audio)", kind: "AudioEndpoint", status: "OK" }, bt("Unlisted Gadget")];
    const paired = [{ id: "1", name: "soundpot", paired: true, connected: true, kind: "classic" as const }];
    expect(otherDevices(present, paired).map((d) => d.name)).toEqual(["Speakers (Realtek(R) Audio)", "Unlisted Gadget"]);
    expect(otherDevices(null, paired)).toEqual([]);
    expect(otherDevices(present, null)).toHaveLength(3);
  });
  it("searches case-insensitively and ignores surrounding spaces", () => {
    expect(matchesQuery("JBL TUNE770NC", "  jbl ")).toBe(true);
    expect(matchesQuery("JBL", "")).toBe(true);
    expect(matchesQuery("JBL", "bose")).toBe(false);
  });
});

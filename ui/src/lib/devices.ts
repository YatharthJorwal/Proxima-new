import type { BtDevice, PresentDevice } from "../bridge/types";

/**
 * Windows lists every Bluetooth profile and service as its own "device"
 * ("Generic Access Profile", "… Avrcp Transport"). They are plumbing, not
 * things a person connects, so they are hidden from the device lists.
 */
const SERVICE_NAME = /(avrcp|a2dp|hands-?free|gatt|generic (access|attribute)|service discovery|device information|enumerator|rfcomm|\btransport\b|\bprofile\b)/i;

export const isBluetoothService = (d: PresentDevice): boolean => /bluetooth/i.test(d.kind) && SERVICE_NAME.test(d.name);

/** Devices Windows reports as present that are worth listing: no profiles, and nothing already shown as a paired Bluetooth device. */
export function otherDevices(present: PresentDevice[] | null | undefined, paired: BtDevice[] | null): PresentDevice[] {
  if (!present) return [];
  const pairedNames = new Set((paired ?? []).map((d) => d.name.toLowerCase()));
  return present.filter((d) => !isBluetoothService(d) && !(/bluetooth/i.test(d.kind) && pairedNames.has(d.name.toLowerCase())));
}

export const matchesQuery = (name: string, query: string): boolean => name.toLowerCase().includes(query.trim().toLowerCase());

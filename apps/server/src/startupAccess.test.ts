import { assert, expect, it } from "@effect/vitest";

import {
  buildPairingUrl,
  formatHeadlessServeOutput,
  renderTerminalQrCode,
  resolveHeadlessConnectionString,
  resolveListeningPort,
} from "./startupAccess.ts";

it("does not advertise an address when no phone-reachable host is configured", () => {
  expect(resolveHeadlessConnectionString(undefined, 3773)).toBeNull();
});

it("rejects wildcard and loopback bind hosts as phone destinations", () => {
  expect(resolveHeadlessConnectionString("0.0.0.0", 3773)).toBeNull();
  expect(resolveHeadlessConnectionString("::", 3773)).toBeNull();
  expect(resolveHeadlessConnectionString("127.0.0.1", 3773)).toBeNull();
  expect(resolveHeadlessConnectionString("::1", 3773)).toBeNull();
});

it("uses explicit LAN, Tailnet, forwarded, and IPv6 destinations", () => {
  expect(resolveHeadlessConnectionString("192.168.1.42", 3773)).toBe("http://192.168.1.42:3773");
  expect(resolveHeadlessConnectionString("100.64.0.7", 3773)).toBe("http://100.64.0.7:3773");
  expect(resolveHeadlessConnectionString("0.0.0.0", 3773, "https://code.example.com:8443/t3")).toBe(
    "https://code.example.com:8443/t3",
  );
  expect(resolveHeadlessConnectionString("::", 3773, "fd7a:115c:a1e0::1")).toBe(
    "http://[fd7a:115c:a1e0::1]:3773",
  );
});

it("never accepts a wildcard or loopback advertised host", () => {
  expect(resolveHeadlessConnectionString("0.0.0.0", 3773, "0.0.0.0")).toBeNull();
  expect(resolveHeadlessConnectionString("0.0.0.0", 3773, "http://localhost:3773")).toBeNull();
});

it("prefers the actual bound port when an http server address is available", () => {
  expect(resolveListeningPort({ port: 4123 }, 3773)).toBe(4123);
  expect(resolveListeningPort("pipe", 3773)).toBe(3773);
  expect(resolveListeningPort(null, 3773)).toBe(3773);
});

it("builds a pairing URL that embeds the token in the hash", () => {
  expect(buildPairingUrl("http://192.168.1.42:3773", "PAIRCODE")).toBe(
    "http://192.168.1.42:3773/pair#token=PAIRCODE",
  );
  expect(buildPairingUrl("https://code.example.com/t3", "PAIRCODE")).toBe(
    "https://code.example.com/t3/pair#token=PAIRCODE",
  );
});

it("explains how to repair a server without a phone destination and omits the qr code", () => {
  const output = formatHeadlessServeOutput({
    connectionString: null,
    token: "PAIRCODE",
    pairingUrl: null,
  });

  expect(output).toContain("--advertised-host");
  expect(output).not.toContain("Connection string:");
  assert.isFalse(output.includes("█") || output.includes("▀") || output.includes("▄"));
});

it("renders terminal QR codes as a multi-line unicode block grid", () => {
  const qrCode = renderTerminalQrCode("http://192.168.1.42:3773/pair#token=PAIRCODE");

  assert.isTrue(qrCode.includes("█"));
  assert.isTrue(qrCode.split("\n").length > 10);
});

it("formats headless serve output with the connection string, token, pairing url, and qr code", () => {
  const output = formatHeadlessServeOutput({
    connectionString: "http://192.168.1.42:3773",
    token: "PAIRCODE",
    pairingUrl: "http://192.168.1.42:3773/pair#token=PAIRCODE",
  });

  expect(output).toContain("Connection string: http://192.168.1.42:3773");
  expect(output).toContain("Token: PAIRCODE");
  expect(output).toContain("Pairing URL: http://192.168.1.42:3773/pair#token=PAIRCODE");
  assert.isTrue(output.includes("█") || output.includes("▀") || output.includes("▄"));
});

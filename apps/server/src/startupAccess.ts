import { QrCode } from "@t3tools/shared/qrCode";
import { buildTailscaleHttpsBaseUrl, readTailscaleStatus } from "@t3tools/tailscale";
import * as Effect from "effect/Effect";
import { HttpServer } from "effect/unstable/http";

import { ServerConfig } from "./config.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";

export interface HeadlessServeAccessInfo {
  readonly connectionString: string | null;
  readonly token: string;
  readonly pairingUrl: string | null;
}

export const isLoopbackHost = (host: string | undefined): boolean => {
  if (!host || host.length === 0) {
    return true;
  }

  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.")
  );
};

export const isWildcardHost = (host: string | undefined): boolean =>
  host === "0.0.0.0" || host === "::" || host === "[::]";

export const formatHostForUrl = (host: string): string =>
  host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

const normalizeHost = (host: string): string =>
  host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

const explicitAdvertisedUrl = (value: string, fallbackPort: number): URL | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const hasScheme = /^[A-Za-z][A-Za-z\d+.-]*:\/\//u.test(trimmed);
  const unbracketedIpv6 =
    !hasScheme &&
    !trimmed.startsWith("[") &&
    trimmed.includes(":") &&
    trimmed.split(":").length > 2;
  const candidate = hasScheme ? trimmed : `http://${unbracketedIpv6 ? `[${trimmed}]` : trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username.length > 0 || url.password.length > 0) return null;
    const hostname = normalizeHost(url.hostname);
    if (isWildcardHost(hostname) || isLoopbackHost(hostname)) return null;
    if (!hasScheme && url.port.length === 0) url.port = String(fallbackPort);
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
};

export const resolveHeadlessConnectionString = (
  host: string | undefined,
  port: number,
  advertisedHost?: string,
): string | null => {
  const selected = advertisedHost ?? host;
  if (!selected || isWildcardHost(selected) || isLoopbackHost(selected)) return null;

  const url = explicitAdvertisedUrl(selected, port);
  if (!url) return null;
  const value = url.toString();
  return url.pathname === "/" ? value.slice(0, -1) : value.replace(/\/+$/u, "");
};

export const resolveListeningPort = (address: unknown, fallbackPort: number): number => {
  if (
    typeof address === "object" &&
    address !== null &&
    "port" in address &&
    typeof address.port === "number"
  ) {
    return address.port;
  }
  return fallbackPort;
};

export const buildPairingUrl = (connectionString: string, token: string): string => {
  const url = new URL(connectionString);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/pair`;
  url.searchParams.delete("token");
  url.hash = new URLSearchParams([["token", token]]).toString();
  return url.toString();
};

export const renderTerminalQrCode = (value: string, margin = 2): string => {
  const qrCode = QrCode.encodeText(value, QrCode.Ecc.MEDIUM);
  const rows: Array<string> = [];
  const isDark = (x: number, y: number): boolean =>
    x >= 0 && x < qrCode.size && y >= 0 && y < qrCode.size && qrCode.getModule(x, y);

  for (let y = -margin; y < qrCode.size + margin; y += 2) {
    let row = "";

    for (let x = -margin; x < qrCode.size + margin; x += 1) {
      const topDark = isDark(x, y);
      const bottomDark = isDark(x, y + 1);

      row += topDark ? (bottomDark ? "█" : "▀") : bottomDark ? "▄" : " ";
    }

    rows.push(row);
  }

  return rows.join("\n");
};

export const formatHeadlessServeOutput = (accessInfo: HeadlessServeAccessInfo): string =>
  accessInfo.connectionString && accessInfo.pairingUrl
    ? [
        "T3 Code server is ready.",
        `Connection string: ${accessInfo.connectionString}`,
        `Token: ${accessInfo.token}`,
        `Pairing URL: ${accessInfo.pairingUrl}`,
        "",
        renderTerminalQrCode(accessInfo.pairingUrl),
        "",
      ].join("\n")
    : [
        "T3 Code server is ready.",
        `Token: ${accessInfo.token}`,
        "Pairing URL unavailable: the bind address is not a phone destination.",
        "Restart with --advertised-host set to an HTTP(S) address this phone can reach.",
        "",
      ].join("\n");

export const issueHeadlessServeAccessInfo = Effect.fn("issueHeadlessServeAccessInfo")(function* () {
  const serverConfig = yield* ServerConfig;
  const httpServer = yield* HttpServer.HttpServer;
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const tailscaleAdvertisedHost = serverConfig.tailscaleServeEnabled
    ? yield* readTailscaleStatus.pipe(
        Effect.map((status) =>
          status.magicDnsName
            ? buildTailscaleHttpsBaseUrl({
                magicDnsName: status.magicDnsName,
                servePort: serverConfig.tailscaleServePort,
              })
            : undefined,
        ),
        Effect.orElseSucceed(() => undefined),
      )
    : undefined;
  const connectionString = resolveHeadlessConnectionString(
    serverConfig.host,
    resolveListeningPort(httpServer.address, serverConfig.port),
    serverConfig.advertisedHost ?? tailscaleAdvertisedHost,
  );
  const issued = yield* serverAuth.issueStartupPairingCredential();

  return {
    connectionString,
    token: issued.credential,
    pairingUrl: connectionString ? buildPairingUrl(connectionString, issued.credential) : null,
  } satisfies HeadlessServeAccessInfo;
});

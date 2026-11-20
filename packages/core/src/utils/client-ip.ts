import { config } from "../config";
import type { AppContext } from "../types";
import { clientAddress } from "./client-address";

export type ClientAddressResolver = (c: AppContext) => string | undefined;

export function peerClientAddress(
  peer: (c: AppContext) => string | undefined,
): ClientAddressResolver {
  return (c) => clientAddress(peer(c), c.req.header("x-forwarded-for"), config.trustedProxies);
}

export const cloudflareClientAddress: ClientAddressResolver = (c) =>
  c.req.header("cf-connecting-ip");

export const defaultClientAddress: ClientAddressResolver = (c) => {
  const incoming = c.env?.incoming as { socket?: { remoteAddress?: string } } | undefined;
  const peer = incoming?.socket?.remoteAddress;
  if (peer === undefined) return cloudflareClientAddress(c);
  return clientAddress(peer, c.req.header("x-forwarded-for"), config.trustedProxies);
};

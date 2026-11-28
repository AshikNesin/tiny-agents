import type { SshEndpoint } from "./connection";

export interface SandboxMachine {
  readonly label: string;
  ready(): Promise<void>;
  dial(): Promise<SshEndpoint>;
}

export function sshMachine(endpoint: SshEndpoint): SandboxMachine {
  return {
    label: endpoint.host,
    async ready() {},
    async dial() {
      return endpoint;
    },
  };
}

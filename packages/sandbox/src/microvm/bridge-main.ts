import { writeFile } from "node:fs/promises";
import { createMicrovmBridge, MICROVM_BRIDGE_PORT } from "./bridge";

const AUTHORIZED_KEYS = "/etc/ssh/authorized-keys/exedev";

createMicrovmBridge({
  sshPort: 22,
  authorize: (publicKey) => writeFile(AUTHORIZED_KEYS, `${publicKey}\n`, { mode: 0o644 }),
}).listen(MICROVM_BRIDGE_PORT, "0.0.0.0");

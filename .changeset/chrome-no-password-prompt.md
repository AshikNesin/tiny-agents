---
"tiny-agents": patch
---

The sandbox browser no longer offers Chrome's "Save password?" prompt. A Chrome policy (`PasswordManagerEnabled: false`) is installed on VMs and in the local sandbox image, so sign-ins stay in the vault. Existing VMs pick it up on the next browser start, which reruns the browser stack install.

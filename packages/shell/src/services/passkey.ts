import { apiClient } from "@groot/shell/lib/api";
import { describeWebAuthnError } from "@groot/shell/lib/feedback";
import { startRegistration } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type { PasskeySummary } from "@groot/core/passkey/passkey.schema";

type Passkey = PasskeySummary;

class PasskeyService {
  async registerPasskey(credentialName?: string): Promise<Passkey> {
    try {
      const options = await apiClient.post<PublicKeyCredentialCreationOptionsJSON>(
        "/passkey/register/options",
      );

      if (!options) {
        throw new Error("Failed to get registration options");
      }

      const registrationResponse: RegistrationResponseJSON = await startRegistration({
        optionsJSON: options,
      });

      const passkey = await apiClient.post<Passkey>("/passkey/register/verify", {
        response: registrationResponse,
        credentialName,
      });

      if (!passkey) {
        throw new Error("Failed to verify registration");
      }

      return passkey;
    } catch (error: unknown) {
      const message = describeWebAuthnError(error);
      if (message) throw new Error(message, { cause: error });
      throw error;
    }
  }

  async listPasskeys(): Promise<Passkey[]> {
    const passkeys = await apiClient.get<Passkey[]>("/passkey/list");
    return passkeys || [];
  }

  async deletePasskey(passkeyId: number): Promise<void> {
    await apiClient.delete(`/passkey/${passkeyId}`);
  }

  async updatePasskeyName(passkeyId: number, credentialName: string): Promise<Passkey> {
    const passkey = await apiClient.patch<Passkey>(`/passkey/${passkeyId}`, {
      credentialName,
    });

    if (!passkey) {
      throw new Error("Failed to update passkey name");
    }

    return passkey;
  }
}

export const passkeyService = new PasskeyService();
export type { Passkey };

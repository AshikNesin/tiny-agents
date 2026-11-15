import type { Account } from "../../../../shared/api/models";
import type { ModelPickerOption } from "../../../components/ModelPicker";

/** Every model the owner could pick, grouped by account. */
export function modelOptions(
  accounts: Account[],
  type: "chat" | "classifier" = "chat",
): ModelPickerOption[] {
  return accounts.flatMap((account) =>
    account.models
      .filter((model) => model.type === type && model.enabled)
      .map((model) => ({
        id: model.id,
        label: model.name,
        group: account.name,
        keywords: [model.upstreamId],
      })),
  );
}

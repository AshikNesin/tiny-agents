import { z } from "zod";

export type PasskeyKind = "security-key" | "synced" | "device";

export interface PasskeySummary {
  id: number;
  credentialName: string | null;
  kind: PasskeyKind;
  label: string;
  backedUp: boolean;
  canDelete: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export const verifyRegistrationSchema = z.object({
  response: z.any(),
  credentialName: z.string().trim().min(1).max(100).optional(),
});

export const verifyAuthenticationSchema = z.object({
  response: z.any(),
});

export const generateAuthenticationOptionsSchema = z.object({
  email: z.email().trim().toLowerCase().optional(),
});

export const updatePasskeyNameSchema = z.object({
  credentialName: z
    .string()
    .trim()
    .min(1, "Passkey name must not be empty")
    .max(100, "Passkey name must be at most 100 characters"),
});

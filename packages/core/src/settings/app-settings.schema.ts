import { z } from "zod";

export const upsertAppSettingSchema = z.object({
  value: z.unknown(),
  metadata: z
    .object({
      description: z.string().optional(),
    })
    .optional(),
});

export type UpsertAppSettingDTO = z.infer<typeof upsertAppSettingSchema>;

export const createAppSettingSchema = upsertAppSettingSchema.extend({
  key: z.string().trim().min(1, "Key is required"),
});

export type CreateAppSettingDTO = z.infer<typeof createAppSettingSchema>;

export interface AppSettingMetadata {
  description?: string;
  updatedAt: string;
}

export interface AppSetting<T = unknown> {
  key: string;
  value: T;
  metadata?: AppSettingMetadata;
}

import { z } from "zod";

const url = z.string().trim().url("Enter the server's URL").max(2000);
const headerName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]+$/, "Header names use letters, digits and hyphens")
  .max(100);
const secret = z.string().min(1).max(8000);

export const createConnectionSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(60),
    url,
    transport: z.enum(["streamable-http", "sse"]).optional().default("streamable-http"),
    authType: z.enum(["none", "header", "oauth"]).optional().default("none"),
    headerName: headerName.optional(),
    secret: secret.optional(),
    /** Pre-registered OAuth client, for servers without automatic registration. */
    clientId: z.string().trim().min(1).max(500).optional(),
    clientSecret: z.string().min(1).max(2000).optional(),
    botIds: z.array(z.string()).max(200).optional(),
  })
  .refine((v) => v.authType !== "header" || (v.headerName && v.secret), {
    message: "Header auth needs a header name and value",
    path: ["secret"],
  });

export const updateConnectionSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  url: url.optional(),
  headerName: headerName.optional(),
  /** Replaces the stored header value. */
  secret: secret.optional(),
  botIds: z.array(z.string()).max(200).optional(),
});

export const testConnectionSchema = z.object({
  url,
  transport: z.enum(["streamable-http", "sse"]).optional().default("streamable-http"),
  headerName: headerName.optional(),
  secret: secret.optional(),
});

export type CreateConnectionDTO = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionDTO = z.infer<typeof updateConnectionSchema>;
export type TestConnectionDTO = z.infer<typeof testConnectionSchema>;

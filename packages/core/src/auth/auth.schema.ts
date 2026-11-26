import { z } from "zod";

const emailField = z.email("Invalid email address");
const passwordField = z.string().min(6, "Password must be at least 6 characters");

export const loginSchema = z.object({
  email: emailField,
  password: passwordField,
});

export type LoginDTO = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({
  email: emailField,
  password: passwordField,
  name: z.string().min(1, "Name is required").optional(),
});

export type CreateUserDTO = z.infer<typeof createUserSchema>;

export interface SessionUser {
  id: number;
  email: string;
  name: string | null;

  isAdmin: boolean;
}

export interface SignInResponse {
  token: string;
  user: SessionUser;
}

export interface SetupStatus {
  needsSetup: boolean;
}

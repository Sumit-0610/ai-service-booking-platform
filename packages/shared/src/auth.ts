import { z } from 'zod';

/**
 * Shared authentication contracts. Used by the API to validate requests and by
 * the web client to validate forms and type responses. No server-only logic
 * lives here.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const roleSchema = z.enum(['customer', 'operations', 'technician']);
export type Role = z.infer<typeof roleSchema>;

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

export const registerInputSchema = z
  .object({
    email: emailSchema,
    // Registration is self-service and only ever creates customers. Staff
    // accounts are provisioned out of band.
    name: z.string().trim().min(1).max(100),
    password: passwordSchema,
  })
  .strict()
  .refine((value) => !value.password.toLowerCase().includes(value.email.split('@')[0] ?? ''), {
    message: 'Password must not contain your email name',
    path: ['password'],
  });
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();
export type LoginInput = z.infer<typeof loginInputSchema>;

/** The safe view of a user. Never includes the password hash. */
export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const authMeResponseSchema = z.object({ user: sessionUserSchema });
export type AuthMeResponse = z.infer<typeof authMeResponseSchema>;

/** Consistent API error envelope (see docs/api.md). */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

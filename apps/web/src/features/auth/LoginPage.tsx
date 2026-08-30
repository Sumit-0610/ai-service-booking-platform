import { useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { loginInputSchema, type LoginInput } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { useAuth } from './AuthProvider';

export function LoginPage(): ReactElement {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginInputSchema) });

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values);
      navigate('/', { replace: true });
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
    }
  });

  return (
    <main className="auth-shell">
      <h1>Log in</h1>
      <form onSubmit={onSubmit} noValidate>
        {formError ? (
          <p role="alert" className="form-error">
            {formError}
          </p>
        ) : null}

        <label>
          Email
          <input type="email" autoComplete="email" {...register('email')} />
        </label>
        {errors.email ? <span role="alert">{errors.email.message}</span> : null}

        <label>
          Password
          <input type="password" autoComplete="current-password" {...register('password')} />
        </label>
        {errors.password ? <span role="alert">{errors.password.message}</span> : null}

        <button type="submit" disabled={isSubmitting}>
          Log in
        </button>
      </form>
      <p>
        Need an account? <Link to="/register">Register</Link>
      </p>
    </main>
  );
}

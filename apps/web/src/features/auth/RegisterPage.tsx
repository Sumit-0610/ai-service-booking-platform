import { useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { registerInputSchema, type RegisterInput } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { useAuth } from './AuthProvider';

export function RegisterPage(): ReactElement {
  const { register: registerUser, status } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerInputSchema) });

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await registerUser(values);
      navigate('/', { replace: true });
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
    }
  });

  return (
    <main className="auth-shell">
      <h1>Create an account</h1>
      <form onSubmit={onSubmit} noValidate>
        {formError ? (
          <p role="alert" className="form-error">
            {formError}
          </p>
        ) : null}

        <label>
          Name
          <input type="text" autoComplete="name" {...register('name')} />
        </label>
        {errors.name ? <span role="alert">{errors.name.message}</span> : null}

        <label>
          Email
          <input type="email" autoComplete="email" {...register('email')} />
        </label>
        {errors.email ? <span role="alert">{errors.email.message}</span> : null}

        <label>
          Password
          <input type="password" autoComplete="new-password" {...register('password')} />
        </label>
        {errors.password ? <span role="alert">{errors.password.message}</span> : null}

        <button type="submit" disabled={isSubmitting}>
          Register
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}

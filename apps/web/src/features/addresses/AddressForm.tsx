import { useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  COMMON_COUNTRIES,
  createAddressSchema,
  type Address,
  type CreateAddressInput,
} from '@aisbp/shared';
import { ApiError } from '../../lib/api';

interface FieldConfig {
  name: keyof CreateAddressInput;
  label: string;
  autoComplete?: string;
  optional?: boolean;
}

const FIELDS: FieldConfig[] = [
  { name: 'label', label: 'Label (e.g. Home, Office)' },
  { name: 'line1', label: 'Address line 1', autoComplete: 'address-line1' },
  { name: 'line2', label: 'Address line 2', autoComplete: 'address-line2', optional: true },
  { name: 'city', label: 'City', autoComplete: 'address-level2' },
  { name: 'state', label: 'State / region', autoComplete: 'address-level1' },
  { name: 'postalCode', label: 'Postal code', autoComplete: 'postal-code' },
];

type AddressFormValues = {
  label: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

function toFormValues(address?: Address): AddressFormValues {
  return {
    label: address?.label ?? '',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    city: address?.city ?? '',
    state: address?.state ?? '',
    postalCode: address?.postalCode ?? '',
    country: address?.country ?? 'IN',
  };
}

export function AddressForm({
  address,
  onSubmit,
  onCancel,
}: {
  address?: Address;
  onSubmit: (values: CreateAddressInput) => Promise<void>;
  onCancel: () => void;
}): ReactElement {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createAddressSchema),
    defaultValues: toFormValues(address) as AddressFormValues,
  });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(values as CreateAddressInput);
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Could not save the address. Please try again.',
      );
    }
  });

  return (
    <form
      onSubmit={submit}
      noValidate
      className="rounded-2xl border border-slate-200 bg-white p-5"
      aria-label={address ? 'Edit address' : 'Add address'}
    >
      {formError ? (
        <p role="alert" className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {formError}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label
            key={field.name}
            className="flex flex-col gap-1 text-sm font-medium text-slate-700"
          >
            {field.label}
            {field.optional ? (
              <span className="font-normal text-slate-400"> (optional)</span>
            ) : null}
            <input
              type="text"
              autoComplete={field.autoComplete}
              {...register(field.name)}
              className="rounded-lg border border-slate-300 px-3 py-2 font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            />
            {errors[field.name] ? (
              <span role="alert" className="font-normal text-rose-600">
                {errors[field.name]?.message}
              </span>
            ) : null}
          </label>
        ))}

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Country
          <select
            {...register('country')}
            className="rounded-lg border border-slate-300 px-3 py-2 font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
          >
            {COMMON_COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
          {errors.country ? (
            <span role="alert" className="font-normal text-rose-600">
              {errors.country.message}
            </span>
          ) : null}
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {address ? 'Save changes' : 'Add address'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

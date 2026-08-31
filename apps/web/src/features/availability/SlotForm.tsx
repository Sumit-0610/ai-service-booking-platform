import { useEffect, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { TechnicianSlot } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { catalogueApi } from '../catalogue/catalogue-api';
import type { SlotBody } from './availability-api';

interface ServiceOption {
  slug: string;
  name: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toLocalDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Combine a local date + local time into a UTC ISO instant. */
function toIso(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

const slotFormSchema = z
  .object({
    serviceSlug: z.string().min(1, 'Choose a service'),
    date: z.string().min(1, 'Choose a date'),
    startTime: z.string().min(1, 'Choose a start time'),
    endTime: z.string().min(1, 'Choose an end time'),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: 'The end time must be after the start time',
    path: ['endTime'],
  })
  .refine((v) => new Date(`${v.date}T${v.startTime}`).getTime() > Date.now(), {
    message: 'The start time must be in the future',
    path: ['date'],
  });

type SlotFormValues = z.infer<typeof slotFormSchema>;

export function SlotForm({
  slot,
  onSubmit,
  onCancel,
}: {
  slot?: TechnicianSlot;
  onSubmit: (body: SlotBody) => Promise<void>;
  onCancel: () => void;
}): ReactElement {
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SlotFormValues>({
    resolver: zodResolver(slotFormSchema),
    defaultValues: {
      serviceSlug: slot?.service.slug ?? '',
      date: slot ? toLocalDateInput(slot.startsAt) : '',
      startTime: slot ? toLocalTimeInput(slot.startsAt) : '09:00',
      endTime: slot ? toLocalTimeInput(slot.endsAt) : '10:00',
    },
  });

  useEffect(() => {
    let active = true;
    catalogueApi
      .listServices({ limit: 48, sort: 'name_asc' })
      .then((response) => {
        if (!active) return;
        const options = response.items.map((s) => ({ slug: s.slug, name: s.name }));
        setServices(options);
        if (!slot && options[0]) {
          setValue('serviceSlug', options[0].slug);
        }
      })
      .catch(() => {
        /* the select stays empty; submit surfaces the error */
      });
    return () => {
      active = false;
    };
  }, [slot, setValue]);

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit({
        serviceSlug: values.serviceSlug,
        startsAt: toIso(values.date, values.startTime),
        endsAt: toIso(values.date, values.endTime),
      });
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Could not save the slot. Please try again.',
      );
    }
  });

  const fieldClass =
    'rounded-lg border border-slate-300 px-3 py-2 font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';
  const errorText = (message?: string) =>
    message ? (
      <span role="alert" className="text-xs font-normal text-rose-600">
        {message}
      </span>
    ) : null;

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-slate-200 bg-white p-5"
      aria-label={slot ? 'Edit availability' : 'Add availability'}
      noValidate
    >
      {formError ? (
        <p role="alert" className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {formError}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 sm:col-span-2">
          Service
          <select {...register('serviceSlug')} className={fieldClass}>
            {services.length === 0 ? <option value="">Loading services…</option> : null}
            {services.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
          {errorText(errors.serviceSlug?.message)}
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Date
          <input type="date" {...register('date')} className={fieldClass} />
          {errorText(errors.date?.message)}
        </label>
        <span className="hidden sm:block" />

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Start time
          <input type="time" {...register('startTime')} className={fieldClass} />
          {errorText(errors.startTime?.message)}
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          End time
          <input type="time" {...register('endTime')} className={fieldClass} />
          {errorText(errors.endTime?.message)}
        </label>
      </div>

      <p className="mt-2 text-xs text-slate-400">Enter times in your local timezone.</p>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {slot ? 'Save changes' : 'Add slot'}
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

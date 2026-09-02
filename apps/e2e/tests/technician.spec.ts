import { expect, test } from '@playwright/test';
import {
  SEED,
  apiRegisterCustomer,
  bookFirstSlot,
  confirmAndAssign,
  uiLogin,
  uniqueEmail,
} from './helpers';

test('technician moves an assigned job through in_progress to completed', async ({
  page,
  request,
}) => {
  // Setup: customer books a Wi-Fi mesh slot; operations confirms and assigns Tomas.
  const customer = await apiRegisterCustomer(request, uniqueEmail('tech-customer'));
  const bookingId = await bookFirstSlot(request, customer, SEED.wifiMeshSlug);
  await confirmAndAssign(request, bookingId, /tomas/i);

  // "Mark complete" asks for confirmation via window.confirm.
  page.on('dialog', (dialog) => dialog.accept());

  await uiLogin(page, SEED.technicianTomas);

  await page.goto('/technician/bookings');
  await expect(page.getByRole('heading', { name: 'Your jobs' })).toBeVisible();
  await expect(page.locator('li', { hasText: SEED.wifiMeshName }).first()).toBeVisible();

  // Open this run's job directly (the shared DB may hold other Wi-Fi jobs).
  await page.goto(`/technician/bookings/${bookingId}`);
  await expect(page.getByRole('heading', { level: 1, name: SEED.wifiMeshName })).toBeVisible();
  await expect(page.getByText('assigned', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Start job' }).click();
  await expect(page.getByText('in progress', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByText('completed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start job|Mark complete/ })).toHaveCount(0);
});

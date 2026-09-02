import { expect, test } from '@playwright/test';
import { SEED, apiRegisterCustomer, bookFirstSlot, uiLogin, uniqueEmail } from './helpers';

test('operations confirms a pending booking and assigns a qualified technician', async ({
  page,
  request,
}) => {
  // Setup: a fresh customer books a Wi-Fi mesh slot (on Tara's calendar).
  const customer = await apiRegisterCustomer(request, uniqueEmail('ops-customer'));
  const bookingId = await bookFirstSlot(request, customer, SEED.wifiMeshSlug);

  await uiLogin(page, SEED.operations);

  await page.goto('/operations');
  await expect(page.getByRole('heading', { name: 'Operations dashboard' })).toBeVisible();

  // Open the booking from the queue.
  const row = page.getByRole('row', { name: new RegExp(SEED.wifiMeshName) }).first();
  await row.getByRole('link', { name: 'View' }).click();
  await expect(page).toHaveURL(new RegExp(`/operations/bookings/${bookingId}$`));
  await expect(page.getByText('pending', { exact: true })).toBeVisible();

  // Confirm it.
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('confirmed', { exact: true })).toBeVisible();

  // Reassign to Tomas (also qualified for Wi-Fi mesh in the E2E fixture).
  const assignment = page.getByRole('region', { name: 'Technician assignment' });
  await expect(assignment).toBeVisible();
  await assignment.getByLabel('Technician').selectOption({ label: 'Tomas Field' });
  await assignment.getByRole('button', { name: 'Assign' }).click();
  await expect(assignment.getByRole('status')).toContainText(/assigned/i);
  await expect(page.getByText('assigned', { exact: true })).toBeVisible();
  await expect(page.getByText('Tomas Field', { exact: true })).toBeVisible();
});

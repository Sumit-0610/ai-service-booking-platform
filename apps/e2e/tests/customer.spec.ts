import { expect, test } from '@playwright/test';
import { SEED_PASSWORD, bookFirstSlotViaUi, uniqueEmail } from './helpers';

test('customer registers, adds an address, books a service, then cancels it', async ({ page }) => {
  const email = uniqueEmail('customer');

  // Register through the UI.
  await page.goto('/register');
  await page.getByLabel('Name').fill('E2E Customer');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL('/');

  // Browse the catalogue and open a service.
  await expect(page.getByRole('heading', { name: 'Service catalogue' })).toBeVisible();
  await page
    .getByRole('link', { name: /washing machine installation/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/services\/washing-machine-installation/);
  await expect(
    page.getByRole('heading', { level: 1, name: /washing machine installation/i }),
  ).toBeVisible();

  // Booking needs an address first.
  await expect(page.getByRole('heading', { name: 'Availability' })).toBeVisible();
  await page.getByRole('link', { name: 'Add an address' }).click();
  await expect(page).toHaveURL(/\/account\/addresses/);
  await page.getByRole('button', { name: 'Add address' }).click();

  const form = page.locator('form[aria-label="Add address"]');
  await form.getByRole('textbox', { name: 'Label (e.g. Home, Office)' }).fill('Home');
  await form.getByRole('textbox', { name: 'Address line 1' }).fill('1 E2E Street');
  await form.getByRole('textbox', { name: 'City' }).fill('Pune');
  await form.getByRole('textbox', { name: 'State / region' }).fill('Maharashtra');
  await form.getByRole('textbox', { name: 'Postal code' }).fill('411001');
  await form.getByRole('button', { name: 'Add address' }).click();
  await expect(page.getByRole('status')).toContainText(/added/i);

  // Back to the service, pick a slot, confirm.
  await page.goto('/services/washing-machine-installation');
  await bookFirstSlotViaUi(page);

  // It appears in the account, with a cancel action.
  await page.goto('/account/bookings');
  const card = page.locator('li', { hasText: 'Washing Machine Installation' }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText('pending', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(card.getByText('cancelled', { exact: true })).toBeVisible();
});

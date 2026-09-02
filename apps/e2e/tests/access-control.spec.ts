import { expect, test } from '@playwright/test';
import { SEED, apiRegisterCustomer, uiLogin, uniqueEmail } from './helpers';

test('role guards keep users out of areas they do not own', async ({ page, request }) => {
  const email = uniqueEmail('rbac-customer');
  await apiRegisterCustomer(request, email);
  await uiLogin(page, email);

  // A customer cannot see operations or technician areas.
  await page.goto('/operations');
  await expect(page.getByRole('alert')).toContainText(/do not have access/i);

  await page.goto('/technician/bookings');
  await expect(page.getByRole('alert')).toContainText(/do not have access/i);
});

test('an anonymous visitor is redirected from a protected route to login', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/account/bookings');
  await expect(page).toHaveURL(/\/login/);
});

test('operations cannot use the customer-only assistant', async ({ page }) => {
  await uiLogin(page, SEED.operations);
  await page.goto('/assistant');
  await expect(page.getByRole('alert')).toContainText(/do not have access/i);
});

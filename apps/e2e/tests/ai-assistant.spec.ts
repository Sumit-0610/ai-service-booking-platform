import { expect, test } from '@playwright/test';
import {
  addAddress,
  apiRegisterCustomer,
  bookFirstSlotViaUi,
  uiLogin,
  uniqueEmail,
} from './helpers';

test('AI assistant drafts a booking intent and hands off to the normal booking flow', async ({
  page,
  request,
}) => {
  const email = uniqueEmail('ai-customer');
  const session = await apiRegisterCustomer(request, email);
  await addAddress(request, session); // the assistant needs a saved address to ground

  await uiLogin(page, email);

  await page.goto('/assistant');
  await expect(page.getByRole('heading', { name: 'Booking assistant' })).toBeVisible();

  await page
    .getByLabel('Message the booking assistant')
    .fill('I need my washing machine installed tomorrow at home');
  await page.getByRole('button', { name: 'Send' }).click();

  // The stubbed assistant grounds a complete intent and offers the handoff.
  const draft = page.locator('section', { hasText: 'Draft booking' });
  await expect(draft.getByRole('heading', { name: 'Draft booking' })).toBeVisible();
  await expect(draft.getByText('Washing Machine Installation', { exact: true })).toBeVisible();

  const handoff = page.getByRole('link', { name: /Review & book/ });
  await expect(handoff).toBeVisible();
  await handoff.click();

  // Lands on the real service page — booking still goes through normal validation.
  await expect(page).toHaveURL(/\/services\/washing-machine-installation/);
  await bookFirstSlotViaUi(page);

  await page.goto('/account/bookings');
  await expect(
    page.locator('li', { hasText: 'Washing Machine Installation' }).first(),
  ).toBeVisible();
});

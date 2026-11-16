import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`trunk dialog add, retry and remove in ${theme}`, async ({ page }) => {
    await page.goto('/tests/fixture.html');
    await page.evaluate(async theme => {
      document.documentElement.dataset.theme = theme;
      const { mountTrunkDialog } = await import('/src/trunk-dialog.js');
      const { createMockTrunkApi } = await import('/src/mock-trunk-api.js');
      const root = document.getElementById('app');
      root.innerHTML = '<header class="titlebar"></header>';
      mountTrunkDialog(root, createMockTrunkApi());
    }, theme);
    const launcher = page.getByRole('button', { name: 'Транки', exact: true });
    await launcher.focus();
    await launcher.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'SIP-транки' });
    await expect(dialog.getByText('Транков пока нет.')).toBeVisible();
    await dialog.getByLabel('SIP-логин').fill('fixture');
    const password = dialog.getByLabel('SIP-пароль');
    await password.fill('fixture-secret');
    await password.press('Enter');
    await expect(password).toHaveValue('');
    await expect(dialog.getByText('Регистрация недоступна', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Повторить подключение' }).click();
    await expect(dialog.getByText('Регистрация недоступна', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Удалить транк' }).click();
    await expect(dialog.getByText('Транков пока нет.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(launcher).toBeFocused();
  });
}

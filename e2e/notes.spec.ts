import { expect, test } from '@playwright/test'
test('Notes guidance and file contents remain reachable on a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Notes', exact: true }).click()
  const notes = page.getByRole('region', { name: 'Notes window' })
  await expect(
    notes.getByText('Open a text file from Files to read it in Notes.'),
  ).toBeVisible()
  await notes.getByRole('button', { name: 'Close Notes', exact: true }).click()
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files.getByRole('button', { name: 'New file' }).click()
  const dialog = page.getByRole('dialog', { name: 'New file' })
  await dialog.getByRole('textbox').fill('mobile.txt')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden()
  await files.getByRole('button', { name: 'Open', exact: true }).click()
  const contents = notes.getByRole('region', { name: 'File contents' })
  await expect(contents).toBeInViewport()
  await contents.focus()
  await expect(contents).toBeFocused()
  await expect(
    notes.getByRole('button', { name: 'Close Notes', exact: true }),
  ).toBeInViewport()
})

// spec: App-initiated rename/delete of an OPEN file must not surface as an
// "externally deleted" notification (the file watcher's unlink is our own).
// seed: tests/open-folder.spec.ts

import { test as base, expect, stubConfirmDialog } from './fixtures'
import { _electron as electron, ElectronApplication } from 'playwright'
import path from 'path'
import os from 'os'
import fs from 'fs'

const test = base.extend<{ electronApp: ElectronApplication }>({
  electronApp: async ({}, use) => {
    const app = await electron.launch({
      args: [path.resolve(__dirname, '../out/main/index.js')],
      env: { ...process.env, E2E_TEST: '1', NODE_ENV: 'test' },
      timeout: 15_000,
    })
    await use(app)
    await app.close()
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForSelector('[data-testid="app"]', { timeout: 10_000 })
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('menu:file-new')
    })
    await page.waitForSelector('.monaco-editor textarea', { timeout: 10_000 })
    await page.waitForSelector('[data-testid="tabbar"] [data-tab-title]', { timeout: 5_000 })
    await use(page)
  },
})

async function sendIPC(electronApp: ElectronApplication, channel: string, ...args: unknown[]) {
  await electronApp.evaluate(
    ({ BrowserWindow }, { ch, a }) =>
      BrowserWindow.getAllWindows()[0].webContents.send(ch, ...(a as unknown[])),
    { ch: channel, a: args }
  )
}

async function openFolder(electronApp: ElectronApplication, page: import('playwright').Page, dir: string) {
  await sendIPC(electronApp, 'ui:toggle-sidebar', true)
  await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
  await sendIPC(electronApp, 'menu:folder-open', dir)
}

const menuItem = (page: import('playwright').Page, name: string) =>
  page.getByRole('menuitem', { name })

const deletedToast = (page: import('playwright').Page) => page.getByText(/was deleted from disk/)

test.describe('File-tree action notifications', () => {
  test('renaming an OPEN file updates its tab and shows no "deleted" toast', async ({ electronApp, page }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-rename-open-'))
    fs.writeFileSync(path.join(tmpDir, 'before.txt'), 'hi')

    try {
      await openFolder(electronApp, page, tmpDir)
      const sidebar = page.locator('[data-testid="sidebar"]')
      await expect(sidebar.getByText('before.txt')).toBeVisible({ timeout: 3_000 })

      // Open it so the file is watched and has a tab.
      await sidebar.getByText('before.txt').click()
      await page.locator('[data-tab-title="before.txt"]').waitFor({ state: 'visible', timeout: 5_000 })

      // Rename via the inline editor.
      await sidebar.getByText('before.txt').click({ button: 'right' })
      await menuItem(page, 'Rename').click()
      const input = page.locator('[data-testid="inline-edit-input"]')
      await expect(input).toBeVisible({ timeout: 2_000 })
      await input.fill('after.txt')
      await input.press('Enter')

      // Tab repoints to the new name.
      await page.locator('[data-tab-title="after.txt"]').waitFor({ state: 'visible', timeout: 5_000 })
      await expect(page.locator('[data-tab-title="before.txt"]')).not.toBeVisible()

      // Give the watcher time to (not) fire — assert no deletion toast appears.
      await page.waitForTimeout(1_500)
      await expect(deletedToast(page)).not.toBeVisible()
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('deleting an OPEN file shows no "deleted from disk" toast', async ({ electronApp, page }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-delete-open-'))
    fs.writeFileSync(path.join(tmpDir, 'doomed.txt'), 'bye')

    try {
      await openFolder(electronApp, page, tmpDir)
      const sidebar = page.locator('[data-testid="sidebar"]')
      await expect(sidebar.getByText('doomed.txt')).toBeVisible({ timeout: 3_000 })

      await sidebar.getByText('doomed.txt').click()
      await page.locator('[data-tab-title="doomed.txt"]').waitFor({ state: 'visible', timeout: 5_000 })

      // Auto-confirm the delete. The prompt is a native main-process message
      // box, so it must be stubbed there — not via window.confirm.
      await stubConfirmDialog(electronApp, 'confirm')

      await sidebar.getByText('doomed.txt').click({ button: 'right' })
      await menuItem(page, 'Delete').click()

      // Row disappears from the tree (deletion happened)…
      await expect(sidebar.getByText('doomed.txt')).not.toBeVisible({ timeout: 3_000 })
      expect(fs.existsSync(path.join(tmpDir, 'doomed.txt'))).toBe(false)

      // …but the watcher's unlink must not surface as an external deletion.
      await page.waitForTimeout(1_500)
      await expect(deletedToast(page)).not.toBeVisible()
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

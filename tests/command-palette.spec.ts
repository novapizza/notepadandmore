// spec: Command Palette — command mode (Ctrl+Shift+P) and file mode (Ctrl+E)
// seed: tests/quick-open.spec.ts (this file replaces it; file mode is the old
// Quick Open behaviour, which must be preserved exactly)

import { test as base, expect } from './fixtures'
import { _electron as electron, ElectronApplication } from 'playwright'
import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * ELECTRON_RUN_AS_NODE must be cleared or electron.exe boots as plain Node and
 * every launch fails with "Process failed to launch!" — see fixtures.ts. This
 * spec can't just use the shared fixtures: it needs `electronApp` and `page` to
 * be the *same* instance so it can drive native-menu IPC at the window under test.
 */
function makeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, E2E_TEST: '1', NODE_ENV: 'test' }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

const test = base.extend<{ electronApp: ElectronApplication }>({
  electronApp: async ({}, use) => {
    const app = await electron.launch({
      args: [path.resolve(__dirname, '../out/main/index.js')],
      env: makeEnv(),
      timeout: 15_000,
    })
    await use(app)
    await app.close()
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForSelector('[data-testid="app"]', { timeout: 10_000 })
    // E2E mode skips session restore, so seed an untitled buffer to leave the
    // WelcomeScreen (same as the base fixture's seedInitialBuffer).
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('menu:file-new')
    })
    await page.waitForSelector('.monaco-editor textarea', { timeout: 10_000 })
    await page.waitForSelector('[data-testid="tabbar"] [data-tab-title]', { timeout: 5_000 })
    await use(page)
  },
})

// IPC helper — fires the channels the native Search menu items send.
async function sendIPC(electronApp: ElectronApplication, channel: string, ...args: unknown[]) {
  await electronApp.evaluate(
    ({ BrowserWindow }, { ch, a }) =>
      BrowserWindow.getAllWindows()[0].webContents.send(ch, ...(a as unknown[])),
    { ch: channel, a: args }
  )
}

test.describe('Command palette — file mode (Ctrl+E)', () => {
  test('opens via menu:goto-file and focuses the input', async ({ electronApp, page }) => {
    await sendIPC(electronApp, 'menu:goto-file')

    const palette = page.locator('[data-testid="command-palette"]')
    await expect(palette).toBeVisible({ timeout: 3_000 })
    await expect(palette).toHaveAttribute('data-mode', 'files')
    await expect(page.locator('[data-testid="command-palette-input"]')).toBeFocused()
  })

  test('with no folder open, shows the "open a folder" hint', async ({ electronApp, page }) => {
    await sendIPC(electronApp, 'menu:goto-file')
    await expect(page.locator('[data-testid="command-palette"]')).toBeVisible({ timeout: 3_000 })
    await expect(page.getByText('No folder is open.')).toBeVisible()
    await expect(page.locator('[data-testid="command-palette-file"]')).toHaveCount(0)
  })

  test('Escape closes the palette', async ({ electronApp, page }) => {
    await sendIPC(electronApp, 'menu:goto-file')
    const palette = page.locator('[data-testid="command-palette"]')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    await page.locator('[data-testid="command-palette-input"]').press('Escape')
    await expect(palette).not.toBeVisible()
  })

  test('fuzzy-filters files in the open folder and opens the chosen one with Enter', async ({ electronApp, page }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-palette-'))
    fs.writeFileSync(path.join(tmpDir, 'alpha.txt'), 'a')
    fs.writeFileSync(path.join(tmpDir, 'beta.md'), 'b')
    fs.mkdirSync(path.join(tmpDir, 'nested'))
    fs.writeFileSync(path.join(tmpDir, 'nested', 'config-loader.ts'), 'c')

    try {
      // Set the workspace folder, then open the palette.
      await sendIPC(electronApp, 'menu:folder-open', tmpDir)
      await page.waitForTimeout(300)
      await sendIPC(electronApp, 'menu:goto-file')

      const input = page.locator('[data-testid="command-palette-input"]')
      await expect(input).toBeVisible({ timeout: 3_000 })

      // Empty query lists files (recursive — includes the nested file).
      await expect(page.locator('[data-testid="command-palette-file"]')).not.toHaveCount(0, { timeout: 3_000 })

      // Fuzzy subsequence "cl" should surface config-loader.ts (nested) as a match.
      await input.fill('cl')
      const results = page.locator('[data-testid="command-palette-file"]')
      await expect(results.first()).toContainText('config-loader.ts', { timeout: 3_000 })

      // Enter opens the top result as a tab and closes the palette.
      await input.press('Enter')
      await page.locator('[data-tab-title="config-loader.ts"]').waitFor({ state: 'visible', timeout: 5_000 })
      await expect(page.locator('[data-testid="command-palette"]')).not.toBeVisible()
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('clicking a result opens it', async ({ electronApp, page }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-palette-click-'))
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'hi')

    try {
      await sendIPC(electronApp, 'menu:folder-open', tmpDir)
      await page.waitForTimeout(300)
      await sendIPC(electronApp, 'menu:goto-file')

      const input = page.locator('[data-testid="command-palette-input"]')
      await expect(input).toBeVisible({ timeout: 3_000 })
      await input.fill('readme')

      const row = page.locator('[data-testid="command-palette-file"]').filter({ hasText: 'readme.txt' }).first()
      await expect(row).toBeVisible({ timeout: 3_000 })
      await row.click()

      await page.locator('[data-tab-title="readme.txt"]').waitFor({ state: 'visible', timeout: 5_000 })
      await expect(page.locator('[data-testid="command-palette"]')).not.toBeVisible()
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

test.describe('Command palette — command mode (Ctrl+Shift+P)', () => {
  test('opens in command mode, prefilled with ">", and lists commands', async ({ electronApp, page }) => {
    await sendIPC(electronApp, 'menu:command-palette')

    const palette = page.locator('[data-testid="command-palette"]')
    await expect(palette).toBeVisible({ timeout: 3_000 })
    await expect(palette).toHaveAttribute('data-mode', 'commands')

    const input = page.locator('[data-testid="command-palette-input"]')
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('>')
    await expect(page.locator('[data-testid="command-palette-command"]')).not.toHaveCount(0)
  })

  test('fuzzy-filters commands by label and shows their binding', async ({ electronApp, page }) => {
    await sendIPC(electronApp, 'menu:command-palette')
    const input = page.locator('[data-testid="command-palette-input"]')
    await expect(input).toBeVisible({ timeout: 3_000 })

    await input.fill('>dup')
    const rows = page.locator('[data-testid="command-palette-command"]')
    await expect(rows.first()).toContainText('Duplicate Line', { timeout: 3_000 })
    // The row teaches the shortcut, formatted for the platform.
    await expect(rows.first()).toContainText(process.platform === 'darwin' ? '⌘D' : 'Ctrl+D')
  })

  test('matches on section and keywords, not just the label', async ({ electronApp, page }) => {
    await sendIPC(electronApp, 'menu:command-palette')
    const input = page.locator('[data-testid="command-palette-input"]')
    await expect(input).toBeVisible({ timeout: 3_000 })

    // "charset" appears in no command label — only in the encoding commands'
    // keywords, so finding them at all proves keywords are searched. Asserting
    // presence rather than rank: fuzzyFilter scores every path match, so which
    // keyword hit ranks first is not part of the contract.
    await input.fill('>charset')
    await expect(
      page.locator('[data-testid="command-palette-command"]').filter({ hasText: 'Encode in UTF-8' }).first()
    ).toBeVisible({ timeout: 3_000 })
  })

  test('a query matching nothing says so', async ({ electronApp, page }) => {
    await sendIPC(electronApp, 'menu:command-palette')
    const input = page.locator('[data-testid="command-palette-input"]')
    await expect(input).toBeVisible({ timeout: 3_000 })

    await input.fill('>zzzzqqqq')
    await expect(page.getByText('No matching commands')).toBeVisible()
  })

  test('deleting the ">" switches to file mode without closing', async ({ electronApp, page }) => {
    await sendIPC(electronApp, 'menu:command-palette')
    const palette = page.locator('[data-testid="command-palette"]')
    const input = page.locator('[data-testid="command-palette-input"]')
    await expect(palette).toHaveAttribute('data-mode', 'commands', { timeout: 3_000 })

    await input.fill('')
    await expect(palette).toBeVisible()
    await expect(palette).toHaveAttribute('data-mode', 'files')

    // …and typing it back returns to command mode.
    await input.fill('>')
    await expect(palette).toHaveAttribute('data-mode', 'commands')
  })

  test('Enter runs the selected command and the palette closes first', async ({ electronApp, page }) => {
    await sendIPC(electronApp, 'menu:command-palette')
    const input = page.locator('[data-testid="command-palette-input"]')
    await expect(input).toBeVisible({ timeout: 3_000 })

    // Find & Replace opens its own overlay — it must survive the palette's
    // teardown, which is why the palette closes before running the command.
    await input.fill('>Find…')
    await expect(page.locator('[data-testid="command-palette-command"]').first()).toContainText('Find', {
      timeout: 3_000,
    })
    await input.press('Enter')

    await expect(page.locator('[data-testid="command-palette"]')).not.toBeVisible()
    await page.getByText('Find Next ↓').waitFor({ state: 'visible', timeout: 3_000 })
  })

  test('editor commands are absent when no editor is open', async ({ electronApp, page }) => {
    // Close the seeded buffer to land back on the Welcome screen.
    await sendIPC(electronApp, 'menu:file-close')
    await page.waitForSelector('[data-testid="app"]')
    await sendIPC(electronApp, 'menu:command-palette')

    const input = page.locator('[data-testid="command-palette-input"]')
    await expect(input).toBeVisible({ timeout: 3_000 })
    await input.fill('>Duplicate Line')
    await expect(page.getByText('No matching commands')).toBeVisible({ timeout: 3_000 })
  })
})

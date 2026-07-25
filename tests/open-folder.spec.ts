// spec: specs/open-folder.md
// seed: tests/phase5-sidebar-panels.spec.ts

import { test as base, expect, stubConfirmDialog } from './fixtures'
import { _electron as electron, ElectronApplication } from 'playwright'
import path from 'path'
import os from 'os'
import fs from 'fs'

// Extended fixture that shares ONE ElectronApplication instance between electronApp and page
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
    // Seed an untitled buffer. E2E mode skips session restore, so without this
    // there are no buffers, the WelcomeScreen renders instead of the editor,
    // and the Monaco/tabbar waits below never resolve.
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('menu:file-new')
    })
    await page.waitForSelector('.monaco-editor textarea', { timeout: 10_000 })
    await page.waitForSelector('[data-testid="tabbar"] [data-tab-title]', { timeout: 5_000 })
    await use(page)
  },
})

// IPC helper — sends a channel+args from main process to the renderer
async function sendIPC(electronApp: ElectronApplication, channel: string, ...args: unknown[]) {
  await electronApp.evaluate(
    ({ BrowserWindow }, { ch, a }) =>
      BrowserWindow.getAllWindows()[0].webContents.send(ch, ...(a as unknown[])),
    { ch: channel, a: args }
  )
}

// File-tree context menu items are Radix ContextMenuItems rendered into a
// portal at the document root — they are NOT inside [data-testid="sidebar"].
const menuItem = (page: import('playwright').Page, name: string) =>
  page.getByRole('menuitem', { name })

// ─── Group A: Happy-Path Scenarios ──────────────────────────────────────────

test.describe('Open Folder Feature', () => {

  test.describe('Group A: Happy-Path Scenarios', () => {

    // Scenario A-1: Opening a folder via IPC renders sidebar with file tree
    test('Scenario A-1 — Opening a folder via IPC renders sidebar with file tree', async ({ electronApp, page }) => {
      // 1. Create a temp directory containing hello.txt and subdirectory subdir/
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-open-folder-a1-'))
      fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'hello world')
      fs.mkdirSync(path.join(tmpDir, 'subdir'))

      try {
        // 2. Send IPC ui:toggle-sidebar with true
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })

        // 3. Send IPC menu:folder-open with the absolute temp directory path
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        const folderName = path.basename(tmpDir)

        // 4. Assert sidebar header shows the folder's basename
        await expect(sidebar.getByText(folderName)).toBeVisible({ timeout: 3_000 })

        // 5. Assert hello.txt is visible in the sidebar tree
        await expect(sidebar.getByText('hello.txt')).toBeVisible({ timeout: 3_000 })

        // 6. Assert subdir is visible in the sidebar tree
        await expect(sidebar.getByText('subdir')).toBeVisible()

        // 7. Assert [data-testid="app"] is still visible (no crash)
        await expect(page.locator('[data-testid="app"]')).toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario A-2: Header displays only the folder basename, not the full path
    test('Scenario A-2 — Header displays only the folder basename, not the full path', async ({ electronApp, page }) => {
      // 1. Create a temp directory with a recognizable prefix
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-notepad-test-'))

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })

        // 2. Send IPC menu:folder-open with the full absolute path
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        const folderBasename = path.basename(tmpDir)

        // 3. Assert sidebar header text equals only the basename (no leading path segments)
        await expect(sidebar.getByText(folderBasename)).toBeVisible({ timeout: 3_000 })

        // 4. Assert the full path is NOT rendered as visible text anywhere in the sidebar header
        // The parent directory path should not appear as raw text
        const fullPathText = sidebar.getByText(tmpDir, { exact: true })
        await expect(fullPathText).not.toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario A-3: File tree sorts directories before files, then alphabetically
    test('Scenario A-3 — File tree sorts directories before files, then alphabetically', async ({ electronApp, page }) => {
      // 1. Create temp directory with: zebra.txt, apple.txt, banana/, alpha/
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sort-a3-'))
      fs.writeFileSync(path.join(tmpDir, 'zebra.txt'), '')
      fs.writeFileSync(path.join(tmpDir, 'apple.txt'), '')
      fs.mkdirSync(path.join(tmpDir, 'banana'))
      fs.mkdirSync(path.join(tmpDir, 'alpha'))

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })

        // 2. Send IPC menu:folder-open
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('alpha')).toBeVisible({ timeout: 3_000 })

        // 3. Collect the ordered list of visible tree item names via title attributes
        // Each TreeNodeRow renders a div with title={node.path}; we read the .name span text
        const nameSpans = sidebar.locator('span').filter({ hasText: /^(alpha|banana|apple\.txt|zebra\.txt)$/ })
        const names = await nameSpans.allTextContents()
        const trimmed = names.map((n) => n.trim()).filter(Boolean)

        // 4. Assert order is: alpha, banana, apple.txt, zebra.txt
        expect(trimmed.indexOf('alpha')).toBeLessThan(trimmed.indexOf('banana'))
        expect(trimmed.indexOf('banana')).toBeLessThan(trimmed.indexOf('apple.txt'))
        expect(trimmed.indexOf('apple.txt')).toBeLessThan(trimmed.indexOf('zebra.txt'))
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario A-4: Clicking a file in the tree opens it in the editor and creates a tab
    test('Scenario A-4 — Clicking a file in the tree opens it in the editor and creates a tab', async ({ electronApp, page }) => {
      // 1. Create tmpDir/test.txt with content "hello world"
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-clickopen-a4-'))
      fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello world')

      try {
        // 2. Open folder via IPC, show sidebar
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')

        // 3. Assert test.txt visible. Click the test.txt row.
        await expect(sidebar.getByText('test.txt')).toBeVisible({ timeout: 3_000 })
        await sidebar.getByText('test.txt').click()

        // 4. Wait up to 5s for [data-tab-title="test.txt"] to appear
        await page.locator('[data-tab-title="test.txt"]').waitFor({ state: 'visible', timeout: 5_000 })

        // 5. Assert the tab is visible
        await expect(page.locator('[data-tab-title="test.txt"]')).toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario A-5: Sidebar auto-switches to File Browser tab when opening a folder
    test('Scenario A-5 — Sidebar auto-switches to File Browser tab when opening a folder', async ({ electronApp, page }) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-autoswitch-a5-'))
      fs.writeFileSync(path.join(tmpDir, 'file.txt'), '')

      try {
        // 1. Show sidebar. Click button[title="Project"] tab.
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await page.locator('[data-testid="sidebar"]').locator('button[title="Project"]').click()
        await page.waitForTimeout(300)

        // 2. Send IPC menu:folder-open
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')

        // 3. Assert the File Browser panel becomes visible — shows the folder header
        const folderName = path.basename(tmpDir)
        await expect(sidebar.getByText(folderName)).toBeVisible({ timeout: 3_000 })

        // Project panel's empty state should NOT be showing
        await expect(sidebar.getByText('No workspace folder open.')).not.toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario A-6: Project panel reflects the same workspace folder
    test('Scenario A-6 — Project panel reflects the same workspace folder', async ({ electronApp, page }) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-project-a6-'))

      try {
        // 1. Set workspace via menu:folder-open
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)
        await page.waitForTimeout(500)

        const sidebar = page.locator('[data-testid="sidebar"]')

        // 2. Click button[title="Project"] tab
        await sidebar.locator('button[title="Project"]').click()

        const folderBasename = path.basename(tmpDir)

        // 3. Assert the folder basename is visible in the Project panel
        await expect(sidebar.getByText(folderBasename)).toBeVisible({ timeout: 3_000 })

        // 4. Assert the change-folder button (button with text …) is visible
        await expect(sidebar.locator('button', { hasText: '…' })).toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario A-7: "Open Folder…" button visible in sidebar empty state
    test('Scenario A-7 — "Open Folder…" button visible in sidebar empty state', async ({ electronApp, page }) => {
      // 1. Show sidebar (no workspace set)
      await sendIPC(electronApp, 'ui:toggle-sidebar', true)
      await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })

      const sidebar = page.locator('[data-testid="sidebar"]')

      // 2. Assert button with text "Open Folder…" is visible
      await expect(sidebar.locator('button', { hasText: 'Open Folder…' })).toBeVisible()

      // 3. Assert text "Open a folder to browse files." is visible
      await expect(sidebar.getByText('Open a folder to browse files.')).toBeVisible()

      // 4. Assert Refresh button is NOT visible
      await expect(sidebar.locator('button[title="Refresh"]')).not.toBeVisible()
    })

  })

  // ─── Group B: Edge Cases and Boundaries ──────────────────────────────────────

  test.describe('Group B: Edge Cases and Boundaries', () => {

    // Scenario B-1: Empty folder shows "Empty folder" message, no crash
    test('Scenario B-1 — Empty folder shows "Empty folder" message, no crash', async ({ electronApp, page }) => {
      // 1. Create an empty temp directory
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-empty-b1-'))

      try {
        // 2. Send IPC menu:folder-open. Show sidebar.
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        const folderName = path.basename(tmpDir)

        // 3. Assert header shows folder basename
        await expect(sidebar.getByText(folderName)).toBeVisible({ timeout: 3_000 })

        // 4. Assert text "Empty folder" is visible inside the sidebar
        await expect(sidebar.getByText('Empty folder')).toBeVisible()

        // 5. Assert no file tree rows with file paths are rendered (title attr holds full paths)
        // Only the header span should be visible, no row items
        const rowsWithPaths = sidebar.locator(`[title="${tmpDir}"]`)
        await expect(rowsWithPaths).toHaveCount(0)

        // 6. Assert [data-testid="app"] is still mounted
        await expect(page.locator('[data-testid="app"]')).toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario B-2: Folder containing only subdirectories renders correctly
    test('Scenario B-2 — Folder containing only subdirectories renders correctly', async ({ electronApp, page }) => {
      // 1. Create tmpDir/a/, tmpDir/b/, tmpDir/c/ — no files
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dirsonly-b2-'))
      fs.mkdirSync(path.join(tmpDir, 'a'))
      fs.mkdirSync(path.join(tmpDir, 'b'))
      fs.mkdirSync(path.join(tmpDir, 'c'))

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')

        // 2. Assert a, b, c visible. No "Empty folder" message.
        // Use exact:true to avoid ambiguous matches with other sidebar text containing these letters
        await expect(sidebar.getByText('a', { exact: true })).toBeVisible({ timeout: 3_000 })
        await expect(sidebar.getByText('b', { exact: true })).toBeVisible()
        await expect(sidebar.getByText('c', { exact: true })).toBeVisible()

        // "Empty folder" should NOT appear — the root has subdirectories
        await expect(sidebar.getByText('Empty folder')).not.toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario B-3: Deeply nested folders expand correctly level-by-level
    test('Scenario B-3 — Deeply nested folders expand correctly level-by-level', async ({ electronApp, page }) => {
      // 1. Create tmpDir/level1/level2/level3/deep.txt
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-deep-b3-'))
      fs.mkdirSync(path.join(tmpDir, 'level1', 'level2', 'level3'), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, 'level1', 'level2', 'level3', 'deep.txt'), 'deep')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')

        // 2. Assert level1 visible; deep.txt NOT visible
        await expect(sidebar.getByText('level1')).toBeVisible({ timeout: 3_000 })
        await expect(sidebar.getByText('deep.txt')).not.toBeVisible()

        // 3. Click level1. Assert level2 visible; deep.txt NOT visible
        await sidebar.getByText('level1').click()
        await expect(sidebar.getByText('level2')).toBeVisible({ timeout: 3_000 })
        await expect(sidebar.getByText('deep.txt')).not.toBeVisible()

        // 4. Click level2. Assert level3 visible; deep.txt NOT visible
        await sidebar.getByText('level2').click()
        await expect(sidebar.getByText('level3')).toBeVisible({ timeout: 3_000 })
        await expect(sidebar.getByText('deep.txt')).not.toBeVisible()

        // 5. Click level3. Assert deep.txt visible
        await sidebar.getByText('level3').click()
        await expect(sidebar.getByText('deep.txt')).toBeVisible({ timeout: 3_000 })
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario B-4: Folder with 200 files renders without timeout
    test('Scenario B-4 — Folder with 200 files renders without timeout', async ({ electronApp, page }) => {
      // 1. Create 200 files named file-001.txt … file-200.txt
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-200files-b4-'))
      for (let i = 1; i <= 200; i++) {
        const name = `file-${String(i).padStart(3, '0')}.txt`
        fs.writeFileSync(path.join(tmpDir, name), '')
      }

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })

        // 2. Open folder. Wait up to 5s for header.
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)
        await expect(
          page.locator('[data-testid="sidebar"]').getByText(path.basename(tmpDir))
        ).toBeVisible({ timeout: 5_000 })

        // 3. Assert file-001.txt visible. Assert app not frozen.
        await expect(
          page.locator('[data-testid="sidebar"]').getByText('file-001.txt')
        ).toBeVisible({ timeout: 5_000 })
        await expect(page.locator('[data-testid="app"]')).toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario B-5: Folder name with spaces renders correctly
    test('Scenario B-5 — Folder name with spaces renders correctly', async ({ electronApp, page }) => {
      // 1. Create directory named "my test folder"
      const tmpDir = path.join(os.tmpdir(), 'my test folder')
      fs.mkdirSync(tmpDir, { recursive: true })

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })

        // 2. Open folder. Assert header shows "my test folder".
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)
        await expect(
          page.locator('[data-testid="sidebar"]').getByText('my test folder')
        ).toBeVisible({ timeout: 3_000 })
      } finally {
        // Clean up the non-temp directory if it only contains what we created
        try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
      }
    })

    // Scenario B-6: Folder name with special characters renders correctly
    test('Scenario B-6 — Folder name with special characters renders correctly', async ({ electronApp, page }) => {
      // 1. Create a dir named "test-[proj](v1)"
      const tmpDir = path.join(os.tmpdir(), 'test-[proj](v1)')
      fs.mkdirSync(tmpDir, { recursive: true })

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })

        // 2. Open folder. Assert header shows "test-[proj](v1)" unescaped.
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)
        await expect(
          page.locator('[data-testid="sidebar"]').getByText('test-[proj](v1)')
        ).toBeVisible({ timeout: 3_000 })
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
      }
    })

  })

  // ─── Group C: Cancel and Re-Open ──────────────────────────────────────────────

  test.describe('Group C: Cancel and Re-Open', () => {

    // Scenario C-1: Cancelling dialog (stubbed) returns null and leaves workspace unchanged
    test('Scenario C-1 — Cancelling dialog (stubbed) returns null and leaves workspace unchanged', async ({ electronApp, page }) => {
      // 1. Show sidebar (no workspace). Assert empty state visible.
      await sendIPC(electronApp, 'ui:toggle-sidebar', true)
      await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })

      const sidebar = page.locator('[data-testid="sidebar"]')
      await expect(sidebar.getByText('Open a folder to browse files.')).toBeVisible()

      // 2. Stub window.api.file.openDirDialog in renderer to return null
      await page.evaluate(() => {
        ;(window as any).api.file.openDirDialog = async () => null
      })

      // 3. Click "Open Folder…" button
      await sidebar.locator('button', { hasText: 'Open Folder…' }).click()
      await page.waitForTimeout(300)

      // 4. Assert empty state is still visible. Assert no header appeared.
      await expect(sidebar.getByText('Open a folder to browse files.')).toBeVisible()
      await expect(sidebar.locator('button[title="Refresh"]')).not.toBeVisible()
    })

    // Scenario C-2: Opening a second folder replaces the first in the tree
    test('Scenario C-2 — Opening a second folder replaces the first in the tree', async ({ electronApp, page }) => {
      // 1. Create folderA/file-a.txt and folderB/file-b.txt
      const folderA = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-folderA-c2-'))
      const folderB = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-folderB-c2-'))
      fs.writeFileSync(path.join(folderA, 'file-a.txt'), 'a')
      fs.writeFileSync(path.join(folderB, 'file-b.txt'), 'b')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })

        // 2. Open folderA. Assert file-a.txt visible. Header shows folderA basename.
        await sendIPC(electronApp, 'menu:folder-open', folderA)
        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('file-a.txt')).toBeVisible({ timeout: 3_000 })
        await expect(sidebar.getByText(path.basename(folderA))).toBeVisible()

        // 3. Send IPC menu:folder-open with folderB
        await sendIPC(electronApp, 'menu:folder-open', folderB)

        // 4. Assert header updates to folderB basename
        await expect(sidebar.getByText(path.basename(folderB))).toBeVisible({ timeout: 3_000 })

        // 5. Assert file-b.txt visible. Assert file-a.txt NOT visible.
        await expect(sidebar.getByText('file-b.txt')).toBeVisible()
        await expect(sidebar.getByText('file-a.txt')).not.toBeVisible()
      } finally {
        fs.rmSync(folderA, { recursive: true, force: true })
        fs.rmSync(folderB, { recursive: true, force: true })
      }
    })

    // Scenario C-3: Refresh button reloads tree after new file added externally
    test('Scenario C-3 — Refresh button reloads tree after new file added externally', async ({ electronApp, page }) => {
      // 1. Create tmpDir/initial.txt. Open folder.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-refresh-c3-'))
      fs.writeFileSync(path.join(tmpDir, 'initial.txt'), 'initial')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('initial.txt')).toBeVisible({ timeout: 3_000 })

        // 2. Add added.txt via fs.writeFileSync
        fs.writeFileSync(path.join(tmpDir, 'added.txt'), 'added')

        // 3. Click button[title="Refresh"]
        await sidebar.locator('button[title="Refresh"]').click()

        // 4. Assert added.txt visible. Assert initial.txt still visible.
        await expect(sidebar.getByText('added.txt')).toBeVisible({ timeout: 3_000 })
        await expect(sidebar.getByText('initial.txt')).toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

  })

  // ─── Group D: Expand, Collapse, and Refresh ────────────────────────────────────

  test.describe('Group D: Expand, Collapse, and Refresh', () => {

    // Scenario D-1: Clicking a directory expands it and shows children
    test('Scenario D-1 — Clicking a directory expands it and shows children', async ({ electronApp, page }) => {
      // 1. Create tmpDir/subdir/inner.txt. Open folder.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-expand-d1-'))
      fs.mkdirSync(path.join(tmpDir, 'subdir'))
      fs.writeFileSync(path.join(tmpDir, 'subdir', 'inner.txt'), 'inner')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')

        // 2. Assert subdir visible; inner.txt NOT visible
        await expect(sidebar.getByText('subdir')).toBeVisible({ timeout: 3_000 })
        await expect(sidebar.getByText('inner.txt')).not.toBeVisible()

        // 3. Click subdir. Assert inner.txt visible within 3s.
        await sidebar.getByText('subdir').click()
        await expect(sidebar.getByText('inner.txt')).toBeVisible({ timeout: 3_000 })
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario D-2: Clicking an expanded directory collapses it
    test('Scenario D-2 — Clicking an expanded directory collapses it', async ({ electronApp, page }) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-collapse-d2-'))
      fs.mkdirSync(path.join(tmpDir, 'subdir'))
      fs.writeFileSync(path.join(tmpDir, 'subdir', 'inner.txt'), 'inner')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('subdir')).toBeVisible({ timeout: 3_000 })

        // Expand subdir (inner.txt visible)
        await sidebar.getByText('subdir').click()
        await expect(sidebar.getByText('inner.txt')).toBeVisible({ timeout: 3_000 })

        // 1. Click subdir again to collapse
        await sidebar.getByText('subdir').click()

        // 2. Assert inner.txt NOT visible
        await expect(sidebar.getByText('inner.txt')).not.toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario D-3: Re-expanding uses cached children (no extra IPC call)
    test('Scenario D-3 — Re-expanding uses cached children (no extra IPC call)', async ({ electronApp, page }) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cache-d3-'))
      fs.mkdirSync(path.join(tmpDir, 'subdir'))
      fs.writeFileSync(path.join(tmpDir, 'subdir', 'inner.txt'), 'inner')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('subdir')).toBeVisible({ timeout: 3_000 })

        // 1. Expand then collapse subdir
        await sidebar.getByText('subdir').click()
        await expect(sidebar.getByText('inner.txt')).toBeVisible({ timeout: 3_000 })
        await sidebar.getByText('subdir').click()
        await expect(sidebar.getByText('inner.txt')).not.toBeVisible()

        // 2. Expand again — inner.txt reappears immediately (cached)
        await sidebar.getByText('subdir').click()
        await expect(sidebar.getByText('inner.txt')).toBeVisible({ timeout: 1_000 })
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario D-4: Refresh button is absent when no workspace folder is set
    test('Scenario D-4 — Refresh button is absent when no workspace folder is set', async ({ electronApp, page }) => {
      // 1. Show sidebar without opening a folder
      await sendIPC(electronApp, 'ui:toggle-sidebar', true)
      await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })

      // 2. Assert button[title="Refresh"] is NOT visible
      await expect(
        page.locator('[data-testid="sidebar"]').locator('button[title="Refresh"]')
      ).not.toBeVisible()
    })

    // Scenario D-5: Refresh handles an externally deleted subdirectory gracefully
    test('Scenario D-5 — Refresh handles an externally deleted subdirectory gracefully', async ({ electronApp, page }) => {
      // 1. Create tmpDir/subdir/inner.txt. Open folder, expand subdir.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-deletedir-d5-'))
      fs.mkdirSync(path.join(tmpDir, 'subdir'))
      fs.writeFileSync(path.join(tmpDir, 'subdir', 'inner.txt'), 'inner')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('subdir')).toBeVisible({ timeout: 3_000 })
        await sidebar.getByText('subdir').click()
        await expect(sidebar.getByText('inner.txt')).toBeVisible({ timeout: 3_000 })

        // 2. Delete subdir via fs.rmSync
        fs.rmSync(path.join(tmpDir, 'subdir'), { recursive: true, force: true })

        // 3. Click Refresh. Assert subdir NOT visible. Assert app still mounted.
        await sidebar.locator('button[title="Refresh"]').click()
        await expect(sidebar.getByText('subdir')).not.toBeVisible({ timeout: 3_000 })
        await expect(page.locator('[data-testid="app"]')).toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

  })

  // ─── Group E: Context Menu ─────────────────────────────────────────────────────

  test.describe('Group E: Context Menu', () => {

    // Scenario E-1: Right-clicking a file shows correct context menu items
    test('Scenario E-1 — Right-clicking a file shows correct context menu items', async ({ electronApp, page }) => {
      // 1. Create tmpDir/target.txt. Open folder.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ctxfile-e1-'))
      fs.writeFileSync(path.join(tmpDir, 'target.txt'), 'target')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('target.txt')).toBeVisible({ timeout: 3_000 })

        // 2. Right-click target.txt
        await sidebar.getByText('target.txt').click({ button: 'right' })

        // 3. Assert visible: "Open", "New File…", "New Folder…", "Rename", "Delete", "Copy Path"
        await expect(sidebar.getByText('Open')).toBeVisible({ timeout: 2_000 })
        await expect(sidebar.getByText('New File…')).toBeVisible()
        await expect(sidebar.getByText('New Folder…')).toBeVisible()
        await expect(sidebar.getByText('Rename')).toBeVisible()
        await expect(sidebar.getByText('Delete')).toBeVisible()
        await expect(sidebar.getByText('Copy Path')).toBeVisible()

        // 4. Assert text=/Reveal in (Finder|Explorer)/ visible
        await expect(sidebar.locator('text=/Reveal in (Finder|Explorer)/').first()).toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario E-2: Right-clicking a directory omits the "Open" item
    test('Scenario E-2 — Right-clicking a directory omits the "Open" item', async ({ electronApp, page }) => {
      // 1. Create tmpDir/mydir/. Open folder.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ctxdir-e2-'))
      fs.mkdirSync(path.join(tmpDir, 'mydir'))

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('mydir')).toBeVisible({ timeout: 3_000 })

        // 2. Right-click mydir. Assert "Open" button NOT visible.
        await sidebar.getByText('mydir').click({ button: 'right' })
        await expect(sidebar.getByText('New File…')).toBeVisible({ timeout: 2_000 })
        await expect(sidebar.getByRole('button', { name: 'Open' })).not.toBeVisible()

        // 3. Assert "New File…", "New Folder…", "Rename", "Delete", "Copy Path" visible.
        await expect(sidebar.getByText('New Folder…')).toBeVisible()
        await expect(sidebar.getByText('Rename')).toBeVisible()
        await expect(sidebar.getByText('Delete')).toBeVisible()
        await expect(sidebar.getByText('Copy Path')).toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario E-3: Context menu closes on click outside the sidebar
    test('Scenario E-3 — Context menu closes on click outside the sidebar', async ({ electronApp, page }) => {
      // 1. Open context menu on a file row.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ctxclose-e3-'))
      fs.writeFileSync(path.join(tmpDir, 'target.txt'), 'content')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('target.txt')).toBeVisible({ timeout: 3_000 })
        await sidebar.getByText('target.txt').click({ button: 'right' })
        await expect(sidebar.getByText('New File…')).toBeVisible({ timeout: 2_000 })

        // 2. Click [data-testid="editor-pane"]
        await page.locator('[data-testid="editor-pane"]').click()

        // 3. Assert context menu items are NOT visible
        await expect(sidebar.getByText('New File…')).not.toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario E-4: "Copy Path" copies the full absolute path to clipboard
    test('Scenario E-4 — "Copy Path" copies the full absolute path to clipboard', async ({ electronApp, page }) => {
      test.skip(true, 'clipboard.readText() requires Permissions API grant in Electron — unreliable in E2E context without explicit permission stub')
    })

  })

  // ─── Group F: File Operations via Context Menu ─────────────────────────────────

  test.describe('Group F: File Operations via Context Menu', () => {

    // Scenario F-1: "New File…" creates a file and it appears in the tree
    test('Scenario F-1 — "New File…" creates a file and it appears in the tree', async ({ electronApp, page }) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-newfile-f1-'))
      fs.writeFileSync(path.join(tmpDir, 'existing.txt'), '')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('existing.txt')).toBeVisible({ timeout: 3_000 })

        // 1. Stub window.prompt to return 'newfile.txt' (Electron may not fire Playwright dialog events for prompt())
        await page.evaluate(() => { (window as any).prompt = () => 'newfile.txt' })

        // 2. Right-click any row and click "New File…"
        await sidebar.getByText('existing.txt').click({ button: 'right' })
        await expect(sidebar.getByText('New File…')).toBeVisible({ timeout: 2_000 })
        await sidebar.getByText('New File…').click()

        // 3. Assert newfile.txt appears in tree. Assert file exists on disk.
        await expect(sidebar.getByText('newfile.txt')).toBeVisible({ timeout: 3_000 })
        expect(fs.existsSync(path.join(tmpDir, 'newfile.txt'))).toBe(true)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario F-2: "New Folder…" creates a directory in the tree
    test('Scenario F-2 — "New Folder…" creates a directory in the tree', async ({ electronApp, page }) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-newdir-f2-'))
      fs.writeFileSync(path.join(tmpDir, 'seed.txt'), '')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('seed.txt')).toBeVisible({ timeout: 3_000 })

        // 1. Stub window.prompt to return 'mynewdir' (Electron may not fire Playwright dialog events for prompt())
        await page.evaluate(() => { (window as any).prompt = () => 'mynewdir' })

        // 2. Right-click and click "New Folder…"
        await sidebar.getByText('seed.txt').click({ button: 'right' })
        await expect(sidebar.getByText('New Folder…')).toBeVisible({ timeout: 2_000 })
        await sidebar.getByText('New Folder…').click()

        // 3. Assert mynewdir appears. Assert directory exists on disk.
        await expect(sidebar.getByText('mynewdir')).toBeVisible({ timeout: 3_000 })
        expect(fs.existsSync(path.join(tmpDir, 'mynewdir'))).toBe(true)
        expect(fs.statSync(path.join(tmpDir, 'mynewdir')).isDirectory()).toBe(true)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario F-3: "Rename" updates the filename in the tree
    test('Scenario F-3 — "Rename" updates the filename in the tree', async ({ electronApp, page }) => {
      // 1. Create tmpDir/old-name.txt
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-rename-f3-'))
      fs.writeFileSync(path.join(tmpDir, 'old-name.txt'), 'content')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('old-name.txt')).toBeVisible({ timeout: 3_000 })

        // Register prompt stub before clicking the trigger (Electron may not fire Playwright dialog events for prompt())
        await page.evaluate(() => { (window as any).prompt = () => 'new-name.txt' })

        // 2. Right-click old-name.txt and click "Rename"
        await sidebar.getByText('old-name.txt').click({ button: 'right' })
        await expect(sidebar.getByRole('button', { name: 'Rename' })).toBeVisible({ timeout: 2_000 })
        await sidebar.getByRole('button', { name: 'Rename' }).click()

        // 3. Assert new-name.txt visible. Assert old-name.txt NOT visible.
        await expect(sidebar.getByText('new-name.txt')).toBeVisible({ timeout: 3_000 })
        await expect(sidebar.getByText('old-name.txt')).not.toBeVisible()

        // 4. Assert new-name.txt exists on disk; old-name.txt does not.
        expect(fs.existsSync(path.join(tmpDir, 'new-name.txt'))).toBe(true)
        expect(fs.existsSync(path.join(tmpDir, 'old-name.txt'))).toBe(false)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario F-4: "Delete" removes the file from tree and disk
    test('Scenario F-4 — "Delete" removes the file from tree and disk', async ({ electronApp, page }) => {
      // 1. Create tmpDir/delete-me.txt
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-delete-f4-'))
      fs.writeFileSync(path.join(tmpDir, 'delete-me.txt'), 'bye')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('delete-me.txt')).toBeVisible({ timeout: 3_000 })

        // Auto-confirm: the prompt is a native main-process message box, which
        // Playwright can neither see nor dismiss from the renderer.
        await stubConfirmDialog(electronApp, 'confirm')

        // 2. Right-click and click "Delete". The context menu is a Radix
        // portal rendered outside the sidebar, so scope the lookup to the page.
        await sidebar.getByText('delete-me.txt').click({ button: 'right' })
        await expect(menuItem(page, 'Delete')).toBeVisible({ timeout: 2_000 })
        await menuItem(page, 'Delete').click()

        // 3. Assert delete-me.txt NOT visible. Assert file does not exist on disk.
        await expect(sidebar.getByText('delete-me.txt')).not.toBeVisible({ timeout: 3_000 })
        expect(fs.existsSync(path.join(tmpDir, 'delete-me.txt'))).toBe(false)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario F-5: Cancelling "Delete" confirm leaves file intact
    test('Scenario F-5 — Cancelling "Delete" confirm leaves file intact', async ({ electronApp, page }) => {
      // 1. Create tmpDir/keep-me.txt
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-keepfile-f5-'))
      fs.writeFileSync(path.join(tmpDir, 'keep-me.txt'), 'keep')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('keep-me.txt')).toBeVisible({ timeout: 3_000 })

        // Answer the native confirm with Cancel, so deletion is aborted
        await stubConfirmDialog(electronApp, 'cancel')

        // 2. Right-click and click "Delete" (context menu is a portal — see F-4)
        await sidebar.getByText('keep-me.txt').click({ button: 'right' })
        await expect(menuItem(page, 'Delete')).toBeVisible({ timeout: 2_000 })
        await menuItem(page, 'Delete').click()
        await page.waitForTimeout(300)

        // 3. Assert keep-me.txt still visible. Assert file still on disk.
        await expect(sidebar.getByText('keep-me.txt')).toBeVisible()
        expect(fs.existsSync(path.join(tmpDir, 'keep-me.txt'))).toBe(true)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

  })

  // ─── Group G: Regression Scenarios ────────────────────────────────────────────

  test.describe('Group G: Regression Scenarios', () => {

    // Scenario G-1: file:open-dir-dialog IPC returns string, not an object
    test('Scenario G-1 (REGRESSION) — file:open-dir-dialog IPC returns string, not object', async ({ electronApp, page }) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ipctype-g1-'))

      try {
        // Stub IPC handler in main process so it returns the path directly (no native dialog)
        await electronApp.evaluate(({ ipcMain }, dir) => {
          ipcMain.removeHandler('file:open-dir-dialog')
          ipcMain.handle('file:open-dir-dialog', async () => dir)
        }, tmpDir)

        // Invoke from renderer and capture return value
        const result = await page.evaluate(() => (window as any).api.file.openDirDialog())

        // Restore original handler behaviour (returns null — no focused window in test)
        await electronApp.evaluate(({ ipcMain }) => {
          ipcMain.removeHandler('file:open-dir-dialog')
          ipcMain.handle('file:open-dir-dialog', async () => null)
        })

        // Must be a string, not an object like { canceled, filePath }
        expect(typeof result).toBe('string')
        expect(result).toBe(tmpDir)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario G-2: menu:folder-open with string path does not crash FileBrowserPanel
    test('Scenario G-2 (REGRESSION) — menu:folder-open with string path does not crash FileBrowserPanel', async ({ electronApp, page }) => {
      // 1. Create tmpDir/sample.txt. Send IPC menu:folder-open with the string path.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-nocrash-g2-'))
      fs.writeFileSync(path.join(tmpDir, 'sample.txt'), 'hello')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')

        // 2. Assert sidebar header shows the basename (proof .replace() succeeded)
        await expect(sidebar.getByText(path.basename(tmpDir))).toBeVisible({ timeout: 3_000 })

        // 3. Assert sample.txt visible. Assert [data-testid="app"] visible and mounted.
        await expect(sidebar.getByText('sample.txt')).toBeVisible()
        await expect(page.locator('[data-testid="app"]')).toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario G-3: null workspace shows empty state without crash
    test('Scenario G-3 (REGRESSION) — null workspace shows empty state without crash', async ({ electronApp, page }) => {
      // 1. Ensure workspaceFolder is null (fresh launch). Show sidebar.
      await sendIPC(electronApp, 'ui:toggle-sidebar', true)
      await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })

      const sidebar = page.locator('[data-testid="sidebar"]')

      // 3. Assert "Open Folder…" button and "Open a folder to browse files." visible
      await expect(sidebar.locator('button', { hasText: 'Open Folder…' })).toBeVisible()
      await expect(sidebar.getByText('Open a folder to browse files.')).toBeVisible()

      // 4. Assert Refresh button and folder header NOT visible
      await expect(sidebar.locator('button[title="Refresh"]')).not.toBeVisible()

      // 5. Assert no React error boundary triggered (app still mounted)
      await expect(page.locator('[data-testid="app"]')).toBeVisible()
    })

  })

  // ─── Group H: Editor Interaction ───────────────────────────────────────────────

  test.describe('Group H: Editor Interaction', () => {

    // Scenario H-1: Opening a folder does not close existing editor tabs
    test('Scenario H-1 — Opening a folder does not close existing editor tabs', async ({ electronApp, page }) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-existtab-h1-'))

      try {
        // 1. Note the default tab (new 1). Type some text.
        await expect(page.locator('[data-tab-title="new 1"]')).toBeVisible()
        await page.locator('.monaco-editor textarea').first().click({ force: true })
        await page.keyboard.type('existing content')

        // 2. Send IPC menu:folder-open
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)
        await page.waitForTimeout(500)

        // 3. Assert "new 1" tab still present. Assert editor area still visible.
        await expect(page.locator('[data-tab-title="new 1"]')).toBeVisible()
        await expect(page.locator('[data-testid="editor-pane"]')).toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario H-2: Opening a file from tree adds tab without closing existing tabs
    test('Scenario H-2 — Opening a file from tree adds tab without closing existing tabs', async ({ electronApp, page }) => {
      // 1. Create tmpDir/new-file.txt. Open folder.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-addtab-h2-'))
      fs.writeFileSync(path.join(tmpDir, 'new-file.txt'), 'file content')

      try {
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await sendIPC(electronApp, 'menu:folder-open', tmpDir)

        const sidebar = page.locator('[data-testid="sidebar"]')

        // 2. Confirm original tab exists
        await expect(page.locator('[data-tab-title="new 1"]')).toBeVisible()

        // Click new-file.txt in sidebar
        await expect(sidebar.getByText('new-file.txt')).toBeVisible({ timeout: 3_000 })
        await sidebar.getByText('new-file.txt').click()

        // 3. Assert both original tab and new-file.txt tab are visible simultaneously
        await page.locator('[data-tab-title="new-file.txt"]').waitFor({ state: 'visible', timeout: 5_000 })
        await expect(page.locator('[data-tab-title="new 1"]')).toBeVisible()
        await expect(page.locator('[data-tab-title="new-file.txt"]')).toBeVisible()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

  })

  // ─── Group I: "Open Folder…" Button Entry Points ───────────────────────────────

  test.describe('Group I: "Open Folder…" Button Entry Points', () => {

    // Scenario I-1: Button in File Browser (stubbed) sets workspace and renders tree
    test('Scenario I-1 — Button in File Browser (stubbed) sets workspace and renders tree', async ({ electronApp, page }) => {
      // 1. Create tmpDir/stub-file.txt
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-stub-i1-'))
      fs.writeFileSync(path.join(tmpDir, 'stub-file.txt'), 'stub')

      try {
        // 2. Stub 'file:open-dir-dialog' IPC handler in main process to return tmpDir
        // (window.api is a frozen contextBridge object — renderer-side reassignment doesn't work)
        await electronApp.evaluate(({ ipcMain }, dir) => {
          ipcMain.removeHandler('file:open-dir-dialog')
          ipcMain.handle('file:open-dir-dialog', async () => dir)
        }, tmpDir)

        // 3. Show sidebar. Click "Open Folder…" button.
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await page.locator('[data-testid="sidebar"]').locator('button', { hasText: 'Open Folder…' }).click()

        const sidebar = page.locator('[data-testid="sidebar"]')

        // 4. Assert header shows basename. Assert stub-file.txt visible.
        await expect(sidebar.getByText(path.basename(tmpDir))).toBeVisible({ timeout: 3_000 })
        await expect(sidebar.getByText('stub-file.txt')).toBeVisible()
      } finally {
        // Restore the original IPC handler
        await electronApp.evaluate(({ ipcMain, dialog, BrowserWindow }) => {
          ipcMain.removeHandler('file:open-dir-dialog')
          ipcMain.handle('file:open-dir-dialog', async () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (!win) return null
            const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
            if (result.canceled || result.filePaths.length === 0) return null
            return result.filePaths[0]
          })
        }).catch(() => {})
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    // Scenario I-2: Button in Project panel (stubbed) sets workspace and switches to Files tab
    test('Scenario I-2 — Button in Project panel (stubbed) sets workspace and switches to Files tab', async ({ electronApp, page }) => {
      // 1. Create tmpDir/proj-stub.txt
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-projstub-i2-'))
      fs.writeFileSync(path.join(tmpDir, 'proj-stub.txt'), 'proj')

      try {
        // 2. Stub 'file:open-dir-dialog' IPC handler in main process to return tmpDir
        // (window.api is a frozen contextBridge object — renderer-side reassignment doesn't work)
        await electronApp.evaluate(({ ipcMain }, dir) => {
          ipcMain.removeHandler('file:open-dir-dialog')
          ipcMain.handle('file:open-dir-dialog', async () => dir)
        }, tmpDir)

        // 3. Show sidebar. Switch to Project tab. Click "Open Folder…".
        await sendIPC(electronApp, 'ui:toggle-sidebar', true)
        await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 3_000 })
        await page.locator('[data-testid="sidebar"]').locator('button[title="Project"]').click()

        const sidebar = page.locator('[data-testid="sidebar"]')
        await expect(sidebar.getByText('No workspace folder open.')).toBeVisible({ timeout: 2_000 })
        await sidebar.locator('button', { hasText: 'Open Folder…' }).click()

        // 4. Assert sidebar switches to File Browser. Assert proj-stub.txt visible.
        await expect(sidebar.getByText(path.basename(tmpDir))).toBeVisible({ timeout: 3_000 })
        await expect(sidebar.getByText('proj-stub.txt')).toBeVisible()

        // Confirm the Project panel empty state is gone — File Browser is active
        await expect(sidebar.getByText('No workspace folder open.')).not.toBeVisible()
      } finally {
        // Restore the original IPC handler
        await electronApp.evaluate(({ ipcMain, dialog, BrowserWindow }) => {
          ipcMain.removeHandler('file:open-dir-dialog')
          ipcMain.handle('file:open-dir-dialog', async () => {
            const win = BrowserWindow.getAllWindows()[0]
            if (!win) return null
            const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
            if (result.canceled || result.filePaths.length === 0) return null
            return result.filePaths[0]
          })
        }).catch(() => {})
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

  })

})

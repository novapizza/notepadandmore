import { test as base, Page } from '@playwright/test'
import { _electron as electron, ElectronApplication } from 'playwright'
import path from 'path'

export interface AppFixtures {
  electronApp: ElectronApplication
  page: Page
}

/**
 * Build the env passed to Electron, with ELECTRON_RUN_AS_NODE forcibly
 * cleared. When that var is set in the parent shell (which happens with some
 * IDE/CLI setups, including electron-vite dev tooling), the electron.exe
 * binary boots as plain Node — `app`, `BrowserWindow`, etc. are then
 * undefined and every test fails with "Process failed to launch!".
 */
function makeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, E2E_TEST: '1', NODE_ENV: 'test' }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

/**
 * Seed an initial untitled buffer so tests that target the editor have
 * something to interact with. In E2E mode the main process skips session
 * restore for clean test state, which means there are no buffers and the
 * WelcomeScreen is shown until the user creates one. We dispatch the same
 * IPC the native New File menu sends.
 */
async function seedInitialBuffer(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('menu:file-new')
  })
}

/**
 * Force the app's modal confirms to a fixed answer for the rest of the test.
 *
 * Renderer confirm/alert prompts are served by `dialog.showMessageBox` in the
 * MAIN process (see `src/main/ipc/fileHandlers.ts`) — the renderer's
 * `window.confirm()` is deliberately unused because it wedges Monaco's render
 * loop. Playwright cannot dismiss a native modal and does not fire `dialog`
 * events for it, so tests must stub the main-process call. Stubbing
 * `window.confirm` in the renderer intercepts nothing and leaves the real
 * dialog up, hanging the test.
 *
 * `dialog:confirm` treats button 0 as confirm and `cancelId: 1` as cancel.
 */
export async function stubConfirmDialog(
  app: ElectronApplication,
  answer: 'confirm' | 'cancel'
): Promise<void> {
  await app.evaluate(async ({ dialog }, response) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(dialog as any).showMessageBox = async () => ({ response, checkboxChecked: false })
  }, answer === 'confirm' ? 0 : 1)
}

export const test = base.extend<AppFixtures>({
  page: async ({}, use) => {
    const app = await electron.launch({
      args: [path.resolve(__dirname, '../out/main/index.js')],
      env: makeEnv(),
      timeout: 15_000,
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('[data-testid="app"]', { timeout: 10_000 })
    await seedInitialBuffer(app)
    await page.waitForSelector('.monaco-editor textarea', { timeout: 10_000 })
    await page.waitForSelector('[data-testid="tabbar"] [data-tab-title]', { timeout: 5_000 })
    await use(page)
    await app.close()
  },
  electronApp: async ({}, use) => {
    const app = await electron.launch({
      args: [path.resolve(__dirname, '../out/main/index.js')],
      env: makeEnv(),
      timeout: 15_000,
    })
    await use(app)
    await app.close()
  },
})

export { expect } from '@playwright/test'

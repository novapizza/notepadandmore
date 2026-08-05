// Feature: sticky-notes — see .docs/features/sticky-notes/{prd,spec,plan}.md
//
// These tests run against an isolated --user-data-dir so they never touch the
// developer's real notes.json / config.json.

import { test as base, expect } from './fixtures'
import { _electron as electron, ElectronApplication } from 'playwright'
import type { Page } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

interface NotesFixtures {
  electronApp: ElectronApplication
  page: Page
  userDataDir: string
}

const test = base.extend<NotesFixtures>({
  userDataDir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-notes-userdata-'))
    await use(dir)
    fs.rmSync(dir, { recursive: true, force: true })
  },
  electronApp: async ({ userDataDir }, use) => {
    const env = { ...process.env, E2E_TEST: '1', NODE_ENV: 'test' }
    delete env.ELECTRON_RUN_AS_NODE
    const app = await electron.launch({
      args: [path.resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${userDataDir}`],
      env,
      timeout: 15_000,
    })
    await use(app)
    await app.close()
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForSelector('[data-testid="app"]', { timeout: 10_000 })
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:file-new')
    })
    await page.waitForSelector('.monaco-editor textarea', { timeout: 10_000 })
    await use(page)
  },
})

/** Send a main→renderer IPC, the way the native menu does. */
async function sendIPC(app: ElectronApplication, channel: string, ...args: unknown[]) {
  await app.evaluate(
    ({ BrowserWindow }, { ch, a }) =>
      BrowserWindow.getAllWindows()[0].webContents.send(ch, ...(a as unknown[])),
    { ch: channel, a: args }
  )
}

const notesPanel = (page: Page) => page.locator('[data-testid="notes-panel"]')

async function openNotes(page: Page) {
  await page.keyboard.press('Control+Shift+N')
  await notesPanel(page).waitFor({ state: 'visible', timeout: 3_000 })
}

test.describe('Sticky Notes panel', () => {
  test('Mod+Shift+N opens Notes, pressing it again round-trips back to a hidden sidebar', async ({ page }) => {
    await openNotes(page)
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar"]').getByText('Notes', { exact: true })).toBeVisible()

    // Notes opened the sidebar, so collapsing Notes returns to the prior layout.
    await page.keyboard.press('Control+Shift+N')
    await expect(page.locator('[data-testid="sidebar"]')).not.toBeVisible()
  })

  test('Notes stacks below the File Explorer instead of replacing it', async ({ page, electronApp }) => {
    // Open the Explorer first, then Notes.
    await sendIPC(electronApp, 'ui:toggle-sidebar', true)
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible()
    const sidebar = page.locator('[data-testid="sidebar"]')
    await expect(sidebar.getByText('File Browser')).toBeVisible()

    await openNotes(page)
    // Both views are present at once, with a divider between them.
    await expect(sidebar.getByText('File Browser')).toBeVisible()
    await expect(sidebar.getByText('Notes', { exact: true })).toBeVisible()
    await expect(page.locator('[data-testid="notes-panel"]')).toBeVisible()

    // Collapsing Notes leaves the Explorer exactly where it was — the sidebar
    // stays open because Notes is not what opened it.
    await page.keyboard.press('Control+Shift+N')
    await expect(page.locator('[data-testid="notes-panel"]')).toHaveCount(0)
    await expect(sidebar).toBeVisible()
    await expect(sidebar.getByText('File Browser')).toBeVisible()
  })

  test('the Notes view has its own dismiss button that does not close the Explorer', async ({ page, electronApp }) => {
    await sendIPC(electronApp, 'ui:toggle-sidebar', true)
    await openNotes(page)
    const sidebar = page.locator('[data-testid="sidebar"]')

    // The ✕ next to the NOTES header, not the Explorer's.
    await sidebar.locator('button:right-of(:text-is("Notes"))').first().click()
    await expect(page.locator('[data-testid="notes-panel"]')).toHaveCount(0)
    await expect(sidebar.getByText('File Browser')).toBeVisible()
  })

  test('empty state names where notes are stored and warns they are unencrypted', async ({ page }) => {
    await openNotes(page)
    await expect(notesPanel(page).getByText('No notes yet')).toBeVisible()
    await expect(notesPanel(page).getByText(/unencrypted/)).toBeVisible()
    await expect(notesPanel(page).getByText('notes.json')).toBeVisible()
  })

  test('+ New creates a note, typing persists it to notes.json', async ({ page, userDataDir }) => {
    await openNotes(page)
    await notesPanel(page).locator('[data-testid="notes-new"]').click()

    const body = notesPanel(page).locator('[data-testid="note-body"]')
    await expect(body).toBeVisible()
    await body.type('deploy checklist')

    const notesFile = path.join(userDataDir, 'config', 'notes.json')
    await expect(async () => {
      expect(fs.existsSync(notesFile)).toBe(true)
      const parsed = JSON.parse(fs.readFileSync(notesFile, 'utf8'))
      expect(parsed.version).toBe(1)
      expect(parsed.notes.map((n: { body: string }) => n.body)).toContain('deploy checklist')
    }).toPass({ timeout: 5_000 })

    // The derived title is the first non-empty body line.
    await page.keyboard.press('Escape')
    await expect(notesPanel(page).getByText('deploy checklist')).toBeVisible()
  })

  test('Tab inserts a literal tab instead of moving focus', async ({ page }) => {
    await openNotes(page)
    await notesPanel(page).locator('[data-testid="notes-new"]').click()

    const body = notesPanel(page).locator('[data-testid="note-body"]')
    await body.type('a')
    await page.keyboard.press('Tab')
    await body.type('b')

    await expect(body).toHaveValue('a\tb')
    await expect(body).toBeFocused()
  })

  test('Esc collapses the note but keeps the text, and does not close other overlays', async ({ page, electronApp }) => {
    await openNotes(page)
    await notesPanel(page).locator('[data-testid="notes-new"]').click()
    await notesPanel(page).locator('[data-testid="note-body"]').type('kept text')

    // Open Find & Replace, then click back into the note. Esc must collapse the
    // note only — Find & Replace listens for Escape on window (bubble phase), so
    // the textarea's stopPropagation has to shield it.
    const findDialog = page.getByText('Find & Replace', { exact: true })
    await sendIPC(electronApp, 'menu:find')
    await expect(findDialog).toBeVisible()
    await notesPanel(page).locator('[data-testid="note-body"]').click()
    await page.keyboard.press('Escape')

    await expect(notesPanel(page).locator('[data-testid="note-body"]')).toHaveCount(0)
    await expect(notesPanel(page).getByText('kept text')).toBeVisible()
    await expect(findDialog).toBeVisible()
  })

  test('an untouched empty note is discarded rather than persisted', async ({ page }) => {
    await openNotes(page)
    await notesPanel(page).locator('[data-testid="notes-new"]').click()
    await expect(notesPanel(page).locator('[data-testid="note-card"]')).toHaveCount(1)

    // Blur without typing.
    await notesPanel(page).locator('[data-testid="notes-filter"]').click()
    await expect(notesPanel(page).locator('[data-testid="note-card"]')).toHaveCount(0)
    await expect(notesPanel(page).getByText('No notes yet')).toBeVisible()
  })

  test('filter matches body text and shows a distinct empty state', async ({ page }) => {
    await openNotes(page)
    for (const text of ['alpha note', 'beta note']) {
      await notesPanel(page).locator('[data-testid="notes-new"]').click()
      await notesPanel(page).locator('[data-testid="note-body"]').type(text)
      await page.keyboard.press('Escape')
    }
    await expect(notesPanel(page).locator('[data-testid="note-card"]')).toHaveCount(2)

    await notesPanel(page).locator('[data-testid="notes-filter"]').fill('alpha')
    await expect(notesPanel(page).locator('[data-testid="note-card"]')).toHaveCount(1)

    await notesPanel(page).locator('[data-testid="notes-filter"]').fill('gamma')
    await expect(notesPanel(page).getByText('No matching notes')).toBeVisible()

    await notesPanel(page).locator('[data-testid="notes-filter"]').fill('')
    await expect(notesPanel(page).locator('[data-testid="note-card"]')).toHaveCount(2)
  })

  test('pinned notes sort above unpinned ones', async ({ page }) => {
    await openNotes(page)
    for (const text of ['first note', 'second note']) {
      await notesPanel(page).locator('[data-testid="notes-new"]').click()
      await notesPanel(page).locator('[data-testid="note-body"]').type(text)
      await page.keyboard.press('Escape')
    }
    // Newest-updated first: "second note" leads.
    const cards = notesPanel(page).locator('[data-testid="note-card"]')
    await expect(cards.first()).toContainText('second note')

    // Pin the older one via its overflow menu.
    await cards.nth(1).locator('button[aria-label="Note actions"]').click()
    await page.getByRole('menuitem', { name: 'Pin to top' }).click()
    await expect(cards.first()).toContainText('first note')
  })

  test('delete goes through the native dialog — Cancel keeps the note', async ({ page, electronApp }) => {
    await openNotes(page)
    await notesPanel(page).locator('[data-testid="notes-new"]').click()
    await notesPanel(page).locator('[data-testid="note-body"]').type('doomed note')
    await page.keyboard.press('Escape')

    /** The overflow menu unmounts behind a CSS exit animation; clicking the
     *  trigger while that layer is still up is swallowed as an outside-dismiss.
     *  Wait it out, as a human naturally would. */
    const chooseDelete = async () => {
      await expect(page.getByRole('menuitem')).toHaveCount(0)
      await notesPanel(page).locator('button[aria-label="Note actions"]').click()
      await page.getByRole('menuitem', { name: 'Delete' }).click()
    }
    const stubDialog = (response: number) =>
      electronApp.evaluate(async ({ dialog }, r) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).showMessageBox = async () => ({ response: r, checkboxChecked: false })
      }, response)

    // Cancel keeps the note — and must not re-expand it either.
    await stubDialog(1)
    await chooseDelete()
    await expect(notesPanel(page).locator('[data-testid="note-card"]')).toHaveCount(1)
    await expect(notesPanel(page).locator('[data-testid="note-body"]')).toHaveCount(0)

    // Confirm removes it.
    await stubDialog(0)
    await chooseDelete()
    await expect(notesPanel(page).locator('[data-testid="note-card"]')).toHaveCount(0)
  })
})

test.describe('Editor bridges', () => {
  test('Insert at Cursor drops the body into the document as one undo step', async ({ page }) => {
    await page.locator('.monaco-editor textarea').first().click({ force: true })
    await page.keyboard.type('start')

    await openNotes(page)
    await notesPanel(page).locator('[data-testid="notes-new"]').click()
    await notesPanel(page).locator('[data-testid="note-body"]').type('INSERTED')

    await notesPanel(page).getByRole('button', { name: 'Insert at Cursor' }).click()
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('startINSERTED')

    // Focus returns to the editor, and a single undo reverts the insert — and
    // only the insert, not the text the user had typed before it.
    await page.keyboard.press('Control+Z')
    await expect(page.locator('.monaco-editor .view-lines')).not.toContainText('INSERTED')
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('start')
  })

  test('Open as Tab creates a dirty untitled buffer and keeps the note', async ({ page }) => {
    await openNotes(page)
    await notesPanel(page).locator('[data-testid="notes-new"]').click()
    await notesPanel(page).locator('[data-testid="note-body"]').type('graduated note')

    await notesPanel(page).getByRole('button', { name: 'Open as Tab' }).click()
    await expect(page.locator('[data-tab-title="graduated note"]')).toBeVisible()
    // The note itself is retained.
    await expect(notesPanel(page).locator('[data-testid="note-card"]')).toHaveCount(1)
  })

  test('Send Selection to Note copies the selection without touching the document', async ({ page }) => {
    await page.locator('.monaco-editor textarea').first().click({ force: true })
    await page.keyboard.type('const answer = 42')
    await page.keyboard.press('Control+A')

    await page.locator('.monaco-editor textarea').first().click({ button: 'right', force: true })
    await page.getByRole('menuitem', { name: 'Send Selection to Note' }).click()

    await expect(notesPanel(page)).toBeVisible()
    await expect(notesPanel(page).locator('[data-testid="note-body"]')).toHaveValue('const answer = 42')
    // Document unchanged.
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('const answer = 42')
  })
})

test.describe('Persistence hardening', () => {
  test('a malformed notes.json loads empty, does not crash, and is left on disk', async ({ userDataDir, page }) => {
    // The app is already running with an isolated userData; write garbage and
    // reload the renderer so load() re-reads it.
    const configDir = path.join(userDataDir, 'config')
    fs.mkdirSync(configDir, { recursive: true })
    const notesFile = path.join(configDir, 'notes.json')
    const garbage = '{ this is not json'
    fs.writeFileSync(notesFile, garbage, 'utf8')

    await page.reload()
    await page.waitForSelector('[data-testid="app"]', { timeout: 10_000 })
    await openNotes(page)

    await expect(notesPanel(page).getByText('No notes yet')).toBeVisible()
    // The unreadable file must not have been overwritten with an empty list.
    expect(fs.readFileSync(notesFile, 'utf8')).toBe(garbage)
  })

  test('a partially-malformed notes.json keeps the valid entries', async ({ userDataDir, page }) => {
    const configDir = path.join(userDataDir, 'config')
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, 'notes.json'),
      JSON.stringify({
        version: 1,
        notes: [
          { id: 'good', title: '', body: 'survivor', language: 'plaintext', color: 'yellow', pinned: false, createdAt: 1, updatedAt: 2 },
          { id: 'bad-no-timestamps', body: 'dropped' },
          null,
        ],
      }),
      'utf8'
    )

    await page.reload()
    await page.waitForSelector('[data-testid="app"]', { timeout: 10_000 })
    await openNotes(page)

    await expect(notesPanel(page).getByText('survivor')).toBeVisible()
    await expect(notesPanel(page).locator('[data-testid="note-card"]')).toHaveCount(1)
  })
})

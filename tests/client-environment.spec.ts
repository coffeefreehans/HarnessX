import { describe, expect, it, vi } from 'vitest'
import { parseDesktopClientEnvironment } from '../src/client/environment.ts'
import { installAdvancedStyles } from '../src/client/styles.ts'
import {
  MACOS_TITLEBAR_HEIGHT,
  WINDOWS_TITLEBAR_HEIGHT,
} from '../src/window-chrome.ts'

describe('desktop client environment', () => {
  it('accepts the Electron-owned kebab query markers', () => {
    expect(parseDesktopClientEnvironment('?dsh-desktop-mode=advanced&dsh-desktop-platform=darwin'))
      .toEqual({ mode: 'advanced', platform: 'darwin' })
    expect(parseDesktopClientEnvironment('?dsh-desktop-platform=win32&dsh-desktop-mode=compatibility'))
      .toEqual({ mode: 'compatibility', platform: 'win32' })
  })

  it.each([
    ['', 'dsh-desktop-mode'],
    ['?dsh-desktop-mode=glass&dsh-desktop-platform=darwin', 'dsh-desktop-mode'],
    ['?dsh-desktop-mode=advanced', 'dsh-desktop-platform'],
    ['?dsh-desktop-mode=advanced&dsh-desktop-platform=android', 'dsh-desktop-platform'],
  ])('fails loud for malformed marker %s', (search, field) => {
    expect(() => parseDesktopClientEnvironment(search)).toThrow(field)
  })
})

describe('advanced desktop layout', () => {
  it('styles only the document shell around the untouched kernel UI', () => {
    expect(WINDOWS_TITLEBAR_HEIGHT).toBe(32)
    let css = ''
    const remove = vi.fn()
    const style = {
      dataset: {},
      get textContent() { return css },
      set textContent(value: string) { css = value },
      remove,
    }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      createElement: () => style,
      head: { appendChild },
    })

    try {
      const dispose = installAdvancedStyles()
      expect(css).toContain('html, body, #root { width: 100%; height: 100%; }')
      expect(css).toMatch(/body\[data-dsh-desktop-mode="advanced"\] \{ margin: 0;[^}]*background: transparent !important; \}/)
      expect(css).toContain(`body[data-dsh-desktop-mode="advanced"][data-dsh-desktop-platform="win32"] #root { padding-top: ${WINDOWS_TITLEBAR_HEIGHT}px; }`)
      expect(css).toContain(`body[data-dsh-desktop-mode="advanced"][data-dsh-desktop-platform="darwin"] #root { padding-top: ${MACOS_TITLEBAR_HEIGHT}px; }`)
      // The kernel UI renders untouched: no desktop class may leak into it.
      expect(css).not.toMatch(/\.dshDesktop/)
      expect(appendChild).toHaveBeenCalledWith(style)
      dispose()
      expect(remove).toHaveBeenCalledOnce()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('exposes the advanced mode and platform markers for additive shell surfaces', () => {
    const advanced = parseDesktopClientEnvironment('', '#dsh-desktop-mode=advanced&dsh-desktop-platform=win32')
    expect(advanced).toEqual({ mode: 'advanced', platform: 'win32' })
    const compatibility = parseDesktopClientEnvironment('', '#dsh-desktop-mode=compatibility&dsh-desktop-platform=darwin')
    expect(compatibility).toEqual({ mode: 'compatibility', platform: 'darwin' })
  })
})

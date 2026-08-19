/** Cordis Host plugin: native directory picker backed by Electron dialogs. */

import type { Context } from '@deepseek-ai/cordis'
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'
import type {} from './runtime.ts'

/** Plugin name recognized by Cordis Loader. */
export const name = 'desktop-directory-picker'

/** Services required for native dialogs. */
export const inject = ['desktopRuntime']

/**
 * Native directory picker service for HarnessX Electron desktop.
 * Replaces the unbundled child-process picker with Electron's native dialog.
 */
export class DesktopDirectoryPicker extends DirectoryPicker {
  private readonly nativeCapability: DirectoryPickerCapability

  constructor(ctx: Context) {
    super(ctx)
    this.nativeCapability = {
      kind: 'native',
      pick: async () => {
        return await ctx.desktopRuntime.showOpenDialog({
          title: 'Select Workspace Directory',
          properties: ['openDirectory', 'createDirectory'],
        })
      },
    }
  }

  capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }
}

/**
 * Register the native directory picker service.
 * @param ctx - Cordis host context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(DesktopDirectoryPicker)
}

export default DesktopDirectoryPicker

/**
 * Client type surface for the desktop bundle.
 *
 * The 0.1.5-rc.1 family removed the `dsh-client-runtime/client` barrel that
 * used to pull every browser-side declaration merge into one program. The
 * Cordis Context members, slot keys, and standard props the desktop reads are
 * now merged by their owning packages, so importing their `/client` faces
 * here restores that surface for every desktop client module (each imports
 * this file for its side-effect declarations).
 */
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

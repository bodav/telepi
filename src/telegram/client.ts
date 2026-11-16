import { TelegramClient } from '@mtcute/node'
import { APP_NAME, VERSION } from '../core/constants.js'
import { ensureDirs, sessionPath } from '../core/config.js'

export interface ClientOptions {
  apiId: number
  apiHash: string
}

export async function createTelegramClient(opts: ClientOptions): Promise<TelegramClient> {
  await ensureDirs()

  return new TelegramClient({
    apiId: opts.apiId,
    apiHash: opts.apiHash,
    storage: sessionPath(),
    updates: {
      catchUp: true,
      messageGroupingInterval: 250,
    },
    initConnectionOptions: {
      deviceModel: APP_NAME,
      systemVersion: process.platform,
      appVersion: `${APP_NAME} ${VERSION}`,
      systemLangCode: 'en',
      langCode: 'en',
    },
  })
}

import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { Telemetry } from "../telemetry/telemetry"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: async () => {
      await Telemetry.init()
      try {
        const result = await cb()
        return result
      } finally {
        await Instance.dispose()
      }
    },
  })
}

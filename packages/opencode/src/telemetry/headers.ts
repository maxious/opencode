import { $ } from "bun"
import { Log } from "@/util/log"

export namespace TelemetryHeaders {
  const log = Log.create({ service: "telemetry.headers" })

  export async function getDynamicHeaders(helperPath: string): Promise<Record<string, string>> {
    try {
      const result = await $`${helperPath}`.quiet().nothrow().text()
      if (!result.trim()) return {}

      const parsed = JSON.parse(result)
      if (typeof parsed !== "object" || parsed === null) {
        log.error("helper output is not a JSON object", { output: result })
        return {}
      }

      return parsed as Record<string, string>
    } catch (e) {
      log.error("failed to run headers helper", { error: e, helperPath })
      return {}
    }
  }
}

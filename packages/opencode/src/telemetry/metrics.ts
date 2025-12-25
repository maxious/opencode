import { Telemetry } from "./telemetry"
import { Config } from "../config/config"
import { Installation } from "@/installation"
import { Identifier } from "@/id/id"

export namespace Metrics {
  let sessionCounter: any
  let tokenCounter: any
  let costCounter: any
  let locCounter: any
  let commitCounter: any
  let toolDecisionCounter: any
  let activeTimeCounter: any

  export function recordSession(attributes: Record<string, string> = {}) {
    const meter = Telemetry.getMeter()
    if (!meter) return

    sessionCounter ??= meter.createCounter("opencode.session.count", {
      description: "Count of CLI sessions started",
    })

    sessionCounter.add(1, attributes)
  }

  export function recordTokens(input: {
    type: "input" | "output" | "cacheRead" | "cacheCreation"
    model: string
    count: number
    attributes?: Record<string, string>
  }) {
    const meter = Telemetry.getMeter()
    if (!meter) return

    tokenCounter ??= meter.createCounter("opencode.token.usage", {
      description: "Number of tokens used",
    })

    tokenCounter.add(input.count, {
      ...input.attributes,
      type: input.type,
      model: input.model,
    })
  }

  export function recordCost(input: { model: string; cost: number; attributes?: Record<string, string> }) {
    const meter = Telemetry.getMeter()
    if (!meter) return

    costCounter ??= meter.createCounter("opencode.cost.usage", {
      description: "Cost of the OpenCode session in USD",
    })

    costCounter.add(input.cost, {
      ...input.attributes,
      model: input.model,
    })
  }

  export function recordLOC(input: { type: "added" | "removed"; count: number; attributes?: Record<string, string> }) {
    const meter = Telemetry.getMeter()
    if (!meter) return

    locCounter ??= meter.createCounter("opencode.lines_of_code.count", {
      description: "Count of lines of code modified",
    })

    locCounter.add(input.count, {
      ...input.attributes,
      type: input.type,
    })
  }

  export function recordCommit(attributes: Record<string, string> = {}) {
    const meter = Telemetry.getMeter()
    if (!meter) return

    commitCounter ??= meter.createCounter("opencode.commit.count", {
      description: "Number of git commits created",
    })

    commitCounter.add(1, attributes)
  }

  export function recordPR(attributes: Record<string, string> = {}) {
    const meter = Telemetry.getMeter()
    if (!meter) return

    const counter = meter.createCounter("opencode.pull_request.count", {
      description: "Number of pull requests created",
    })

    counter.add(1, attributes)
  }

  export function recordToolDecision(input: {
    tool: string
    decision: "accept" | "reject"
    language: string
    attributes?: Record<string, string>
  }) {
    const meter = Telemetry.getMeter()
    if (!meter) return

    toolDecisionCounter ??= meter.createCounter("opencode.code_edit_tool.decision", {
      description: "Count of code editing tool permission decisions",
    })

    toolDecisionCounter.add(1, {
      ...input.attributes,
      tool: input.tool,
      decision: input.decision,
      language: input.language,
    })
  }

  export function recordActiveTime(seconds: number, attributes: Record<string, string> = {}) {
    const meter = Telemetry.getMeter()
    if (!meter) return

    activeTimeCounter ??= meter.createCounter("opencode.active_time.total", {
      description: "Total active time in seconds",
    })

    activeTimeCounter.add(seconds, attributes)
  }

  export async function getStandardAttributes(sessionID?: string) {
    const cfg = await Config.get()
    const attrs: Record<string, string> = {}

    if (cfg.telemetry?.metrics?.include?.sessionId !== false && sessionID) {
      attrs["session.id"] = sessionID
    }

    if (cfg.telemetry?.metrics?.include?.version) {
      attrs["app.version"] = Installation.VERSION
    }

    if (cfg.telemetry?.metrics?.include?.accountUuid !== false && cfg.username) {
      attrs["user.account_uuid"] = cfg.username
    }

    const terminalType = process.env.TERM_PROGRAM || process.env.TERM || "unknown"
    attrs["terminal.type"] = terminalType

    return attrs
  }
}

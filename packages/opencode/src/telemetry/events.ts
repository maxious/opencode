import { Telemetry } from "./telemetry"
import { Metrics } from "./metrics"

export namespace Events {
  export async function emit(name: string, attributes: Record<string, any> = {}, sessionID?: string) {
    const logger = Telemetry.getLogger()
    if (!logger) return

    const standardAttrs = await Metrics.getStandardAttributes(sessionID)

    logger.emit({
      severityNumber: 9, // INFO
      severityText: "INFO",
      body: name,
      attributes: {
        ...standardAttrs,
        "event.name": name,
        "event.timestamp": new Date().toISOString(),
        ...attributes,
      },
    })
  }

  export async function userPrompt(input: { prompt: string; sessionID: string }) {
    const attributes: Record<string, any> = {
      prompt_length: input.prompt.length,
    }

    if (Telemetry.shouldLogPrompts()) {
      attributes["prompt"] = input.prompt
    }

    await emit("opencode.user_prompt", attributes, input.sessionID)
  }

  export async function toolResult(input: {
    toolName: string
    success: boolean
    durationMs: number
    error?: string
    decision: string
    source: string
    parameters?: any
    sessionID: string
  }) {
    await emit(
      "opencode.tool_result",
      {
        tool_name: input.toolName,
        success: input.success.toString(),
        duration_ms: input.durationMs,
        error: input.error,
        decision: input.decision,
        source: input.source,
        tool_parameters: input.parameters ? JSON.stringify(input.parameters) : undefined,
      },
      input.sessionID,
    )
  }

  export async function apiRequest(input: {
    model: string
    costUsd: number
    durationMs: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    sessionID: string
  }) {
    await emit(
      "opencode.api_request",
      {
        model: input.model,
        cost_usd: input.costUsd,
        duration_ms: input.durationMs,
        input_tokens: input.inputTokens,
        output_tokens: input.outputTokens,
        cache_read_tokens: input.cacheReadTokens,
        cache_creation_tokens: input.cacheCreationTokens,
      },
      input.sessionID,
    )
  }

  export async function apiError(input: {
    model: string
    error: string
    statusCode?: number
    durationMs: number
    attempt: number
    sessionID: string
  }) {
    await emit(
      "opencode.api_error",
      {
        model: input.model,
        error: input.error,
        status_code: input.statusCode,
        duration_ms: input.durationMs,
        attempt: input.attempt,
      },
      input.sessionID,
    )
  }

  export async function toolDecision(input: { toolName: string; decision: string; source: string; sessionID: string }) {
    await emit(
      "opencode.tool_decision",
      {
        tool_name: input.toolName,
        decision: input.decision,
        source: input.source,
      },
      input.sessionID,
    )
  }
}

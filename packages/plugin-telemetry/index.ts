import { NodeSDK } from "@opentelemetry/sdk-node"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc"
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { trace, metrics } from "@opentelemetry/api"

let initialized = false
let sdk: any = undefined

export const JaegerPlugin = async () => ({
  async config(config: any) {
    if (!config.experimental?.openTelemetry || initialized) return
    initialized = true

    console.log("Initializing Jaeger OpenTelemetry Plugin (with Metrics)...")

    const traceExporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4317",
    })

    const metricExporter = new OTLPMetricExporter({
      url: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || "http://localhost:4317",
    })

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 1000, // Export frequently for evaluation
    })

    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        ["service.name"]: "opencode-jaeger",
      }),
      traceExporter,
      metricReader,
    })

    sdk.start()
    console.log("Jaeger OTEL SDK (Traces + Metrics) started")
    
    process.on("SIGTERM", () => {
      sdk?.shutdown()
        .then(() => console.log("OTEL SDK shut down"))
        .catch((err: any) => console.log("Error shutting down OTEL SDK", err))
        .finally(() => process.exit(0))
    })
  },

  async "experimental.chat.system.transform"({ sessionID }: { sessionID: string }, { system }: { system: string[] }) {
    const span = trace.getActiveSpan()
    if (span) {
      span.setAttribute("opencode.session_id", sessionID)
      span.setAttribute("opencode.system_prompt_parts", system.length)
    }

    // Evaluate metrics from AI SDK PR 10939 logic
    const meter = metrics.getMeter("ai")
    const requestCounter = meter.createCounter("ai.requests.total")
    requestCounter.add(1, {
      "ai.operationId": "ai.streamText",
      "opencode.session_id": sessionID
    })
  }
})

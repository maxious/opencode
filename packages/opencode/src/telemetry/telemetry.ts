import { metrics, trace, type Meter, type Counter, type Histogram } from "@opentelemetry/api"
import { OTLPMetricExporter as OTLPMetricExporterGrpc } from "@opentelemetry/exporter-metrics-otlp-grpc"
import { OTLPMetricExporter as OTLPMetricExporterHttp } from "@opentelemetry/exporter-metrics-otlp-http"
import { OTLPLogExporter as OTLPLogExporterGrpc } from "@opentelemetry/exporter-logs-otlp-grpc"
import { OTLPLogExporter as OTLPLogExporterHttp } from "@opentelemetry/exporter-logs-otlp-http"
import { OTLPTraceExporter as OTLPTraceExporterGrpc } from "@opentelemetry/exporter-trace-otlp-grpc"
import { OTLPTraceExporter as OTLPTraceExporterHttp } from "@opentelemetry/exporter-trace-otlp-http"
import { MeterProvider, PeriodicExportingMetricReader, ConsoleMetricExporter } from "@opentelemetry/sdk-metrics"
import { LoggerProvider, BatchLogRecordProcessor, ConsoleLogRecordExporter, type Logger } from "@opentelemetry/sdk-logs"
import { NodeTracerProvider, SimpleSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { Config } from "../config/config"
import { Installation } from "@/installation"
import { TelemetryHeaders } from "./headers"
import os from "os"
import { Log } from "@/util/log"

export namespace Telemetry {
  const log = Log.create({ service: "telemetry" })
  let meter: Meter | undefined
  let logger: Logger | undefined
  let meterProvider: MeterProvider | undefined
  let loggerProvider: LoggerProvider | undefined
  let tracerProvider: NodeTracerProvider | undefined
  let config: Config.Info["telemetry"]
  let otlpHeaders: Record<string, string> = {}
  let initialized = false

  export async function init() {
    if (initialized) return
    let cfg
    try {
      cfg = await Config.get()
    } catch (e) {
      // Fallback if no instance context (e.g. some CLI commands)
      cfg = { telemetry: { enabled: true } }
      if (process.env.OPENCODE_CONFIG_CONTENT) {
        try {
          const parsed = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT)
          if (parsed.telemetry) cfg.telemetry = { ...cfg.telemetry, ...parsed.telemetry }
        } catch {}
      }
    }

    config = cfg.telemetry
    if (!config?.enabled) return
    initialized = true

    otlpHeaders = { ...(config.otlp?.headers ?? {}) }
    if (config.otlp?.headersHelper) {
      const dynamic = await TelemetryHeaders.getDynamicHeaders(config.otlp.headersHelper)
      Object.assign(otlpHeaders, dynamic)

      setInterval(
        async () => {
          const dynamic = await TelemetryHeaders.getDynamicHeaders(config!.otlp!.headersHelper!)
          Object.assign(otlpHeaders, dynamic)
        },
        29 * 60 * 1000,
      ).unref()
    }

    const resource = resourceFromAttributes({
      "service.name": "opencode",
      "service.version": Installation.VERSION,
      "os.type": os.platform(),
      "os.version": os.release(),
      "host.arch": os.arch(),
      ...config.resourceAttributes,
    })

    if (config.traces?.exporter !== "none") {
      const traceExporter = createTraceExporter(config)
      tracerProvider = new NodeTracerProvider({
        resource,
        spanProcessors: [new SimpleSpanProcessor(traceExporter)],
      })
      tracerProvider.register()
    }

    if (config.metrics?.exporter !== "none") {
      const metricExporter = createMetricExporter(config)
      const metricReader = new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: config.metrics?.exportInterval ?? 60000,
      })

      meterProvider = new MeterProvider({ resource, readers: [metricReader] })
      metrics.setGlobalMeterProvider(meterProvider)
      meter = metrics.getMeter("com.opencode.telemetry")
    }

    if (config.logs?.exporter !== "none") {
      const logExporter = createLogExporter(config)
      loggerProvider = new LoggerProvider({ resource })
      loggerProvider.addLogRecordProcessor(
        new BatchLogRecordProcessor(logExporter, {
          scheduledDelayMillis: config.logs?.exportInterval ?? 5000,
        }),
      )
      logger = loggerProvider.getLogger("com.opencode.telemetry")
    }

    log.info("initialized", {
      traces: config.traces?.exporter ?? "otlp",
      metrics: config.metrics?.exporter ?? "otlp",
      logs: config.logs?.exporter ?? "otlp",
    })
  }

  export async function shutdown() {
    await Promise.all([tracerProvider?.shutdown(), meterProvider?.shutdown(), loggerProvider?.shutdown()])
  }

  function createTraceExporter(cfg: NonNullable<Config.Info["telemetry"]>) {
    if (cfg.traces?.exporter === "console") return new ConsoleSpanExporter()
    const protocol = cfg.otlp?.protocol ?? "grpc"
    const endpoint = cfg.otlp?.endpoint
    if (protocol === "grpc") {
      return new OTLPTraceExporterGrpc({ url: endpoint, headers: otlpHeaders })
    }
    const url = endpoint?.endsWith("/v1/traces") ? endpoint : `${endpoint}/v1/traces`
    return new OTLPTraceExporterHttp({ url, headers: otlpHeaders })
  }

  function createMetricExporter(cfg: NonNullable<Config.Info["telemetry"]>) {
    if (cfg.metrics?.exporter === "console") return new ConsoleMetricExporter()
    const protocol = cfg.otlp?.protocol ?? "grpc"
    const endpoint = cfg.otlp?.endpoint
    if (protocol === "grpc") {
      return new OTLPMetricExporterGrpc({ url: endpoint, headers: otlpHeaders })
    }
    const url = endpoint?.endsWith("/v1/metrics") ? endpoint : `${endpoint}/v1/metrics`
    return new OTLPMetricExporterHttp({ url, headers: otlpHeaders })
  }

  function createLogExporter(cfg: NonNullable<Config.Info["telemetry"]>) {
    if (cfg.logs?.exporter === "console") return new ConsoleLogRecordExporter()
    const protocol = cfg.otlp?.protocol ?? "grpc"
    const endpoint = cfg.otlp?.endpoint
    if (protocol === "grpc") {
      return new OTLPLogExporterGrpc({ url: endpoint, headers: otlpHeaders })
    }
    const url = endpoint?.endsWith("/v1/logs") ? endpoint : `${endpoint}/v1/logs`
    return new OTLPLogExporterHttp({ url, headers: otlpHeaders })
  }

  export function getMeter() {
    return meter || metrics.getMeter("com.opencode.telemetry")
  }
  export function getLogger() {
    return logger
  }
  export function isEnabled() {
    return !!config?.enabled
  }
  export function shouldLogPrompts() {
    return !!config?.logs?.logUserPrompts
  }
}

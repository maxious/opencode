import { Log } from "../util/log"
import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import z from "zod"
import { Filesystem } from "../util/filesystem"
import { ModelsDev } from "../provider/models"
import { mergeDeep, pipe, unique } from "remeda"
import { Global } from "../global"
import fs from "fs/promises"
import { lazy } from "../util/lazy"
import { NamedError } from "@opencode-ai/util/error"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import { type ParseError as JsoncParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import { Instance } from "../project/instance"
import { LSPServer } from "../lsp/server"
import { BunProc } from "@/bun"
import { Installation } from "@/installation"
import { ConfigMarkdown } from "./markdown"

export namespace Config {
  const log = Log.create({ service: "config" })

  // Custom merge function that concatenates plugin arrays instead of replacing them
  function mergeConfigWithPlugins(target: Info, source: Info): Info {
    const merged = mergeDeep(target, source)
    // If both configs have plugin arrays, concatenate them instead of replacing
    if (target.plugin && source.plugin) {
      const pluginSet = new Set([...target.plugin, ...source.plugin])
      merged.plugin = Array.from(pluginSet)
    }
    return merged
  }

  export const state = Instance.state(async () => {
    const auth = await Auth.all()
    let result = await global()

    // Override with custom config if provided
    if (Flag.OPENCODE_CONFIG) {
      result = mergeConfigWithPlugins(result, await loadFile(Flag.OPENCODE_CONFIG))
      log.debug("loaded custom config", { path: Flag.OPENCODE_CONFIG })
    }

    for (const file of ["opencode.jsonc", "opencode.json"]) {
      const found = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
      for (const resolved of found.toReversed()) {
        result = mergeConfigWithPlugins(result, await loadFile(resolved))
      }
    }

    if (Flag.OPENCODE_CONFIG_CONTENT) {
      result = mergeConfigWithPlugins(result, JSON.parse(Flag.OPENCODE_CONFIG_CONTENT))
      log.debug("loaded custom config from OPENCODE_CONFIG_CONTENT")
    }

    for (const [key, value] of Object.entries(auth)) {
      if (value.type === "wellknown") {
        process.env[value.key] = value.token
        const wellknown = (await fetch(`${key}/.well-known/opencode`).then((x) => x.json())) as any
        result = mergeConfigWithPlugins(result, await load(JSON.stringify(wellknown.config ?? {}), process.cwd()))
      }
    }

    result.agent = result.agent || {}
    result.mode = result.mode || {}
    result.plugin = result.plugin || []

    const directories = [
      Global.Path.config,
      ...(await Array.fromAsync(
        Filesystem.up({
          targets: [".opencode"],
          start: Instance.directory,
          stop: Instance.worktree,
        }),
      )),
      ...(await Array.fromAsync(
        Filesystem.up({
          targets: [".opencode"],
          start: Global.Path.home,
          stop: Global.Path.home,
        }),
      )),
    ]

    if (Flag.OPENCODE_CONFIG_DIR) {
      directories.push(Flag.OPENCODE_CONFIG_DIR)
      log.debug("loading config from OPENCODE_CONFIG_DIR", { path: Flag.OPENCODE_CONFIG_DIR })
    }

    const promises: Promise<void>[] = []
    for (const dir of unique(directories)) {
      await assertValid(dir)

      if (dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR) {
        for (const file of ["opencode.jsonc", "opencode.json"]) {
          log.debug(`loading config from ${path.join(dir, file)}`)
          result = mergeConfigWithPlugins(result, await loadFile(path.join(dir, file)))
        }
      }
    }

    for (const file of ["opencode.jsonc", "opencode.json"]) {
      const found = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
      for (const resolved of found.toReversed()) {
        result = mergeConfigWithPlugins(result, await loadFile(resolved))
      }
    }

    return Info.parse(result)
  })

  export async function get() {
    return state()
  }

  async function loadFile(file: string) {
    if (file.endsWith(".jsonc") || file.endsWith(".json")) {
      const content = await fs.readFile(file, "utf8").catch(() => "")
      if (!content) return {}
      return load(content, file)
    }
    return {}
  }

  async function load(content: string, file: string) {
    const errors: JsoncParseError[] = []
    const result = parseJsonc(content, errors, {
      allowTrailingCommas: true,
    })
    if (errors.length) {
      for (const error of errors) {
        log.error("failed to parse config", {
          file,
          error: printParseErrorCode(error.error),
          offset: error.offset,
          length: error.length,
        })
      }
      throw new Error(`Failed to parse config file: ${file}`)
    }
    return result
  }

  async function global() {
    return {
      agent: {},
      mode: {},
      plugin: [],
    }
  }

  async function assertValid(dir: string) {
    // Check if the directory exists and is actually a directory
    try {
      const stats = await fs.stat(dir)
      if (!stats.isDirectory()) {
        log.debug("not a directory", { dir })
        return
      }
    } catch (e) {
      log.debug("directory does not exist", { dir })
      return
    }
  }

  export const Layout = z.enum(["stretch", "compact"])
  export type Layout = z.infer<typeof Layout>

  export const Permission = z.enum(["allow", "deny", "ask"])
  export type Permission = z.infer<typeof Permission>

  export const Info = z
    .object({
      username: z.string().optional().describe("OpenCode username"),
      default_agent: z.string().optional().describe("Default agent to use"),
      instructions: z.array(z.string()).optional().describe("Additional instruction files or patterns to include"),
      layout: Layout.optional().describe("@deprecated Always uses stretch layout."),
      permission: z
        .object({
          edit: Permission.optional(),
          bash: z.union([Permission, z.record(z.string(), Permission)]).optional(),
          skill: z.union([Permission, z.record(z.string(), Permission)]).optional(),
          webfetch: Permission.optional(),
          doom_loop: Permission.optional(),
          external_directory: Permission.optional(),
        })
        .optional(),
      tools: z.record(z.string(), z.boolean()).optional(),
      telemetry: z
        .object({
          enabled: z.boolean().optional().describe("Enable OpenTelemetry metrics and events collection"),
          metrics: z
            .object({
              exporter: z
                .enum(["otlp", "prometheus", "console", "none"])
                .optional()
                .default("otlp")
                .describe("Metrics exporter type (default: otlp)"),
              exportInterval: z
                .number()
                .int()
                .positive()
                .optional()
                .default(60000)
                .describe("Export interval in milliseconds (default: 60000)"),
              include: z
                .object({
                  sessionId: z
                    .boolean()
                    .optional()
                    .default(true)
                    .describe("Include session.id attribute (default: true)"),
                  version: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe("Include app.version attribute (default: false)"),
                  accountUuid: z
                    .boolean()
                    .optional()
                    .default(true)
                    .describe("Include user.account_uuid attribute (default: true)"),
                })
                .optional()
                .default({}),
            })
            .optional()
            .default({}),
          logs: z
            .object({
              exporter: z
                .enum(["otlp", "console", "none"])
                .optional()
                .default("otlp")
                .describe("Logs/events exporter type (default: otlp)"),
              exportInterval: z
                .number()
                .int()
                .positive()
                .optional()
                .default(5000)
                .describe("Export interval in milliseconds (default: 5000)"),
              logUserPrompts: z
                .boolean()
                .optional()
                .default(false)
                .describe("Include user prompt content in events (default: false for privacy)"),
            })
            .optional()
            .default({}),
          traces: z
            .object({
              exporter: z
                .enum(["otlp", "console", "none"])
                .optional()
                .default("otlp")
                .describe("Traces exporter type (default: otlp)"),
            })
            .optional()
            .default({}),
          otlp: z
            .object({
              protocol: z
                .enum(["grpc", "http/json", "http/protobuf"])
                .optional()
                .default("grpc")
                .describe("OTLP protocol (default: grpc)"),
              endpoint: z.string().optional().describe("OTLP collector endpoint (default: http://localhost:4317)"),
              headers: z
                .record(z.string(), z.string())
                .optional()
                .default({})
                .describe("Static headers for authentication"),
              headersHelper: z
                .string()
                .optional()
                .describe("Path to script that generates dynamic headers (outputs JSON)"),
            })
            .optional()
            .default({}),
          resourceAttributes: z
            .record(z.string(), z.string())
            .optional()
            .describe("Custom resource attributes (e.g., department, team.id, cost_center)"),
        })
        .optional()
        .describe("OpenTelemetry observability configuration")
        .meta({
          ref: "TelemetryConfig",
        }),
      enterprise: z
        .object({
          url: z.string().optional().describe("Enterprise URL"),
        })
        .optional(),
      experimental: z
        .object({
          hook: z
            .object({
              file_edited: z
                .record(
                  z.string(),
                  z
                    .object({
                      command: z.string().array(),
                      environment: z.record(z.string(), z.string()).optional(),
                    })
                    .array(),
                )
                .optional(),
              session_completed: z
                .object({
                  command: z.string().array(),
                  environment: z.record(z.string(), z.string()).optional(),
                })
                .array()
                .optional(),
            })
            .optional(),
          chatMaxRetries: z.number().optional().describe("Number of retries for chat completions on failure"),
          disable_paste_summary: z.boolean().optional(),
          batch_tool: z.boolean().optional().describe("Enable the batch tool"),
          openTelemetry: z
            .boolean()
            .optional()
            .describe("Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)"),
          primary_tools: z
            .array(z.string())
            .optional()
            .describe("Tools that should only be available to primary agents."),
          continue_loop_on_deny: z.boolean().optional().describe("Continue the agent loop when a tool call is denied"),
        })
        .optional(),
      agent: z.record(z.string(), z.any()).optional(),
      mode: z.record(z.string(), z.any()).optional(),
      plugin: z.array(z.string()).optional(),
      snapshot: z.boolean().optional().default(true).describe("Enable or disable snapshot tracking"),
      mcp: z.record(z.string(), z.any()).optional(),
    })
    .strict()
    .meta({
      ref: "Config",
    })

  export type Info = z.output<typeof Info>

  export async function reset() {
    state.reset()
  }
}

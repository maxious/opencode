import type { Hooks, PluginInput, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Server } from "../server/server"
import { BunProc } from "../bun"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const state = Instance.state(async () => {
    // console.log("[Plugin] Initializing state...")
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      // @ts-ignore - fetch type incompatibility
      fetch: async (...args) => Server.App().fetch(...args),
    })
    const config = await Config.get()
    const hooks = []
    const input: PluginInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      $: Bun.$,
    }
    const plugins = [...(config.plugin ?? [])]
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      plugins.push("opencode-copilot-auth@0.0.9")
      plugins.push("opencode-anthropic-auth@0.0.5")
    }
    for (let plugin of plugins) {
      // console.log("[Plugin] Loading:", plugin)
      if (!plugin.startsWith("file://")) {
        const lastAtIndex = plugin.lastIndexOf("@")
        const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
        const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
        plugin = await BunProc.install(pkg, version)
      } else {
        plugin = plugin.replace("file://", "")
      }
      try {
        const mod = await import(plugin)
        for (const [name, fn] of Object.entries<PluginInstance>(mod)) {
          if (typeof fn !== "function") continue
          // console.log("[Plugin] Initializing hook function:", name)
          const init = await fn(input)
          hooks.push(init)
        }
      } catch (e) {
        // console.error("[Plugin] Failed to load plugin:", plugin, e)
      }
    }

    return {
      hooks,
      input,
    }
  })

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    if (!name) return output
    const s = await state()
    for (const hook of s.hooks) {
      const fn = hook[name]
      if (!fn) continue
      await fn(input, output)
    }
    return output
  }

  export async function list() {
    return state().then((x) => x.hooks)
  }

  export async function init() {
    const s = await state()
    const config = await Config.get()
    for (const hook of s.hooks) {
      await hook.config?.(config)
    }
    Bus.subscribeAll(async (input) => {
      const s = await state()
      for (const hook of s.hooks) {
        hook["event"]?.({
          event: input,
        })
      }
    })
  }
}

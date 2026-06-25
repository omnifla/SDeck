import type { DeckPlugin, ActionContext } from "../src/types";

// ── Shell plugin ───────────────────────────────────────────────────────────────
// Runs commands defined directly in the profile JSON under "options":
//
//   "options": {
//     "cmd": ["powershell", "-Command", "Start-Process wt"],
//     "label": "Done",
//     "errorLabel": "Error",
//     "resetAfterMs": 2000
//   }
//
// cmd is an array so args are passed safely without shell injection.

const plugin: DeckPlugin = {
  name: "shell",

  actions: {
    async run({ keyIndex, pushDisplay, state }: ActionContext) {
      const opts = state.get<{
        cmd: string[];
        label?: string;
        errorLabel?: string;
        resetAfterMs?: number;
      }>(`shell.key.${keyIndex}.options`);

      if (!opts?.cmd?.length) {
        console.warn(
          `[shell] no cmd configured for key ${keyIndex} — set options in profile JSON`,
        );
        return;
      }

      pushDisplay({ keyIndex, label: "...", color: "#888888" });

      try {
        const proc = Bun.spawn(opts.cmd, { stdout: "pipe", stderr: "pipe" });
        const exitCode = await proc.exited;

        if (exitCode === 0) {
          pushDisplay({
            keyIndex,
            label: opts.label ?? "Done",
            color: "#4CAF50",
          });
        } else {
          const errText = await new Response(proc.stderr).text();
          console.error(
            `[shell] key ${keyIndex} exited ${exitCode}:`,
            errText.trim(),
          );
          pushDisplay({
            keyIndex,
            label: opts.errorLabel ?? "Error",
            color: "#F44336",
          });
        }
      } catch (err) {
        console.error(`[shell] key ${keyIndex} spawn failed:`, err);
        pushDisplay({
          keyIndex,
          label: opts.errorLabel ?? "Error",
          color: "#F44336",
        });
      }

      const resetMs = opts.resetAfterMs ?? 2000;
      if (resetMs > 0) {
        setTimeout(
          () => pushDisplay({ keyIndex, label: "", color: "#222222" }),
          resetMs,
        );
      }
    },
  },
};

export default plugin;

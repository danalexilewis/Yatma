export type ComposerMode = "message" | "task" | "project";

/** Slash commands select a capture mode; ordinary slashes remain message text. */
export function parseComposerInput(value: string, mode: ComposerMode) {
  const command = /^\/(task|project|heading|message)(?:\s+|$)/i.exec(value);
  return command
    ? {
        mode: (command[1]!.toLowerCase() === "heading"
          ? "project"
          : command[1]!.toLowerCase()) as ComposerMode,
        text: value.slice(command[0].length),
        command: true,
      }
    : { mode, text: value, command: false };
}

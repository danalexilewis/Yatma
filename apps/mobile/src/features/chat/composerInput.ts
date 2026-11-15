export type ComposerInput =
  | { readonly kind: "list" }
  | { readonly kind: "message"; readonly text: string };

/** Only a complete /list command is local; unknown commands and prose reach the conversation. */
export function parseComposerInput(value: string): ComposerInput {
  const text = value.trim();
  return /^\/list$/i.test(text) ? { kind: "list" } : { kind: "message", text };
}

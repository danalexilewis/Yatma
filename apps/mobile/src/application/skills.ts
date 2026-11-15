import type { SaveSkill } from "@yatma/core";

import { getSyncEngine } from "../sync/engine";

function client() {
  const engine = getSyncEngine();
  if (!engine) throw new Error("Sign in and connect to manage your skills.");
  return engine.client;
}
export function listSkills() {
  return client().listSkills();
}
export function saveSkill(input: SaveSkill) {
  return client().saveSkill(input);
}
export function deleteSkill(id: string) {
  return client().deleteSkill(id);
}

/** Only declared public API messages are shown; transport/provider details stay out of the UI. */
export function skillsErrorMessage(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "invalid_request" &&
    "message" in cause &&
    typeof cause.message === "string"
  )
    return cause.message;
  return "Could not load or save skills. Check your connection and try again.";
}

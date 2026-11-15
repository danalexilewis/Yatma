import type { ReviewSchedule } from "@yatma/contracts/review";
import { getSyncEngine } from "./engine";

function client() {
  const engine = getSyncEngine();
  if (!engine) throw new Error("Sign in and connect to manage review invitations and Gmail.");
  return engine.client;
}
export function readReviewSchedule() {
  return client().readReviewSchedule();
}
export function saveReviewSchedule(input: ReviewSchedule) {
  return client().saveReviewSchedule(input);
}
export function gmailStatus() {
  return client().gmailStatus();
}
export function beginGmail() {
  return client().beginGmail();
}
export function completeGmail(input: { code: string; state: string }) {
  return client().completeGmail(input);
}
export function importGmail(pageToken?: string) {
  return client().importGmail(pageToken);
}
export function disconnectGmail() {
  return client().disconnectGmail();
}

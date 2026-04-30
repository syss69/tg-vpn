import crypto from "crypto";

export function generateSubscriptionToken(length = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

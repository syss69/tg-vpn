import { getPool } from "../db/pool";
import { SubscriptionTokensRepository } from "../repositories/subscriptionTokens.repository";
import { generateSubscriptionToken } from "../utils/generateToken";

export async function createSubscriptionToken(params: {
  subscriptionId: number;
  expiresAt?: Date | null;
}) {
  const { subscriptionId, expiresAt = null } = params;

  const subscriptionTokensRepository = new SubscriptionTokensRepository(getPool());

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateSubscriptionToken(32);

    try {
      const created = await subscriptionTokensRepository.create({
        subscriptionId,
        token,
        expiresAt,
      });

      return created;
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;
      if (code === "23505") {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Failed to generate unique subscription token");
}

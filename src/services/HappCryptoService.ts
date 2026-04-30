export class HappCryptoService {
  async encryptSubscriptionUrl(subscriptionUrl: string): Promise<string | null> {
    const normalizedUrl = subscriptionUrl.trim();
    if (!normalizedUrl) {
      return null;
    }

    try {
      const response = await fetch("https://crypto.happ.su/api-v2.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: normalizedUrl }),
      });

      const responseText = (await response.text()).trim();
      if (!response.ok) {
        console.warn(
          "[HappCryptoService] encryptSubscriptionUrl non-OK response:",
          response.status,
          responseText.slice(0, 300)
        );
        return null;
      }

      if (
        responseText.startsWith("happ://crypt5/") ||
        responseText.startsWith("happ://crypt4/") ||
        responseText.startsWith("happ://crypto")
      ) {
        return responseText;
      }

      try {
        const json = JSON.parse(responseText) as Record<string, unknown>;
        const keysToCheck = [
          "encrypted_link",
          "encryptedLink",
          "link",
          "url",
          "result",
          "data",
        ] as const;
        for (const key of keysToCheck) {
          const value = json[key];
          if (typeof value === "string" && value.trim().startsWith("happ://crypt")) {
            return value.trim();
          }
        }
      } catch {
        console.warn(
          "[HappCryptoService] encryptSubscriptionUrl unexpected response:",
          responseText.slice(0, 300)
        );
        return null;
      }

      console.warn(
        "[HappCryptoService] encryptSubscriptionUrl no encrypted link in response:",
        responseText.slice(0, 300)
      );
      return null;
    } catch (error) {
      console.warn("[HappCryptoService] encryptSubscriptionUrl failed:", error);
      return null;
    }
  }
}

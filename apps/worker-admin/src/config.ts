import { AppError } from "./errors";
import type { Env } from "./types";

export interface Config {
  environment: Env["ENVIRONMENT"];
  allowedOrigins: Set<string>;
  githubOwner: string;
  githubRepo: string;
  githubRef: string;
  writesEnabled: boolean;
  githubAppId?: string;
  githubInstallationId?: string;
  githubAppPrivateKey?: string;
  ipHashPepper?: string;
}

export function getConfig(env: Env): Config {
  const allowedOrigins = new Set(env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowedOrigins.size) throw new AppError(503, "configuration_error", "Не настроен список разрешённых origin");
  return {
    environment: env.ENVIRONMENT,
    allowedOrigins,
    githubOwner: env.GITHUB_OWNER.trim(),
    githubRepo: env.GITHUB_REPO.trim(),
    githubRef: env.GITHUB_REF.trim() || "main",
    writesEnabled: env.WRITES_ENABLED === "true",
    githubAppId: env.GITHUB_APP_ID,
    githubInstallationId: env.GITHUB_INSTALLATION_ID,
    githubAppPrivateKey: env.GITHUB_APP_PRIVATE_KEY,
    ipHashPepper: env.IP_HASH_PEPPER
  };
}

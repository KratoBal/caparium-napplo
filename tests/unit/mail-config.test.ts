// The SMTP settings come from the environment only, and a missing one is named, never a value (caparium-hibak-4).
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { mailConfig } from "@/lib/mail";

const full = {
  CAPARIUM_SMTP_HOST: "smtp.example.test",
  CAPARIUM_SMTP_PORT: "587",
  CAPARIUM_SMTP_USER: "user@example.test",
  CAPARIUM_SMTP_PASSWORD: "not-a-real-key",
  CAPARIUM_MAIL_FROM: "napplo@example.test",
};

describe("mailConfig", () => {
  it("reads the five variables", () => {
    expect(mailConfig(full)).toEqual({ host: "smtp.example.test", port: 587, user: "user@example.test", password: "not-a-real-key", from: "napplo@example.test" });
  });

  it("a missing or broken one is a 503 that names it, never the password's value", () => {
    const err = (env: Record<string, string | undefined>) => {
      try {
        mailConfig(env);
        return null;
      } catch (e) {
        return e as AppError;
      }
    };
    const none = err({});
    expect([none?.status, none?.code]).toEqual([503, "MAIL_NOT_CONFIGURED"]);
    expect(none?.message).toBe("A levélküldés nincs beállítva: hiányzik vagy hibás: CAPARIUM_SMTP_HOST, CAPARIUM_SMTP_PORT, CAPARIUM_SMTP_USER, CAPARIUM_SMTP_PASSWORD, CAPARIUM_MAIL_FROM.");
    expect(err({ ...full, CAPARIUM_SMTP_PASSWORD: " " })?.message).toMatch(/: CAPARIUM_SMTP_PASSWORD\.$/);
    const port = err({ ...full, CAPARIUM_SMTP_PORT: "levél" });
    expect(port?.message).toMatch(/: CAPARIUM_SMTP_PORT\.$/);
    expect(port?.message).not.toContain("not-a-real-key");
  });
});

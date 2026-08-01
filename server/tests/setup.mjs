import { randomBytes } from "node:crypto";

process.env.ADMIN_PASSWORD ??= randomBytes(32).toString("hex");
process.env.DEV_PANEL_PASSWORD ??= randomBytes(32).toString("hex");
process.env.NODE_ENV = "test";
process.env.SF_TEST_FAST_PASSWORDS = "1";

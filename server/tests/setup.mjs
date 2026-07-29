import { randomBytes } from "node:crypto";

process.env.ADMIN_PASSWORD ??= randomBytes(32).toString("hex");

import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Image Docker légère : seul le serveur et ses dépendances sont copiés.
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../../"),
  transpilePackages: ["@hub/shared"],
  poweredByHeader: false,
};

export default config;

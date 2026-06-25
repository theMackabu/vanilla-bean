import path from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeConfigPlugin, configPlugin } from "./config.ts";
import { jsxPlugin } from "./jsx.ts";
import { devPlugin } from "./serve.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

export type Ctx = {
  meta: any;
  ssrBuild: boolean;
  runtime: { transitions: boolean };
  CONFIG_ID: string;
  entryFile: string;
  serverEntry: string;
  indexPath: string;
  apiRoutesPath: string;
  devEntry: string;
};

export default function framework(userSite: any = {}, opts: any = {}): any[] {
  const ssrBuild = !!opts.ssrBuild;
  const entryFile = path.join(here, "../../client.ts");
  const ctx: Ctx = {
    meta: { lang: "en", title: "app", description: "", ...(userSite.meta || {}) },
    ssrBuild,
    runtime: { transitions: !!userSite.transitions },
    CONFIG_ID: "virtual:framework-config",
    entryFile,
    serverEntry: path.join(here, "../../server/server.ts"),
    indexPath: path.join(here, "../../index.ts"),
    apiRoutesPath: path.join(here, "../../server/api-routes.ts"),
    devEntry: "/" + path.relative(process.cwd(), entryFile).split(path.sep).join("/"),
  };

  return [runtimeConfigPlugin(ctx), configPlugin(ctx), jsxPlugin(ctx), devPlugin(ctx)];
}

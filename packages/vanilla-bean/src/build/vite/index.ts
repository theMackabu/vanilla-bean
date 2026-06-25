import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsxPlugin } from "./jsx.ts";
import { devPlugin } from "./serve.ts";
import { runtimeConfigPlugin, configPlugin } from "./config.ts";

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
  const entryFile = path.join(here, "client.js");

  const ctx: Ctx = {
    ssrBuild,
    entryFile,

    meta: {
      lang: "en",
      title: "app",
      description: "",
      ...(userSite.meta || {}),
    },

    runtime: { transitions: !!userSite.transitions },
    CONFIG_ID: "virtual:framework-config",

    serverEntry: path.join(here, "server.js"),
    indexPath: path.join(here, "index.js"),
    apiRoutesPath: path.join(here, "api-routes.js"),
    devEntry: "/" + path.relative(process.cwd(), entryFile).split(path.sep).join("/"),
  };

  return [runtimeConfigPlugin(ctx), configPlugin(ctx), jsxPlugin(ctx), devPlugin(ctx)];
}

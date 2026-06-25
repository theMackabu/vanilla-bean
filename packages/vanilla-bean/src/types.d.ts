declare module "virtual:framework-config" {
  const config: Record<string, unknown>;
  export default config;
}

interface ImportMeta {
  env?: { SSR?: boolean; [k: string]: unknown };
  glob(pattern: string): Record<string, () => Promise<any>>;
}

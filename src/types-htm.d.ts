declare module "htm/dist/htm.mjs" {
  const htm: {
    bind<HResult>(h: (...args: unknown[]) => HResult): (strings: TemplateStringsArray, ...values: unknown[]) => HResult | HResult[];
  };
  export default htm;
}

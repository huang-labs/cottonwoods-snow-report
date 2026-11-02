declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

declare module "harfbuzz-runtime/hb.js" {
  const createHarfBuzz: (options: {
    instantiateWasm: (
      imports: WebAssembly.Imports,
      receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) => WebAssembly.Exports;
  }) => Promise<unknown>;
  export default createHarfBuzz;
}

declare module "harfbuzz-runtime/hbjs.js" {
  const hbjs: (module: unknown) => unknown;
  export default hbjs;
}

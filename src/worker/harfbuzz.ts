// Emscripten's default loader fetches/compiles WASM at runtime. Workers require
// a module bundled ahead of time; retain the upstream JS API and initialization.
// The npm alias avoids recursively resolving Wrangler's harfbuzzjs alias.
import createHarfBuzz from "harfbuzz-runtime/hb.js";
import hbjs from "harfbuzz-runtime/hbjs.js";
import wasm from "harfbuzz-runtime/hb.wasm";

export default createHarfBuzz({
  instantiateWasm(imports, receiveInstance) {
    const instance = new WebAssembly.Instance(wasm, imports);
    receiveInstance(instance, wasm);
    return instance.exports;
  },
}).then(hbjs);

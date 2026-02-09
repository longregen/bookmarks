{ runCommand, lib, serverVendor }:

runCommand "bookmark-rag-server-src"
{
  src = lib.cleanSourceWith {
    src = ../server;
    filter = path: _type:
      let baseName = builtins.baseNameOf path; in
      !(builtins.elem baseName [
        "node_modules"
        ".wrangler"
        "data"
        ".env"
        "vendor"
      ]);
  };
  meta = {
    description = "Bookmark RAG Deno server (source)";
    license = lib.licenses.mit;
  };
}
''
  cp -r $src $out
  chmod -R u+w $out
  cp -r ${serverVendor} $out/vendor
''

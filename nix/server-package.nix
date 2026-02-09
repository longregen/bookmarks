{ runCommand, lib }:

runCommand "bookmark-rag-server-src"
{
  src = lib.cleanSourceWith {
    src = ../server;
    filter = path: type:
      let baseName = builtins.baseNameOf path; in
      !(builtins.elem baseName [
        "node_modules"
        ".wrangler"
        "data"
        ".env"
      ]);
  };
  meta = {
    description = "Bookmark RAG Deno server (source)";
    license = lib.licenses.mit;
  };
}
''
  cp -r $src $out
''

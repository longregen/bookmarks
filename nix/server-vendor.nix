{ stdenv, deno, cacert, lib }:

stdenv.mkDerivation {
  name = "bookmark-rag-vendor";

  src = lib.cleanSourceWith {
    src = ../server;
    filter = path: _type:
      let baseName = builtins.baseNameOf path; in
      builtins.elem baseName [ "deno.json" "deno.lock" ];
  };

  nativeBuildInputs = [ deno cacert ];

  outputHash = "sha256-fn8yDkqBF+ULOsUHsseGJbjBfocdeDMgpQEJjMK/7xo=";
  outputHashAlgo = "sha256";
  outputHashMode = "recursive";

  buildPhase = ''
    export HOME=$TMPDIR
    deno install
  '';

  installPhase = ''
    cp -r vendor $out
  '';
}
